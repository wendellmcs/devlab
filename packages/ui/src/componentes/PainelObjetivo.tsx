import { useEffect, useRef, type ReactElement } from 'react'

import type {
  ErroDetectado,
  EstadoDaIa,
  Licao,
  MomentoIa,
  RespostaDaIa,
  ResultadoVerificacao,
} from '../tipos.ts'
import { AssistenteIa } from './AssistenteIa.tsx'
import { Compreensao, Ensino } from './Ensino.tsx'
import { Markdown } from './Markdown.tsx'

type Props = {
  licao: Licao
  verificacao: ResultadoVerificacao | null
  ocupado: string | null
  podeVerificar: boolean
  ia: EstadoDaIa | null
  respostaIa: RespostaDaIa | null
  aoVerificar: () => void
  aoRevelarDica: (nivel: number) => void
  aoPedirIa: (momento: MomentoIa) => void
  aoInserirComando: (comando: string) => void
}

const ROTULO_NIVEL: Record<Licao['nivel'], string> = {
  operador: 'Nível 1 · Operador',
  construtor: 'Nível 2 · Construtor',
  engenheiro: 'Nível 3 · Engenheiro',
}

const ROTULO_CATEGORIA: Record<ErroDetectado['categoria'], string> = {
  sintaxe: 'sintaxe',
  ferramenta_errada: 'ferramenta errada',
  flag_errada: 'flag errada',
  permissao: 'permissão',
  conceitual: 'conceitual',
  config_nao_recarregada: 'config não recarregada',
}

export function PainelObjetivo({
  licao,
  verificacao,
  ocupado,
  podeVerificar,
  ia,
  respostaIa,
  aoVerificar,
  aoRevelarDica,
  aoPedirIa,
  aoInserirComando,
}: Props): ReactElement {
  const concluida = licao.progresso?.estado === 'concluida'

  return (
    <>
      <div className="painel__cabecalho">
        {/*
          Rótulo do painel, não título de seção. Era um <h2> e vinha ANTES do
          <h1> do título da lição — quem navega por cabeçalho ouvia "Objetivo,
          nível 2" e só depois o nome da lição, no nível 1. O <section> que
          envolve o painel já tem aria-label, então o landmark continua
          nomeado; o que sai é a hierarquia invertida.
        */}
        <p className="painel__titulo">Objetivo</p>
        {concluida && <span className="etiqueta etiqueta--ok">✓ concluída</span>}
        <div className="barra__espaco" />
        <span className="etiqueta">{licao.xp} XP</span>
      </div>

      <div className="painel__corpo">
        <div className="licao__nivel">
          <span className="etiqueta etiqueta--acento">{ROTULO_NIVEL[licao.nivel]}</span>
          {licao.capstone && <span className="etiqueta">★ capstone</span>}
          {licao.lab.quebraConserta && <span className="etiqueta etiqueta--aviso">quebra/conserta</span>}
        </div>

        <h1 className="licao__titulo">{licao.titulo}</h1>

        <p className="capacidade">
          <span className="capacidade__rotulo">Capacidade</span>
          <span>{licao.capacidade}</span>
        </p>

        <div role="status" aria-live="polite">
          {verificacao !== null && <BlocoResultado resultado={verificacao} />}
        </div>

        {/*
          Blocos 1 a 7 do E-G-P vêm ANTES da tarefa avaliada, nesta ordem e por
          este motivo: até aqui a lição abria pedindo `objetivo_md` — ou seja,
          mandava fazer sem nunca ter ensinado. Quem já sabia passava, quem não
          sabia pagava dica. O bloco de ensino é o que torna isto um curso em
          vez de uma prova.
        */}
        <Ensino licao={licao} aoInserirComando={aoInserirComando} />

        {/* 8 — prática independente: a tarefa que vale XP. */}
        <section className="ensino ensino--tarefa" aria-labelledby="bloco-tarefa">
          <h2 className="ensino__titulo" id="bloco-tarefa">
            Sua vez, sozinho
            <span className="etiqueta etiqueta--acento">vale {licao.xp} XP</span>
          </h2>
          <Markdown texto={licao.objetivo_md} nivelBase={3} aoClicarCodigo={aoInserirComando} />
        </section>

        <button
          type="button"
          className="botao botao--primario botao--largo"
          onClick={aoVerificar}
          disabled={!podeVerificar || ocupado !== null}
          aria-describedby={!podeVerificar ? 'motivo-verificar' : undefined}
        >
          {ocupado !== null ? 'Verificando…' : '✓ Verificar'}
        </button>
        {!podeVerificar && (
          <p className="ia__nota" id="motivo-verificar">
            O lab precisa estar de pé para verificar. Se ele não subir, use
            <strong> Resetar lab</strong> ou escolha a lição de novo.
          </p>
        )}

        <section className="secao" aria-labelledby="titulo-checks">
          <h2 className="secao__titulo" id="titulo-checks">
            O que será verificado
            <span className="etiqueta">estado, não texto</span>
          </h2>
          <ul className="lista-checks">
            {licao.checks.map((check) => {
              const resultado = verificacao?.checks.find((c) => c.indice === check.indice)
              const classe =
                resultado === undefined ? '' : resultado.aprovado ? 'check--ok' : 'check--falha'
              return (
                <li className={`check ${classe}`} key={check.indice}>
                  <span className="check__marca" aria-hidden="true">
                    {resultado === undefined ? '·' : resultado.aprovado ? '✓' : '✗'}
                  </span>
                  <span>
                    {resultado !== undefined && (
                      <span className="sr-apenas">
                        {resultado.aprovado ? 'aprovado: ' : 'reprovado: '}
                      </span>
                    )}
                    {check.descricao}
                    {resultado?.aprovado === false && (
                      <span className="check__detalhe">
                        {resultado.mensagem ??
                          resultado.dicaDiagnostica ??
                          `o check terminou com código ${resultado.exit}`}
                      </span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>

        {/* 9 — verificação de compreensão: depois de fazer, não antes. */}
        <Compreensao licao={licao} />

        {licao.dicas.total > 0 && (
          <EscadaDeDicas licao={licao} aoRevelarDica={aoRevelarDica} />
        )}

        <AssistenteIa
          estado={ia}
          resposta={respostaIa}
          licao={licao}
          aprovado={verificacao?.aprovado === true || concluida}
          reprovado={verificacao?.aprovado === false}
          ocupado={ocupado !== null}
          aoPedir={aoPedirIa}
        />

        {licao.cards_revisao.length > 0 && (
          <section className="secao" aria-labelledby="titulo-cards">
            <h2 className="secao__titulo" id="titulo-cards">
              Vai virar card de revisão
            </h2>
            <ul className="lista-checks">
              {licao.cards_revisao.map((card) => (
                <li className="check" key={card}>
                  <span className="check__marca" aria-hidden="true">
                    ↻
                  </span>
                  <span>{card.replace(/-/g, ' ')}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="secao">
          <h2 className="secao__titulo">Ambiente</h2>
          <p className="trilha__resumo">
            <code>{licao.lab.imagem}</code> · {licao.lab.limites.cpus} CPU ·{' '}
            {licao.lab.limites.memoriaMb} MB · {licao.lab.limites.pids} PIDs ·{' '}
            {licao.lab.limites.rede}
            {licao.lab.limites.capacidadesExtras.length > 0 && (
              <> · caps: {licao.lab.limites.capacidadesExtras.join(', ')}</>
            )}
          </p>
        </section>
      </div>
    </>
  )
}

function EscadaDeDicas({
  licao,
  aoRevelarDica,
}: {
  licao: Licao
  aoRevelarDica: (nivel: number) => void
}): ReactElement {
  const reveladas = new Map(licao.dicas.reveladas.map((d) => [d.nivel, d.texto]))
  const niveis = Array.from({ length: licao.dicas.total }, (_, i) => i + 1)

  /**
   * Foco na dica recém-aberta.
   *
   * Revelar uma dica troca o <button> por um <div> com o texto. O elemento que
   * tinha o foco deixa de existir, e o browser devolve o foco ao <body> — quem
   * está no teclado é jogado para o topo do documento e precisa tabular a tela
   * inteira de volta, sem que nada anuncie o texto que ele acabou de PAGAR
   * para ver. É WCAG 2.4.3 (Ordem do Foco) e 3.2.2 (Em Entrada).
   *
   * A dica recebe `tabindex="-1"`: entra por script, não na ordem de tabulação.
   */
  const ultimoAberto = useRef(0)
  const abertos = licao.dicas.reveladas.length
  const alvo = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (abertos > ultimoAberto.current) alvo.current?.focus()
    ultimoAberto.current = abertos
  }, [abertos])

  const maiorAberto = licao.dicas.reveladas.reduce((m, d) => Math.max(m, d.nivel), 0)

  return (
    <section className="secao" aria-labelledby="titulo-dicas">
      <h2 className="secao__titulo" id="titulo-dicas">
        Dicas
        <span className="etiqueta">a primeira é grátis</span>
      </h2>
      <div className="dicas">
        {niveis.map((nivel) => {
          const texto = reveladas.get(nivel)
          const custo = licao.dicas.custos[nivel - 1] ?? 0
          const anteriorAberta = nivel === 1 || reveladas.has(nivel - 1)

          if (texto !== undefined) {
            return (
              <div
                className="dica"
                key={nivel}
                ref={nivel === maiorAberto ? alvo : undefined}
                tabIndex={-1}
              >
                <div className="dica__cabecalho">
                  <span>Dica {nivel}</span>
                  {custo > 0 ? (
                    <span className="etiqueta etiqueta--aviso">−{custo} XP</span>
                  ) : (
                    <span className="etiqueta etiqueta--ok">grátis</span>
                  )}
                </div>
                <div>{texto}</div>
              </div>
            )
          }

          return (
            <button
              type="button"
              className="dica__botao"
              key={nivel}
              disabled={!anteriorAberta}
              onClick={() => aoRevelarDica(nivel)}
            >
              <span>
                {nivel === 1 && 'Dica 1 — empurrão conceitual'}
                {nivel === 2 && 'Dica 2 — a forma do comando, com lacuna'}
                {nivel === 3 && 'Dica 3 — a solução'}
                {!anteriorAberta && ' (abra a anterior primeiro)'}
              </span>
              {/* Explicação conceitual não se paga; comando pronto, sim. */}
              <span className="dica__custo">{custo > 0 ? `−${custo} XP` : 'grátis'}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function BlocoResultado({ resultado }: { resultado: ResultadoVerificacao }): ReactElement {
  const reprovados = resultado.checks.filter((c) => !c.aprovado)

  return (
    <div className={`resultado ${resultado.aprovado ? 'resultado--ok' : 'resultado--falha'}`}>
      <div className="resultado__topo">
        <span aria-hidden="true">{resultado.aprovado ? '✓' : '✗'}</span>
        <span>
          {resultado.aprovado
            ? resultado.primeiraConclusao
              ? 'Lição concluída'
              : 'Continua correto'
            : `${reprovados.length} de ${resultado.checks.length} check(s) reprovaram`}
        </span>
        {resultado.xpCreditado > 0 && (
          <span className="resultado__xp">+{resultado.xpCreditado} XP</span>
        )}
      </div>

      {resultado.aprovado && resultado.progresso.semAjuda && resultado.primeiraConclusao && (
        <p style={{ margin: 0, fontSize: 13 }}>Resolvida sem dica e sem IA. É o que conta.</p>
      )}

      {!resultado.aprovado &&
        reprovados.map((check) => (
          <div className="erro-catalogado" key={check.indice}>
            <div className="erro-catalogado__mensagem">
              {check.descricao} — código {check.exit} (esperado {check.esperadoExit})
            </div>
            <div className="erro-catalogado__corpo">
              {check.mensagem !== undefined && <div>{check.mensagem}</div>}
              {check.dicaDiagnostica !== undefined && (
                <div className="erro-catalogado__linha">
                  <strong>Como investigar</strong>
                  {check.dicaDiagnostica}
                </div>
              )}
              {check.saida !== '' && <pre className="saida-bruta">{check.saida}</pre>}
            </div>
          </div>
        ))}

      {resultado.errosDetectados.map((erro, i) => (
        <ErroCatalogado erro={erro} key={`${erro.id ?? 'licao'}-${i}`} />
      ))}
    </div>
  )
}

/** A mensagem original vem primeiro; a explicação vem depois. */
function ErroCatalogado({ erro }: { erro: ErroDetectado }): ReactElement {
  return (
    <div className="erro-catalogado">
      <div className="erro-catalogado__mensagem">{erro.trecho}</div>
      <div className="erro-catalogado__corpo">
        <div className="erro-catalogado__linha">
          <strong>{erro.titulo} · {ROTULO_CATEGORIA[erro.categoria]}</strong>
          {erro.significa}
        </div>
        {erro.porque !== undefined && (
          <div className="erro-catalogado__linha">
            <strong>Por que aconteceu</strong>
            {erro.porque}
          </div>
        )}
        {erro.investigar !== undefined && (
          <div className="erro-catalogado__linha">
            <strong>Como investigar</strong>
            {erro.investigar}
          </div>
        )}
        {erro.corrigir !== undefined && (
          <div className="erro-catalogado__linha">
            <strong>Como corrigir</strong>
            {erro.corrigir}
          </div>
        )}
      </div>
    </div>
  )
}
