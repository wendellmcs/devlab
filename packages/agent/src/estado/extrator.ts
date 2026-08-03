import { log } from '../log.ts'
import type { GerenciadorDeLabs } from '../lab/gerenciador.ts'
import type { Recursos } from '../lab/tipos.ts'

export type TipoNo = 'diretorio' | 'arquivo' | 'link' | 'outro'

export type NoArvore = {
  nome: string
  caminho: string
  tipo: TipoNo
  tamanho: number
  permissoes: string
  dono: string
  filhos: NoArvore[]
}

export type EstadoDoLab = {
  raiz: string
  arvore: NoArvore | null
  truncada: boolean
  recursos: Recursos | null
  atualizadoEm: number
  /**
   * Quanto falta para a coleta por ociosidade. `null` quando o lab sumiu entre
   * o começo e o fim da coleta.
   */
  ttl: { restanteMs: number; totalMs: number } | null
  /**
   * Ações deliberadas do aluno neste lab, até agora.
   *
   * Viaja aqui porque só o agente sabe: o aluno digita no terminal por
   * WebSocket, e a tela que precisa dessa informação — a que pergunta se pode
   * mesmo sair e destruir o container — não tem como contar sozinha.
   */
  acoesDoAluno: number | null
}

const MAX_ENTRADAS = 400
const PROFUNDIDADE_PADRAO = 3

/**
 * State Extractor.
 *
 * Roda comandos de leitura dentro do lab e converte em JSON para o painel da
 * direita. Tudo aqui é dado REAL extraído do container — nada é inventado nem
 * derivado do que o aluno digitou.
 */
export class ExtratorDeEstado {
  readonly #labs: GerenciadorDeLabs

  constructor(labs: GerenciadorDeLabs) {
    this.#labs = labs
  }

  async coletar(
    labId: string,
    opcoes: { raiz?: string; profundidade?: number } = {},
  ): Promise<EstadoDoLab> {
    const info = this.#labs.obter(labId)
    const raiz = opcoes.raiz ?? info?.workdir ?? '/'
    const profundidade = clampar(opcoes.profundidade ?? PROFUNDIDADE_PADRAO, 1, 6)

    const [arvore, recursos] = await Promise.all([
      this.#arvore(labId, raiz, profundidade),
      this.#recursos(labId),
    ])

    // Lido DEPOIS dos execs: o prazo é calculado no instante da resposta, e
    // entre o começo e o fim desta coleta passam centenas de milissegundos.
    const depois = this.#labs.obter(labId)

    return {
      raiz,
      arvore: arvore.raiz,
      truncada: arvore.truncada,
      recursos,
      atualizadoEm: Date.now(),
      // O relógio da coleta por ociosidade viaja junto com o estado porque é
      // esta requisição que a interface repete a cada 2,5 s. Um endpoint
      // separado só para o prazo dobraria o tráfego para dizer a mesma coisa —
      // e esta leitura não conta como atividade, então ela pode observar o
      // relógio andar sem interferir nele.
      ttl:
        depois === undefined
          ? null
          : { restanteMs: depois.ociosidadeRestanteMs, totalMs: depois.ttlMs },
      acoesDoAluno: depois?.acoesDoAluno ?? null,
    }
  }

  async #arvore(
    labId: string,
    raiz: string,
    profundidade: number,
  ): Promise<{ raiz: NoArvore | null; truncada: boolean }> {
    if (raiz.includes("'")) return { raiz: null, truncada: false }

    // %y tipo · %s tamanho · %M permissões simbólicas · %u dono · %P caminho relativo
    const comando =
      `find '${raiz}' -maxdepth ${profundidade} -printf '%y\\t%s\\t%M\\t%u\\t%P\\n' 2>/dev/null ` +
      `| head -n ${MAX_ENTRADAS + 1}`

    const r = await this.#labs.exec(labId, ['/bin/bash', '-c', comando], {
      usuario: 'root',
      timeoutMs: 10_000,
    })
    if (r.exit !== 0 && r.stdout === '') return { raiz: null, truncada: false }

    return montarArvore(r.stdout, raiz)
  }

  async #recursos(labId: string): Promise<Recursos | null> {
    try {
      return await this.#labs.recursos(labId)
    } catch (e) {
      log.debug('não foi possível ler recursos do lab', e)
      return null
    }
  }
}

/** Converte a saída do `find` numa árvore. Pura, para poder ser testada sozinha. */
export function montarArvore(
  saidaFind: string,
  raiz: string,
): { raiz: NoArvore | null; truncada: boolean } {
  const linhas = saidaFind.split('\n').filter((l) => l !== '')
  const truncada = linhas.length > MAX_ENTRADAS
  const usadas = truncada ? linhas.slice(0, MAX_ENTRADAS) : linhas

  let no: NoArvore | null = null
  const porCaminho = new Map<string, NoArvore>()

  for (const linha of usadas) {
    const partes = linha.split('\t')
    if (partes.length < 5) continue
    const [tipo, tamanho, permissoes, dono] = partes
    const relativo = partes.slice(4).join('\t')

    const atual: NoArvore = {
      nome: relativo === '' ? nomeBase(raiz) : nomeBase(relativo),
      caminho: relativo,
      tipo: traduzirTipo(tipo ?? ''),
      tamanho: Number(tamanho ?? 0) || 0,
      permissoes: permissoes ?? '',
      dono: dono ?? '',
      filhos: [],
    }

    if (relativo === '') {
      no = atual
      porCaminho.set('', atual)
      continue
    }
    porCaminho.set(relativo, atual)
  }

  if (no === null) return { raiz: null, truncada }

  for (const [caminho, entrada] of porCaminho) {
    if (caminho === '') continue
    const corte = caminho.lastIndexOf('/')
    const paiCaminho = corte === -1 ? '' : caminho.slice(0, corte)
    const pai = porCaminho.get(paiCaminho)
    if (pai !== undefined) pai.filhos.push(entrada)
  }

  ordenar(no)
  return { raiz: no, truncada }
}

function ordenar(no: NoArvore): void {
  no.filhos.sort((a, b) => {
    if (a.tipo === 'diretorio' && b.tipo !== 'diretorio') return -1
    if (b.tipo === 'diretorio' && a.tipo !== 'diretorio') return 1
    return a.nome.localeCompare(b.nome, 'pt-BR')
  })
  for (const filho of no.filhos) ordenar(filho)
}

function traduzirTipo(letra: string): TipoNo {
  if (letra === 'd') return 'diretorio'
  if (letra === 'f') return 'arquivo'
  if (letra === 'l') return 'link'
  return 'outro'
}

function nomeBase(caminho: string): string {
  const limpo = caminho.replace(/\/+$/, '')
  const corte = limpo.lastIndexOf('/')
  return corte === -1 ? limpo : limpo.slice(corte + 1)
}

/** `?profundidade=abc` vira NaN, e NaN atravessa Math.max/min sem ser clampado. */
function clampar(valor: number, min: number, max: number): number {
  if (!Number.isFinite(valor)) return min
  return Math.max(min, Math.min(max, Math.trunc(valor)))
}
