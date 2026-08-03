import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'

import { config } from '../config.ts'
import { diagnosticarDaemon, docker } from '../docker/cliente.ts'
import { LicaoSchema, type Licao } from '../conteudo/schema.ts'
import { ExecutorDeChecks } from '../verificacao/executor.ts'
import { ExtratorDeEstado } from '../estado/extrator.ts'
import { GerenciadorDeLabs } from './gerenciador.ts'
import { ENSINO_MINIMO } from '../conteudo/ensino-minimo.ts'

/**
 * Teste de integração do Lab Manager: sobe container de verdade.
 *
 * Pré-requisitos: Docker acessível e a imagem devlab/linux-base construída
 * (`npm run imagens`). Sem isso, a suíte é pulada em vez de falhar.
 */
const motivoPular = await descobrirMotivoParaPular()

async function descobrirMotivoParaPular(): Promise<string | false> {
  const daemon = await diagnosticarDaemon()
  if (!daemon.ok) return `Docker indisponível: ${daemon.erro}`
  try {
    await docker().getImage(config.imagemPadrao).inspect()
    return false
  } catch {
    return `imagem ${config.imagemPadrao} ausente — rode: npm run imagens`
  }
}

function licaoDeTeste(extra: Partial<Record<string, unknown>> = {}): Licao {
  return LicaoSchema.parse({
    id: 'teste-integracao',
    trilha: 'linux',
    nivel: 'operador',
    ordem: 1,
    titulo: 'Lição de integração',
    capacidade: 'Sei rodar o teste.',
    objetivo_md: 'crie /home/aluno/alvo.txt',
    xp: 10,
    ensino: ENSINO_MINIMO,
    verificar: [
      {
        descricao: 'alvo.txt existe',
        script: [
          '#!/bin/bash',
          'if [ ! -f /home/aluno/alvo.txt ]; then',
          `  echo 'DEVLAB_JSON:{"mensagem":"alvo.txt nao existe"}'`,
          '  exit 1',
          'fi',
          'exit 0',
        ].join('\n'),
      },
    ],
    ...extra,
  })
}

describe('GerenciadorDeLabs (integração)', { skip: motivoPular, concurrency: false }, () => {
  const labs = new GerenciadorDeLabs()

  after(async () => {
    await labs.destruirTodos()
  })

  it('cria um lab pronto a partir da imagem-semente', async () => {
    const info = await labs.criar(licaoDeTeste())
    assert.equal(info.estado, 'pronto')
    assert.equal(info.imagem, config.imagemPadrao)
    await labs.destruir(info.id)
  })

  it('executa comandos dentro do container e captura stdout, stderr e exit', async () => {
    const info = await labs.criar(licaoDeTeste())

    const ok = await labs.exec(info.id, ['/bin/bash', '-c', 'echo ola; echo erro >&2; exit 3'])
    assert.equal(ok.stdout.trim(), 'ola')
    assert.equal(ok.stderr.trim(), 'erro')
    assert.equal(ok.exit, 3)

    await labs.destruir(info.id)
  })

  it('grava arquivo no lab por cópia, sem bind mount', async () => {
    const info = await labs.criar(licaoDeTeste())

    const conteudo = 'linha um\nlinha dois com acento: ação\n'
    await labs.escreverArquivo(info.id, '/tmp/devlab/exemplo.txt', conteudo)
    const lido = await labs.exec(info.id, ['cat', '/tmp/devlab/exemplo.txt'])

    assert.equal(lido.stdout, conteudo)
    await labs.destruir(info.id)
  })

  it('aplica o setup declarado pela lição', async () => {
    const licao = licaoDeTeste({
      lab: { setup: 'install -o aluno -g aluno -d /home/aluno/semeado\ntouch /home/aluno/semeado/ok' },
    })
    const info = await labs.criar(licao)

    const r = await labs.exec(info.id, ['test', '-f', '/home/aluno/semeado/ok'])
    assert.equal(r.exit, 0)

    await labs.destruir(info.id)
  })

  it('respeita o limite de memória declarado', async () => {
    const licao = licaoDeTeste({ lab: { limites: { memoria_mb: 256 } } })
    const info = await labs.criar(licao)

    const r = await labs.exec(info.id, ['cat', '/sys/fs/cgroup/memory.max'])
    assert.equal(r.stdout.trim(), String(256 * 1024 * 1024))

    await labs.destruir(info.id)
  })

  it('o kernel aplica de fato o no-new-privileges e o conjunto mínimo de caps', async () => {
    const info = await labs.criar(licaoDeTeste())

    // Os testes de unidade provam o que foi ENVIADO ao Docker. Isto prova o
    // que o kernel aplicou — que é a garantia que o README vende.
    const noNewPrivs = await labs.exec(info.id, [
      '/bin/bash',
      '-c',
      'grep NoNewPrivs /proc/self/status',
    ])
    assert.match(noNewPrivs.stdout, /NoNewPrivs:\s*1/)

    // CapEff do processo root do container: sem NET_ADMIN (bit 12) nem
    // SYS_ADMIN (bit 21), que são os que dariam caminho para o host.
    const caps = await labs.exec(info.id, [
      '/bin/bash',
      '-c',
      "grep CapEff /proc/self/status | awk '{print $2}'",
    ])
    const efetivas = BigInt(`0x${caps.stdout.trim()}`)
    assert.equal((efetivas >> 12n) & 1n, 0n, 'NET_ADMIN não deveria estar presente')
    assert.equal((efetivas >> 21n) & 1n, 0n, 'SYS_ADMIN não deveria estar presente')
    assert.equal((efetivas >> 0n) & 1n, 1n, 'CHOWN deveria estar presente')

    await labs.destruir(info.id)
  })

  it('mata o processo dentro do container quando o check estoura o tempo', async () => {
    const info = await labs.criar(licaoDeTeste())

    const r = await labs.exec(info.id, ['/bin/bash', '-c', 'sleep 60'], { timeoutMs: 2000 })
    assert.equal(r.expirou, true)

    // Sem `timeout` dentro do container, o sleep sobreviveria ao fim do exec e
    // cada verificação empilharia mais um até estourar o PidsLimit.
    const sobrou = await labs.exec(info.id, ['/bin/bash', '-c', 'pgrep -c -x sleep || true'])
    assert.equal(sobrou.stdout.trim(), '1', 'só o `sleep infinity` do container deveria restar')

    await labs.destruir(info.id)
  })

  it('deixa o lab sem rede externa por padrão', async () => {
    const info = await labs.criar(licaoDeTeste())

    const r = await labs.exec(info.id, ['/bin/bash', '-c', 'ls /sys/class/net'])
    assert.equal(r.stdout.trim(), 'lo')

    await labs.destruir(info.id)
  })

  it('reprova e depois aprova o mesmo check conforme o estado muda', async () => {
    const licao = licaoDeTeste()
    const info = await labs.criar(licao)
    const checks = new ExecutorDeChecks(labs, [])

    const antes = await checks.verificar(info.id, licao)
    assert.equal(antes.aprovado, false)
    assert.equal(antes.checks[0]?.mensagem, 'alvo.txt nao existe')

    await labs.exec(info.id, ['touch', '/home/aluno/alvo.txt'])

    const depois = await checks.verificar(info.id, licao)
    assert.equal(depois.aprovado, true)

    await labs.destruir(info.id)
  })

  it('o reset devolve o lab ao estado inicial', async () => {
    const info = await labs.criar(licaoDeTeste())

    await labs.exec(info.id, ['touch', '/home/aluno/sujeira.txt'])
    assert.equal((await labs.exec(info.id, ['test', '-f', '/home/aluno/sujeira.txt'])).exit, 0)

    const reiniciado = await labs.reiniciar(info.id)
    assert.equal(reiniciado.estado, 'pronto')
    assert.equal(reiniciado.resets, 1)
    assert.notEqual(reiniciado.containerId, info.containerId)
    assert.equal((await labs.exec(info.id, ['test', '-f', '/home/aluno/sujeira.txt'])).exit, 1)

    await labs.destruir(info.id)
  })

  it('lê a árvore de arquivos real do container', async () => {
    const info = await labs.criar(licaoDeTeste())
    const extrator = new ExtratorDeEstado(labs)

    const estado = await extrator.coletar(info.id)
    const nomes = (estado.arvore?.filhos ?? []).map((f) => f.nome)

    assert.ok(nomes.includes('logs'), `esperava a pasta logs na árvore; achei: ${nomes.join(', ')}`)
    assert.ok(nomes.includes('documentos'))

    await labs.destruir(info.id)
  })

  /**
   * O relógio da coleta por ociosidade mede o ALUNO, não o app.
   *
   * Este é o teste que faltava quando o TTL de 45 min era decorativo: o painel
   * de estado lê a árvore de arquivos a cada 2,5 s, e enquanto essa leitura
   * contava como atividade nenhum lab jamais ficava ocioso com a tela aberta.
   * O bug não aparecia em lugar nenhum — só num container que nunca morria.
   */
  it('ler o estado NÃO conta como atividade; ação do aluno conta', async () => {
    const info = await labs.criar(licaoDeTeste())
    const extrator = new ExtratorDeEstado(labs)

    const inicial = labs.obter(info.id)
    assert.equal(inicial?.acoesDoAluno, 0, 'o setup da lição não é ação do aluno')

    await extrator.coletar(info.id)
    const depoisDaLeitura = labs.obter(info.id)
    assert.equal(
      depoisDaLeitura?.ultimaAtividade,
      inicial?.ultimaAtividade,
      'a leitura automática de estado mexeu no relógio de ociosidade',
    )
    assert.equal(depoisDaLeitura?.acoesDoAluno, 0)

    // E o prazo anda: quem observa não interfere.
    assert.ok(
      (depoisDaLeitura?.ociosidadeRestanteMs ?? 0) < (inicial?.ociosidadeRestanteMs ?? 0),
      'o prazo deveria estar diminuindo',
    )

    // Já um exec marcado como ação do aluno zera a contagem.
    await labs.exec(info.id, ['/bin/bash', '-c', 'true'], { atividade: true })
    const depoisDaAcao = labs.obter(info.id)
    assert.ok(
      (depoisDaAcao?.ultimaAtividade ?? 0) > (inicial?.ultimaAtividade ?? 0),
      'ação do aluno deveria ter zerado o relógio',
    )
    assert.equal(depoisDaAcao?.acoesDoAluno, 1)

    await labs.destruir(info.id)
  })

  it('renovar devolve o prazo cheio sem tocar no container', async () => {
    const info = await labs.criar(licaoDeTeste())
    await labs.exec(info.id, ['/bin/bash', '-c', 'echo oi > /home/aluno/marca.txt'])

    const renovado = labs.registrarAtividade(info.id)
    assert.equal(renovado?.ociosidadeRestanteMs, renovado?.ttlMs, 'o prazo não voltou ao total')
    assert.equal(renovado?.containerId, info.containerId, 'renovar recriou o container')

    // O arquivo continua lá: renovar não é reset.
    const lido = await labs.exec(info.id, ['cat', '/home/aluno/marca.txt'])
    assert.equal(lido.stdout.trim(), 'oi')

    await labs.destruir(info.id)
  })

  it('abre um terminal com TTY e responde a comando', async () => {
    const info = await labs.criar(licaoDeTeste())
    const sessao = await labs.abrirTerminal(info.id, { cols: 80, rows: 24 })

    const saida = await new Promise<string>((resolver) => {
      let acumulado = ''
      const parar = setTimeout(() => resolver(acumulado), 8000)
      sessao.stream.on('data', (pedaco: Buffer) => {
        acumulado += pedaco.toString('utf8')
        if (acumulado.includes('MARCA-DEVLAB-OK')) {
          clearTimeout(parar)
          resolver(acumulado)
        }
      })
      setTimeout(() => sessao.stream.write('echo MARCA-DEVLAB-OK\n'), 800)
    })

    assert.match(saida, /MARCA-DEVLAB-OK/)
    await sessao.redimensionar(100, 30)
    sessao.encerrar()
    await labs.destruir(info.id)
  })

  it('destruir remove o container do Docker', async () => {
    const info = await labs.criar(licaoDeTeste())
    const containerId = info.containerId

    await labs.destruir(info.id)
    assert.equal(labs.obter(info.id), undefined)

    await assert.rejects(() => docker().getContainer(containerId).inspect())
  })

  it('recusa lição que aponta para imagem inexistente', async () => {
    const licao = licaoDeTeste({ lab: { imagem: 'devlab/nao-existe:0.0.0' } })
    await assert.rejects(() => labs.criar(licao), /não está no cache local/)
  })

  it('setup que falha não deixa container nem vaga ocupada', async () => {
    // Regressão: `criar()` lançava DEPOIS de pôr o lab no mapa e sem remover o
    // container, que ficava rodando. Como o cliente recebe 500 e nunca conhece
    // o labId, não havia como mandar DELETE — seis lições quebradas enchiam o
    // teto de labs simultâneos e travavam o aluno por 45 min, até o TTL.
    const licao = licaoDeTeste({
      lab: { setup: '#!/bin/bash\necho "falha proposital" >&2\nexit 7\n' },
    })

    const antes = await contarContainersDoTeste()
    await assert.rejects(() => labs.criar(licao), /setup .* falhou/)

    assert.deepEqual(labs.listar(), [], 'o lab que falhou não pode ocupar vaga')
    assert.equal(
      await contarContainersDoTeste(),
      antes,
      'o container do lab que falhou tem de sumir junto',
    )
  })
})

/** Containers desta lição de teste que ainda existem no daemon. */
async function contarContainersDoTeste(): Promise<number> {
  const lista = await docker().listContainers({
    all: true,
    filters: { label: ['devlab.licao=teste-integracao'] },
  })
  return lista.length
}
