#!/usr/bin/env node
import { carregarConteudo } from '../conteudo/carregador.ts'
import { config } from '../config.ts'
import { rodarDoctor, type Verificacao } from '../doctor.ts'

const SIMBOLO = { ok: '✔', aviso: '!', falha: '✘' } as const
const COR = { ok: '\x1b[32m', aviso: '\x1b[33m', falha: '\x1b[31m' } as const
const RESET = '\x1b[0m'
const DIM = '\x1b[2m'
const NEGRITO = '\x1b[1m'

const colorir = process.stdout.isTTY && !process.env['NO_COLOR']

function pintar(cor: string, texto: string): string {
  return colorir ? `${cor}${texto}${RESET}` : texto
}

async function doctor(): Promise<number> {
  const relatorio = await rodarDoctor()

  console.log('')
  console.log(pintar(NEGRITO, 'devlab doctor'))
  console.log(pintar(DIM, 'verificando o ambiente Linux + Docker'))
  console.log('')

  for (const v of relatorio.verificacoes) {
    imprimir(v)
  }

  console.log('')
  if (relatorio.pronto) {
    console.log(pintar(COR.ok, '✔ ambiente pronto.') + ' Suba tudo com: npm run dev')
  } else {
    console.log(pintar(COR.falha, '✘ ambiente incompleto.') + ' Resolva os itens marcados acima.')
  }
  console.log('')

  return relatorio.pronto ? 0 : 1
}

function imprimir(v: Verificacao): void {
  const simbolo = pintar(COR[v.estado], SIMBOLO[v.estado])
  console.log(`  ${simbolo} ${v.titulo.padEnd(24)} ${pintar(DIM, v.detalhe)}`)
  if (v.correcao !== undefined) {
    for (const linha of quebrar(v.correcao, 74)) {
      console.log(`      ${pintar(DIM, '→ ' + linha)}`)
    }
  }
}

/** Quebra o texto de correção em linhas, sem cortar palavra no meio. */
function quebrar(texto: string, largura: number): string[] {
  const linhas: string[] = []
  let atual = ''
  for (const palavra of texto.split(/\s+/)) {
    if (atual === '') {
      atual = palavra
    } else if (atual.length + 1 + palavra.length <= largura) {
      atual += ' ' + palavra
    } else {
      linhas.push(atual)
      atual = palavra
    }
  }
  if (atual !== '') linhas.push(atual)
  return linhas
}

async function licoes(): Promise<number> {
  const conteudo = await carregarConteudo(config.dirConteudo)

  if (conteudo.problemas.length > 0) {
    console.log(pintar(COR.falha, 'problemas de conteúdo:'))
    for (const p of conteudo.problemas) console.log(`  - ${p}`)
    console.log('')
  }

  for (const trilha of conteudo.trilhas) {
    const daTrilha = conteudo.licoes.filter((l) => l.trilha === trilha.id)
    console.log(`${pintar(NEGRITO, trilha.titulo)} ${pintar(DIM, `(${daTrilha.length} lições)`)}`)
    for (const licao of daTrilha) {
      const marca = licao.capstone ? '★' : ' '
      console.log(
        `  ${marca} ${licao.id.padEnd(34)} ${pintar(DIM, `${licao.nivel} · ${String(licao.xp)} XP`)}`,
      )
    }
    console.log('')
  }

  return conteudo.problemas.length > 0 ? 1 : 0
}

function ajuda(): number {
  console.log(`
${pintar(NEGRITO, 'devlab')} — Oficina Prática de Infraestrutura e VoIP

  devlab doctor    valida WSL2, Docker, cgroup v2, disco, portas e conteúdo
  devlab licoes    lista as trilhas e lições carregadas de content/
  devlab ajuda     mostra esta mensagem

Para subir o agente e a interface:  npm run dev
`)
  return 0
}

const comando = process.argv[2] ?? 'ajuda'
const tabela: Record<string, () => Promise<number> | number> = {
  doctor,
  licoes,
  ajuda,
  '--help': ajuda,
  '-h': ajuda,
}

const executor = tabela[comando]
if (executor === undefined) {
  console.error(`comando desconhecido: ${comando}`)
  process.exitCode = ajuda() || 1
} else {
  process.exitCode = await executor()
}
