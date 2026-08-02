import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import { WebSocketServer, type WebSocket } from 'ws'

import { log } from '../log.ts'
import type { GerenciadorDeLabs } from '../lab/gerenciador.ts'

import { hostPermitido, origemPermitida } from './origem.ts'

export const CAMINHO_PTY = '/ws/pty'

/** Teto do buffer de saída pendente no socket antes de pausar o container. */
const TETO_BUFFER_BYTES = 1024 * 1024
/** Mensagens do browser são teclas e resize; 64 KB é folga de sobra. */
const MAX_PAYLOAD_BYTES = 64 * 1024

/** Mensagens que o browser envia (sempre texto JSON). */
type MensagemCliente =
  | { t: 'i'; d: string }
  | { t: 'r'; c: number; l: number }
  | { t: 'ping' }

const INTERVALO_KEEPALIVE_MS = 30_000

/**
 * PTY Bridge.
 *
 * Um `docker exec` com TTY por conexão — logo, cada aba de terminal do aluno é
 * uma sessão independente sobre o mesmo lab. Isso é requisito das trilhas de
 * VoIP (fs_cli numa aba, sngrep na outra) e já vale para `htop` aqui na Fase 0.
 *
 * Protocolo: cliente manda JSON em texto; servidor devolve os bytes do terminal
 * em binário e eventos de controle em texto.
 */
export function montarPontePty(servidor: Server, labs: GerenciadorDeLabs): WebSocketServer {
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: MAX_PAYLOAD_BYTES,
  })

  servidor.on('upgrade', (req, socket, cabeca) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== CAMINHO_PTY) {
      socket.destroy()
      return
    }

    // WebSocket não passa por CORS: sem esta checagem, qualquer página aberta
    // noutra aba do browser pode abrir um shell dentro do container do aluno.
    if (!origemPermitida(req.headers.origin) || !hostPermitido(req.headers.host)) {
      log.aviso('upgrade de WebSocket recusado', {
        origem: req.headers.origin ?? '(ausente)',
        host: req.headers.host ?? '(ausente)',
      })
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }

    wss.handleUpgrade(req, socket as Duplex, cabeca, (ws) => {
      wss.emit('connection', ws, req)
    })
  })

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    void abrirSessao(ws, req, labs)
  })

  return wss
}

async function abrirSessao(
  ws: WebSocket,
  req: IncomingMessage,
  labs: GerenciadorDeLabs,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const labId = url.searchParams.get('lab') ?? ''
  const cols = inteiro(url.searchParams.get('cols'), 80)
  const rows = inteiro(url.searchParams.get('rows'), 24)

  if (labs.obter(labId) === undefined) {
    ws.close(4404, 'lab inexistente')
    return
  }

  let sessao
  try {
    sessao = await labs.abrirTerminal(labId, { cols, rows })
  } catch (e) {
    log.erro(`não foi possível abrir terminal no lab ${labId}`, e)
    enviarEvento(ws, { t: 'erro', mensagem: e instanceof Error ? e.message : String(e) })
    ws.close(4500, 'falha ao abrir terminal')
    return
  }

  // A aba pode ter sido fechada durante as três idas ao daemon acima. O evento
  // 'close' já passou e não é bufferizado: sem esta guarda, a sessão e o bash
  // dentro do container ficariam vivos até a morte do container.
  if (ws.readyState !== ws.OPEN) {
    sessao.encerrar()
    return
  }

  const decodificador = new StringDecoder('utf8')
  let vivo = true
  let pausado = false

  sessao.stream.on('data', (pedaco: Buffer) => {
    if (ws.readyState !== ws.OPEN) return
    ws.send(pedaco, { binary: true })
    labs.registrarSaida(labId, decodificador.write(pedaco))

    // Backpressure: `yes` ou `cat /dev/urandom` no terminal produz muito mais
    // do que o xterm.js consome, e o buffer do socket cresce na memória do
    // HOST — fora do alcance dos limites de cgroup do container. O gatilho
    // aqui não é ataque nenhum: é um aluno curioso fazendo o que o app pede.
    if (!pausado && ws.bufferedAmount > TETO_BUFFER_BYTES) {
      pausado = true
      sessao.stream.pause()
      const drenar = (): void => {
        if (!vivo) return
        if (ws.bufferedAmount > TETO_BUFFER_BYTES / 2) {
          setTimeout(drenar, 50)
          return
        }
        pausado = false
        sessao.stream.resume()
      }
      setTimeout(drenar, 50)
    }
  })

  const encerrar = (motivo: string): void => {
    if (!vivo) return
    vivo = false
    clearInterval(keepalive)
    sessao.encerrar()
    if (ws.readyState === ws.OPEN) {
      enviarEvento(ws, { t: 'fim', motivo })
      ws.close(1000, motivo)
    }
  }

  sessao.stream.on('end', () => encerrar('shell encerrado'))
  sessao.stream.on('close', () => encerrar('shell encerrado'))
  sessao.stream.on('error', (e: unknown) => {
    log.debug('erro no stream do terminal', e)
    encerrar('erro no terminal')
  })

  ws.on('message', (dados, ehBinario) => {
    labs.registrarAtividade(labId)

    if (ehBinario) {
      sessao.stream.write(dados as Buffer)
      return
    }

    const msg = analisar(dados.toString())
    if (msg === null) return

    if (msg.t === 'i') {
      sessao.stream.write(msg.d)
    } else if (msg.t === 'r') {
      void sessao.redimensionar(msg.c, msg.l)
    }
  })

  ws.on('close', () => encerrar('conexão encerrada'))
  ws.on('error', (e) => {
    log.debug('erro no websocket do terminal', e)
    encerrar('erro no websocket')
  })

  // Ping sem olhar o pong só mantém o NAT aberto. Se o notebook suspende ou o
  // Wi-Fi cai sem FIN, o socket fica half-open, 'close' nunca chega, e a
  // sessão e o bash no container ficariam vivos indefinidamente.
  let respondeu = true
  ws.on('pong', () => {
    respondeu = true
  })

  const keepalive = setInterval(() => {
    if (ws.readyState !== ws.OPEN) return
    if (!respondeu) {
      log.debug(`terminal do lab ${labId} não respondeu ao ping — encerrando`)
      ws.terminate()
      encerrar('conexão sem resposta')
      return
    }
    respondeu = false
    ws.ping()
  }, INTERVALO_KEEPALIVE_MS)
  keepalive.unref()

  enviarEvento(ws, { t: 'pronto', lab: labId })
  log.debug(`terminal aberto no lab ${labId}`, { cols, rows })
}

function analisar(texto: string): MensagemCliente | null {
  try {
    const bruto: unknown = JSON.parse(texto)
    if (bruto === null || typeof bruto !== 'object') return null
    const obj = bruto as Record<string, unknown>

    if (obj['t'] === 'i' && typeof obj['d'] === 'string') return { t: 'i', d: obj['d'] }
    if (obj['t'] === 'r' && typeof obj['c'] === 'number' && typeof obj['l'] === 'number') {
      return { t: 'r', c: obj['c'], l: obj['l'] }
    }
    if (obj['t'] === 'ping') return { t: 'ping' }
    return null
  } catch {
    return null
  }
}

function enviarEvento(ws: WebSocket, evento: Record<string, unknown>): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(evento))
}

function inteiro(valor: string | null, padrao: number): number {
  const n = Number(valor)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : padrao
}
