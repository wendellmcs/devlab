import type { IncomingMessage, ServerResponse } from 'node:http'

import { log } from '../log.ts'
import { ErroDeLab } from '../docker/cliente.ts'
import { hostPermitido, origemPermitida } from './origem.ts'

export type Metodo = 'GET' | 'POST' | 'DELETE'

export type Contexto = {
  req: IncomingMessage
  res: ServerResponse
  params: Record<string, string>
  query: URLSearchParams
  corpo: unknown
}

export type Manipulador = (ctx: Contexto) => unknown | Promise<unknown>

/** Erro de aplicação com status HTTP explícito. */
export class ErroHttp extends Error {
  readonly status: number
  readonly codigo: string

  constructor(status: number, codigo: string, mensagem: string) {
    super(mensagem)
    this.name = 'ErroHttp'
    this.status = status
    this.codigo = codigo
  }
}

/**
 * Casa um padrão de rota contra um caminho.
 * Segmentos iniciados por ':' viram parâmetros nomeados.
 */
export function casarRota(padrao: string, caminho: string): Record<string, string> | null {
  const p = dividir(padrao)
  const c = dividir(caminho)
  if (p.length !== c.length) return null

  const params: Record<string, string> = {}
  for (let i = 0; i < p.length; i += 1) {
    const esperado = p[i] as string
    const recebido = c[i] as string
    if (esperado.startsWith(':')) {
      if (recebido === '') return null
      params[esperado.slice(1)] = decodeURIComponent(recebido)
      continue
    }
    if (esperado !== recebido) return null
  }
  return params
}

function dividir(caminho: string): string[] {
  return caminho.replace(/\/+$/, '').split('/').filter((s) => s !== '')
}

const LIMITE_CORPO = 1024 * 1024

export class Roteador {
  readonly #rotas: { metodo: Metodo; padrao: string; manipulador: Manipulador }[] = []

  get(padrao: string, manipulador: Manipulador): this {
    this.#rotas.push({ metodo: 'GET', padrao, manipulador })
    return this
  }

  post(padrao: string, manipulador: Manipulador): this {
    this.#rotas.push({ metodo: 'POST', padrao, manipulador })
    return this
  }

  delete(padrao: string, manipulador: Manipulador): this {
    this.#rotas.push({ metodo: 'DELETE', padrao, manipulador })
    return this
  }

  async despachar(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const metodo = (req.method ?? 'GET').toUpperCase()

    if (metodo === 'OPTIONS') {
      responder(res, 204, null)
      return
    }

    // Guarda de CSRF para tudo que muda estado. O browser sempre manda
    // `Origin` em POST/DELETE, inclusive same-origin; um formulário hostil
    // chega com a origem do site dele e é recusado aqui. Cliente que não é
    // browser (curl, script) não manda `Origin` — e não é vetor de CSRF.
    if (metodo !== 'GET' && !hostPermitido(req.headers.host)) {
      responder(res, 403, { erro: 'host não permitido', codigo: 'host_recusado' })
      return
    }
    if (
      metodo !== 'GET' &&
      req.headers.origin !== undefined &&
      !origemPermitida(req.headers.origin)
    ) {
      responder(res, 403, { erro: 'origem não permitida', codigo: 'origem_recusada' })
      return
    }

    for (const rota of this.#rotas) {
      if (rota.metodo !== metodo) continue
      const params = casarRota(rota.padrao, url.pathname)
      if (params === null) continue

      try {
        const corpo = metodo === 'POST' && temCorpo(req) ? await lerCorpo(req) : undefined
        const resultado = await rota.manipulador({
          req,
          res,
          params,
          query: url.searchParams,
          corpo,
        })
        if (!res.writableEnded) responder(res, 200, resultado ?? { ok: true })
      } catch (e) {
        tratarErro(res, e, `${metodo} ${url.pathname}`)
      }
      return
    }

    responder(res, 404, { erro: 'rota inexistente', caminho: url.pathname })
  }
}

function tratarErro(res: ServerResponse, e: unknown, rota: string): void {
  if (e instanceof ErroHttp) {
    responder(res, e.status, { erro: e.message, codigo: e.codigo })
    return
  }
  if (e instanceof ErroDeLab) {
    const status = e.codigo === 'lab_inexistente' ? 404 : 400
    responder(res, status, { erro: e.message, codigo: e.codigo, detalhe: e.detalhe })
    return
  }
  log.erro(`falha em ${rota}`, e)
  responder(res, 500, {
    erro: e instanceof Error ? e.message : 'erro interno',
    codigo: 'erro_interno',
  })
}

/** POST sem corpo é legítimo (reset, recarregar): não force JSON no vazio. */
function temCorpo(req: IncomingMessage): boolean {
  const tamanho = req.headers['content-length']
  if (req.headers['transfer-encoding'] !== undefined) return true
  return tamanho !== undefined && tamanho !== '0'
}

export function responder(res: ServerResponse, status: number, corpo: unknown): void {
  if (corpo === null) {
    res.writeHead(status)
    res.end()
    return
  }
  const texto = JSON.stringify(corpo)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(texto),
    'cache-control': 'no-store',
  })
  res.end(texto)
}

async function lerCorpo(req: IncomingMessage): Promise<unknown> {
  // Exigir JSON fecha a classe inteira de CSRF: um <form> só consegue enviar
  // application/x-www-form-urlencoded, multipart ou text/plain, e nenhum
  // desses dispara preflight — logo o CORS não impediria o efeito colateral.
  const tipo = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase()
  if (tipo !== 'application/json') {
    throw new ErroHttp(
      415,
      'tipo_nao_suportado',
      'o corpo precisa ser enviado com content-type: application/json',
    )
  }

  const pedacos: Buffer[] = []
  let total = 0
  for await (const pedaco of req) {
    const buf = Buffer.from(pedaco as Buffer)
    total += buf.length
    if (total > LIMITE_CORPO) throw new ErroHttp(413, 'corpo_grande', 'corpo da requisição grande demais')
    pedacos.push(buf)
  }
  if (total === 0) return undefined
  const texto = Buffer.concat(pedacos).toString('utf8')
  try {
    return JSON.parse(texto)
  } catch {
    throw new ErroHttp(400, 'json_invalido', 'corpo não é JSON válido')
  }
}
