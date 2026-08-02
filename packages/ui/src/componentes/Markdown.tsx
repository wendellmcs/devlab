import { useEffect, useMemo, useRef, type ReactElement } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

type Props = {
  texto: string
  /** Quando informado, cada bloco de código vira um botão que insere no terminal. */
  aoClicarCodigo?: (comando: string) => void
}

marked.setOptions({ gfm: true, breaks: false })

export function Markdown({ texto, aoClicarCodigo }: Props): ReactElement {
  const raiz = useRef<HTMLDivElement>(null)

  // Este componente também renderiza a resposta do modelo local, que por sua
  // vez recebe a saída do terminal do aluno no prompt. O `marked` não sanitiza
  // (a opção saiu na v5) e o `sanitizar()` do agente é um filtro pedagógico,
  // não de HTML: `<img src=x onerror=…>` fora de bloco de código passaria
  // inteiro. Daí o DOMPurify.
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(texto, { async: false })),
    [texto],
  )

  useEffect(() => {
    const el = raiz.current
    if (el === null || aoClicarCodigo === undefined) return

    const limpezas: (() => void)[] = []

    for (const bloco of Array.from(el.querySelectorAll('pre'))) {
      bloco.tabIndex = 0
      bloco.setAttribute('role', 'button')
      // `aria-label` sobrescreve o conteúdo: com um rótulo genérico, quem usa
      // leitor de tela ouviria a mesma frase N vezes e nunca o comando — que
      // é justamente o conteúdo didático da página.
      const comando = (bloco.textContent ?? '').trim()
      bloco.setAttribute('aria-label', `Inserir no terminal: ${comando}`)

      const inserir = (): void => aoClicarCodigo(comando)
      // Só Enter: interceptar Espaço impediria rolar um comando longo pelo
      // teclado, já que o <pre> tem overflow-x: auto.
      const aoTeclar = (evento: KeyboardEvent): void => {
        if (evento.key !== 'Enter') return
        evento.preventDefault()
        inserir()
      }

      bloco.addEventListener('click', inserir)
      bloco.addEventListener('keydown', aoTeclar)
      limpezas.push(() => {
        bloco.removeEventListener('click', inserir)
        bloco.removeEventListener('keydown', aoTeclar)
      })
    }

    return () => {
      for (const limpar of limpezas) limpar()
    }
  }, [html, aoClicarCodigo])

  return <div className="md" ref={raiz} dangerouslySetInnerHTML={{ __html: html }} />
}
