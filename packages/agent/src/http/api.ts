import { config } from '../config.ts'
import { rodarDoctor } from '../doctor.ts'
import type { IndiceDeConteudo } from '../conteudo/carregador.ts'
import type { Licao } from '../conteudo/schema.ts'
import type { GerenciadorDeLabs } from '../lab/gerenciador.ts'
import type { LabInfo } from '../lab/tipos.ts'
import type { ExecutorDeChecks, ResultadoVerificacao } from '../verificacao/executor.ts'
import type { ExtratorDeEstado } from '../estado/extrator.ts'
import type { ArmazemDeProgresso } from '../progresso/store.ts'
import { CUSTO_DE_DICA, licaoDesbloqueada } from '../progresso/regras.ts'
import type { ServicoDeIa } from '../ia/servico.ts'
import { MOMENTOS, type Momento } from '../ia/tipos.ts'
import {
  montarPayloadDeLicao,
  montarPayloadDeTrilha,
  type ContextoDeProgresso,
} from './payloads.ts'
import { ErroHttp, Roteador } from './roteador.ts'

/** Teto de containers vivos ao mesmo tempo. */
const MAX_LABS_SIMULTANEOS = 6

export type Dependencias = {
  indice: IndiceDeConteudo
  labs: GerenciadorDeLabs
  checks: ExecutorDeChecks
  extrator: ExtratorDeEstado
  progresso: ArmazemDeProgresso
  ia: ServicoDeIa
}

export function montarApi(dep: Dependencias): Roteador {
  const r = new Roteador()

  // Última verificação por lab: é o que dá à IA o diagnóstico real do erro,
  // sem precisar que o browser mande nada (e sem confiar no que ele mandaria).
  const ultimaVerificacao = new Map<string, ResultadoVerificacao>()

  r.get('/api/saude', () => ({
    ok: true,
    versaoNode: process.versions.node,
    licoes: dep.indice.licoes.length,
    labsAtivos: dep.labs.listar().length,
    problemasDeConteudo: dep.indice.problemas,
  }))

  r.get('/api/doctor', () => rodarDoctor())

  r.post('/api/conteudo/recarregar', async () => {
    const conteudo = await dep.indice.recarregar(config.dirConteudo)
    dep.checks.atualizarCatalogo(conteudo.catalogo)
    return {
      trilhas: conteudo.trilhas.length,
      licoes: conteudo.licoes.length,
      problemas: conteudo.problemas,
    }
  })

  // ── conteúdo e progresso ────────────────────────────────────────────────

  r.get('/api/trilhas', () => {
    const concluidas = dep.progresso.concluidas()
    return dep.indice.trilhas.map((trilha) =>
      montarPayloadDeTrilha(trilha, dep.indice.licoesDaTrilha(trilha.id), concluidas, (id) =>
        dep.progresso.progresso(id),
      ),
    )
  })

  r.get('/api/licoes/:id', ({ params }) => {
    const licao = exigirLicao(dep, params['id'] as string)
    return montarPayloadDeLicao(licao, contextoDe(dep, licao))
  })

  r.post('/api/licoes/:id/dica', ({ params, corpo }) => {
    const licao = exigirLicao(dep, params['id'] as string)
    const nivel = Number((corpo as { nivel?: unknown } | undefined)?.nivel)

    if (!Number.isInteger(nivel) || nivel < 1 || nivel > licao.dicas.length) {
      throw new ErroHttp(
        400,
        'nivel_invalido',
        `esta lição tem ${licao.dicas.length} dica(s); nível pedido: ${String(nivel)}`,
      )
    }

    dep.progresso.revelarDica(licao.id, licao.trilha, nivel)
    return {
      nivel,
      texto: licao.dicas[nivel - 1],
      custoXp: Math.round(licao.xp * (CUSTO_DE_DICA[nivel] ?? 0)),
      licao: montarPayloadDeLicao(licao, contextoDe(dep, licao)),
    }
  })

  r.get('/api/progresso', () => ({
    resumo: dep.progresso.resumo(),
    licoes: dep.progresso.todosOsProgressos(),
    historicoDeErros: dep.progresso.historicoDeErros(20),
  }))

  r.get('/api/erros', () => dep.indice.catalogo)

  // ── labs ────────────────────────────────────────────────────────────────

  r.get('/api/labs', () => dep.labs.listar())

  r.post('/api/labs', async ({ corpo }) => {
    const licaoId = (corpo as { licaoId?: unknown } | undefined)?.licaoId
    if (typeof licaoId !== 'string') {
      throw new ErroHttp(400, 'licao_id_ausente', 'informe licaoId no corpo')
    }
    const licao = exigirLicao(dep, licaoId)

    // Cada lab é um container real com 512 MB e 1 CPU reservados. Sem teto,
    // uma UI travada em laço — ou uma página hostil — enfileira criações até
    // a máquina do aluno engasgar.
    if (dep.labs.listar().length >= MAX_LABS_SIMULTANEOS) {
      throw new ErroHttp(
        429,
        'labs_demais',
        `já existem ${MAX_LABS_SIMULTANEOS} labs ativos. Feche um antes de abrir outro.`,
      )
    }

    const concluidas = dep.progresso.concluidas()
    if (!licaoDesbloqueada(licao.prereqs, concluidas)) {
      const faltando = licao.prereqs.filter((p) => !concluidas.has(p))
      throw new ErroHttp(
        409,
        'prereq_pendente',
        `esta lição destrava depois de: ${faltando.join(', ')}`,
      )
    }

    dep.progresso.iniciar(licao.id, licao.trilha)
    const info = await dep.labs.criar(licao)
    return { lab: info, licao: montarPayloadDeLicao(licao, contextoDe(dep, licao)) }
  })

  r.get('/api/labs/:labId', ({ params }) => exigirLab(dep, params['labId'] as string))

  r.post('/api/labs/:labId/reset', ({ params }) => dep.labs.reiniciar(params['labId'] as string))

  r.get('/api/labs/:labId/estado', ({ params, query }) => {
    const labId = params['labId'] as string
    exigirLab(dep, labId)
    const raiz = query.get('raiz') ?? undefined
    const profundidade = query.has('profundidade')
      ? Number(query.get('profundidade'))
      : undefined
    return dep.extrator.coletar(labId, { raiz, profundidade })
  })

  r.post('/api/labs/:labId/verificar', async ({ params }) => {
    const labId = params['labId'] as string
    const info = exigirLab(dep, labId)
    const licao = dep.labs.licaoDoLab(labId)
    if (licao === undefined) {
      throw new ErroHttp(409, 'lab_sem_licao', 'este lab não está associado a uma lição')
    }

    const resultado = await dep.checks.verificar(labId, licao)
    ultimaVerificacao.set(labId, resultado)

    const registro = dep.progresso.registrarTentativa({
      licaoId: licao.id,
      trilha: licao.trilha,
      xpBase: licao.xp,
      aprovada: resultado.aprovado,
      duracaoMs: resultado.duracaoMs,
      checks: resultado.checks.map((c) => ({
        descricao: c.descricao,
        aprovado: c.aprovado,
        exit: c.exit,
      })),
      erros: resultado.errosDetectados,
    })

    return {
      ...resultado,
      lab: info.id,
      xpCreditado: registro.xpCreditado,
      primeiraConclusao: registro.primeiraConclusao,
      progresso: registro.progresso,
      resumo: dep.progresso.resumo(),
    }
  })

  r.delete('/api/labs/:labId', async ({ params }) => {
    ultimaVerificacao.delete(params['labId'] as string)
    await dep.labs.destruir(params['labId'] as string)
    return { destruido: true }
  })

  // ── IA local, opcional ──────────────────────────────────────────────────

  r.get('/api/ia/estado', () => dep.ia.estado())

  r.post('/api/ia/:momento', async ({ params, corpo }) => {
    const momento = params['momento'] as Momento
    if (!(MOMENTOS as readonly string[]).includes(momento)) {
      throw new ErroHttp(404, 'momento_invalido', `momento de IA desconhecido: ${momento}`)
    }
    if (!dep.ia.ligada) {
      throw new ErroHttp(
        409,
        'ia_desligada',
        'a camada de IA está desligada — suba o agente com DEVLAB_IA=1',
      )
    }

    const labId = (corpo as { labId?: unknown } | undefined)?.labId
    if (typeof labId !== 'string') {
      throw new ErroHttp(400, 'lab_id_ausente', 'informe labId no corpo')
    }
    exigirLab(dep, labId)

    const licao = dep.labs.licaoDoLab(labId)
    if (licao === undefined) {
      throw new ErroHttp(409, 'lab_sem_licao', 'este lab não está associado a uma lição')
    }

    // Cobra ANTES de responder: se o modelo falhar no meio, o aluno não fica
    // com a dúvida de ter pago sem receber — e não dá para sondar de graça.
    dep.progresso.marcarUsoDeIa(licao.id, licao.trilha)

    const anterior = ultimaVerificacao.get(labId)
    const resposta = await dep.ia.responder({
      momento,
      licao,
      terminal: dep.labs.saidaRecente(labId),
      ...(anterior !== undefined ? { ultimaVerificacao: anterior } : {}),
    })

    return {
      ...resposta,
      custoXp: Math.round(licao.xp * (CUSTO_DE_DICA[3] ?? 0)),
      licao: montarPayloadDeLicao(licao, contextoDe(dep, licao)),
    }
  })

  return r
}

function exigirLicao(dep: Dependencias, id: string): Licao {
  const licao = dep.indice.licao(id)
  if (licao === undefined) {
    throw new ErroHttp(404, 'licao_inexistente', `lição '${id}' não existe`)
  }
  return licao
}

function exigirLab(dep: Dependencias, labId: string): LabInfo {
  const info = dep.labs.obter(labId)
  if (info === undefined) {
    throw new ErroHttp(404, 'lab_inexistente', `lab '${labId}' não existe ou já foi destruído`)
  }
  return info
}

/** As três leituras de progresso que a montagem do payload precisa. */
function contextoDe(dep: Dependencias, licao: Licao): ContextoDeProgresso {
  return {
    reveladas: dep.progresso.dicasReveladas(licao.id),
    concluidas: dep.progresso.concluidas(),
    progresso: dep.progresso.progresso(licao.id),
  }
}
