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
 *  2. `Host` em TODO método, GET inclusive. É o que fecha DNS rebinding — o
 *     atacante faz o domínio dele resolver para 127.0.0.1 e a partir daí o
 *     browser considera tudo same-origin, o que dispensa CORS por completo.
 *     Aplicar a guarda só em POST/DELETE deixava `/api/doctor` e a árvore de
 *     arquivos do container legíveis por qualquer página que fizesse o rebind.
 *  3. `Content-Type` nos POST (em `roteador.ts`), que fecha CSRF por formulário
 *     `text/plain`, o único que não dispara preflight.
 */

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/

/**
 * Nome do host de uma autoridade HTTP (`nome`, `nome:porta`, `[::1]:porta`).
 *
 * Delegar ao parser de URL evita a aritmética de dois-pontos, que erra em IPv6
 * sem porta (`[::1]` virava nome `[:`) e que trataria `127.0.0.1@evil.com`
 * como loopback — o parser devolve `evil.com`, que é o host de verdade.
 */
function nomeDoHost(autoridade: string): string | null {
  try {
    return new URL(`http://${autoridade}`).hostname
  } catch {
    return null
  }
}

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
 * O `Host` tem de nomear um endereço de loopback. Um domínio que resolva para
 * 127.0.0.1 chega aqui com o próprio nome no header — é exatamente esse caso
 * que precisa ser recusado.
 *
 * A PORTA é ignorada de propósito. Em desenvolvimento o browser fala com o
 * Vite (5173), que faz proxy para o agente (7788) com `changeOrigin: false` —
 * então o `Host` que chega aqui é o da UI, não o do agente. Exigir a porta do
 * agente recusava com 403 todo POST, DELETE e upgrade de WebSocket vindos do
 * browser: criar lab, verificar, dica, reset e o terminal inteiro. E a porta
 * não defende nada, porque quem decide o `Host` é a autoridade da URL que o
 * browser visitou — uma página em evil.com não consegue emitir
 * `Host: 127.0.0.1` em porta nenhuma. O nome é a trava; a porta era só dano.
 */
export function hostPermitido(host: string | undefined): boolean {
  if (host === undefined || host === '') return false
  const nome = nomeDoHost(host)
  return nome !== null && LOOPBACK.test(nome)
}
