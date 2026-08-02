import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'

import { api, ErroDaApi } from './api.ts'
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
import { BarraSuperior } from './componentes/BarraSuperior.tsx'
import { PainelObjetivo } from './componentes/PainelObjetivo.tsx'
import { PainelTerminal, type ControleTerminal } from './componentes/PainelTerminal.tsx'
import { PainelEstado } from './componentes/PainelEstado.tsx'
import { ListaDeTrilhas } from './componentes/ListaDeTrilhas.tsx'
import { TelaDoctor } from './componentes/TelaDoctor.tsx'

const INTERVALO_ESTADO_MS = 2500

export function App(): ReactElement {
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
  const [vista, setVista] = useState<'licao' | 'trilhas'>('trilhas')
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [falha, setFalha] = useState<string | null>(null)

  const terminal = useRef<ControleTerminal>(null)
  /** Sequência do último pedido de abrir lição, para descartar os atrasados. */
  const pedidoAtual = useRef(0)
  /** Espelho de `lab` para os callbacks não dependerem dele e se recriarem. */
  const labRef = useRef<LabInfo | null>(null)
  labRef.current = lab

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

  const abrirLicao = useCallback(
    async (id: string) => {
      // Guarda de sequência: sem ela, dois cliques rápidos em lições
      // diferentes deixavam um container órfão (o segundo não sabia do lab do
      // primeiro) e podiam terminar mostrando a lição A com o terminal de B,
      // conforme a ordem em que as respostas chegassem.
      const meuPedido = pedidoAtual.current + 1
      pedidoAtual.current = meuPedido

      setOcupado('Subindo o lab…')
      setFalha(null)
      setVerificacao(null)
      setRespostaIa(null)
      try {
        const anterior = labRef.current
        if (anterior !== null) await api.destruirLab(anterior.id).catch(() => undefined)
        if (pedidoAtual.current !== meuPedido) return
        setLab(null)

        const { lab: novoLab, licao: nova } = await api.criarLab(id)
        if (pedidoAtual.current !== meuPedido) {
          // Outro clique venceu: este lab não tem dono na tela.
          await api.destruirLab(novoLab.id).catch(() => undefined)
          return
        }
        setLicao(nova)
        setLab(novoLab)
        setVista('licao')
      } catch (e) {
        if (pedidoAtual.current === meuPedido) relatarFalha(e)
      } finally {
        if (pedidoAtual.current === meuPedido) setOcupado(null)
      }
    },
    [relatarFalha],
  )

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
      setOcupado('Consultando o modelo local…')
      setFalha(null)
      try {
        const r = await api.iaResponder(momento, lab.id)
        setRespostaIa(r)
        // A lição volta atualizada: usar IA marca a solução e derruba o selo
        // de "sem ajuda", e isso precisa aparecer na hora.
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
      <BarraSuperior
        escala={escala}
        aoMudarEscala={mudarEscala}
        resumo={resumo}
        lab={lab}
        recursos={estado?.recursos ?? null}
        ocupado={ocupado}
        vista={vista}
        aoTrocarVista={setVista}
        aoResetar={resetar}
      />

      {/* Fora dos painéis de propósito: antes, uma falha ao abrir a lição só
          era renderizada dentro do PainelObjetivo — que nem chega a montar
          quando a abertura falha. O usuário via o chip sumir e mais nada. */}
      {falha !== null && (
        <div className="alerta alerta--global" role="alert">
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

      <div className="paineis">
        <section className="painel painel--objetivo" aria-label="Objetivo e dicas">
          {vista === 'trilhas' || licao === null ? (
            <ListaDeTrilhas
              trilhas={trilhas}
              licaoAtual={licao?.id ?? null}
              aoEscolher={(id) => void abrirLicao(id)}
            />
          ) : (
            <PainelObjetivo
              licao={licao}
              verificacao={verificacao}
              ocupado={ocupado}
              podeVerificar={lab !== null && lab.estado === 'pronto'}
              ia={ia}
              respostaIa={respostaIa}
              aoVerificar={() => void verificar()}
              aoRevelarDica={(n) => void revelarDica(n)}
              aoPedirIa={(m) => void pedirIa(m)}
              aoInserirComando={inserirNoTerminal}
            />
          )}
        </section>

        <section className="painel painel--terminal" aria-label="Terminal do lab">
          <PainelTerminal ref={terminal} lab={lab} escala={escala} />
        </section>

        <section className="painel painel--estado" aria-label="Estado do lab ao vivo">
          <PainelEstado estado={estado} lab={lab} />
        </section>
      </div>
    </div>
  )
}
