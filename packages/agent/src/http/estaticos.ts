import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { RAIZ_REPO } from '../config.ts'
import { log } from '../log.ts'

/** Saída do `vite build`. Gerada, não versionada. */
export const RAIZ_UI = path.join(RAIZ_REPO, 'packages', 'ui', 'dist')

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

/**
 * Servidor de arquivos da interface.
 *
 * O agente serve a própria UI em vez de delegar ao dev server do Vite. Isso
 * apaga uma classe inteira de problema: com o proxy no meio, o browser falava
 * na 5173 e o agente na 7788, então `Host` e `Origin` chegavam de uma origem
 * diferente da que atendia — foi exatamente o que derrubou POST, DELETE e o
 * WebSocket inteiro. Uma porta só, uma origem só, e as guardas voltam a
 * comparar a coisa com ela mesma.
 *
 * O Vite continua existindo para DESENVOLVER (`npm run dev`, com HMR). Ele só
 * deixa de estar no caminho de quem está estudando.
 */
export function montarEstaticos(): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const metodo = (req.method ?? 'GET').toUpperCase()
    if (metodo !== 'GET' && metodo !== 'HEAD') {
      responderTexto(res, 405, 'método não permitido')
      return
    }

    const url = new URL(req.url ?? '/', 'http://localhost')
    const alvo = resolverCaminho(url.pathname)

    // Fora da raiz da UI: `..`, `%2e%2e%2f`, byte nulo, link para fora. Um
    // servidor de arquivos que confia no caminho da URL entrega /etc/shadow.
    if (alvo === null) {
      responderTexto(res, 403, 'caminho não permitido')
      return
    }

    const arquivo = (await tipoDeArquivo(alvo)) === 'arquivo' ? alvo : null

    if (arquivo !== null) {
      await enviarArquivo(res, arquivo, metodo === 'HEAD')
      return
    }

    // Fallback de SPA: rota do React (ex.: /trilhas) não existe em disco, mas
    // tem de devolver o index para o roteamento acontecer no cliente.
    const indice = path.join(RAIZ_UI, 'index.html')
    if ((await tipoDeArquivo(indice)) === 'arquivo') {
      await enviarArquivo(res, indice, metodo === 'HEAD')
      return
    }

    // Sem build: dizer o que fazer vale mais que um 404 mudo.
    responderTexto(
      res,
      503,
      'A interface ainda não foi construída.\n\n' +
        'Construa uma vez:  npm run build --workspace @devlab/ui\n' +
        'Ou rode o setup:   ./scripts/setup.sh -y\n\n' +
        'Para desenvolver a UI com recarga automática:  npm run dev\n',
    )
  }
}

/**
 * Traduz o caminho da URL para um caminho em disco dentro de `RAIZ_UI`.
 * Devolve null quando o resultado escaparia da raiz.
 */
export function resolverCaminho(caminhoUrl: string, raiz: string = RAIZ_UI): string | null {
  let decodificado: string
  try {
    decodificado = decodeURIComponent(caminhoUrl)
  } catch {
    return null
  }
  // Byte nulo trunca strings em várias camadas abaixo: recusa antes de chegar lá.
  if (decodificado.includes('\0')) return null

  const relativo = decodificado.replace(/^\/+/, '')
  const resolvido = path.resolve(raiz, relativo)

  // `startsWith` sem o separador aceitaria `/dist-malicioso` para raiz `/dist`.
  if (resolvido !== raiz && !resolvido.startsWith(raiz + path.sep)) return null
  return resolvido
}

async function tipoDeArquivo(caminho: string): Promise<'arquivo' | 'outro'> {
  try {
    const s = await fsp.stat(caminho)
    return s.isFile() ? 'arquivo' : 'outro'
  } catch {
    return 'outro'
  }
}

async function enviarArquivo(res: ServerResponse, caminho: string, apenasCabecalho: boolean) {
  let tamanho: number
  try {
    tamanho = (await fsp.stat(caminho)).size
  } catch {
    responderTexto(res, 404, 'não encontrado')
    return
  }

  res.writeHead(200, {
    'content-type': TIPOS[path.extname(caminho).toLowerCase()] ?? 'application/octet-stream',
    'content-length': tamanho,
    // O Vite carimba hash no nome dos arquivos de `assets/`, então eles podem
    // ser cacheados para sempre. O index.html não pode: é ele que aponta para
    // os nomes novos depois de um `devlab atualizar`.
    'cache-control': ehImutavel(caminho)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
    'x-content-type-options': 'nosniff',
  })

  if (apenasCabecalho) {
    res.end()
    return
  }

  const fluxo = fs.createReadStream(caminho)
  fluxo.on('error', (e) => {
    log.debug(`falha ao ler ${caminho}`, e)
    res.destroy()
  })
  fluxo.pipe(res)
}

function ehImutavel(caminho: string): boolean {
  return path.dirname(caminho) === path.join(RAIZ_UI, 'assets')
}

function responderTexto(res: ServerResponse, status: number, texto: string): void {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(texto),
    'cache-control': 'no-store',
  })
  res.end(texto)
}

/** A UI foi construída? Usado pelo doctor e pelo lançador. */
export function uiConstruida(): boolean {
  try {
    return fs.statSync(path.join(RAIZ_UI, 'index.html')).isFile()
  } catch {
    return false
  }
}
