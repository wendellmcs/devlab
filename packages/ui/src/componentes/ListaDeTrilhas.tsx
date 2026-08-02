import type { ReactElement } from 'react'

import type { ResumoLicao, Trilha } from '../tipos.ts'

type Props = {
  trilhas: Trilha[]
  licaoAtual: string | null
  aoEscolher: (id: string) => void
}

export function ListaDeTrilhas({ trilhas, licaoAtual, aoEscolher }: Props): ReactElement {
  return (
    <>
      <div className="painel__cabecalho">
        <h2 className="painel__titulo">Trilhas</h2>
      </div>

      <div className="painel__corpo">
        {trilhas.length === 0 ? (
          <p className="vazio">
            Nenhuma trilha carregada. Confira os arquivos em <code>content/trilhas/</code>.
          </p>
        ) : (
          trilhas.map((trilha) => (
            <section className="trilha" key={trilha.id}>
              <div className="trilha__cabecalho">
                <span aria-hidden="true">{trilha.icone}</span>
                <h3 className="trilha__titulo">{trilha.titulo}</h3>
                <span className="etiqueta">Fase {trilha.fase}</span>
              </div>
              <p className="trilha__resumo">{trilha.resumo}</p>

              <ul className="lista-licoes">
                {trilha.licoes.map((licao) => (
                  <li key={licao.id}>
                    <ItemLicao
                      licao={licao}
                      atual={licao.id === licaoAtual}
                      aoEscolher={aoEscolher}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </>
  )
}

function ItemLicao({
  licao,
  atual,
  aoEscolher,
}: {
  licao: ResumoLicao
  atual: boolean
  aoEscolher: (id: string) => void
}): ReactElement {
  const concluida = licao.progresso?.estado === 'concluida'
  const bloqueada = !licao.desbloqueada

  const classes = ['item-licao']
  if (concluida) classes.push('item-licao--concluida')

  const meta = [
    `${licao.xp} XP`,
    concluida ? (licao.progresso?.semAjuda === true ? 'sem ajuda' : 'concluída') : licao.nivel,
    licao.capstone ? 'capstone' : null,
  ]
    .filter((m) => m !== null)
    .join(' · ')

  return (
    <button
      type="button"
      className={classes.join(' ')}
      aria-current={atual ? 'true' : undefined}
      disabled={bloqueada}
      onClick={() => aoEscolher(licao.id)}
      title={
        bloqueada
          ? `Destrava depois de: ${licao.prereqs.join(', ')}`
          : licao.capacidade
      }
    >
      <span className="item-licao__marca" aria-hidden="true">
        {concluida ? '✓' : bloqueada ? '🔒' : licao.capstone ? '★' : licao.ordem}
      </span>
      <span className="item-licao__texto">
        <span className="item-licao__titulo">{licao.titulo}</span>
        <span className="item-licao__meta">{meta}</span>
      </span>
      {bloqueada && <span className="sr-apenas">bloqueada até concluir os pré-requisitos</span>}
    </button>
  )
}
