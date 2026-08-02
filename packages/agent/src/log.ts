type Nivel = 'debug' | 'info' | 'aviso' | 'erro'

const ORDEM: Record<Nivel, number> = { debug: 10, info: 20, aviso: 30, erro: 40 }

const nivelMinimo: Nivel = (() => {
  const bruto = (process.env.DEVLAB_LOG ?? 'info').toLowerCase()
  return bruto in ORDEM ? (bruto as Nivel) : 'info'
})()

const COR: Record<Nivel, string> = {
  debug: '\x1b[2m',
  info: '\x1b[36m',
  aviso: '\x1b[33m',
  erro: '\x1b[31m',
}
const RESET = '\x1b[0m'
const colorir = process.stderr.isTTY && !process.env.NO_COLOR

function emitir(nivel: Nivel, mensagem: string, extra?: unknown): void {
  if (ORDEM[nivel] < ORDEM[nivelMinimo]) return
  const hora = new Date().toISOString().slice(11, 23)
  const etiqueta = nivel.toUpperCase().padEnd(5)
  const cabecalho = colorir ? `${COR[nivel]}${etiqueta}${RESET}` : etiqueta
  const linha = `${hora} ${cabecalho} ${mensagem}`
  if (extra === undefined) process.stderr.write(linha + '\n')
  else process.stderr.write(`${linha} ${formatar(extra)}\n`)
}

function formatar(valor: unknown): string {
  if (valor instanceof Error) return `${valor.name}: ${valor.message}`
  if (typeof valor === 'string') return valor
  try {
    return JSON.stringify(valor)
  } catch {
    return String(valor)
  }
}

export const log = {
  debug: (m: string, extra?: unknown) => emitir('debug', m, extra),
  info: (m: string, extra?: unknown) => emitir('info', m, extra),
  aviso: (m: string, extra?: unknown) => emitir('aviso', m, extra),
  erro: (m: string, extra?: unknown) => emitir('erro', m, extra),
}
