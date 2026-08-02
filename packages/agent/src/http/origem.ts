import { config } from '../config.ts'

/**
 * Guardas de origem do agente local.
 *
 * O agente não tem autenticação — e para uma ferramenta local em 127.0.0.1
 * isso é normal. Só que "sem autenticação" só é aceitável com três travas no
 * lugar, e as três moram aqui:
 *
 *  1. `Origin` no WebSocket. CORS **não** protege WebSocket: qualquer página
 *     aberta noutra aba pode abrir `ws://127.0.0.1:7788/ws/pty` e, acertando o
 *     labId, ganhar stdin e stdout de um shell dentro do container.
 *  2. `Host` em tudo. É o que fecha DNS rebinding — o atacante faz o domínio
 *     dele resolver para 127.0.0.1 e a partir daí o browser considera tudo
 *     same-origin, o que dispensa CORS por completo.
 *  3. `Content-Type` nos POST (em `roteador.ts`), que fecha CSRF por formulário
 *     `text/plain`, o único que não dispara preflight.
 */

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/

/** Aceita apenas origens de loopback, em qualquer porta (Vite usa a 5173). */
export function origemPermitida(origem: string | undefined): boolean {
  if (origem === undefined || origem === '') return false
  try {
    const url = new URL(origem)
    return url.protocol === 'http:' && LOOPBACK.test(url.hostname)
  } catch {
    return false
  }
}

/**
 * O `Host` tem de ser loopback na porta do agente. Um nome de domínio que
 * resolva para 127.0.0.1 chega aqui com o próprio nome no header — e é
 * exatamente esse caso que precisa ser recusado.
 */
export function hostPermitido(host: string | undefined): boolean {
  if (host === undefined || host === '') return false
  const separador = host.lastIndexOf(':')
  const nome = separador === -1 ? host : host.slice(0, separador)
  const porta = separador === -1 ? '' : host.slice(separador + 1)

  if (!LOOPBACK.test(nome)) return false
  return porta === '' || porta === String(config.porta)
}
