import { createRequire } from 'node:module'
import { chromium, type Browser, type Page } from 'playwright'
import type { AxeResults, Result, RunOptions } from 'axe-core'

import { LICAO_AUDITADA, subirServidorDeFixtures } from './servidor.ts'

/**
 * Auditoria de acessibilidade com axe-core sobre o DOM renderizado.
 *
 * Por que isto existe além do portão de contraste da paleta: `tokens.test.ts`
 * prova que cada PAR texto×superfície passa em 7:1. Isso não prova que o par
 * certo foi usado no lugar certo. Texto de token A sobre superfície de token C,
 * `opacity` somando onde ninguém contou, `disabled` herdando um cinza que a
 * tabela nunca viu — nada disso aparece numa tabela de cores, só no pixel.
 *
 * Duas armadilhas conhecidas, resolvidas aqui de propósito:
 *
 * 1. `color-contrast-enhanced` — a regra que implementa o 1.4.6 (7:1) — vem
 *    DESLIGADA no axe. Rodar o axe com a configuração padrão e escrever "0
 *    violações" no relatório certifica AA, não AAA. Ela é ligada explicitamente
 *    em `OPCOES_AXE`.
 * 2. Selecionar as regras por tag (`runOnly: ['wcag2aaa']`) parece o caminho
 *    natural e é justamente o que quebra: é o mesmo defeito do
 *    `pa11y --standard WCAG2AAA`, que não injeta a tag direito e roda um
 *    conjunto que não contém a regra. Aqui não há `runOnly`: roda tudo o que
 *    está ligado, e a única mexida é ligar a regra enhanced.
 */

const require = createRequire(import.meta.url)
const CAMINHO_AXE = require.resolve('axe-core') as string

/** Desktop: a decisão 7 já descartou layout abaixo de 1024px. */
const JANELA = { width: 1440, height: 900 }

const TEMAS = ['escuro', 'claro'] as const
type Tema = (typeof TEMAS)[number]

const OPCOES_AXE: RunOptions = {
  // Sem `runOnly`. Ver a armadilha 2 no cabeçalho.
  rules: {
    // 1.4.6 Contraste (Melhorado), 7:1. Desligada por padrão no axe.
    'color-contrast-enhanced': { enabled: true },
  },
  resultTypes: ['violations'],
}

type Tela = {
  nome: string
  caminho: string
  /** Espera até a tela estar de fato montada — evita auditar o esqueleto. */
  pronta: string
  /** Estado do servidor de fixtures antes de carregar. */
  fixture?: 'doctor-quebrado' | 'ttl-apertado' | 'aluno-trabalhou'
  /** Interações que levam a tela ao estado a auditar. */
  preparar?: (page: Page) => Promise<void>
}

const TELAS: Tela[] = [
  {
    nome: 'mapa das trilhas',
    caminho: '/',
    pronta: 'h1',
  },
  {
    nome: 'mapa da trilha Linux (concluída, em andamento e bloqueada)',
    caminho: '/trilha/linux',
    pronta: 'h1',
  },
  {
    nome: 'área do aluno',
    caminho: '/aluno',
    pronta: 'h1',
  },
  {
    nome: 'lição com o lab de pé',
    caminho: `/licao/${LICAO_AUDITADA}`,
    pronta: '.licao__titulo',
  },
  {
    // O estado mais carregado de cor do app: escada de dicas aberta, checks
    // reprovados, saída bruta do comando e erro do catálogo, todos na tela.
    nome: 'lição com dicas abertas e verificação reprovada',
    caminho: `/licao/${LICAO_AUDITADA}`,
    pronta: '.licao__titulo',
    preparar: async (page) => {
      for (let i = 0; i < 3; i += 1) {
        const botao = page.locator('.dica__botao:not([disabled])').first()
        if ((await botao.count()) === 0) break
        await botao.click()
        await page.locator('.dica').nth(i).waitFor({ state: 'visible' })
      }
      await page.getByRole('button', { name: /Verificar/ }).click()
      await page.locator('.resultado--falha').waitFor({ state: 'visible' })
    },
  },
  {
    nome: 'lição aprovada',
    caminho: `/licao/${LICAO_AUDITADA}`,
    pronta: '.licao__titulo',
    preparar: async (page) => {
      // A primeira verificação do fixture reprova, a segunda aprova.
      await page.getByRole('button', { name: /Verificar/ }).click()
      await page.locator('.resultado--falha').waitFor({ state: 'visible' })
      await page.getByRole('button', { name: /Verificar/ }).click()
      await page.locator('.resultado--ok').waitFor({ state: 'visible' })
    },
  },
  {
    // WCAG 2.2.6: o aviso de que o lab está para ser coletado. Estado de tela
    // que só existe por alguns minutos na vida real e por isso nunca seria
    // conferido à mão — tem barra semântica, relógio e um botão de ação.
    nome: 'lição com o aviso de prazo do lab',
    caminho: `/licao/${LICAO_AUDITADA}`,
    pronta: '.licao__titulo',
    fixture: 'ttl-apertado',
    preparar: async (page) => {
      await page.locator('.ttl').waitFor({ state: 'visible', timeout: 15_000 })
    },
  },
  {
    // WCAG 3.3.6: a confirmação de reset, com o diálogo modal ABERTO. É o
    // estado em que o resto da página fica inerte — se o axe achar algo aqui,
    // achou dentro do único lugar operável da tela.
    nome: 'lição com a confirmação de reset aberta',
    caminho: `/licao/${LICAO_AUDITADA}`,
    pronta: '.licao__titulo',
    preparar: async (page) => {
      await page.getByRole('button', { name: /Resetar lab/ }).click()
      await page.locator('dialog.confirmacao[open]').waitFor({ state: 'visible', timeout: 10_000 })
    },
  },
  {
    // Primeira tela de quem instalou errado. Se ela reprovar, reprova para
    // exatamente o público que menos consegue contornar.
    nome: 'diagnóstico do ambiente com falha',
    caminho: '/',
    pronta: 'h1',
    fixture: 'doctor-quebrado',
  },
]

/** Query do controle de fixtures para cada estado pedido pela tela. */
const QUERY_DE_FIXTURE: Record<NonNullable<Tela['fixture']>, string> = {
  'doctor-quebrado': '?doctor=quebrado',
  'ttl-apertado': '?ttl=apertado',
  'aluno-trabalhou': '?trabalhou=1',
}

type Achado = { tela: string; tema: Tema; violacoes: Result[] }

/** WCAG 2.5.5 Tamanho do Alvo (AAA). */
const ALVO_MINIMO = 44

/**
 * Alvos menores que 44×44 CSS px.
 *
 * O axe tem regra de tamanho de alvo, mas ela implementa o 2.5.8 — o critério
 * AA da WCAG 2.2, que pede 24×24. Rodar só o axe deixaria passar tudo entre 24
 * e 44, que é exatamente onde os alvos deste app estavam: breadcrumb a 31px,
 * placar a 33px, skip link a 41px. Nenhum deles apareceria no relatório.
 *
 * A exceção de "alvo inline num bloco de texto" é a razão de a varredura
 * ignorar links dentro de parágrafo e de tabela: ali o tamanho é ditado pelo
 * texto corrido, e o critério dispensa.
 */
async function alvosPequenos(page: Page): Promise<string[]> {
  return page.evaluate((minimo) => {
    const seletor = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    const achados: string[] = []
    for (const e of Array.from(document.querySelectorAll(seletor))) {
      const el = e as HTMLElement
      if (el.closest('p, li, td, .md') !== null) continue // alvo inline: dispensado
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue // fora de tela / medida zero
      if (r.width >= minimo && r.height >= minimo) continue
      const nome = (el.getAttribute('aria-label') ?? el.textContent ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 40)
      achados.push(
        `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${nome}" — ${Math.round(r.width)}×${Math.round(r.height)}`,
      )
    }
    return [...new Set(achados)]
  }, ALVO_MINIMO)
}

/**
 * Rolagem horizontal onde não deveria haver.
 *
 * WCAG 1.4.10 (Refluxo): conteúdo não deve exigir rolagem em duas direções.
 * O app inteiro é feito de painéis que rolam na VERTICAL; rolar na horizontal
 * significa que algum bloco cresceu além da coluna.
 *
 * A causa é quase sempre a mesma e não aparece em revisão de código: filho de
 * grid ou de flex nasce com `min-width: auto`, então ele se estica até caber o
 * conteúdo em vez de deixar o bloco interno rolar. Um `<pre>` com um comando
 * longo empurra o painel inteiro, e o `overflow-x: auto` que estava lá para
 * resolver isso nunca chega a agir.
 *
 * Blocos de código e tabelas rolam por conta própria, e devem: a exceção aqui
 * são os CONTÊINERES, não o conteúdo.
 */
async function rolagemHorizontal(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const suspeitos = ['.painel--objetivo', '.painel--estado', '.app__conteudo', 'body']
    const achados: string[] = []
    for (const seletor of suspeitos) {
      const el = document.querySelector(seletor) as HTMLElement | null
      if (el === null) continue
      const excesso = el.scrollWidth - el.clientWidth
      if (excesso > 1) {
        achados.push(`${seletor} rola ${excesso}px na horizontal (scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth})`)
      }
    }
    return achados
  })
}

/**
 * Amostra de controle: `#6B6B6B` sobre branco dá 5,33:1 — passa no AA (4,5:1)
 * e reprova no AAA (7:1). É a faixa exata onde as duas regras discordam.
 */
const CONTROLE = `<!doctype html><html lang="pt-BR"><head><title>controle</title></head>
<body style="background:#FFFFFF">
  <p style="color:#6B6B6B;background:#FFFFFF;font-size:16px">
    Texto de controle a 5,33:1 — reprova em 7:1 e passa em 4,5:1.
  </p>
</body></html>`

/**
 * Prova que a regra de 7:1 está de fato rodando, ANTES de acreditar num zero.
 *
 * "0 violações" tem dois significados possíveis: a tela passou, ou a regra
 * nunca rodou. Os dois imprimem a mesma linha verde. Como
 * `color-contrast-enhanced` vem desligada por padrão e há uma armadilha
 * conhecida de seleção por tag (ver o cabeçalho), o relatório silenciosamente
 * errado é o resultado mais provável de uma configuração ruim — e é o pior,
 * porque certifica AAA tendo medido AA.
 *
 * Então o harness mede a si mesmo: uma amostra que SÓ reprova em 7:1 tem de
 * ser reprovada aqui. Se ela passar, a auditoria está cega e o processo morre
 * em vez de imprimir um verde que não vale nada.
 */
async function provarQueARegraRoda(page: Page): Promise<void> {
  await page.setContent(CONTROLE)
  const r = await auditar(page)
  const pegou = r.violations.some((v) => v.id === 'color-contrast-enhanced')
  if (!pegou) {
    const rodaram = r.violations.map((v) => v.id).join(', ') || '(nenhuma)'
    throw new Error(
      'auto-teste do harness reprovou: a amostra de controle a 5,33:1 NÃO foi ' +
        'acusada por color-contrast-enhanced.\n' +
        `  violações vistas na amostra: ${rodaram}\n` +
        '  ou seja: a auditoria está medindo 4,5:1 e reportando como se fosse 7:1.',
    )
  }
  console.log('  [32m✔[0m auto-teste: a amostra de controle a 5,33:1 foi reprovada pela regra de 7:1')
}

async function auditar(page: Page): Promise<AxeResults> {
  await page.addScriptTag({ path: CAMINHO_AXE })
  return page.evaluate(
    async (opcoes) =>
      (window as unknown as { axe: { run: (o: RunOptions) => Promise<AxeResults> } }).axe.run(
        opcoes,
      ),
    OPCOES_AXE,
  )
}

function descrever(v: Result): string {
  const alvos = v.nodes
    .slice(0, 4)
    .map((n) => `      ${String(n.target.join(' '))}\n        ${n.failureSummary ?? ''}`)
    .join('\n')
  const resto = v.nodes.length > 4 ? `\n      … e mais ${v.nodes.length - 4} elemento(s)` : ''
  return `    [${v.id}] ${v.help}\n${alvos}${resto}`
}

async function principal(): Promise<number> {
  const { url, fechar } = await subirServidorDeFixtures()
  let navegador: Browser | undefined
  const achados: Achado[] = []
  let auditadas = 0
  let reprovasDeAlvo = 0

  try {
    navegador = await chromium.launch()

    const paginaDeControle = await navegador.newPage()
    try {
      await provarQueARegraRoda(paginaDeControle)
    } finally {
      await paginaDeControle.close()
    }

    for (const tema of TEMAS) {
      for (const tela of TELAS) {
        const contexto = await navegador.newContext({
          viewport: JANELA,
          colorScheme: tema === 'escuro' ? 'dark' : 'light',
          reducedMotion: 'reduce',
        })
        // O tema é lido do localStorage antes do primeiro render: gravar aqui
        // evita auditar um frame com o tema errado.
        await contexto.addInitScript((t) => {
          localStorage.setItem('devlab.tema', t)
          localStorage.setItem('devlab.escala', '1')
        }, tema)

        const page = await contexto.newPage()
        try {
          await page.request.post(
            `${url}/api/_fixture/estado${tela.fixture === undefined ? '' : QUERY_DE_FIXTURE[tela.fixture]}`,
          )
          await page.goto(`${url}${tela.caminho}`, { waitUntil: 'domcontentloaded' })
          await page.locator(tela.pronta).first().waitFor({ state: 'visible', timeout: 15_000 })
          if (tela.preparar !== undefined) await tela.preparar(page)

          const resultado = await auditar(page)
          const pequenos = await alvosPequenos(page)
          const rolagens = await rolagemHorizontal(page)
          auditadas += 1

          if (resultado.violations.length > 0 || pequenos.length > 0 || rolagens.length > 0) {
            achados.push({ tela: tela.nome, tema, violacoes: resultado.violations })
            reprovasDeAlvo += pequenos.length + rolagens.length
            console.log(`  [31m✘[0m ${tema} · ${tela.nome}`)
            for (const v of resultado.violations) console.log(descrever(v))
            for (const p of pequenos) {
              console.log(
                `    [tamanho-do-alvo] abaixo de ${ALVO_MINIMO}×${ALVO_MINIMO} (WCAG 2.5.5, AAA)\n      ${p}`,
              )
            }
            for (const r of rolagens) {
              console.log(`    [refluxo] rolagem horizontal (WCAG 1.4.10)\n      ${r}`)
            }
          } else {
            console.log(`  [32m✔[0m ${tema} · ${tela.nome}`)
          }
        } finally {
          await contexto.close()
        }
      }
    }
  } finally {
    await navegador?.close()
    await fechar()
  }

  const total = achados.reduce((n, a) => n + a.violacoes.length, 0) + reprovasDeAlvo
  console.log('\n' + '='.repeat(62))
  console.log(`  ${auditadas} auditoria(s): ${TELAS.length} tela(s) × ${TEMAS.length} tema(s)`)
  console.log('  color-contrast-enhanced (1.4.6, 7:1): ligada e provada no auto-teste')
  console.log(`  tamanho do alvo (2.5.5, ${ALVO_MINIMO}\u00d7${ALVO_MINIMO}) e refluxo (1.4.10): verificados fora do axe`)
  if (total > 0) {
    console.log(`  [31m✘ ${total} violação(ões)[0m`)
    return 1
  }
  console.log('  [32m✔ 0 violações[0m')
  return 0
}

process.exitCode = await principal()
