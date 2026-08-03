import type { ReactElement } from 'react'

import type { Anatomia, ErroComum, Licao, PassoDemonstrado, PassoGuiado } from '../tipos.ts'
import { Markdown } from './Markdown.tsx'

/**
 * Blocos 1 a 7 do E-G-P — tudo o que vem ANTES da tarefa avaliada.
 *
 * A ordem não é decorativa. Cada bloco existe para tirar uma carga do bloco
 * seguinte: o gancho dá motivo, o modelo mental dá o porquê, a anatomia dá o
 * vocabulário, a demonstração mostra resolvido, os erros comuns antecipam o
 * tropeço, e a prática guiada é o degrau que faltava entre ver e fazer.
 *
 * Um detalhe de renderização vale a pena registrar: as RESPOSTAS da prática
 * guiada e das perguntas de compreensão ficam dentro de `<details>`, fechadas.
 * Não é para esconder — é para o aluno tentar antes de ver. Exemplo resolvido
 * (bloco 5) fica aberto, porque ali ver É o exercício; prática guiada (bloco
 * 7) fica fechada, porque ali fazer é o exercício.
 */

/**
 * Texto curto com trechos de código entre crases.
 *
 * Não é markdown: aqui só existe uma regra, `assim` vira `<code>assim</code>`.
 * Rótulo de anatomia, nota de demonstração e instrução de passo são frases de
 * uma linha — passá-las pelo `Markdown` traria parágrafo, margem de bloco e um
 * `dangerouslySetInnerHTML` para renderizar meia dúzia de palavras. E sem
 * NENHUM tratamento a crase aparecia literal na tela, que é o que acontecia
 * antes desta função existir.
 *
 * Não há sanitização a fazer: o resultado são elementos React, nunca HTML.
 */
function TextoRico({ texto }: { texto: string }): ReactElement {
  const partes = texto.split('`')
  return (
    <>
      {partes.map((parte, i) =>
        i % 2 === 1 ? <code key={i}>{parte}</code> : <span key={i}>{parte}</span>,
      )}
    </>
  )
}

const PAPEL: Record<Anatomia['partes'][number]['papel'], string> = {
  comando: 'comando',
  opcao: 'opção',
  argumento: 'argumento',
  operador: 'operador do shell',
}

const TIPO_DE_PERGUNTA: Record<Licao['ensino']['compreensao'][number]['tipo'], string> = {
  predicao: 'preveja a saída',
  diagnostico: 'diagnostique',
  transferencia: 'transfira',
}

type Props = {
  licao: Licao
  aoInserirComando: (comando: string) => void
}

export function Ensino({ licao, aoInserirComando }: Props): ReactElement {
  const e = licao.ensino

  return (
    <>
      {/* 1 — Gancho */}
      <section className="ensino ensino--gancho" aria-labelledby="bloco-gancho">
        <h2 className="ensino__titulo" id="bloco-gancho">
          Por que isto importa
        </h2>
        <Markdown texto={e.gancho} nivelBase={3} />
      </section>

      {/* 2 — Objetivos */}
      {e.objetivos.length > 0 && (
        <section className="ensino" aria-labelledby="bloco-objetivos">
          <h2 className="ensino__titulo" id="bloco-objetivos">
            Ao terminar, você vai conseguir
          </h2>
          <ul className="objetivos">
            {e.objetivos.map((o) => (
              <li className="objetivo" key={`${o.verbo}-${o.texto}`}>
                <span className="objetivo__verbo">{o.verbo}</span>
                <span><TextoRico texto={o.texto} /></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 3 — Modelo mental */}
      <section className="ensino ensino--modelo" aria-labelledby="bloco-modelo">
        <h2 className="ensino__titulo" id="bloco-modelo">
          O modelo mental
          {licao.conceitos.length > 0 && (
            <span className="etiqueta">
              {licao.conceitos.length} conceito{licao.conceitos.length > 1 ? 's' : ''} novo
              {licao.conceitos.length > 1 ? 's' : ''}
            </span>
          )}
        </h2>
        <Markdown texto={e.modelo_mental} nivelBase={3} aoClicarCodigo={aoInserirComando} />
      </section>

      {/* 4 — Anatomia */}
      {e.anatomia.map((a) => (
        <BlocoAnatomia anatomia={a} key={a.linha} />
      ))}

      {/* 5 — Demonstração comentada */}
      {e.demonstracao.length > 0 && (
        <section className="ensino" aria-labelledby="bloco-demo">
          <h2 className="ensino__titulo" id="bloco-demo">
            Veja resolvido
            <span className="etiqueta">saída real do container</span>
          </h2>
          <ol className="demo">
            {e.demonstracao.map((passo, i) => (
              <Demonstracao passo={passo} aoInserir={aoInserirComando} key={`${i}-${passo.comando}`} />
            ))}
          </ol>
        </section>
      )}

      {/* 6 — Erros comuns */}
      {licao.erros_comuns.length > 0 && (
        <section className="ensino" aria-labelledby="bloco-erros">
          <h2 className="ensino__titulo" id="bloco-erros">
            O que costuma dar errado
          </h2>
          <div className="erros-antecipados">
            {licao.erros_comuns.map((erro) => (
              <ErroAntecipado erro={erro} aoInserir={aoInserirComando} key={erro.mensagem} />
            ))}
          </div>
        </section>
      )}

      {/* 7 — Prática guiada */}
      {e.pratica_guiada.length > 0 && (
        <section className="ensino" aria-labelledby="bloco-guiada">
          <h2 className="ensino__titulo" id="bloco-guiada">
            Agora com você — passo a passo
            <span className="etiqueta">não vale XP, é treino</span>
          </h2>
          <ol className="guiada">
            {e.pratica_guiada.map((passo, i) => (
              <PassoDaGuiada passo={passo} indice={i} aoInserir={aoInserirComando} key={passo.instrucao} />
            ))}
          </ol>
        </section>
      )}
    </>
  )
}

/** Bloco 9 — fica DEPOIS da tarefa, então é montado à parte. */
export function Compreensao({ licao }: { licao: Licao }): ReactElement | null {
  if (licao.ensino.compreensao.length === 0) return null

  return (
    <section className="ensino" aria-labelledby="bloco-compreensao">
      <h2 className="ensino__titulo" id="bloco-compreensao">
        Entendeu mesmo?
        <span className="etiqueta">colar não resolve</span>
      </h2>
      <div className="compreensao">
        {licao.ensino.compreensao.map((p) => (
          <div className="pergunta" key={p.pergunta}>
            <div className="pergunta__tipo">{TIPO_DE_PERGUNTA[p.tipo]}</div>
            <p className="pergunta__texto"><TextoRico texto={p.pergunta} /></p>
            <details className="revelavel">
              <summary>Conferir a resposta</summary>
              <Markdown texto={p.resposta} nivelBase={4} />
            </details>
          </div>
        ))}
      </div>
    </section>
  )
}

function BlocoAnatomia({ anatomia }: { anatomia: Anatomia }): ReactElement {
  return (
    <section className="ensino" aria-label={`Anatomia de ${anatomia.linha}`}>
      <h2 className="ensino__titulo">Anatomia do comando</h2>
      <pre className="anatomia__linha" tabIndex={0}>
        <code>{anatomia.linha}</code>
      </pre>
      <dl className="anatomia">
        {anatomia.partes.map((parte) => (
          <div className="anatomia__parte" key={`${parte.papel}-${parte.trecho}`}>
            <dt>
              <code>{parte.trecho}</code>
              <span className="anatomia__papel">{PAPEL[parte.papel]}</span>
            </dt>
            <dd><TextoRico texto={parte.explica} /></dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function Demonstracao({
  passo,
  aoInserir,
}: {
  passo: PassoDemonstrado
  aoInserir: (c: string) => void
}): ReactElement {
  return (
    <li className="demo__passo">
      <button
        type="button"
        className="demo__comando"
        onClick={() => aoInserir(passo.comando)}
        aria-label={`Inserir no terminal: ${passo.comando}`}
      >
        <span className="demo__prompt" aria-hidden="true">
          $
        </span>
        <code>{passo.comando}</code>
      </button>
      {/* Rola na horizontal e não pode quebrar linha: precisa de tabindex
          para quem navega por teclado alcançar o fim da saída (WCAG 2.1.1). */}
      {passo.saida !== '' && (
        <pre className="demo__saida" tabIndex={0}>
          {passo.saida}
        </pre>
      )}
      <p className="demo__nota"><TextoRico texto={passo.nota} /></p>
    </li>
  )
}

function ErroAntecipado({
  erro,
  aoInserir,
}: {
  erro: ErroComum
  aoInserir: (c: string) => void
}): ReactElement {
  return (
    <div className="erro-antecipado">
      <div className="erro-antecipado__linha">
        <span className="erro-antecipado__rotulo">Você digita</span>
        <button
          type="button"
          className="erro-antecipado__comando"
          onClick={() => aoInserir(erro.digita)}
          aria-label={`Inserir no terminal: ${erro.digita}`}
        >
          <code>{erro.digita}</code>
        </button>
      </div>
      <div className="erro-antecipado__linha">
        <span className="erro-antecipado__rotulo">A resposta</span>
        <pre className="erro-antecipado__mensagem">{erro.mensagem}</pre>
      </div>
      <div className="erro-antecipado__linha">
        <span className="erro-antecipado__rotulo">Por quê</span>
        <span><TextoRico texto={erro.causa} /></span>
      </div>
      <div className="erro-antecipado__linha">
        <span className="erro-antecipado__rotulo">O conserto</span>
        <span><TextoRico texto={erro.conserto} /></span>
      </div>
    </div>
  )
}

function PassoDaGuiada({
  passo,
  indice,
  aoInserir,
}: {
  passo: PassoGuiado
  indice: number
  aoInserir: (c: string) => void
}): ReactElement {
  return (
    <li className="guiada__passo">
      <p className="guiada__instrucao"><TextoRico texto={passo.instrucao} /></p>
      {passo.modelo !== undefined && (
        <button
          type="button"
          className="guiada__modelo"
          onClick={() => aoInserir(passo.modelo as string)}
          aria-label={`Inserir no terminal o modelo com lacuna: ${passo.modelo}`}
        >
          <code>{passo.modelo}</code>
        </button>
      )}
      <details className="revelavel">
        <summary>Conferir o passo {indice + 1}</summary>
        <button
          type="button"
          className="guiada__resposta"
          onClick={() => aoInserir(passo.resposta)}
          aria-label={`Inserir no terminal: ${passo.resposta}`}
        >
          <code>{passo.resposta}</code>
        </button>
      </details>
    </li>
  )
}
