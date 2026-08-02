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

  versaoNodeMinima: 24,

  /**
   * Camada de IA — opcional e DESLIGADA por padrão (princípio 2).
   *
   * O provedor é um Ollama rodando na própria máquina: nenhum dado sai daqui,
   * não há chave de API para vazar e o princípio 4 (offline após o primeiro
   * build) continua valendo depois que o modelo é baixado.
   */
  ia: {
    ligada: /^(1|true|on|sim)$/i.test(process.env.DEVLAB_IA ?? ''),
    url: (process.env.DEVLAB_IA_URL ?? 'http://127.0.0.1:11434').replace(/\/+$/, ''),
    modelo: process.env.DEVLAB_IA_MODELO ?? 'qwen2.5-coder:7b',
    timeoutMs: num(process.env.DEVLAB_IA_TIMEOUT_MS, 120_000),
    /** Teto do trecho de terminal enviado ao modelo. */
    maxContextoChars: 4000,
  },
} as const

export const caminhoBanco = (): string => path.join(config.dirDados, 'progresso.db')
