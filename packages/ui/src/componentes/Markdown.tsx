import {
  useCallback,
  useMemo,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from 'react'
import DOMPurify from 'dompurify'
import { Marked } from 'marked'

type Props = {
  texto: string
  /**
   * Nível do primeiro título do texto renderizado.
   *
   * O conteúdo não sabe onde vai ser encaixado: o mesmo `##` cai debaixo do
   * `<h1>` da lição num lugar e debaixo de um `<h2>` de seção noutro. Quem
   * escreve lição não deveria ter de contar níveis do layout para acertar —
   * então o componente reancora a hierarquia aqui.
   */
  nivelBase?: number
  /** Quando informado, cada bloco de código vira um botão que insere no terminal. */
  aoClicarCodigo?: (comando: string) => void
}

/** Instância própria: `marked.setOptions` é global e vazaria para outros usos. */
const marked = new Marked({ gfm: true, breaks: false })

const ABRE_PRE_INTERATIVO = '<pre role="button" tabindex="0">'

function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function desescapar(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * Renderiza reancorando os títulos e já entregando o `<pre>` acessível.
 *
 * Duas coisas acontecem aqui, as duas por acessibilidade.
 *
 * Os títulos: sem reancorar, um `### Sua tarefa` logo depois do `<h1>` do
 * título da lição pula do nível 1 para o 3 — violação de heading-order (WCAG
 * 1.3.1). O deslocamento é relativo ao MENOR nível presente no texto, e não
 * absoluto, para a hierarquia que o autor escreveu sobreviver.
 *
 * O `tabindex` do `<pre>`: bloco de código rola na horizontal, e região que
 * rola precisa ser alcançável pelo teclado (WCAG 2.1.1) — senão quem não usa
 * mouse não chega ao fim da linha. O atributo é escrito DENTRO do HTML, não
 * aplicado depois por efeito, pelo motivo documentado em `Markdown`.
 */
function paraHtml(texto: string, nivelBase: number, interativo: boolean): string {
  const tokens = marked.lexer(texto)

  let menor = 7
  marked.walkTokens(tokens, (t) => {
    if (t.type === 'heading') menor = Math.min(menor, t.depth)
  })

  if (menor <= 6 && menor !== nivelBase) {
    const deslocamento = nivelBase - menor
    marked.walkTokens(tokens, (t) => {
      if (t.type === 'heading') t.depth = Math.min(6, Math.max(1, t.depth + deslocamento))
    })
  }

  const html = marked.parser(tokens)
  return html.replaceAll('<pre>', interativo ? ABRE_PRE_INTERATIVO : '<pre tabindex="0">')
}

/**
 * Põe no `aria-label` de cada bloco interativo o comando que ele contém.
 *
 * Rótulo genérico não serve: o `aria-label` SUBSTITUI o conteúdo para quem usa
 * leitor de tela, e o comando é justamente o conteúdo didático da página. Com
 * "inserir no terminal" repetido, a pessoa ouviria a mesma frase N vezes e
 * nunca o comando.
 */
function rotular(html: string): string {
  const bloco = new RegExp(`${ABRE_PRE_INTERATIVO}(<code[^>]*>[\\s\\S]*?</code>)</pre>`, 'g')
  return html.replace(bloco, (_inteiro, corpo: string) => {
    const rotulo = escapar(`Inserir no terminal: ${desescapar(corpo).trim()}`)
    return `<pre role="button" tabindex="0" aria-label="${rotulo}">${corpo}</pre>`
  })
}

function comandoDe(alvo: EventTarget | null): string | null {
  const bloco = (alvo as HTMLElement | null)?.closest?.('pre[role="button"]')
  const texto = (bloco?.textContent ?? '').trim()
  return texto === '' ? null : texto
}

/**
 * Markdown do conteúdo, renderizado como HTML sanitizado.
 *
 * Por que nada aqui é aplicado por efeito depois da renderização: o React 19
 * compara o OBJETO passado a `dangerouslySetInnerHTML` por identidade, não o
 * texto dentro dele. Um `{ __html: html }` literal no JSX é um objeto novo a
 * cada render — então o innerHTML inteiro era reescrito em TODA renderização,
 * mesmo com o HTML idêntico. E o painel de lição re-renderiza sozinho a cada
 * 2,5 s, junto com a leitura de estado do container.
 *
 * Isso apagava em silêncio o `tabindex`, o `role` e o `aria-label` que um
 * `useEffect` aplicava nos blocos de código logo após montar: o efeito não
 * voltava a rodar (o HTML não mudara), mas os nós que ele havia tocado já
 * tinham sido trocados por cópias limpas. O bloco de código ficava
 * inalcançável pelo teclado, e clicar nele deixava de inserir no terminal —
 * funcionava só na primeira renderização, que é o que se vê ao testar à mão.
 *
 * A correção tem duas partes e as duas importam: o objeto é memoizado, então o
 * innerHTML só é reescrito quando o HTML muda de verdade; e os atributos fazem
 * parte do HTML gerado, em vez de aplicados por fora. Os handlers ficam no
 * contêiner, delegados — sobrevivem a qualquer troca de innerHTML.
 */
export function Markdown({ texto, nivelBase = 2, aoClicarCodigo }: Props): ReactElement {
  const interativo = aoClicarCodigo !== undefined

  const conteudo = useMemo(() => {
    const bruto = paraHtml(texto, nivelBase, interativo)
    // O `marked` não sanitiza (a opção saiu na v5) e o `sanitizar()` do agente
    // é um filtro pedagógico, não de HTML: este componente também renderiza a
    // resposta do modelo, que por sua vez recebe a saída do terminal do aluno.
    return { __html: DOMPurify.sanitize(interativo ? rotular(bruto) : bruto) }
  }, [texto, nivelBase, interativo])

  const aoClicar = useCallback(
    (evento: MouseEvent<HTMLDivElement>) => {
      const comando = comandoDe(evento.target)
      if (comando !== null) aoClicarCodigo?.(comando)
    },
    [aoClicarCodigo],
  )

  const aoTeclar = useCallback(
    (evento: KeyboardEvent<HTMLDivElement>) => {
      // Só Enter: interceptar Espaço impediria rolar um comando longo pelo
      // teclado, já que o <pre> tem overflow-x: auto.
      if (evento.key !== 'Enter') return
      const comando = comandoDe(evento.target)
      if (comando === null) return
      evento.preventDefault()
      aoClicarCodigo?.(comando)
    },
    [aoClicarCodigo],
  )

  return (
    <div
      className="md"
      onClick={interativo ? aoClicar : undefined}
      onKeyDown={interativo ? aoTeclar : undefined}
      dangerouslySetInnerHTML={conteudo}
    />
  )
}
