import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'

import { urlDoTerminal } from '../api.ts'
import type { LabInfo } from '../tipos.ts'

export type ControleTerminal = {
  /** Insere texto no prompt sem executar: quem aperta Enter é o aluno. */
  inserir(texto: string): void
  focar(): void
  reconectar(): void
}

type Props = { lab: LabInfo | null; escala?: number }

type Conexao = 'ocioso' | 'conectando' | 'conectado' | 'encerrado'

export const PainelTerminal = forwardRef<ControleTerminal, Props>(function PainelTerminal(
  { lab, escala = 1 },
  ref,
) {
  const hospedeiro = useRef<HTMLDivElement>(null)
  const escape = useRef<HTMLButtonElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const [conexao, setConexao] = useState<Conexao>('ocioso')
  const [geracao, setGeracao] = useState(0)

  /**
   * Espelho da escala para o effect de montagem ler o valor atual sem tê-lo
   * como dependência. Com `escala` nas deps, mexer no tamanho da fonte
   * derrubava o Terminal e o WebSocket e abria um `docker exec` novo: rolagem
   * perdida, diretório de volta ao inicial e o processo em execução morto.
   * Fonte ajustável é requisito de acessibilidade — não pode custar a sessão.
   */
  const escalaRef = useRef(escala)
  escalaRef.current = escala

  const enviar = useCallback((mensagem: unknown) => {
    const s = socketRef.current
    if (s !== null && s.readyState === WebSocket.OPEN) s.send(JSON.stringify(mensagem))
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      inserir(texto) {
        // Antes só as quebras FINAIS eram removidas: as internas de um bloco
        // multi-linha chegavam ao PTY e o shell EXECUTAVA cada linha. O
        // contrato é o oposto — quem aperta Enter é o aluno. Várias linhas
        // viram uma só, separadas por `; `, legível no prompt e inerte.
        const umaLinha = texto
          .split('\n')
          .map((linha) => linha.trim())
          .filter((linha) => linha !== '')
          .join('; ')
        enviar({ t: 'i', d: umaLinha })
        termRef.current?.focus()
      },
      focar() {
        termRef.current?.focus()
      },
      reconectar() {
        setGeracao((g) => g + 1)
      },
    }),
    [enviar],
  )

  useEffect(() => {
    const alvo = hospedeiro.current
    if (lab === null || alvo === null) {
      setConexao('ocioso')
      return
    }

    const term = new Terminal({
      fontFamily:
        'ui-monospace, "Cascadia Code", "JetBrains Mono", "Fira Code", Consolas, monospace',
      fontSize: Math.round(14 * escalaRef.current),
      lineHeight: 1.2,
      cursorBlink: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      scrollback: 5000,
      allowProposedApi: true,
      theme: temaDoXterm(),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(alvo)
    termRef.current = term
    fitRef.current = fit

    // O xterm captura Tab e Shift+Tab e os manda para o shell, o que impede
    // sair do terminal pelo teclado — armadilha de foco (WCAG 2.1.2) num app
    // cujo requisito é justamente "nunca prender foco". Escape devolve o foco
    // ao documento; Ctrl+Shift+Tab também, para quem espera o atalho.
    term.attachCustomKeyEventHandler((evento) => {
      if (evento.type !== 'keydown') return true
      const saida =
        evento.key === 'Escape' ||
        (evento.key === 'Tab' && evento.ctrlKey && evento.shiftKey)
      if (!saida) return true
      evento.preventDefault()
      escape.current?.focus()
      return false
    })

    try {
      fit.fit()
    } catch {
      // o painel ainda pode não ter medida no primeiro frame
    }

    setConexao('conectando')
    const socket = new WebSocket(urlDoTerminal(lab.id, term.cols, term.rows))
    socket.binaryType = 'arraybuffer'
    socketRef.current = socket

    socket.onopen = () => {
      setConexao('conectado')
      // A geometria do primeiro fit() sai errada (o painel ainda não tem
      // medida) e ia assada na URL. O ResizeObserver tentava corrigir, mas
      // naquele instante o socket estava em CONNECTING e a correção era
      // descartada — o terminal ficava quebrando linha em 80 colunas.
      ajustar()
    }

    socket.onmessage = (evento) => {
      if (typeof evento.data === 'string') {
        const aviso = interpretarEvento(evento.data)
        if (aviso !== null) term.writeln(`\r\n\x1b[2m${aviso}\x1b[0m`)
        return
      }
      term.write(new Uint8Array(evento.data as ArrayBuffer))
    }

    socket.onclose = () => setConexao('encerrado')
    socket.onerror = () => setConexao('encerrado')

    const descarte = term.onData((dados) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: 'i', d: dados }))
    })

    function ajustar(): void {
      try {
        fit.fit()
      } catch {
        return
      }
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ t: 'r', c: term.cols, l: term.rows }))
      }
    }

    // Sem coalescer, arrastar a borda da janela dispara um fit() e um ioctl
    // no container por quadro — e o fit() dentro do callback do RO ainda
    // provoca o clássico "ResizeObserver loop completed".
    let quadro = 0
    const agendarAjuste = (): void => {
      if (quadro !== 0) return
      quadro = window.requestAnimationFrame(() => {
        quadro = 0
        ajustar()
      })
    }

    const observador = new ResizeObserver(agendarAjuste)
    observador.observe(alvo)
    window.addEventListener('resize', agendarAjuste)

    // Não roubar o foco no mount: o aluno acabou de chegar pelo painel da
    // esquerda e seria jogado para dentro do terminal sem ter pedido.
    return () => {
      if (quadro !== 0) window.cancelAnimationFrame(quadro)
      observador.disconnect()
      window.removeEventListener('resize', agendarAjuste)
      descarte.dispose()
      socket.onclose = null
      socket.onerror = null
      socket.onmessage = null
      socket.close()
      socketRef.current = null
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [lab, geracao])

  // Fonte: muda no terminal vivo. Reflui as colunas e avisa o PTY do novo
  // tamanho, sem tocar no socket nem no shell lá dentro.
  useEffect(() => {
    const term = termRef.current
    const fit = fitRef.current
    if (term === null || fit === null) return

    term.options.fontSize = Math.round(14 * escala)
    try {
      fit.fit()
    } catch {
      return
    }
    enviar({ t: 'r', c: term.cols, l: term.rows })
  }, [escala, enviar])

  return (
    <>
      <div className="painel__cabecalho">
        <h2 className="painel__titulo">Terminal</h2>
        {lab !== null && (
          <span className="etiqueta" title={`container ${lab.containerId.slice(0, 12)}`}>
            {lab.usuario}@lab:{lab.workdir}
          </span>
        )}
        <div className="barra__espaco" />
        <span className={`etiqueta ${classeDaConexao(conexao)}`} role="status" aria-live="polite">
          {rotuloDaConexao(conexao)}
        </span>
      </div>

      {lab === null ? (
        <div className="terminal-vazio">
          <p>
            Escolha uma lição para subir um lab.
            <br />
            O terminal aqui é um shell de verdade dentro de um container descartável.
          </p>
        </div>
      ) : (
        <>
          {/* Entrada e saída explícitas do terminal: o xterm captura Tab, então
              sem estas duas paradas o teclado ficaria preso lá dentro. */}
          <button
            type="button"
            className="terminal__entrada"
            onClick={() => termRef.current?.focus()}
          >
            Entrar no terminal <span aria-hidden="true">·</span> <kbd>Esc</kbd> devolve o foco
          </button>
          <div className="terminal" ref={hospedeiro} />
          <button type="button" className="sr-apenas" ref={escape}>
            Fim do terminal. Continue tabulando para os demais painéis.
          </button>
        </>
      )}
    </>
  )
})

function interpretarEvento(texto: string): string | null {
  try {
    const evento: unknown = JSON.parse(texto)
    if (evento === null || typeof evento !== 'object') return null
    const obj = evento as Record<string, unknown>
    if (obj['t'] === 'fim') return `— ${String(obj['motivo'] ?? 'sessão encerrada')} —`
    if (obj['t'] === 'erro') return `— erro: ${String(obj['mensagem'] ?? '')} —`
    return null
  } catch {
    return null
  }
}

function classeDaConexao(c: Conexao): string {
  if (c === 'conectado') return 'etiqueta--ok'
  if (c === 'encerrado') return 'etiqueta--falha'
  return ''
}

function rotuloDaConexao(c: Conexao): string {
  const mapa: Record<Conexao, string> = {
    ocioso: 'sem lab',
    conectando: 'conectando…',
    conectado: '● conectado',
    encerrado: '○ desconectado',
  }
  return mapa[c]
}

/** Lê as variáveis do tema para o terminal acompanhar claro/escuro. */
function temaDoXterm(): Record<string, string> {
  const estilo = getComputedStyle(document.documentElement)
  const cor = (nome: string, padrao: string): string =>
    estilo.getPropertyValue(nome).trim() || padrao

  return {
    background: cor('--fundo', '#0f1216'),
    foreground: cor('--texto', '#e6edf3'),
    cursor: cor('--acento', '#58a6ff'),
    cursorAccent: cor('--fundo', '#0f1216'),
    selectionBackground: cor('--acento-fundo', '#12283f'),
  }
}
