import type {
  CategoriaDeErro,
  EntradaCatalogo,
  ErroComumLicao,
} from '../conteudo/schema.ts'

/** Prefixo que um script de check usa para devolver diagnóstico estruturado. */
export const PREFIXO_JSON = 'DEVLAB_JSON:'

export type DiagnosticoScript = {
  mensagem?: string
  dica_diagnostica?: string
}

/**
 * Separa o diagnóstico estruturado da saída bruta do check.
 *
 * O script pode emitir, em qualquer linha:
 *   echo 'DEVLAB_JSON:{"mensagem":"...","dica_diagnostica":"..."}'
 * A última linha válida vence — assim um script pode refinar o diagnóstico
 * conforme avança.
 */
export function extrairDiagnostico(saida: string): {
  texto: string
  diagnostico: DiagnosticoScript
} {
  const linhas = saida.split('\n')
  const restante: string[] = []
  let diagnostico: DiagnosticoScript = {}

  for (const linha of linhas) {
    const cru = linha.trimStart()
    if (!cru.startsWith(PREFIXO_JSON)) {
      restante.push(linha)
      continue
    }
    const payload = cru.slice(PREFIXO_JSON.length).trim()
    try {
      const analisado: unknown = JSON.parse(payload)
      if (analisado !== null && typeof analisado === 'object') {
        const obj = analisado as Record<string, unknown>
        const proximo: DiagnosticoScript = {}
        if (typeof obj['mensagem'] === 'string') proximo.mensagem = obj['mensagem']
        if (typeof obj['dica_diagnostica'] === 'string') {
          proximo.dica_diagnostica = obj['dica_diagnostica']
        }
        diagnostico = { ...diagnostico, ...proximo }
      }
    } catch {
      // JSON malformado no check é problema de quem escreveu a lição:
      // preserva a linha na saída em vez de engolir silenciosamente.
      restante.push(linha)
    }
  }

  return { texto: restante.join('\n').trimEnd(), diagnostico }
}

export type ErroDetectado = {
  origem: 'licao' | 'catalogo'
  id: string | undefined
  titulo: string
  categoria: CategoriaDeErro
  /** A mensagem original, exatamente como a ferramenta emitiu. Vem primeiro na UI. */
  trecho: string
  significa: string
  porque: string | undefined
  investigar: string | undefined
  corrigir: string | undefined
}

/**
 * Casa a saída real das ferramentas contra o catálogo de erros.
 *
 * Os `erros_comuns` da própria lição têm precedência: são mais específicos que
 * o catálogo global e falam do contexto exato do exercício.
 */
export function classificarErros(
  saida: string,
  errosDaLicao: ErroComumLicao[],
  catalogo: EntradaCatalogo[],
  trilha?: string,
): ErroDetectado[] {
  if (saida.trim() === '') return []
  const detectados: ErroDetectado[] = []
  const jaVistos = new Set<string>()

  for (const erro of errosDaLicao) {
    const trecho = casar(saida, erro.match)
    if (trecho === null) continue
    const chave = `licao:${erro.match}`
    if (jaVistos.has(chave)) continue
    jaVistos.add(chave)
    // Os quatro campos do bloco 6 chegam inteiros ao aluno. Antes só havia
    // `explica`, e o app dizia o que o erro significa sem dizer como sair
    // dele — enquanto a lição, logo acima, trazia o conserto escrito.
    detectados.push({
      origem: 'licao',
      id: undefined,
      titulo: 'Erro comum nesta lição',
      categoria: erro.categoria,
      trecho,
      significa: erro.causa,
      porque: undefined,
      investigar: `O comando que costuma produzir isto é: ${erro.digita}`,
      corrigir: erro.conserto,
    })
  }

  for (const entrada of catalogo) {
    if (
      trilha !== undefined &&
      entrada.trilhas.length > 0 &&
      !entrada.trilhas.includes(trilha)
    ) {
      continue
    }
    const trecho = casar(saida, entrada.match)
    if (trecho === null) continue
    if (jaVistos.has(entrada.id)) continue
    jaVistos.add(entrada.id)
    detectados.push({
      origem: 'catalogo',
      id: entrada.id,
      titulo: entrada.titulo,
      categoria: entrada.categoria,
      trecho,
      significa: entrada.significa,
      porque: entrada.porque,
      investigar: entrada.investigar,
      corrigir: entrada.corrigir,
    })
  }

  return detectados
}

function casar(saida: string, padrao: string): string | null {
  let regex: RegExp
  try {
    regex = new RegExp(padrao, 'im')
  } catch {
    return null
  }
  const achado = regex.exec(saida)
  if (achado === null) return null
  // Devolve a linha inteira: a mensagem original é mais útil que o fragmento.
  return linhaDoIndice(saida, achado.index)
}

function linhaDoIndice(texto: string, indice: number): string {
  const inicio = texto.lastIndexOf('\n', indice) + 1
  const fim = texto.indexOf('\n', indice)
  return texto.slice(inicio, fim === -1 ? undefined : fim).trim()
}
