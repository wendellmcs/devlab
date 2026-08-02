import fs from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'

import {
  CatalogoSchema,
  LicaoSchema,
  TrilhaSchema,
  type EntradaCatalogo,
  type Licao,
  type Trilha,
} from './schema.ts'

export type Conteudo = {
  trilhas: Trilha[]
  licoes: Licao[]
  catalogo: EntradaCatalogo[]
  /** Problemas de conteúdo. Não derrubam o agente: são exibidos para quem escreve a lição. */
  problemas: string[]
}

const VAZIO: Conteudo = { trilhas: [], licoes: [], catalogo: [], problemas: [] }

export async function carregarConteudo(dirConteudo: string): Promise<Conteudo> {
  const problemas: string[] = []

  if (!(await existe(dirConteudo))) {
    return { ...VAZIO, problemas: [`diretório de conteúdo não encontrado: ${dirConteudo}`] }
  }

  const dirTrilhas = path.join(dirConteudo, 'trilhas')
  const trilhas = await carregarTrilhas(dirTrilhas, problemas)
  const licoes = await carregarLicoes(dirTrilhas, problemas)
  const catalogo = await carregarCatalogo(path.join(dirConteudo, 'catalogo'), problemas)

  validarCoerencia(trilhas, licoes, problemas)

  trilhas.sort((a, b) => a.ordem - b.ordem)
  licoes.sort((a, b) => a.ordem - b.ordem || a.id.localeCompare(b.id))

  return { trilhas, licoes, catalogo, problemas }
}

async function carregarTrilhas(dirTrilhas: string, problemas: string[]): Promise<Trilha[]> {
  const trilhas: Trilha[] = []
  for (const arquivo of await listarYaml(dirTrilhas)) {
    if (path.basename(arquivo) !== 'trilha.yaml') continue
    const bruto = await lerYaml(arquivo, problemas)
    if (bruto === undefined) continue
    const r = TrilhaSchema.safeParse(bruto)
    if (r.success) trilhas.push(r.data)
    else problemas.push(descreverFalha(arquivo, r.error))
  }
  return trilhas
}

async function carregarLicoes(dirTrilhas: string, problemas: string[]): Promise<Licao[]> {
  const licoes: Licao[] = []
  for (const arquivo of await listarYaml(dirTrilhas)) {
    if (path.basename(arquivo) === 'trilha.yaml') continue
    const bruto = await lerYaml(arquivo, problemas)
    if (bruto === undefined) continue
    const r = LicaoSchema.safeParse(bruto)
    if (!r.success) {
      problemas.push(descreverFalha(arquivo, r.error))
      continue
    }
    for (const erro of r.data.erros_comuns) {
      if (!regexValida(erro.match)) {
        problemas.push(`${rel(arquivo)}: erros_comuns.match não é uma regex válida: ${erro.match}`)
      }
    }
    licoes.push(r.data)
  }
  return licoes
}

async function carregarCatalogo(
  dirCatalogo: string,
  problemas: string[],
): Promise<EntradaCatalogo[]> {
  const entradas: EntradaCatalogo[] = []
  for (const arquivo of await listarYaml(dirCatalogo)) {
    const bruto = await lerYaml(arquivo, problemas)
    if (bruto === undefined) continue
    const r = CatalogoSchema.safeParse(bruto)
    if (!r.success) {
      problemas.push(descreverFalha(arquivo, r.error))
      continue
    }
    for (const entrada of r.data.erros) {
      if (!regexValida(entrada.match)) {
        problemas.push(`${rel(arquivo)}: match não é uma regex válida em '${entrada.id}'`)
        continue
      }
      entradas.push(entrada)
    }
  }
  return entradas
}

function validarCoerencia(trilhas: Trilha[], licoes: Licao[], problemas: string[]): void {
  const idsTrilha = new Set(trilhas.map((t) => t.id))
  const vistos = new Map<string, string>()

  for (const licao of licoes) {
    const anterior = vistos.get(licao.id)
    if (anterior !== undefined) problemas.push(`id de lição duplicado: ${licao.id}`)
    vistos.set(licao.id, licao.titulo)

    if (!idsTrilha.has(licao.trilha)) {
      problemas.push(`lição '${licao.id}' referencia trilha inexistente: ${licao.trilha}`)
    }
  }

  const idsLicao = new Set(licoes.map((l) => l.id))
  for (const licao of licoes) {
    for (const pre of licao.prereqs) {
      if (!idsLicao.has(pre)) {
        problemas.push(`lição '${licao.id}' tem prereq inexistente: ${pre}`)
      }
    }
  }

  detectarCiclos(licoes, problemas)
}

/** A skill tree é um DAG: um ciclo em prereqs travaria o aluno para sempre. */
function detectarCiclos(licoes: Licao[], problemas: string[]): void {
  const porId = new Map(licoes.map((l) => [l.id, l]))
  const estado = new Map<string, 'visitando' | 'pronto'>()

  const visitar = (id: string, caminho: string[]): void => {
    const atual = estado.get(id)
    if (atual === 'pronto') return
    if (atual === 'visitando') {
      problemas.push(`ciclo de prereqs: ${[...caminho, id].join(' -> ')}`)
      return
    }
    estado.set(id, 'visitando')
    for (const pre of porId.get(id)?.prereqs ?? []) {
      if (porId.has(pre)) visitar(pre, [...caminho, id])
    }
    estado.set(id, 'pronto')
  }

  for (const licao of licoes) visitar(licao.id, [])
}

async function listarYaml(dir: string): Promise<string[]> {
  if (!(await existe(dir))) return []
  const entradas = await fs.readdir(dir, { recursive: true, withFileTypes: true })
  return entradas
    .filter((e) => e.isFile() && /\.ya?ml$/i.test(e.name))
    .map((e) => path.join(e.parentPath, e.name))
    .sort()
}

async function lerYaml(arquivo: string, problemas: string[]): Promise<unknown> {
  try {
    return parseYaml(await fs.readFile(arquivo, 'utf8'))
  } catch (e) {
    problemas.push(`${rel(arquivo)}: YAML inválido — ${e instanceof Error ? e.message : String(e)}`)
    return undefined
  }
}

function descreverFalha(arquivo: string, erro: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const detalhes = erro.issues
    .map((i) => `${i.path.map(String).join('.') || '(raiz)'}: ${i.message}`)
    .join('; ')
  return `${rel(arquivo)}: ${detalhes}`
}

function regexValida(padrao: string): boolean {
  try {
    new RegExp(padrao, 'i')
    return true
  } catch {
    return false
  }
}

async function existe(caminho: string): Promise<boolean> {
  try {
    await fs.access(caminho)
    return true
  } catch {
    return false
  }
}

function rel(arquivo: string): string {
  return path.relative(process.cwd(), arquivo) || arquivo
}

/** Índice em memória, com as buscas que a API precisa. */
export class IndiceDeConteudo {
  #conteudo: Conteudo = VAZIO
  #porId = new Map<string, Licao>()

  async recarregar(dirConteudo: string): Promise<Conteudo> {
    this.#conteudo = await carregarConteudo(dirConteudo)
    this.#porId = new Map(this.#conteudo.licoes.map((l) => [l.id, l]))
    return this.#conteudo
  }

  get trilhas(): Trilha[] {
    return this.#conteudo.trilhas
  }

  get licoes(): Licao[] {
    return this.#conteudo.licoes
  }

  get catalogo(): EntradaCatalogo[] {
    return this.#conteudo.catalogo
  }

  get problemas(): string[] {
    return this.#conteudo.problemas
  }

  licao(id: string): Licao | undefined {
    return this.#porId.get(id)
  }

  licoesDaTrilha(trilha: string): Licao[] {
    return this.#conteudo.licoes.filter((l) => l.trilha === trilha)
  }
}
