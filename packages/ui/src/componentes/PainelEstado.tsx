import type { ReactElement } from 'react'

import type { EstadoDoLab, LabInfo, NoArvore } from '../tipos.ts'

type Props = {
  estado: EstadoDoLab | null
  lab: LabInfo | null
}

/** Tipo do nó também em texto: cor e glifo sozinhos não chegam à AT. */
const ROTULO_TIPO: Record<NoArvore['tipo'], string> = {
  diretorio: 'diretório',
  arquivo: 'arquivo',
  link: 'link',
  outro: 'outro',
}

const ICONE: Record<NoArvore['tipo'], string> = {
  diretorio: '▸',
  arquivo: '·',
  link: '↪',
  outro: '?',
}

export function PainelEstado({ estado, lab }: Props): ReactElement {
  return (
    <>
      <div className="painel__cabecalho">
        <h2 className="painel__titulo">Estado do lab</h2>
        <div className="barra__espaco" />
        {estado !== null && (
          <span className="etiqueta" title="Lido do container, não simulado">
            dados reais
          </span>
        )}
      </div>

      <div className="painel__corpo">
        {lab === null ? (
          <p className="vazio">Sem lab ativo.</p>
        ) : estado === null ? (
          <p className="vazio">Lendo o estado do container…</p>
        ) : (
          <>
            {estado.recursos !== null && (
              <div className="recursos">
                <Recurso
                  rotulo="CPU"
                  valor={`${estado.recursos.cpuPercent.toFixed(1)}%`}
                  fracao={Math.min(1, estado.recursos.cpuPercent / 100)}
                />
                <Recurso
                  rotulo="Memória"
                  valor={`${estado.recursos.memoriaUsadaMb.toFixed(0)} MB`}
                  fracao={
                    estado.recursos.memoriaLimiteMb > 0
                      ? Math.min(
                          1,
                          estado.recursos.memoriaUsadaMb / estado.recursos.memoriaLimiteMb,
                        )
                      : 0
                  }
                  detalhe={`de ${estado.recursos.memoriaLimiteMb} MB`}
                />
                <Recurso rotulo="Processos" valor={String(estado.recursos.pids)} />
                <Recurso rotulo="Resets" valor={String(lab.resets)} />
              </div>
            )}

            <h3 className="secao__titulo" style={{ marginTop: 0 }}>
              {estado.raiz}
              {estado.truncada && <span className="etiqueta etiqueta--aviso">truncada</span>}
            </h3>

            {estado.arvore === null ? (
              <p className="vazio">Não foi possível ler a árvore de arquivos.</p>
            ) : (
              <ul className="arvore">
                <NoDaArvore no={estado.arvore} raiz />
              </ul>
            )}
          </>
        )}
      </div>
    </>
  )
}

function Recurso({
  rotulo,
  valor,
  fracao,
  detalhe,
}: {
  rotulo: string
  valor: string
  fracao?: number
  detalhe?: string
}): ReactElement {
  return (
    <div className="recurso">
      <div className="recurso__rotulo">{rotulo}</div>
      <div className="recurso__valor">{valor}</div>
      {detalhe !== undefined && <div className="recurso__rotulo">{detalhe}</div>}
      {fracao !== undefined && (
        <div className="recurso__barra">
          <i style={{ width: `${Math.round(fracao * 100)}%` }} />
        </div>
      )}
    </div>
  )
}

function NoDaArvore({ no, raiz = false }: { no: NoArvore; raiz?: boolean }): ReactElement {
  return (
    <li>
      <span className={`no no--${no.tipo}`}>
        <span className="no__icone" aria-hidden="true">
          {ICONE[no.tipo]}
        </span>
        <span className="sr-apenas">{ROTULO_TIPO[no.tipo]} </span>
        <span className="no__nome">{no.nome}</span>
        <span className="no__meta">
          {no.tipo === 'arquivo' ? formatarTamanho(no.tamanho) : no.permissoes}
        </span>
      </span>
      {no.filhos.length > 0 && (
        <ul>
          {no.filhos.map((filho) => (
            <NoDaArvore no={filho} key={filho.caminho} />
          ))}
        </ul>
      )}
      {raiz && no.filhos.length === 0 && (
        <ul>
          <li>
            <span className="no__meta">(vazio)</span>
          </li>
        </ul>
      )}
    </li>
  )
}

function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} K`
  return `${(bytes / (1024 * 1024)).toFixed(1)} M`
}
