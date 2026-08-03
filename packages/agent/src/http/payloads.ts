import type { Licao, Trilha } from '../conteudo/schema.ts'
import { descreverLimites } from '../lab/limites.ts'
import type { ProgressoLicao } from '../progresso/store.ts'
import { CUSTO_DE_DICA, licaoDesbloqueada } from '../progresso/regras.ts'

/**
 * Montagem dos payloads que o browser recebe.
 *
 * Vive fora de `api.ts` porque não depende de Docker, de SQLite nem de rede:
 * só de conteúdo e de três leituras de progresso. Isso deixa a MESMA função
 * servir o agente de verdade e o servidor de fixtures da auditoria de
 * acessibilidade — que precisa das telas reais sem ter container para subir.
 * Duas montagens paralelas divergiriam, e a auditoria passaria a certificar
 * uma tela que ninguém vê.
 */
export type ContextoDeProgresso = {
  /** Níveis de dica já pagos nesta lição. */
  reveladas: number[]
  concluidas: Set<string>
  progresso: ProgressoLicao | null
}

/**
 * Payload da lição para o browser.
 *
 * As dicas ainda não reveladas NÃO são enviadas: se fossem, o custo de XP
 * viraria encenação — bastaria abrir o DevTools.
 */
export function montarPayloadDeLicao(licao: Licao, ctx: ContextoDeProgresso): unknown {
  return {
    id: licao.id,
    trilha: licao.trilha,
    nivel: licao.nivel,
    ordem: licao.ordem,
    titulo: licao.titulo,
    capacidade: licao.capacidade,
    objetivo_md: licao.objetivo_md,
    xp: licao.xp,
    capstone: licao.capstone,
    prereqs: licao.prereqs,
    desbloqueada: licaoDesbloqueada(licao.prereqs, ctx.concluidas),
    cards_revisao: licao.cards_revisao,
    lab: {
      imagem: licao.lab.imagem,
      usuario: licao.lab.usuario,
      workdir: licao.lab.workdir,
      limites: descreverLimites(licao.lab),
      quebraConserta: licao.lab.break !== undefined,
    },
    /**
     * Blocos 1 a 7 e 9 do E-G-P.
     *
     * Vai inteiro para o browser, inclusive as respostas da prática guiada e
     * da verificação de compreensão. É deliberado, e é o oposto da regra das
     * dicas logo abaixo: aqui não há nada a "ganhar" revelando cedo — a
     * resposta de um exemplo resolvido é parte do exemplo, e o que decide XP
     * continua sendo o estado real do container, não o que o aluno leu.
     */
    ensino: licao.ensino,
    conceitos: licao.ensina.conceitos,
    /**
     * Bloco 6. Vai sem o `match`: a regex é ferramenta do classificador, não
     * conteúdo, e mostrá-la ensinaria o aluno a reconhecer o padrão do
     * detector em vez da mensagem real da ferramenta.
     */
    erros_comuns: licao.erros_comuns.map((e) => ({
      digita: e.digita,
      mensagem: e.mensagem,
      causa: e.causa,
      conserto: e.conserto,
      categoria: e.categoria,
    })),
    checks: licao.verificar.map((c, indice) => ({ indice, descricao: c.descricao })),
    dicas: {
      total: licao.dicas.length,
      custos: licao.dicas.map((_, i) => Math.round(licao.xp * (CUSTO_DE_DICA[i + 1] ?? 0))),
      reveladas: ctx.reveladas
        .filter((n) => n >= 1 && n <= licao.dicas.length)
        .map((n) => ({ nivel: n, texto: licao.dicas[n - 1] as string })),
    },
    progresso: ctx.progresso,
  }
}

/** Resumo de lição usado no mapa da trilha — sem enunciado, sem dica, sem check. */
export function montarPayloadDeTrilha(
  trilha: Trilha,
  licoes: Licao[],
  concluidas: Set<string>,
  progressoDe: (licaoId: string) => ProgressoLicao | null,
): unknown {
  return {
    ...trilha,
    licoes: licoes.map((licao) => ({
      id: licao.id,
      titulo: licao.titulo,
      nivel: licao.nivel,
      ordem: licao.ordem,
      xp: licao.xp,
      capstone: licao.capstone,
      capacidade: licao.capacidade,
      prereqs: licao.prereqs,
      desbloqueada: licaoDesbloqueada(licao.prereqs, concluidas),
      progresso: progressoDe(licao.id),
    })),
  }
}
