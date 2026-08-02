#!/usr/bin/env node
import { carregarConteudo } from '../conteudo/carregador.ts'
import { config } from '../config.ts'
import { rodarDoctor, type Verificacao } from '../doctor.ts'
import { criarProvedor } from '../ia/provedor.ts'
import { ProvedorNuvem } from '../ia/nuvem.ts'
import type { ProvedorOllama } from '../ia/ollama.ts'
import { gravarPreferencia, protegerEnv } from '../preferencias.ts'

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
    console.log(pintar(COR.ok, '✔ ambiente pronto.') + ' Suba com: devlab iniciar')
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

/**
 * `devlab ia` — liga, desliga e troca de provedor.
 *
 * A escolha do setup não é definitiva: quem instalou sem IA, ou com um modelo
 * grande demais para a máquina, precisa poder mudar de ideia sem reinstalar.
 */
function ia(): number {
  const alvo = (process.argv[3] ?? '').toLowerCase()

  if (alvo === '') {
    const estado = config.ia.ligada ? pintar(COR.ok, 'ligada') : pintar(DIM, 'desligada')
    const modelo = config.ia.provedor === 'nuvem' ? config.ia.modeloNuvem : config.ia.modelo
    console.log('')
    console.log(`  IA:       ${estado}`)
    console.log(`  provedor: ${config.ia.provedor}`)
    console.log(`  modelo:   ${modelo}`)
    console.log('')
    console.log(pintar(DIM, '  devlab ia ollama   modelo local, nada sai da máquina (padrão)'))
    console.log(pintar(DIM, '  devlab ia nuvem    API com a sua chave, para máquina apertada'))
    console.log(pintar(DIM, '  devlab ia off      desliga (o núcleo não depende dela)'))
    console.log('')
    return 0
  }

  if (alvo === 'off' || alvo === 'nao' || alvo === 'não') {
    gravarPreferencia('DEVLAB_IA', '0')
    console.log(pintar(COR.ok, '✔') + ' IA desligada. O DevLab continua inteiro sem ela.')
    return 0
  }

  if (alvo === 'ollama' || alvo === 'local') {
    gravarPreferencia('DEVLAB_IA', '1')
    gravarPreferencia('DEVLAB_IA_PROVEDOR', 'ollama')
    console.log(pintar(COR.ok, '✔') + ` IA local ligada (modelo ${config.ia.modelo}).`)
    console.log(pintar(DIM, '  troque o modelo com: devlab modelo <nome>'))
    return 0
  }

  if (alvo === 'nuvem' || alvo === 'cloud' || alvo === 'api') {
    gravarPreferencia('DEVLAB_IA', '1')
    gravarPreferencia('DEVLAB_IA_PROVEDOR', 'nuvem')
    protegerEnv()
    console.log(pintar(COR.ok, '✔') + ` IA em nuvem ligada (modelo ${config.ia.modeloNuvem}).`)
    if (config.ia.chaveNuvem === undefined || config.ia.chaveNuvem === '') {
      console.log('')
      console.log(pintar(COR.aviso, '  !') + ' falta a chave. Acrescente ao .env:')
      console.log(pintar(DIM, '      ANTHROPIC_API_KEY=sk-ant-...'))
    }
    console.log('')
    console.log(pintar(DIM, '  A chave é sua e o custo é seu. O enunciado da lição e as'))
    console.log(pintar(DIM, '  últimas linhas do seu terminal passam a sair da máquina —'))
    console.log(pintar(DIM, '  a dica, a solução e os scripts de check continuam fora.'))
    console.log('')
    return 0
  }

  console.error(`provedor desconhecido: ${alvo} (use ollama, nuvem ou off)`)
  return 1
}

/** `devlab modelo` — mostra, lista e troca o modelo do provedor em uso. */
async function modelo(): Promise<number> {
  const arg = process.argv[3] ?? ''
  const naNuvem = config.ia.provedor === 'nuvem'
  const atual = naNuvem ? config.ia.modeloNuvem : config.ia.modelo
  const chaveEnv = naNuvem ? 'DEVLAB_IA_MODELO_NUVEM' : 'DEVLAB_IA_MODELO'

  if (arg === '--listar' || arg === '-l') {
    const provedor = criarProvedor()
    let disponiveis: string[]
    try {
      disponiveis =
        provedor instanceof ProvedorNuvem
          ? await provedor.listarModelos()
          : await (provedor as ProvedorOllama).listarModelos()
    } catch (e) {
      console.error(`não foi possível listar: ${e instanceof Error ? e.message : String(e)}`)
      return 1
    }
    if (disponiveis.length === 0) {
      console.log(pintar(DIM, naNuvem ? 'nenhum modelo visível para esta chave' : 'nenhum modelo baixado — use: ollama pull <nome>'))
      return 0
    }
    console.log('')
    for (const m of disponiveis) {
      console.log(`  ${m === atual ? pintar(COR.ok, '●') : ' '} ${m}`)
    }
    console.log('')
    console.log(pintar(DIM, `  trocar: devlab modelo <nome>`))
    console.log('')
    return 0
  }

  if (arg === '') {
    console.log('')
    console.log(`  provedor: ${config.ia.provedor}`)
    console.log(`  modelo:   ${pintar(NEGRITO, atual)}`)
    if (naNuvem) console.log(`  esforço:  ${config.ia.esforco}`)
    console.log('')
    console.log(pintar(DIM, '  devlab modelo --listar   modelos disponíveis'))
    console.log(pintar(DIM, '  devlab modelo <nome>     troca o modelo'))
    console.log('')
    return 0
  }

  gravarPreferencia(chaveEnv, arg)
  console.log(pintar(COR.ok, '✔') + ` modelo do provedor '${config.ia.provedor}' agora é ${arg}`)
  if (!naNuvem) {
    console.log(pintar(DIM, `  se ainda não baixou: ollama pull ${arg}`))
  }
  console.log(pintar(DIM, '  vale no próximo "devlab iniciar".'))
  return 0
}

function ajuda(): number {
  console.log(`
${pintar(NEGRITO, 'devlab')} — Oficina Prática de Infraestrutura e VoIP

  devlab iniciar   sobe o DevLab (um processo) em http://127.0.0.1:7788
  devlab doctor    valida WSL2, Docker, cgroup v2, disco, portas e conteúdo
  devlab licoes    lista as trilhas e lições carregadas de content/
  devlab ia        liga/desliga a IA e troca entre modelo local e nuvem
  devlab modelo    mostra, lista e troca o modelo em uso
  devlab atualizar git pull + dependências + build da interface
  devlab ajuda     mostra esta mensagem

Para MEXER na interface (Vite com HMR, porta 5173):  devlab dev
`)
  return 0
}

const comando = process.argv[2] ?? 'ajuda'
const tabela: Record<string, () => Promise<number> | number> = {
  doctor,
  licoes,
  ia,
  modelo,
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
