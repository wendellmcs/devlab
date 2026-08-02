import http from 'node:http'

import { caminhoBanco, config } from './config.ts'
import { log } from './log.ts'
import { IndiceDeConteudo } from './conteudo/carregador.ts'
import { diagnosticarDaemon } from './docker/cliente.ts'
import { GerenciadorDeLabs } from './lab/gerenciador.ts'
import { ExecutorDeChecks } from './verificacao/executor.ts'
import { ExtratorDeEstado } from './estado/extrator.ts'
import { ArmazemDeProgresso } from './progresso/store.ts'
import { ProvedorOllama } from './ia/ollama.ts'
import { ServicoDeIa } from './ia/servico.ts'
import { montarApi } from './http/api.ts'
import { montarPontePty } from './http/pty.ts'
import { origemPermitida } from './http/origem.ts'
import { responder } from './http/roteador.ts'

async function principal(): Promise<void> {
  const indice = new IndiceDeConteudo()
  const conteudo = await indice.recarregar(config.dirConteudo)
  for (const problema of conteudo.problemas) log.aviso(`conteúdo: ${problema}`)
  log.info(
    `conteúdo carregado: ${conteudo.trilhas.length} trilha(s), ${conteudo.licoes.length} lição(ões)`,
  )

  const daemon = await diagnosticarDaemon()
  if (daemon.ok) {
    log.info(`docker ${daemon.versao} (API ${daemon.apiVersao})`)
  } else {
    log.aviso(`docker indisponível: ${daemon.erro}`)
    log.aviso(daemon.sugestao)
    log.aviso('a interface sobe mesmo assim; rode "npm run doctor" para o diagnóstico completo')
  }

  const progresso = new ArmazemDeProgresso(caminhoBanco())
  const labs = new GerenciadorDeLabs()
  const checks = new ExecutorDeChecks(labs, conteudo.catalogo)
  const extrator = new ExtratorDeEstado(labs)

  const ia = new ServicoDeIa(new ProvedorOllama())
  if (ia.ligada) {
    const d = await ia.estado()
    if (d.disponivel) log.info(`IA local ligada: ${d.modelo} via ${d.provedor}`)
    else log.aviso(`IA ligada mas indisponível: ${d.erro ?? '?'} — ${d.sugestao ?? ''}`)
  } else {
    log.info('IA desligada (padrão). Para ligar: DEVLAB_IA=1')
  }

  if (daemon.ok) await labs.limparOrfaos()
  labs.iniciarColetor()

  const api = montarApi({ indice, labs, checks, extrator, progresso, ia })

  const servidor = http.createServer((req, res) => {
    aplicarCabecalhos(req, res)
    void api.despachar(req, res).catch((e: unknown) => {
      log.erro('falha não tratada no despacho', e)
      if (!res.writableEnded) responder(res, 500, { erro: 'erro interno' })
    })
  })

  const wss = montarPontePty(servidor, labs)

  servidor.listen(config.porta, config.host, () => {
    log.info(`devlab-agent em http://${config.host}:${config.porta}`)
    log.info(`interface (vite): http://127.0.0.1:5173`)
  })

  let encerrando = false
  const encerrar = async (sinal: string): Promise<void> => {
    // Segundo Ctrl+C não pode atropelar o primeiro: `#labs` já estaria vazio
    // e o process.exit sairia com as remoções ainda em voo, deixando os
    // containers de pé depois de o usuário achar que saiu.
    if (encerrando) {
      log.aviso(`${sinal} novamente — saindo à força`)
      process.exit(1)
    }
    encerrando = true

    log.info(`recebido ${sinal} — destruindo labs e encerrando`)
    servidor.close()
    wss.close()
    labs.pararColetor()

    // Teto de tempo: `container.remove()` contra um daemon travado não retorna,
    // e aí o Ctrl+C nunca devolveria o prompt.
    const limite = new Promise<void>((r) => setTimeout(r, 15_000).unref())
    await Promise.race([labs.destruirTodos(), limite])

    progresso.fechar()
    process.exit(0)
  }

  process.on('SIGINT', () => void encerrar('SIGINT'))
  process.on('SIGTERM', () => void encerrar('SIGTERM'))

  // Sem isto, um erro não tratado derruba o processo deixando todos os
  // containers vivos até o `limparOrfaos` do próximo boot.
  process.on('uncaughtException', (e) => {
    log.erro('exceção não tratada', e)
    void encerrar('uncaughtException')
  })
  process.on('unhandledRejection', (e) => {
    log.erro('promessa rejeitada sem tratamento', e)
  })
}

/**
 * Tudo é local: o agente só aceita o browser da própria máquina.
 * Em desenvolvimento o Vite já faz proxy de /api e /ws, então isto cobre
 * apenas o caso de alguém abrir a API direto.
 */
function aplicarCabecalhos(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origem = req.headers.origin
  if (origemPermitida(origem)) {
    res.setHeader('access-control-allow-origin', origem as string)
    res.setHeader('access-control-allow-headers', 'content-type')
    res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS')
  }
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('vary', 'origin')
}

principal().catch((e: unknown) => {
  log.erro('o agente não conseguiu subir', e)
  process.exitCode = 1
})
