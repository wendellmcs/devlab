import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { carregarConteudo } from '../../agent/src/conteudo/carregador.ts'
import type { Licao } from '../../agent/src/conteudo/schema.ts'
import { montarEstaticos } from '../../agent/src/http/estaticos.ts'
import {
  montarPayloadDeLicao,
  montarPayloadDeTrilha,
} from '../../agent/src/http/payloads.ts'
import type { ProgressoLicao, ResumoProgresso } from '../../agent/src/progresso/store.ts'
import type { ResultadoVerificacao } from '../../agent/src/verificacao/executor.ts'
import type { LabComPrazo } from '../../agent/src/lab/tipos.ts'
import type { EstadoDoLab } from '../../agent/src/estado/extrator.ts'
import { descreverLimites } from '../../agent/src/lab/limites.ts'

/**
 * Servidor de fixtures da auditoria de acessibilidade.
 *
 * O gate de contraste em `tokens.test.ts` prova a PALETA; ele não prova a
 * TELA. Um par aprovado na tabela ainda pode chegar ao browser aplicado à
 * superfície errada, ou sobreposto por uma opacidade que ninguém somou. Só o
 * axe rodando sobre o DOM renderizado pega isso — e para haver DOM é preciso
 * subir as telas.
 *
 * Subir as telas de verdade exigiria Docker: a tela de lição só existe depois
 * que um container está de pé. Este servidor troca APENAS o Docker por dados
 * fixos. Conteúdo, montagem de payload e servidor de arquivos são os módulos
 * reais do agente, importados daqui — se o payload mudar de forma, isto para
 * de compilar antes de passar a auditar uma tela que já não existe.
 *
 * O que é falso está confinado a este arquivo: lab, estado do container e
 * resultado de verificação.
 */

const AQUI_ARQUIVO = fileURLToPath(import.meta.url)
const RAIZ_REPO = path.resolve(path.dirname(AQUI_ARQUIVO), '..', '..', '..')

/**
 * Lição usada na tela de lição auditada. Fixa de propósito: a auditoria compara
 * resultado entre execuções, e "a primeira que o glob pegar" tornaria a
 * comparação instável a cada lição nova.
 */
export const LICAO_AUDITADA = 'linux-op-10-globbing'

/**
 * Progresso simulado: trilha na lição 10 de 12.
 *
 * O corte é o que faz o mapa exibir os três estados ao mesmo tempo —
 * concluída (1 a 9), disponível (10) e bloqueada (11 e 12) — e é também o que
 * DESTRAVA a lição auditada. Encurtar esta lista deixa `LICAO_AUDITADA` atrás
 * de um pré-requisito pendente: ela some do mapa como cartão sem link, e o
 * percurso de teclado não tem por onde entrar.
 */
const CONCLUIDAS = new Set([
  'linux-op-01-shell',
  'linux-op-02-listar',
  'linux-op-03-caminhos',
  'linux-op-04-hierarquia',
  'linux-op-05-criar',
  'linux-op-06-copiar-mover',
  'linux-op-07-remover',
  'linux-op-08-ler-arquivos',
  'linux-op-09-ajuda',
])

const RESUMO: ResumoProgresso = {
  xpTotal: 126,
  licoesConcluidas: 9,
  licoesSemAjuda: 6,
  tentativasTotais: 21,
  porTrilha: [{ trilha: 'linux', concluidas: 9, xp: 126 }],
}

function progressoDe(licaoId: string): ProgressoLicao | null {
  if (CONCLUIDAS.has(licaoId)) {
    return {
      licaoId,
      trilha: 'linux',
      estado: 'concluida',
      tentativas: 2,
      dicaMaxima: 0,
      usouIa: false,
      xpGanho: 14,
      semAjuda: true,
      primeiraEm: 1_699_000_000_000,
      concluidaEm: 1_699_100_000_000,
    }
  }
  if (licaoId !== LICAO_AUDITADA) return null
  return {
    licaoId,
    trilha: 'linux',
    estado: 'em_andamento',
    tentativas: 3,
    dicaMaxima: 0,
    usouIa: false,
    xpGanho: 0,
    semAjuda: false,
    primeiraEm: 1_700_000_000_000,
    concluidaEm: null,
  }
}

const TTL_TOTAL_MS = 45 * 60 * 1000
/** Sobra do lab "recém-tocado": longe do limiar, nenhum aviso na tela. */
const TTL_FOLGADO_MS = 40 * 60 * 1000
/** Sobra que dispara o aviso de 2.2.6 — 4 min e 12 s, com os dois dígitos. */
const TTL_APERTADO_MS = 4 * 60 * 1000 + 12_000

function labFalso(licao: Licao): LabComPrazo {
  return {
    id: 'lab-auditoria',
    containerId: 'devlab-auditoria-0000',
    licaoId: licao.id,
    imagem: licao.lab.imagem,
    usuario: licao.lab.usuario,
    workdir: licao.lab.workdir,
    estado: 'pronto',
    criadoEm: 1_700_000_000_000,
    ultimaAtividade: 1_700_000_000_000,
    acoesDoAluno: 0,
    resets: 1,
    limites: descreverLimites(licao.lab),
    ociosidadeRestanteMs: TTL_FOLGADO_MS,
    ttlMs: TTL_TOTAL_MS,
  }
}

const ESTADO_FALSO: EstadoDoLab = {
  raiz: '/home/aluno',
  truncada: true,
  atualizadoEm: 1_700_000_000_000,
  ttl: { restanteMs: TTL_FOLGADO_MS, totalMs: TTL_TOTAL_MS },
  // Zero por padrão: sair da lição não deve pedir confirmação a quem não fez
  // nada. As telas que auditam a confirmação ligam isto pelo controle abaixo.
  acoesDoAluno: 0,
  recursos: { cpuPercent: 3.7, memoriaUsadaMb: 48, memoriaLimiteMb: 512, pids: 6 },
  arvore: {
    nome: 'aluno',
    caminho: '/home/aluno',
    tipo: 'diretorio',
    tamanho: 4096,
    permissoes: 'drwxr-xr-x',
    dono: 'aluno',
    filhos: [
      {
        nome: 'documentos',
        caminho: '/home/aluno/documentos',
        tipo: 'diretorio',
        tamanho: 4096,
        permissoes: 'drwxr-xr-x',
        dono: 'aluno',
        filhos: [
          {
            nome: 'nota importante.txt',
            caminho: '/home/aluno/documentos/nota importante.txt',
            tipo: 'arquivo',
            tamanho: 0,
            permissoes: '-rw-r--r--',
            dono: 'aluno',
            filhos: [],
          },
        ],
      },
      {
        nome: 'logs',
        caminho: '/home/aluno/logs',
        tipo: 'diretorio',
        tamanho: 4096,
        permissoes: 'drwxr-xr-x',
        dono: 'aluno',
        filhos: [
          {
            nome: 'chamadas.log',
            caminho: '/home/aluno/logs/chamadas.log',
            tipo: 'arquivo',
            tamanho: 812,
            permissoes: '-rw-r--r--',
            dono: 'aluno',
            filhos: [],
          },
        ],
      },
      {
        nome: 'atalho',
        caminho: '/home/aluno/atalho',
        tipo: 'link',
        tamanho: 11,
        permissoes: 'lrwxrwxrwx',
        dono: 'aluno',
        filhos: [],
      },
    ],
  },
}

/**
 * O que `POST /api/labs/:id/verificar` devolve: o resultado do executor mais o
 * que a rota acrescenta. Declarado aqui para o compilador cobrar cada campo —
 * uma fixture com forma parecida, mas não igual, auditaria a tela errada.
 */
type RespostaDeVerificacao = ResultadoVerificacao & {
  lab: string
  xpCreditado: number
  primeiraConclusao: boolean
  progresso: ProgressoLicao
  resumo: ResumoProgresso
}

/**
 * Verificação REPROVADA — o estado de tela com mais superfície de cor do app:
 * bloco de falha, saída bruta do check e erro do catálogo, cada um com o seu
 * par texto×fundo. É o caso que mais reprovaria se a paleta escorregasse.
 */
function verificacaoReprovada(licao: Licao): RespostaDeVerificacao {
  return {
    aprovado: false,
    duracaoMs: 412,
    lab: 'lab-auditoria',
    xpCreditado: 0,
    primeiraConclusao: false,
    progresso: progressoDe(licao.id) as ProgressoLicao,
    resumo: RESUMO,
    checks: licao.verificar.map((c, indice) => ({
      indice,
      descricao: c.descricao,
      aprovado: indice !== 0,
      exit: indice === 0 ? 1 : 0,
      esperadoExit: 0,
      expirou: false,
      mensagem: indice === 0 ? 'a pasta relatorios/ nao existe' : undefined,
      dicaDiagnostica:
        indice === 0
          ? 'cp nao cria o diretorio de destino: crie antes com mkdir'
          : undefined,
      saida: indice === 0 ? "cp: cannot create regular file '/home/aluno/relatorios/': No such file or directory" : '',
    })),
    errosDetectados: [
      {
        origem: 'catalogo',
        id: 'no-such-file',
        titulo: 'Arquivo ou diretório inexistente',
        categoria: 'conceitual',
        trecho: 'No such file or directory',
        significa: 'O caminho que você passou não existe do ponto de vista do comando.',
        porque: 'O diretório de destino precisa existir antes da cópia.',
        investigar: 'Liste o diretório pai: ls -l ~',
        corrigir: 'Crie o destino primeiro: mkdir -p ~/relatorios',
      },
    ],
  }
}

function verificacaoAprovada(licao: Licao): RespostaDeVerificacao {
  return {
    aprovado: true,
    duracaoMs: 388,
    lab: 'lab-auditoria',
    xpCreditado: licao.xp,
    primeiraConclusao: true,
    progresso: {
      licaoId: licao.id,
      trilha: licao.trilha,
      estado: 'concluida',
      tentativas: 4,
      dicaMaxima: 0,
      usouIa: false,
      xpGanho: licao.xp,
      semAjuda: true,
      primeiraEm: 1_700_000_000_000,
      concluidaEm: 1_700_000_100_000,
    },
    resumo: { ...RESUMO, licoesConcluidas: 4, licoesSemAjuda: 3, xpTotal: RESUMO.xpTotal + licao.xp },
    checks: licao.verificar.map((c, indice) => ({
      indice,
      descricao: c.descricao,
      aprovado: true,
      exit: 0,
      esperadoExit: 0,
      expirou: false,
      mensagem: undefined,
      dicaDiagnostica: undefined,
      saida: '',
    })),
    errosDetectados: [],
  }
}

export async function subirServidorDeFixtures(porta = 0): Promise<{ url: string; fechar: () => Promise<void> }> {
  const conteudo = await carregarConteudo(path.join(RAIZ_REPO, 'content'))
  if (conteudo.problemas.length > 0) {
    throw new Error(`conteúdo com problemas: ${conteudo.problemas.join('; ')}`)
  }
  const porId = new Map(conteudo.licoes.map((l) => [l.id, l]))
  const estaticos = montarEstaticos()

  /** Dicas já reveladas nesta execução — o custo de XP é encenado, o DOM não. */
  const reveladas = new Set<number>()
  let verificacoes = 0
  let doctorQuebrado = false
  /** Sobra de prazo que a próxima tela vai enxergar. */
  let restanteMs = TTL_FOLGADO_MS
  /** O aluno já mexeu no lab? É o que decide se sair pede confirmação. */
  let acoesDoAluno = 0

  const contexto = (licao: Licao) => ({
    reveladas: [...reveladas],
    concluidas: CONCLUIDAS,
    progresso: progressoDe(licao.id),
  })

  const servidor = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const rota = url.pathname
      const metodo = (req.method ?? 'GET').toUpperCase()

      const json = (corpo: unknown, status = 200): void => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(corpo))
      }

      if (!rota.startsWith('/api/')) {
        await estaticos(req, res)
        return
      }

      // Controle da auditoria: zera o que uma tela anterior deixou para trás e
      // escolhe se o diagnóstico do ambiente responde pronto ou quebrado. Cada
      // tela é auditada a partir de um estado conhecido, não do resíduo da
      // anterior — senão a ordem das telas mudaria o resultado.
      if (rota === '/api/_fixture/estado' && metodo === 'POST') {
        reveladas.clear()
        verificacoes = 0
        doctorQuebrado = url.searchParams.get('doctor') === 'quebrado'
        restanteMs = url.searchParams.get('ttl') === 'apertado' ? TTL_APERTADO_MS : TTL_FOLGADO_MS
        acoesDoAluno = url.searchParams.get('trabalhou') === '1' ? 3 : 0
        json({ ok: true, doctorQuebrado, restanteMs, acoesDoAluno })
        return
      }

      if (rota === '/api/doctor') {
        json(
          doctorQuebrado
            ? {
                pronto: false,
                em: 1_700_000_000_000,
                verificacoes: [
                  {
                    id: 'docker',
                    titulo: 'Docker acessível',
                    estado: 'falha',
                    detalhe: 'não foi possível falar com o daemon do Docker',
                    correcao: 'Suba o serviço: sudo systemctl start docker',
                  },
                  {
                    id: 'grupo',
                    titulo: 'Usuário no grupo docker',
                    estado: 'aviso',
                    detalhe: 'o shell atual ainda não pegou o grupo',
                    correcao: 'Abra um shell novo, ou rode: sg docker -c "npm run iniciar"',
                  },
                  {
                    id: 'node',
                    titulo: 'Node 24 ou superior',
                    estado: 'ok',
                    detalhe: `v${process.versions.node}`,
                  },
                ],
              }
            : { pronto: true, em: 1_700_000_000_000, verificacoes: [] },
        )
        return
      }

      if (rota === '/api/ia/estado') {
        json({
          ligada: false,
          disponivel: false,
          provedor: 'ollama',
          url: 'http://127.0.0.1:11434',
          modelo: 'qwen2.5-coder:7b',
          modelosLocais: [],
          sugestao: 'Suba o agente com DEVLAB_IA=1 para habilitar a camada opcional.',
          momentos: [],
        })
        return
      }

      if (rota === '/api/trilhas') {
        json(
          conteudo.trilhas.map((t) =>
            montarPayloadDeTrilha(
              t,
              conteudo.licoes.filter((l) => l.trilha === t.id),
              CONCLUIDAS,
              progressoDe,
            ),
          ),
        )
        return
      }

      if (rota === '/api/progresso') {
        json({ resumo: RESUMO, licoes: [], historicoDeErros: [] })
        return
      }

      if (rota === '/api/labs' && metodo === 'POST') {
        const licao = porId.get(LICAO_AUDITADA)
        if (licao === undefined) {
          json({ erro: `lição de auditoria ausente: ${LICAO_AUDITADA}` }, 500)
          return
        }
        json({ lab: labFalso(licao), licao: montarPayloadDeLicao(licao, contexto(licao)) })
        return
      }

      const dica = /^\/api\/licoes\/([^/]+)\/dica$/.exec(rota)
      if (dica !== null && metodo === 'POST') {
        const licao = porId.get(decodeURIComponent(dica[1] as string))
        if (licao === undefined) {
          json({ erro: 'lição inexistente' }, 404)
          return
        }
        // Revela a escada inteira até o nível pedido; a auditoria quer o DOM
        // de dica aberta, não o contador de XP.
        const nivel = Math.min(licao.dicas.length, reveladas.size + 1)
        reveladas.add(nivel)
        json({
          nivel,
          texto: licao.dicas[nivel - 1],
          custoXp: 0,
          licao: montarPayloadDeLicao(licao, contexto(licao)),
        })
        return
      }

      if (/^\/api\/licoes\/[^/]+$/.test(rota)) {
        const id = decodeURIComponent(rota.slice('/api/licoes/'.length))
        const licao = porId.get(id)
        if (licao === undefined) {
          json({ erro: 'lição inexistente' }, 404)
          return
        }
        json(montarPayloadDeLicao(licao, contexto(licao)))
        return
      }

      if (/^\/api\/labs\/[^/]+\/estado$/.test(rota)) {
        // O prazo é FIXO entre leituras, de propósito: a auditoria compara
        // telas entre execuções, e um relógio que anda de verdade produziria
        // captura diferente a cada vez. A contagem local da interface continua
        // rodando por cima disso — o que se audita aqui é o DOM do aviso.
        json({ ...ESTADO_FALSO, ttl: { restanteMs, totalMs: TTL_TOTAL_MS }, acoesDoAluno })
        return
      }

      if (/^\/api\/labs\/[^/]+\/renovar$/.test(rota) && metodo === 'POST') {
        const licao = porId.get(LICAO_AUDITADA)
        if (licao === undefined) {
          json({ erro: 'lição de auditoria ausente' }, 500)
          return
        }
        restanteMs = TTL_TOTAL_MS
        json({ ...labFalso(licao), ociosidadeRestanteMs: TTL_TOTAL_MS })
        return
      }

      if (/^\/api\/labs\/[^/]+\/verificar$/.test(rota) && metodo === 'POST') {
        const licao = porId.get(LICAO_AUDITADA)
        if (licao === undefined) {
          json({ erro: 'lição de auditoria ausente' }, 500)
          return
        }
        // A primeira tentativa reprova e a segunda aprova: os dois blocos de
        // resultado têm cores próprias, e os dois precisam ser auditados.
        verificacoes += 1
        json(verificacoes === 1 ? verificacaoReprovada(licao) : verificacaoAprovada(licao))
        return
      }

      if (/^\/api\/labs\/[^/]+$/.test(rota) && metodo === 'DELETE') {
        json({ destruido: true })
        return
      }

      json({ erro: `rota de fixture não implementada: ${metodo} ${rota}` }, 404)
    })()
  })

  await new Promise<void>((resolve) => servidor.listen(porta, '127.0.0.1', resolve))
  const endereco = servidor.address()
  if (endereco === null || typeof endereco === 'string') {
    throw new Error('servidor de fixtures sem porta')
  }

  return {
    url: `http://127.0.0.1:${endereco.port}`,
    fechar: () =>
      new Promise<void>((resolve, reject) =>
        servidor.close((e) => (e !== undefined && e !== null ? reject(e) : resolve())),
      ),
  }
}

// Execução direta: útil para abrir as telas no browser e inspecionar à mão.
// Compara caminhos resolvidos, não URLs: a raiz do repositório tem espaço no
// nome, e `import.meta.url` o traz percent-encoded.
if (process.argv[1] !== undefined && AQUI_ARQUIVO === path.resolve(process.argv[1])) {
  const { url } = await subirServidorDeFixtures(7799)
  console.log(`fixtures de acessibilidade em ${url}`)
}
