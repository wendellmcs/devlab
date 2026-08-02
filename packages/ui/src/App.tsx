import { useCallback, useEffect, useRef, useState, type ReactElement, type RefObject } from 'react'

import { api, ErroDaApi } from './api.ts'
import { useRota, type Navegar, type Rota } from './rota.ts'
import type {
  EstadoDaIa,
  EstadoDoLab,
  LabInfo,
  Licao,
  MomentoIa,
  RelatorioDoctor,
  RespostaDaIa,
  ResultadoVerificacao,
  ResumoProgresso,
  Trilha,
} from './tipos.ts'
import { Cabecalho, migalhasDe } from './componentes/Cabecalho.tsx'
import { MapaDaTrilha, MapaTrilhas } from './componentes/Trilha.tsx'
import { AreaDoAluno } from './componentes/AreaDoAluno.tsx'
import { PainelObjetivo } from './componentes/PainelObjetivo.tsx'
import { PainelTerminal, type ControleTerminal } from './componentes/PainelTerminal.tsx'
import { PainelEstado } from './componentes/PainelEstado.tsx'
import { TelaDoctor } from './componentes/TelaDoctor.tsx'

const INTERVALO_ESTADO_MS = 2500

type Tema = 'escuro' | 'claro'

export function App(): ReactElement {
  const [rota, navegar] = useRota()

  const [doctor, setDoctor] = useState<RelatorioDoctor | null>(null)
  const [trilhas, setTrilhas] = useState<Trilha[]>([])
  const [resumo, setResumo] = useState<ResumoProgresso | null>(null)

  const [licao, setLicao] = useState<Licao | null>(null)
  const [lab, setLab] = useState<LabInfo | null>(null)
  const [estado, setEstado] = useState<EstadoDoLab | null>(null)
  const [verificacao, setVerificacao] = useState<ResultadoVerificacao | null>(null)
  const [ia, setIa] = useState<EstadoDaIa | null>(null)
  const [respostaIa, setRespostaIa] = useState<RespostaDaIa | null>(null)

  const [escala, setEscala] = useState(() => {
    const salva = Number(localStorage.getItem('devlab.escala'))
    return Number.isFinite(salva) && salva >= 0.8 && salva <= 1.6 ? salva : 1
  })
  const [tema, setTema] = useState<Tema>(() => {
    const salvo = localStorage.getItem('devlab.tema')
    return salvo === 'claro' || salvo === 'escuro' ? salvo : 'escuro'
  })
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [falha, setFalha] = useState<string | null>(null)

  const terminal = useRef<ControleTerminal>(null)
  /** Sequência do último pedido de abrir lição, para descartar os atrasados. */
  const pedidoAtual = useRef(0)
  /** Espelho de `lab` para os callbacks não dependerem dele e se recriarem. */
  const labRef = useRef<LabInfo | null>(null)
  labRef.current = lab
  /** Espelho de `licao`, pelo mesmo motivo, dentro do efeito de rota. */
  const licaoRef = useRef<Licao | null>(null)
  licaoRef.current = licao

  const alvoDeFoco = useRef<HTMLElement>(null)
  const primeiraTela = useRef(true)

  const relatarFalha = useCallback((e: unknown) => {
    if (e instanceof ErroDaApi) {
      setFalha(e.detalhe !== undefined ? `${e.message} — ${e.detalhe}` : e.message)
    } else {
      setFalha(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const recarregarTrilhas = useCallback(async () => {
    try {
      const [lista, r] = await Promise.all([api.trilhas(), api.progresso()])
      setTrilhas(lista)
      setResumo(r)
    } catch (e) {
      relatarFalha(e)
    }
  }, [relatarFalha])

  useEffect(() => {
    document.documentElement.style.setProperty('--escala', String(escala))
    localStorage.setItem('devlab.escala', String(escala))
  }, [escala])

  useEffect(() => {
    document.documentElement.setAttribute('data-tema', tema)
    localStorage.setItem('devlab.tema', tema)
  }, [tema])

  const mudarEscala = useCallback((valor: number) => {
    setEscala(Math.min(1.6, Math.max(0.8, Math.round(valor * 10) / 10)))
  }, [])

  // Primeira carga: diagnóstico do ambiente + catálogo de trilhas.
  useEffect(() => {
    void (async () => {
      try {
        const relatorio = await api.doctor()
        setDoctor(relatorio)
        setIa(await api.iaEstado().catch(() => null))
        if (relatorio.pronto) await recarregarTrilhas()
      } catch (e) {
        relatarFalha(e)
        setDoctor({ pronto: false, verificacoes: [], em: Date.now() })
      }
    })()
  }, [recarregarTrilhas, relatarFalha])

  // Visualizador de estado: dados reais lidos do container em intervalo curto.
  useEffect(() => {
    if (lab === null || lab.estado !== 'pronto') {
      setEstado(null)
      return
    }
    let ativo = true

    const coletar = async (): Promise<void> => {
      try {
        const novo = await api.estadoDoLab(lab.id)
        if (ativo) setEstado(novo)
      } catch {
        // lab pode ter sido destruído entre um tick e outro: o próximo resolve
      }
    }

    void coletar()
    const timer = window.setInterval(() => void coletar(), INTERVALO_ESTADO_MS)
    return () => {
      ativo = false
      window.clearInterval(timer)
    }
  }, [lab])

  /**
   * A ROTA manda no lab: entrar numa lição sobe o lab dela, sair destrói.
   *
   * Antes isso morava num handler de clique, então o botão voltar do navegador
   * deixava o container de pé sem nenhuma tela apontando para ele — e o aluno
   * só descobria ao esbarrar no teto de labs simultâneos.
   */
  useEffect(() => {
    const meuPedido = pedidoAtual.current + 1
    pedidoAtual.current = meuPedido

    void (async () => {
      const anterior = labRef.current

      if (rota.tela !== 'licao') {
        if (anterior !== null) {
          setLab(null)
          await api.destruirLab(anterior.id).catch(() => undefined)
        }
        setLicao(null)
        setVerificacao(null)
        setRespostaIa(null)
        return
      }

      // Já estamos nesta lição com lab de pé: nada a fazer (evita recriar o
      // container a cada re-render do efeito).
      if (licaoRef.current?.id === rota.licaoId && anterior !== null) return

      setOcupado('Subindo o lab…')
      setFalha(null)
      setVerificacao(null)
      setRespostaIa(null)
      try {
        if (anterior !== null) await api.destruirLab(anterior.id).catch(() => undefined)
        if (pedidoAtual.current !== meuPedido) return
        setLab(null)

        const { lab: novoLab, licao: nova } = await api.criarLab(rota.licaoId)
        if (pedidoAtual.current !== meuPedido) {
          // Outra navegação venceu: este lab não tem dono na tela.
          await api.destruirLab(novoLab.id).catch(() => undefined)
          return
        }
        setLicao(nova)
        setLab(novoLab)
      } catch (e) {
        if (pedidoAtual.current === meuPedido) relatarFalha(e)
      } finally {
        if (pedidoAtual.current === meuPedido) setOcupado(null)
      }
    })()
  }, [rota, relatarFalha])

  // Foco no conteúdo ao trocar de tela: quem navega por teclado precisa saber
  // que chegou, e o leitor de tela precisa anunciar a página nova.
  useEffect(() => {
    if (primeiraTela.current) {
      primeiraTela.current = false
      return
    }
    alvoDeFoco.current?.focus()
  }, [rota])

  const resetar = useCallback(async () => {
    if (lab === null) return
    setOcupado('Recriando o lab…')
    setFalha(null)
    setVerificacao(null)
    try {
      const atualizado = await api.resetarLab(lab.id)
      setLab({ ...atualizado })
      terminal.current?.reconectar()
    } catch (e) {
      relatarFalha(e)
    } finally {
      setOcupado(null)
    }
  }, [lab, relatarFalha])

  const verificar = useCallback(async () => {
    if (lab === null) return
    setOcupado('Verificando o estado do lab…')
    setFalha(null)
    try {
      const resultado = await api.verificar(lab.id)
      setVerificacao(resultado)
      setResumo(resultado.resumo)
      if (licao !== null) setLicao(await api.licao(licao.id))
      if (resultado.aprovado) await recarregarTrilhas()
    } catch (e) {
      relatarFalha(e)
    } finally {
      setOcupado(null)
    }
  }, [lab, licao, recarregarTrilhas, relatarFalha])

  const revelarDica = useCallback(
    async (nivel: number) => {
      if (licao === null) return
      try {
        const r = await api.revelarDica(licao.id, nivel)
        setLicao(r.licao)
      } catch (e) {
        relatarFalha(e)
      }
    },
    [licao, relatarFalha],
  )

  const pedirIa = useCallback(
    async (momento: MomentoIa) => {
      if (lab === null) return
      setOcupado('Consultando o modelo…')
      setFalha(null)
      try {
        const r = await api.iaResponder(momento, lab.id)
        setRespostaIa(r)
        setLicao(r.licao)
      } catch (e) {
        relatarFalha(e)
      } finally {
        setOcupado(null)
      }
    },
    [lab, relatarFalha],
  )

  const inserirNoTerminal = useCallback((texto: string) => {
    terminal.current?.inserir(texto)
  }, [])

  const revalidarAmbiente = useCallback(async () => {
    setOcupado('Revalidando o ambiente…')
    try {
      const relatorio = await api.doctor()
      setDoctor(relatorio)
      if (relatorio.pronto) await recarregarTrilhas()
    } catch (e) {
      relatarFalha(e)
    } finally {
      setOcupado(null)
    }
  }, [recarregarTrilhas, relatarFalha])

  if (doctor === null) {
    return <div className="vazio">Verificando o ambiente…</div>
  }

  if (!doctor.pronto) {
    return (
      <TelaDoctor relatorio={doctor} ocupado={ocupado !== null} aoRevalidar={revalidarAmbiente} />
    )
  }

  return (
    <div className="app">
      <a className="pular" href="#conteudo">
        Pular para o conteúdo
      </a>
      {rota.tela === 'licao' && (
        <a className="pular pular--2" href="#terminal">
          Pular para o terminal
        </a>
      )}

      <Cabecalho
        migalhas={migalhasDe(rota, trilhas, licao)}
        resumo={resumo}
        escala={escala}
        aoMudarEscala={mudarEscala}
        tema={tema}
        aoAlternarTema={() => setTema((t) => (t === 'escuro' ? 'claro' : 'escuro'))}
        navegar={navegar}
        ocupado={ocupado}
        aoResetar={lab !== null ? () => void resetar() : undefined}
      />

      {falha !== null && (
        <div className="alerta" role="alert">
          <span className="alerta__icone" aria-hidden="true">
            ✘
          </span>
          <span>{falha}</span>
          <button
            type="button"
            className="botao botao--discreto"
            onClick={() => setFalha(null)}
            aria-label="Dispensar aviso"
          >
            ✕
          </button>
        </div>
      )}

      {/* tabIndex -1 recebe foco por script sem entrar na ordem de tabulação. */}
      <main className="app__conteudo" id="conteudo" ref={alvoDeFoco} tabIndex={-1}>
        <Conteudo
          rota={rota}
          trilhas={trilhas}
          resumo={resumo}
          licao={licao}
          lab={lab}
          estado={estado}
          verificacao={verificacao}
          ia={ia}
          respostaIa={respostaIa}
          escala={escala}
          ocupado={ocupado}
          navegar={navegar}
          terminal={terminal}
          aoVerificar={() => void verificar()}
          aoRevelarDica={(n) => void revelarDica(n)}
          aoPedirIa={(m) => void pedirIa(m)}
          aoInserirComando={inserirNoTerminal}
        />
      </main>
    </div>
  )
}

function Conteudo(p: {
  rota: Rota
  trilhas: Trilha[]
  resumo: ResumoProgresso | null
  licao: Licao | null
  lab: LabInfo | null
  estado: EstadoDoLab | null
  verificacao: ResultadoVerificacao | null
  ia: EstadoDaIa | null
  respostaIa: RespostaDaIa | null
  escala: number
  ocupado: string | null
  navegar: Navegar
  terminal: RefObject<ControleTerminal | null>
  aoVerificar: () => void
  aoRevelarDica: (n: number) => void
  aoPedirIa: (m: MomentoIa) => void
  aoInserirComando: (t: string) => void
}): ReactElement {
  const { rota } = p

  if (rota.tela === 'mapa') {
    return <MapaTrilhas trilhas={p.trilhas} navegar={p.navegar} />
  }

  if (rota.tela === 'aluno') {
    return <AreaDoAluno resumo={p.resumo} trilhas={p.trilhas} navegar={p.navegar} />
  }

  if (rota.tela === 'trilha') {
    const t = p.trilhas.find((x) => x.id === rota.trilhaId)
    if (t === undefined) return <div className="vazio">Carregando trilha…</div>
    return <MapaDaTrilha trilha={t} navegar={p.navegar} />
  }

  return (
    <div className="paineis">
      <section className="painel painel--objetivo rolagem" aria-label="Objetivo e dicas">
        {p.licao === null ? (
          <div className="vazio">Subindo o lab…</div>
        ) : (
          <PainelObjetivo
            licao={p.licao}
            verificacao={p.verificacao}
            ocupado={p.ocupado}
            podeVerificar={p.lab !== null && p.lab.estado === 'pronto'}
            ia={p.ia}
            respostaIa={p.respostaIa}
            aoVerificar={p.aoVerificar}
            aoRevelarDica={p.aoRevelarDica}
            aoPedirIa={p.aoPedirIa}
            aoInserirComando={p.aoInserirComando}
          />
        )}
      </section>

      <section className="painel painel--terminal" id="terminal" aria-label="Terminal do lab">
        <PainelTerminal ref={p.terminal} lab={p.lab} escala={p.escala} />
      </section>

      <section className="painel painel--estado rolagem" aria-label="Estado do lab ao vivo">
        <PainelEstado estado={p.estado} lab={p.lab} />
      </section>
    </div>
  )
}
