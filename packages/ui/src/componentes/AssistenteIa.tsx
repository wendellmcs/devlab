import type { ReactElement } from 'react'

import type { EstadoDaIa, Licao, MomentoIa, RespostaDaIa } from '../tipos.ts'
import { Markdown } from './Markdown.tsx'

type Props = {
  estado: EstadoDaIa | null
  resposta: RespostaDaIa | null
  licao: Licao
  aprovado: boolean
  reprovado: boolean
  ocupado: boolean
  aoPedir: (momento: MomentoIa) => void
}

const DESCRICAO: Record<MomentoIa, string> = {
  explicar_erro: 'Traduz a mensagem de erro real em causa provável e próximo passo.',
  revisar_solucao: 'Aponta abordagem mais limpa, riscos e prática de produção.',
  dica_socratica: 'Faz uma pergunta que destrava o raciocínio — não entrega o comando.',
}

const ROTULO_CURTO: Record<MomentoIa, string> = {
  explicar_erro: 'Explicar meu erro',
  revisar_solucao: 'Revisar minha solução',
  dica_socratica: 'Pergunta guia',
}

export function AssistenteIa({
  estado,
  resposta,
  licao,
  aprovado,
  reprovado,
  ocupado,
  aoPedir,
}: Props): ReactElement | null {
  if (estado === null) return null

  const custo = Math.round(licao.xp * 0.5)

  if (!estado.ligada || !estado.disponivel) {
    return (
      <section className="secao" aria-labelledby="titulo-ia">
        <h2 className="secao__titulo" id="titulo-ia">
          Assistente (IA local)
          <span className="etiqueta">{estado.ligada ? 'indisponível' : 'desligado'}</span>
        </h2>
        <p className="ia__nota">
          {estado.ligada
            ? (estado.erro ?? 'o provedor de IA não respondeu')
            : 'A IA vem desligada por princípio: tudo aqui funciona sem ela.'}
        </p>
        {estado.sugestao !== undefined && <p className="ia__nota">{estado.sugestao}</p>}
        <p className="ia__nota ia__nota--forte">
          Quando ligada, o modelo <code>{estado.modelo}</code> roda na sua máquina via{' '}
          {estado.provedor}. Nenhum dado sai daqui.
        </p>
      </section>
    )
  }

  const disponibilidade: Record<MomentoIa, boolean> = {
    explicar_erro: reprovado,
    revisar_solucao: aprovado,
    dica_socratica: true,
  }

  const motivoBloqueio: Record<MomentoIa, string> = {
    explicar_erro: 'disponível depois de uma verificação que reprovar',
    revisar_solucao: 'disponível depois de você passar na verificação',
    dica_socratica: '',
  }

  return (
    <section className="secao" aria-labelledby="titulo-ia">
      <h2 className="secao__titulo" id="titulo-ia">
        Assistente (IA local)
        <span className="etiqueta etiqueta--acento" title={`${estado.provedor} · ${estado.url}`}>
          {estado.modelo}
        </span>
      </h2>

      <p className="ia__nota">
        Roda na sua máquina — nada sai daqui. Usar custa o mesmo que a dica 3
        (−{custo} XP) e marca a lição como resolvida com ajuda.
      </p>

      <div className="dicas">
        {estado.momentos.map((m) => {
          const liberado = disponibilidade[m.id]
          return (
            <button
              type="button"
              key={m.id}
              className="dica__botao"
              disabled={!liberado || ocupado}
              title={liberado ? DESCRICAO[m.id] : motivoBloqueio[m.id]}
              onClick={() => aoPedir(m.id)}
            >
              <span>
                {ROTULO_CURTO[m.id]}
                <span className="check__detalhe">
                  {liberado ? DESCRICAO[m.id] : motivoBloqueio[m.id]}
                </span>
              </span>
              <span className="dica__custo">−{custo} XP</span>
            </button>
          )
        })}
      </div>

      {/* A região precisa preexistir à inserção do conteúdo, senão o leitor
          de tela não anuncia de forma confiável. */}
      <div role="status" aria-live="polite">
        {resposta !== null && (
        <div className="ia-resposta">
          <div className="ia-resposta__cabecalho">
            <span className="etiqueta etiqueta--aviso" title="Solução assistida não conta como maestria sem ajuda">
              ✦ assistido por IA
            </span>
            <span>{resposta.rotulo}</span>
            <span className="ia-resposta__meta">
              {resposta.modelo} · {(resposta.duracaoMs / 1000).toFixed(1)}s
            </span>
          </div>

          <Markdown texto={resposta.texto} />

          {resposta.podado && (
            <p className="ia__nota ia__nota--forte">
              O modelo tentou entregar o comando pronto. O trecho foi removido: nesta
              modalidade a IA orienta, não resolve.
            </p>
          )}
        </div>
        )}
      </div>
    </section>
  )
}
