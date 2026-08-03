import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'

/**
 * Confirmação de ação destrutiva — WCAG 3.3.6 (Prevenção de Erro, AAA).
 *
 * O critério pede que ação capaz de apagar dado do usuário seja reversível,
 * conferida ou confirmada. Aqui não é reversível (o container vai embora e não
 * volta) nem conferível (não há como o app validar a intenção), então sobra
 * confirmar — e confirmar de verdade quer dizer DIZER O QUE SE PERDE. Um
 * "tem certeza?" sem conteúdo transfere a decisão sem transferir a informação,
 * e treina o aluno a apertar Sim no automático.
 *
 * É um `<dialog>` nativo com `showModal()`, e não uma div com `role="dialog"`.
 * O elemento nativo entrega de graça — e correto — o que uma reimplementação
 * erra em silêncio: prende o Tab dentro do diálogo, fecha no Esc (WCAG 2.1.2),
 * marca o resto da página como inerte para o leitor de tela, e DEVOLVE o foco
 * a quem abriu quando fecha. Esse último é o que mais se perde à mão: sem ele,
 * cancelar joga quem usa teclado no topo do documento.
 */
export function Confirmacao({
  aberto,
  titulo,
  rotuloConfirmar,
  aoConfirmar,
  aoCancelar,
  children,
}: {
  aberto: boolean
  titulo: string
  rotuloConfirmar: string
  aoConfirmar: () => void
  aoCancelar: () => void
  children: ReactNode
}): ReactElement | null {
  const dialogo = useRef<HTMLDialogElement>(null)
  const cancelar = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const el = dialogo.current
    if (el === null) return
    if (aberto && !el.open) {
      el.showModal()
      // O foco inicial é posto à mão em vez de por `autofocus`. O React trata
      // `autoFocus` como propriedade e não emite o ATRIBUTO no HTML, que é o
      // que o `showModal()` procura — sem isto o foco cai no próprio <dialog>
      // e a primeira tecla do aluno não chega a nenhum botão.
      cancelar.current?.focus()
    }
    if (!aberto && el.open) el.close()
  }, [aberto])

  useEffect(() => {
    const el = dialogo.current
    if (el === null) return
    // Esc dispara `cancel` antes de `close`. Sem tratar, o React continuaria
    // achando que o diálogo está aberto e a próxima abertura não aconteceria.
    const aoFechar = (): void => aoCancelar()
    el.addEventListener('cancel', aoFechar)
    return () => el.removeEventListener('cancel', aoFechar)
  }, [aoCancelar])

  return (
    <dialog className="confirmacao" ref={dialogo} aria-labelledby="confirmacao-titulo">
      <h2 className="confirmacao__titulo" id="confirmacao-titulo">
        {titulo}
      </h2>

      <div className="confirmacao__corpo">{children}</div>

      <div className="confirmacao__acoes">
        {/*
          Cancelar vem primeiro e recebe o foco inicial. Numa ação destrutiva o
          padrão seguro é o que NÃO destrói: quem abriu sem querer e apertou
          Enter por reflexo sai sem perder nada.
        */}
        <button type="button" className="botao" onClick={aoCancelar} ref={cancelar}>
          Cancelar
        </button>
        <button type="button" className="botao botao--perigo" onClick={aoConfirmar}>
          {rotuloConfirmar}
        </button>
      </div>
    </dialog>
  )
}
