import type { ReactElement } from 'react'

import { propsDeLink, type Navegar, type Rota } from '../rota.ts'
import type { Licao, ResumoProgresso, Trilha } from '../tipos.ts'

export type Migalha = { texto: string; destino?: Rota }

/**
 * Cabeçalho com trilha de navegação.
 *
 * Substitui o antigo botão que alternava entre lista e lição — um interruptor
 * rotulado "← Voltar à lição" quando você estava NA lista, o que era o inverso
 * do que o aluno esperava e por isso ninguém achava. O problema não se resolve
 * com um botão melhor: resolve-se com orientação permanente, que é o que WCAG
 * 2.4.8 (Localização, AAA) pede.
 */
export function Cabecalho({
  migalhas,
  resumo,
  escala,
  aoMudarEscala,
  tema,
  aoAlternarTema,
  navegar,
  ocupado,
  aoResetar,
}: {
  migalhas: Migalha[]
  resumo: ResumoProgresso | null
  escala: number
  aoMudarEscala: (v: number) => void
  tema: 'escuro' | 'claro'
  aoAlternarTema: () => void
  navegar: Navegar
  ocupado: string | null
  /** Só existe quando há lab de pé. PRD §4.2: reset sempre visível. */
  aoResetar?: (() => void) | undefined
}): ReactElement {
  return (
    <header className="cabecalho">
      <nav className="migalhas" aria-label="Trilha de navegação">
        <ol className="migalhas__lista">
          {migalhas.map((m, i) => {
            const ultima = i === migalhas.length - 1
            return (
              <li className="migalhas__item" key={`${m.texto}-${String(i)}`}>
                {i > 0 && (
                  <span className="migalhas__sep" aria-hidden="true">
                    ›
                  </span>
                )}
                {m.destino !== undefined && !ultima ? (
                  <a className="migalhas__link" {...propsDeLink(m.destino, navegar)}>
                    {m.texto}
                  </a>
                ) : (
                  <span className="migalhas__atual" aria-current={ultima ? 'page' : undefined}>
                    {m.texto}
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      </nav>

      {/* Anuncia "Subindo o lab…" sem roubar o foco de quem está no teclado. */}
      <span className="cabecalho__status" role="status" aria-live="polite">
        {ocupado ?? ''}
      </span>

      <div className="cabecalho__acoes">
        {aoResetar !== undefined && (
          <button type="button" className="botao" onClick={aoResetar}>
            Resetar lab
          </button>
        )}

        {resumo !== null && (
          <a className="placar" {...propsDeLink({ tela: 'aluno' }, navegar)}>
            <span className="placar__valor">{resumo.xpTotal}</span>
            <span className="placar__rotulo">XP</span>
            <span className="sr-apenas">— abrir a área do aluno</span>
          </a>
        )}

        <div className="escala" role="group" aria-label="Tamanho da fonte">
          <button
            type="button"
            className="botao botao--icone"
            onClick={() => aoMudarEscala(escala - 0.1)}
            disabled={escala <= 0.8}
            aria-label="Diminuir a fonte"
          >
            A−
          </button>
          <span className="escala__valor" aria-live="polite">
            {Math.round(escala * 100)}%
          </span>
          <button
            type="button"
            className="botao botao--icone"
            onClick={() => aoMudarEscala(escala + 0.1)}
            disabled={escala >= 1.6}
            aria-label="Aumentar a fonte"
          >
            A+
          </button>
        </div>

        <button
          type="button"
          className="botao botao--icone"
          onClick={aoAlternarTema}
          aria-label={tema === 'escuro' ? 'Mudar para o tema claro' : 'Mudar para o tema escuro'}
        >
          <span aria-hidden="true">{tema === 'escuro' ? '☀' : '☾'}</span>
        </button>
      </div>
    </header>
  )
}

/** Migalhas de cada tela. O último item é sempre onde o aluno está. */
export function migalhasDe(
  rota: Rota,
  trilhas: Trilha[],
  licao: Licao | null,
): Migalha[] {
  const raiz: Migalha = { texto: 'Trilhas', destino: { tela: 'mapa' } }

  if (rota.tela === 'mapa') return [{ texto: 'Trilhas' }]
  if (rota.tela === 'aluno') return [raiz, { texto: 'Área do aluno' }]

  if (rota.tela === 'trilha') {
    const t = trilhas.find((x) => x.id === rota.trilhaId)
    return [raiz, { texto: t?.titulo ?? rota.trilhaId }]
  }

  // Lição: Trilhas › Linux › Lição 3 de 12 · Caminhos
  const t = trilhas.find((x) => x.id === licao?.trilha)
  const irmas = (t?.licoes ?? []).filter((l) => l.nivel === licao?.nivel)
  const posicao = irmas.findIndex((l) => l.id === licao?.id)

  return [
    raiz,
    ...(t !== undefined
      ? [{ texto: t.titulo, destino: { tela: 'trilha', trilhaId: t.id } as Rota }]
      : []),
    {
      texto:
        licao === null
          ? 'Carregando…'
          : posicao >= 0
            ? `Lição ${String(posicao + 1)} de ${String(irmas.length)} · ${licao.titulo}`
            : licao.titulo,
    },
  ]
}
