import path from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = path.dirname(fileURLToPath(import.meta.url))

/** packages/agent */
export const RAIZ_PACOTE = path.resolve(aqui, '..')
/** raiz do monorepo */
export const RAIZ_REPO = path.resolve(RAIZ_PACOTE, '..', '..')

function num(valor: string | undefined, padrao: number): number {
  const n = Number(valor)
  return Number.isFinite(n) && n > 0 ? n : padrao
}

/** Níveis de raciocínio aceitos pela API de nuvem. */
export type Esforco = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
const ESFORCOS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max']

/** Um valor escrito errado no .env não pode virar 400 na primeira pergunta. */
export function esforcoValido(valor: string | undefined): Esforco {
  return ESFORCOS.includes(valor ?? '') ? (valor as Esforco) : 'low'
}

export const config = {
  host: process.env.DEVLAB_HOST ?? '127.0.0.1',
  porta: num(process.env.DEVLAB_PORTA, 7788),

  /** Conteúdo declarativo (lições, catálogo de erros). Separado do código de propósito. */
  dirConteudo: process.env.DEVLAB_CONTEUDO ?? path.join(RAIZ_REPO, 'content'),
  /** Dados locais do aluno (SQLite). Nada sai da máquina. */
  dirDados: process.env.DEVLAB_DADOS ?? path.join(RAIZ_REPO, '.devlab'),

  imagemPadrao: 'devlab/linux-base:1.0.0',

  /** Labs ociosos são destruídos: o container é descartável por princípio. */
  ttlLabOciosoMs: num(process.env.DEVLAB_TTL_LAB_MS, 45 * 60 * 1000),
  /** Intervalo do coletor de labs ociosos. */
  intervaloColetorMs: 60 * 1000,

  /** Teto de tempo para um check. Um check que trava é um check reprovado. */
  timeoutCheckMs: num(process.env.DEVLAB_TIMEOUT_CHECK_MS, 30_000),
  timeoutSetupMs: num(process.env.DEVLAB_TIMEOUT_SETUP_MS, 60_000),

  /** Bytes de saída do terminal mantidos por lab, para classificar erros. */
  bufferSaidaBytes: 64 * 1024,

  /**
   * Cota de disco da camada gravável do lab (ex.: '10g'). Desligada por padrão:
   * o Docker só aceita StorageOpt no overlay2 sobre XFS com `pquota`, e no ext4
   * — o caso comum — o container nem sobe. Veja `lab/limites.ts`.
   */
  limiteDisco: process.env['DEVLAB_LIMITE_DISCO'],

  versaoNodeMinima: 24,

  /**
   * Camada de IA — opcional e DESLIGADA por padrão (princípio 2).
   *
   * Dois provedores, e o padrão é o local: um Ollama na própria máquina, onde
   * nenhum dado sai daqui, não há chave para vazar e o princípio 4 (offline
   * após o primeiro build) continua valendo depois que o modelo é baixado.
   *
   * O provedor de nuvem existe porque um modelo local útil pede ~8 GB de RAM
   * livres, e nem toda máquina tem. É opt-in explícito e traz outro contrato:
   * a chave é do aluno, o custo é dele, e o enunciado mais as últimas linhas
   * do terminal saem da máquina. Ver `ia/nuvem.ts`.
   */
  ia: {
    ligada: /^(1|true|on|sim)$/i.test(process.env.DEVLAB_IA ?? ''),
    provedor: /^(nuvem|cloud|anthropic|api)$/i.test(process.env.DEVLAB_IA_PROVEDOR ?? '')
      ? ('nuvem' as const)
      : ('ollama' as const),

    // ── local (Ollama) ──
    url: (process.env.DEVLAB_IA_URL ?? 'http://127.0.0.1:11434').replace(/\/+$/, ''),
    modelo: process.env.DEVLAB_IA_MODELO ?? 'qwen2.5-coder:7b',

    // ── nuvem (BYO key) ──
    chaveNuvem: process.env['ANTHROPIC_API_KEY'],
    modeloNuvem: process.env['DEVLAB_IA_MODELO_NUVEM'] ?? 'claude-opus-5',
    /**
     * Profundidade de raciocínio na nuvem. Tutoria é resposta curta: `low`
     * mantém latência e custo baixos e já responde bem. Suba para `medium` ou
     * `high` se quiser explicações mais elaboradas — custa mais token.
     */
    esforco: esforcoValido(process.env['DEVLAB_IA_ESFORCO']),

    timeoutMs: num(process.env.DEVLAB_IA_TIMEOUT_MS, 120_000),
    /** Teto do trecho de terminal enviado ao modelo. */
    maxContextoChars: 4000,
  },
} as const

export const caminhoBanco = (): string => path.join(config.dirDados, 'progresso.db')
