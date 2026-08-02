import type { ReactElement } from 'react'

import type { LabInfo, Recursos, ResumoProgresso } from '../tipos.ts'

type Props = {
  escala: number
  aoMudarEscala: (escala: number) => void
  resumo: ResumoProgresso | null
  lab: LabInfo | null
  recursos: Recursos | null
  ocupado: string | null
  vista: 'licao' | 'trilhas'
  aoTrocarVista: (vista: 'licao' | 'trilhas') => void
  aoResetar: () => void
}

export function BarraSuperior({
  escala,
  aoMudarEscala,
  resumo,
  lab,
  recursos,
  ocupado,
  vista,
  aoTrocarVista,
  aoResetar,
}: Props): ReactElement {
  const autonomia =
    resumo !== null && resumo.licoesConcluidas > 0
      ? Math.round((resumo.licoesSemAjuda / resumo.licoesConcluidas) * 100)
      : null

  return (
    <header className="barra">
      <div className="barra__marca">
        DevLab <small>oficina prática</small>
      </div>

      <button
        type="button"
        className="botao botao--discreto"
        aria-pressed={vista === 'trilhas'}
        onClick={() => aoTrocarVista(vista === 'trilhas' ? 'licao' : 'trilhas')}
      >
        {vista === 'trilhas' ? '← Voltar à lição' : '☰ Trilhas'}
      </button>

      <div className="barra__espaco" />

      <span role="status" aria-live="polite">
        {ocupado !== null && <span className="etiqueta etiqueta--acento">{ocupado}</span>}
      </span>

      {resumo !== null && (
        <div className="barra__grupo">
          <span className="medidor medidor--xp" title="XP ponderado pela dificuldade da lição">
            XP <strong>{resumo.xpTotal}</strong>
          </span>
          <span className="medidor" title="Lições concluídas">
            Concluídas <strong>{resumo.licoesConcluidas}</strong>
          </span>
          {autonomia !== null && (
            <span
              className="medidor"
              title="Percentual de lições resolvidas sem dica e sem IA — a métrica que mais importa"
            >
              Autonomia <strong>{autonomia}%</strong>
            </span>
          )}
        </div>
      )}

      {recursos !== null && (
        <span className="medidor" title="Uso real do container deste lab">
          CPU <strong>{recursos.cpuPercent.toFixed(0)}%</strong> · RAM{' '}
          <strong>{recursos.memoriaUsadaMb.toFixed(0)}</strong> MB
        </span>
      )}

      {/* Requisito de acessibilidade: fonte ajustável. A escala multiplica o
          tamanho base da página E o do terminal. */}
      <div className="escala" role="group" aria-label="Tamanho da fonte">
        <button
          type="button"
          className="botao botao--discreto"
          onClick={() => aoMudarEscala(escala - 0.1)}
          disabled={escala <= 0.8}
          aria-label="Diminuir a fonte"
          title="Diminuir a fonte"
        >
          A−
        </button>
        <span className="escala__valor" aria-live="polite">
          {Math.round(escala * 100)}%
        </span>
        <button
          type="button"
          className="botao botao--discreto"
          onClick={() => aoMudarEscala(escala + 0.1)}
          disabled={escala >= 1.6}
          aria-label="Aumentar a fonte"
          title="Aumentar a fonte"
        >
          A+
        </button>
      </div>

      <button
        type="button"
        className="botao botao--perigo"
        onClick={aoResetar}
        disabled={lab === null || ocupado !== null}
        title="Destrói o container e recria o lab do zero, em segundos"
      >
        ↻ Resetar lab
      </button>
    </header>
  )
}
