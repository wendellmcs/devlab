import type { ReactElement } from 'react'

import { propsDeLink, type Navegar } from '../rota.ts'
import type { ResumoProgresso, Trilha } from '../tipos.ts'

/**
 * Área do aluno.
 *
 * O agente já devolvia XP, autonomia, tentativas e histórico de erros em
 * `GET /api/progresso` desde a Fase 0 — e nada disso tinha tela. O dado existia
 * e não chegava a ninguém.
 *
 * A métrica em destaque é a AUTONOMIA, não o XP. É a que o PRD §14 chama de "a
 * que mais importa": XP mede quanto você andou, autonomia mede quanto você
 * consegue fazer sozinho. Colocar XP no topo ensinaria a otimizar a métrica
 * errada — que é exatamente o efeito de sobrejustificação que o PRD §8 manda
 * evitar.
 */
export function AreaDoAluno({
  resumo,
  trilhas,
  navegar,
}: {
  resumo: ResumoProgresso | null
  trilhas: Trilha[]
  navegar: Navegar
}): ReactElement {
  if (resumo === null) {
    return <div className="vazio">Carregando seu progresso…</div>
  }

  const autonomia =
    resumo.licoesConcluidas === 0
      ? null
      : Math.round((resumo.licoesSemAjuda / resumo.licoesConcluidas) * 100)

  const totalLicoes = trilhas.reduce((n, t) => n + t.licoes.length, 0)

  return (
    <div className="rolagem mapa">
      <div className="mapa__cabecalho leitura">
        <h1>Área do aluno</h1>
        <p className="mapa__intro">
          O que você já consegue fazer — e onde você mais tropeça, que é por onde
          vale continuar.
        </p>
      </div>

      <div className="metricas">
        <Metrica
          rotulo="Autonomia"
          valor={autonomia === null ? '—' : `${String(autonomia)}%`}
          nota={
            autonomia === null
              ? 'aparece depois da primeira lição concluída'
              : `${String(resumo.licoesSemAjuda)} de ${String(resumo.licoesConcluidas)} resolvidas sem dica e sem IA`
          }
          destaque
        />
        <Metrica
          rotulo="Lições concluídas"
          valor={`${String(resumo.licoesConcluidas)}`}
          nota={`de ${String(totalLicoes)} escritas até agora`}
        />
        <Metrica rotulo="XP" valor={`${String(resumo.xpTotal)}`} nota="ponderado por dificuldade" />
        <Metrica
          rotulo="Tentativas"
          valor={`${String(resumo.tentativasTotais)}`}
          nota="verificações rodadas, aprovadas ou não"
        />
      </div>

      {resumo.porTrilha.length > 0 && (
        <section className="modulo" aria-labelledby="por-trilha">
          <div className="modulo__cabecalho">
            <h2 id="por-trilha" className="modulo__titulo">
              Por trilha
            </h2>
          </div>
          <ul className="lista-simples">
            {resumo.porTrilha.map((pt) => {
              const t = trilhas.find((x) => x.id === pt.trilha)
              return (
                <li key={pt.trilha}>
                  <a
                    className="item"
                    {...propsDeLink({ tela: 'trilha', trilhaId: pt.trilha }, navegar)}
                  >
                    <span className="item__marca" aria-hidden="true">
                      {t?.icone ?? '•'}
                    </span>
                    <span className="item__corpo">
                      <span className="item__titulo">{t?.titulo ?? pt.trilha}</span>
                      <span className="item__meta">
                        <span className="item__estado">
                          {pt.concluidas} concluída{pt.concluidas === 1 ? '' : 's'} · {pt.xp} XP
                        </span>
                      </span>
                    </span>
                  </a>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

function Metrica({
  rotulo,
  valor,
  nota,
  destaque = false,
}: {
  rotulo: string
  valor: string
  nota: string
  destaque?: boolean
}): ReactElement {
  return (
    <div className={`metrica${destaque ? ' metrica--destaque' : ''}`}>
      {/* O número é grande de propósito: ≥24px cai para 4.5:1 em 1.4.6, o que
          devolve um degrau de hierarquia que o contraste 7:1 tinha tirado. */}
      <span className="metrica__valor">{valor}</span>
      <span className="metrica__rotulo">{rotulo}</span>
      <span className="metrica__nota">{nota}</span>
    </div>
  )
}
