import type { ReactElement } from 'react'

import { propsDeLink, type Navegar } from '../rota.ts'
import type { Nivel, ResumoLicao, Trilha } from '../tipos.ts'

const NOME_NIVEL: Record<Nivel, string> = {
  operador: 'Operador',
  construtor: 'Construtor',
  engenheiro: 'Engenheiro',
}

const ORDEM_NIVEL: Nivel[] = ['operador', 'construtor', 'engenheiro']

/**
 * Mapa geral — as dez trilhas do currículo.
 *
 * Mostra também as que ainda não têm lição escrita, marcadas como "em breve"
 * com a fase prevista. Esconder o que não existe fazia o aluno concluir que o
 * produto acabou na primeira trilha; anunciar como pronto seria promessa vazia.
 * O rótulo resolve os dois.
 */
export function MapaTrilhas({
  trilhas,
  navegar,
}: {
  trilhas: Trilha[]
  navegar: Navegar
}): ReactElement {
  return (
    <div className="rolagem mapa">
      <div className="mapa__cabecalho leitura">
        <h1>Trilhas</h1>
        <p className="mapa__intro">
          Cada trilha roda software de verdade num container descartável. Comece
          por Linux — é o terreno onde todo o resto acontece.
        </p>
      </div>

      <ul className="mapa__lista">
        {trilhas.map((t) => (
          <li key={t.id}>
            <CartaoTrilha trilha={t} navegar={navegar} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function CartaoTrilha({
  trilha,
  navegar,
}: {
  trilha: Trilha
  navegar: Navegar
}): ReactElement {
  const emBreve = trilha.situacao === 'em_breve'
  const concluidas = trilha.licoes.filter((l) => l.progresso?.estado === 'concluida').length
  const total = trilha.licoes.length

  const conteudo = (
    <>
      <span className="cartao__icone" aria-hidden="true">
        {trilha.icone}
      </span>
      <span className="cartao__corpo">
        <span className="cartao__titulo">{trilha.titulo}</span>
        <span className="cartao__resumo">{trilha.resumo}</span>
        <span className="cartao__meta">
          {emBreve ? (
            // Texto, não só um cadeado: o Exercism levou um issue priority/high
            // por mostrar cadeado sem dizer o motivo nem o que fazer.
            <span className="etiqueta etiqueta--breve">
              Em breve · prevista para a Fase {trilha.fase}
            </span>
          ) : (
            <>
              <Progresso feitas={concluidas} total={total} />
              <span className="cartao__niveis">
                {ORDEM_NIVEL.filter((n) => trilha.licoes.some((l) => l.nivel === n))
                  .map((n) => NOME_NIVEL[n])
                  .join(' · ')}
              </span>
            </>
          )}
        </span>
      </span>
    </>
  )

  if (emBreve) {
    return (
      <div className="cartao cartao--breve" aria-disabled="true">
        {conteudo}
      </div>
    )
  }

  return (
    <a className="cartao" {...propsDeLink({ tela: 'trilha', trilhaId: trilha.id }, navegar)}>
      {conteudo}
    </a>
  )
}

function Progresso({ feitas, total }: { feitas: number; total: number }): ReactElement {
  const pct = total === 0 ? 0 : Math.round((feitas / total) * 100)
  return (
    <span className="progresso">
      <span
        className="progresso__trilho"
        role="progressbar"
        aria-valuenow={feitas}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${String(feitas)} de ${String(total)} lições concluídas`}
      >
        <span className="progresso__preenchido" style={{ inlineSize: `${String(pct)}%` }} />
      </span>
      {/* O número escrito é o que garante que o estado não dependa só de cor. */}
      <span className="progresso__texto">
        {feitas} de {total}
      </span>
    </span>
  )
}

/**
 * Mapa de uma trilha — as lições agrupadas por nível.
 *
 * Agrupar por nível é o que dá "definição de módulo": sem isso a trilha é uma
 * lista longa e o aluno não sabe onde termina um bloco e começa o outro, nem
 * quanto falta para mudar de patamar.
 */
export function MapaDaTrilha({
  trilha,
  navegar,
}: {
  trilha: Trilha
  navegar: Navegar
}): ReactElement {
  const niveis = ORDEM_NIVEL.filter((n) => trilha.licoes.some((l) => l.nivel === n))

  return (
    <div className="rolagem mapa">
      <div className="mapa__cabecalho leitura">
        <h1>
          <span aria-hidden="true">{trilha.icone} </span>
          {trilha.titulo}
        </h1>
        <p className="mapa__intro">{trilha.resumo}</p>
      </div>

      {niveis.map((nivel) => {
        const daqui = trilha.licoes
          .filter((l) => l.nivel === nivel)
          .sort((a, b) => a.ordem - b.ordem)
        const feitas = daqui.filter((l) => l.progresso?.estado === 'concluida').length

        return (
          <section className="modulo" key={nivel} aria-labelledby={`nivel-${nivel}`}>
            <div className="modulo__cabecalho">
              <h2 id={`nivel-${nivel}`} className="modulo__titulo">
                {NOME_NIVEL[nivel]}
              </h2>
              <Progresso feitas={feitas} total={daqui.length} />
            </div>
            {trilha.capacidades[nivel] !== undefined && (
              <p className="modulo__capacidade">{trilha.capacidades[nivel]}</p>
            )}
            <ol className="modulo__licoes">
              {daqui.map((licao) => (
                <li key={licao.id}>
                  <ItemLicao licao={licao} trilha={trilha} navegar={navegar} />
                </li>
              ))}
            </ol>
          </section>
        )
      })}
    </div>
  )
}

function ItemLicao({
  licao,
  trilha,
  navegar,
}: {
  licao: ResumoLicao
  trilha: Trilha
  navegar: Navegar
}): ReactElement {
  const concluida = licao.progresso?.estado === 'concluida'
  const semAjuda = licao.progresso?.semAjuda === true
  const travada = !licao.desbloqueada

  const conteudo = (
    <>
      {/* Símbolo + texto: estado nunca só por cor (WCAG 1.4.1). */}
      <span className="item__marca" aria-hidden="true">
        {travada ? '🔒' : concluida ? (semAjuda ? '★' : '✔') : licao.capstone ? '◆' : '○'}
      </span>
      <span className="item__corpo">
        <span className="item__titulo">
          {licao.ordem}. {licao.titulo}
          {licao.capstone && <span className="etiqueta etiqueta--capstone">capstone</span>}
        </span>
        <span className="item__meta">
          {travada ? (
            <NomesDosPrereqs licao={licao} trilha={trilha} />
          ) : concluida ? (
            <span className="item__estado">
              Concluída{semAjuda ? ' sem ajuda' : ''} · {licao.progresso?.xpGanho ?? 0} XP
            </span>
          ) : (
            <span className="item__estado">{licao.xp} XP</span>
          )}
        </span>
      </span>
    </>
  )

  if (travada) {
    return (
      <div className="item item--travado" aria-disabled="true">
        {conteudo}
      </div>
    )
  }

  return (
    <a className="item" {...propsDeLink({ tela: 'licao', licaoId: licao.id }, navegar)}>
      {conteudo}
    </a>
  )
}

/**
 * Diz QUAL lição destrava esta, pelo título — não pelo id.
 *
 * Um cadeado sem motivo é o bug que o Exercism registrou como priority/high: o
 * aluno via o ícone e não sabia o que fazer. O texto precisa nomear a ação.
 */
function NomesDosPrereqs({
  licao,
  trilha,
}: {
  licao: ResumoLicao
  trilha: Trilha
}): ReactElement {
  const faltando = licao.prereqs
    .map((id) => trilha.licoes.find((l) => l.id === id))
    .filter((l): l is ResumoLicao => l !== undefined && l.progresso?.estado !== 'concluida')

  if (faltando.length === 0) return <span className="item__estado">Bloqueada</span>

  return (
    <span className="item__estado">
      Conclua{' '}
      {faltando.map((l, i) => (
        <span key={l.id}>
          {i > 0 && ' e '}
          <strong>“{l.titulo}”</strong>
        </span>
      ))}{' '}
      para desbloquear
    </span>
  )
}
