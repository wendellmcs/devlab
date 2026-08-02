import type { ReactElement } from 'react'

import type { RelatorioDoctor } from '../tipos.ts'

type Props = {
  relatorio: RelatorioDoctor
  ocupado: boolean
  aoRevalidar: () => void
}

const SIMBOLO = { ok: '✔', aviso: '!', falha: '✘' } as const

export function TelaDoctor({ relatorio, ocupado, aoRevalidar }: Props): ReactElement {
  return (
    <main className="doctor">
      <h1 style={{ marginBottom: 4 }}>Ambiente incompleto</h1>
      <p style={{ color: 'var(--texto-2)', marginTop: 0 }}>
        O DevLab roda software de verdade em containers descartáveis. Estes itens precisam estar
        de pé antes da primeira lição.
      </p>

      {relatorio.verificacoes.length === 0 && (
        <div className="alerta" role="alert">
          <span className="alerta__icone" aria-hidden="true">
            ✘
          </span>
          <span>
            Não foi possível falar com o <code>devlab-agent</code>. Suba-o com{' '}
            <code>npm run dev</code> dentro do WSL2.
          </span>
        </div>
      )}

      <ul className="doctor__lista">
        {relatorio.verificacoes.map((v) => (
          <li className={`doctor__item doctor__item--${v.estado}`} key={v.id}>
            <span aria-hidden="true" style={{ color: `var(--${v.estado === 'ok' ? 'ok' : v.estado})` }}>
              {SIMBOLO[v.estado]}
            </span>
            <div>
              <strong>{v.titulo}</strong>{' '}
              <span className="sr-apenas">
                {v.estado === 'ok' ? 'ok' : v.estado === 'aviso' ? 'atenção' : 'falha'}
              </span>
              <div style={{ color: 'var(--texto-2)', fontSize: 13 }}>{v.detalhe}</div>
              {v.correcao !== undefined && <div className="doctor__correcao">→ {v.correcao}</div>}
            </div>
          </li>
        ))}
      </ul>

      <p style={{ marginTop: 22 }}>
        <button
          type="button"
          className="botao botao--primario"
          onClick={aoRevalidar}
          disabled={ocupado}
        >
          {ocupado ? 'Revalidando…' : '↻ Verificar de novo'}
        </button>
      </p>

      <p style={{ color: 'var(--texto-3)', fontSize: 13 }}>
        No terminal, o mesmo diagnóstico sai com <code>npm run doctor</code>.
      </p>
    </main>
  )
}
