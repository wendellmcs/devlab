import { chromium, type Browser, type Page } from 'playwright'

import { LICAO_AUDITADA, subirServidorDeFixtures } from './servidor.ts'

/**
 * Percurso central do DevLab feito SÓ com teclado.
 *
 * O roteiro manual (`docs/ROTEIRO-TECLADO.md`) continua sendo a fonte para o
 * que exige um par de olhos e um leitor de tela. Isto aqui automatiza a metade
 * mecânica dele — a que regride em silêncio: um `div` com `onClick` sem
 * `role`, um botão que some da ordem de tabulação, um foco que fica preso.
 * Essa metade não precisa de humano, e humano nenhum a repete a cada commit.
 *
 * Nenhum passo usa clique. `page.keyboard` é a única entrada.
 */

const JANELA = { width: 1440, height: 900 }
/** URL do servidor de fixtures. Preenchida em `principal()`: alguns passos
 *  precisam recarregar a tela num estado que só o controle do fixture cria. */
const BASE = { url: '' }
/** Teto de Tabs por busca: a tela mais densa tem ~16 paradas. */
const MAX_TABS = 60

type Passo = { nome: string; executar: (page: Page) => Promise<void> }

const falhas: string[] = []

function checar(condicao: boolean, mensagem: string): void {
  if (condicao) {
    console.log(`    [32m✔[0m ${mensagem}`)
  } else {
    console.log(`    [31m✘[0m ${mensagem}`)
    falhas.push(mensagem)
  }
}

type Foco = { papel: string; nome: string; tag: string; href: string | null }

/** Descreve o elemento com foco, como um leitor de tela o anunciaria. */
async function focoAtual(page: Page): Promise<Foco> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (el === null) return { papel: '(nada)', nome: '', tag: '', href: null }
    const tag = el.tagName.toLowerCase()
    // `document.body.textContent` é a página inteira: deixar o body entrar na
    // busca por nome faz QUALQUER padrão casar com ele. Foi assim que o
    // percurso "achou" o botão Verificar num ponto em que o foco tinha caído
    // para fora de todo controle — e seguiu adiante apertando Enter no vazio.
    if (tag === 'body' || tag === 'html') {
      return { papel: tag, nome: '', tag, href: null }
    }
    const papel = el.getAttribute('role') ?? tag
    const nome = (el.getAttribute('aria-label') ?? el.textContent ?? '')
      .trim()
      .replace(/\s+/g, ' ')
    return { papel, nome, tag, href: el.getAttribute('href') }
  })
}

/**
 * Tabula até o predicado casar. Devolve quantos Tabs foram precisos, ou -1 se
 * o alvo não estiver alcançável — que é o defeito que isto caça.
 *
 * O predicado recebe o elemento inteiro, não só o nome: casar por texto
 * sozinho já apontou para o botão errado uma vez, porque o rótulo de um
 * controle vizinho continha a mesma palavra. Um alvo de navegação é
 * identificado pelo `href`, não pelo que está escrito nele.
 */
async function tabularAte(page: Page, casa: (f: Foco) => boolean): Promise<number> {
  for (let i = 1; i <= MAX_TABS; i += 1) {
    await page.keyboard.press('Tab')
    const foco = await focoAtual(page)
    if (casa(foco)) return i
    // O terminal captura Tab: sem sair, a varredura gira em falso para sempre.
    if (/Terminal input/i.test(foco.nome)) await page.keyboard.press('Escape')
  }
  return -1
}

const porNome = (alvo: RegExp) => (f: Foco): boolean => alvo.test(f.nome)
const porLink = (destino: string) => (f: Foco): boolean => f.href === destino

const PASSOS: Passo[] = [
  {
    nome: 'do mapa das trilhas, abrir a trilha Linux',
    executar: async (page) => {
      const tabs = await tabularAte(page, porLink('/trilha/linux'))
      checar(tabs > 0, `a trilha Linux é alcançável por Tab (${tabs} paradas)`)
      await page.keyboard.press('Enter')
      await page.waitForURL(/\/trilha\/linux$/, { timeout: 10_000 })
      checar(true, 'Enter no cartão da trilha navegou para /trilha/linux')
    },
  },
  {
    nome: 'abrir a lição e subir o lab',
    executar: async (page) => {
      const tabs = await tabularAte(page, porLink(`/licao/${LICAO_AUDITADA}`))
      checar(tabs > 0, `a lição destravada é alcançável por Tab (${tabs} paradas)`)
      await page.keyboard.press('Enter')
      await page.waitForURL(new RegExp(`/licao/${LICAO_AUDITADA}$`), { timeout: 10_000 })
      await page.locator('.licao__titulo').waitFor({ state: 'visible', timeout: 15_000 })
      checar(true, 'Enter na lição subiu o lab e abriu a tela de lição')

      // WCAG 2.4.3: ao trocar de tela o foco vai para o conteúdo, senão a
      // próxima tecla continuaria de onde estava na tela ANTERIOR.
      const { papel } = await focoAtual(page)
      checar(papel === 'main', `o foco foi para o conteúdo da tela nova (papel: ${papel})`)
    },
  },
  {
    nome: 'ler a lição: os blocos de código são operáveis por teclado',
    executar: async (page) => {
      const blocos = await page.locator('.md pre[role="button"]').count()
      if (blocos === 0) {
        console.log('    · esta lição não tem bloco de código para inserir (nada a testar)')
        return
      }
      const tabs = await tabularAte(page, porNome(/Inserir no terminal/i))
      checar(tabs > 0, `o bloco de código é alcançável por Tab (${tabs} paradas)`)
    },
  },
  {
    nome: 'revelar a dica 1',
    executar: async (page) => {
      const tabs = await tabularAte(page, porNome(/Dica 1/i))
      checar(tabs > 0, `o botão da dica 1 é alcançável por Tab (${tabs} paradas)`)
      await page.keyboard.press('Enter')
      await page.locator('.dica').first().waitFor({ state: 'visible', timeout: 10_000 })
      checar(true, 'Enter revelou a dica 1')

      // O botão que tinha o foco deixou de existir ao virar texto. Se ninguém
      // reposicionar o foco, ele cai no <body> e o aluno volta ao topo da
      // tela sem ouvir a dica que acabou de pagar.
      const depois = await focoAtual(page)
      checar(
        depois.tag !== 'body' && /Dica 1/i.test(depois.nome),
        `o foco foi para o texto da dica revelada (foi para: ${depois.tag} "${depois.nome.slice(0, 30)}")`,
      )
    },
  },
  {
    nome: 'verificar a solução',
    executar: async (page) => {
      const tabs = await tabularAte(page, porNome(/Verificar/i))
      checar(tabs > 0, `o botão Verificar é alcançável por Tab (${tabs} paradas)`)
      await page.keyboard.press('Enter')
      await page.locator('.resultado').waitFor({ state: 'visible', timeout: 15_000 })

      // WCAG 4.1.3: o resultado tem de ser anunciado sem mover o foco.
      const vivo = await page
        .locator('[role="status"][aria-live="polite"] .resultado')
        .count()
      checar(vivo > 0, 'o resultado saiu numa região aria-live="polite" (anunciado sem roubar foco)')
    },
  },
  {
    nome: 'entrar no terminal e conseguir sair',
    executar: async (page) => {
      const tabs = await tabularAte(page, porNome(/Entrar no terminal/i))
      checar(tabs > 0, `o botão de entrada do terminal é alcançável por Tab (${tabs} paradas)`)
      await page.keyboard.press('Enter')

      const dentro = await focoAtual(page)
      checar(/Terminal input/i.test(dentro.nome), 'Enter levou o foco para dentro do terminal')

      // WCAG 2.1.2: o xterm captura Tab de propósito (o shell precisa dele
      // para completar). Então a saída é o Esc — e o botão de entrada anuncia
      // isso no próprio rótulo, que é o que o critério exige.
      await page.keyboard.press('Tab')
      const aindaDentro = await focoAtual(page)
      checar(
        /Terminal input/i.test(aindaDentro.nome),
        'Tab NÃO sai do terminal (esperado: o shell precisa do Tab)',
      )

      await page.keyboard.press('Escape')
      const fora = await focoAtual(page)
      checar(
        !/Terminal input/i.test(fora.nome),
        `Esc devolve o foco para fora do terminal (foi para: "${fora.nome.slice(0, 40)}")`,
      )
    },
  },
  {
    nome: 'resetar o lab pede confirmação, e cancelar devolve o foco',
    executar: async (page) => {
      const tabs = await tabularAte(page, porNome(/Resetar lab/i))
      checar(tabs > 0, `o botão Resetar lab é alcançável por Tab (${tabs} paradas)`)

      await page.keyboard.press('Enter')
      const aberto = await page.locator('dialog.confirmacao[open]').count()
      checar(aberto > 0, 'Enter abriu a confirmação em vez de destruir o container')

      // WCAG 3.3.6 só vale se a confirmação DISSER o que se perde. Um "tem
      // certeza?" vazio transfere a decisão sem transferir a informação.
      const corpo = (await page.locator('.confirmacao__corpo').innerText()).toLowerCase()
      checar(
        corpo.includes('perde') || corpo.includes('arquivos'),
        'a confirmação enumera o que se perde e o que fica',
      )

      // O foco tem de estar DENTRO do diálogo, e no botão que não destrói.
      const dentro = await focoAtual(page)
      checar(/Cancelar/i.test(dentro.nome), `o foco inicial é o botão que não destrói (foi: "${dentro.nome}")`)

      // Modal de verdade: Tab não escapa para a página de trás.
      await page.keyboard.press('Tab')
      const aindaDentro = await page.evaluate(
        () => document.activeElement?.closest('dialog.confirmacao') !== null,
      )
      checar(aindaDentro, 'Tab continua dentro do diálogo (o resto da página está inerte)')

      // WCAG 2.1.2: Esc fecha. E o foco volta para quem abriu — sem isso, quem
      // usa teclado é despejado no topo do documento depois de cancelar.
      await page.keyboard.press('Escape')
      const fechado = await page.locator('dialog.confirmacao[open]').count()
      checar(fechado === 0, 'Esc fecha a confirmação')

      const devolvido = await focoAtual(page)
      checar(
        /Resetar lab/i.test(devolvido.nome),
        `o foco voltou para o botão que abriu (foi: "${devolvido.nome}")`,
      )
    },
  },
  {
    nome: 'voltar pelo breadcrumb e chegar à área do aluno',
    executar: async (page) => {
      const tabs = await tabularAte(page, porLink('/'))
      checar(tabs > 0, `o breadcrumb "Trilhas" é alcançável por Tab (${tabs} paradas)`)
      await page.keyboard.press('Enter')
      await page.waitForURL(/\/$/, { timeout: 10_000 })
      checar(true, 'Enter no breadcrumb voltou ao mapa das trilhas')

      const tabsAluno = await tabularAte(page, porLink('/aluno'))
      checar(tabsAluno > 0, `o placar leva à área do aluno por Tab (${tabsAluno} paradas)`)
      await page.keyboard.press('Enter')
      await page.waitForURL(/\/aluno$/, { timeout: 10_000 })
      checar(true, 'Enter no placar abriu /aluno')
    },
  },
  {
    nome: 'o aviso de prazo do lab é operável por teclado',
    executar: async (page) => {
      // A vida real leva 40 minutos para chegar neste estado; o fixture o
      // entrega pronto. O que se testa é o DOM do aviso, não o relógio.
      await page.request.post(`${BASE.url}/api/_fixture/estado?ttl=apertado`)
      await page.goto(`${BASE.url}/licao/${LICAO_AUDITADA}`, { waitUntil: 'domcontentloaded' })
      await page.locator('.ttl').waitFor({ state: 'visible', timeout: 15_000 })
      checar(true, 'com pouco tempo restante, o aviso aparece sozinho')

      // WCAG 4.1.3 / 2.2.1: o aviso é anunciado, e a saída é alcançável.
      const vivo = await page.locator('[role="alert"] .ttl__texto, .ttl[role="alert"]').count()
      checar(vivo > 0, 'o aviso está numa região que o leitor de tela anuncia')

      const tabs = await tabularAte(page, porNome(/Manter o lab vivo/i))
      checar(tabs > 0, `"Manter o lab vivo" é alcançável por Tab (${tabs} paradas)`)

      await page.keyboard.press('Enter')
      await page.locator('.ttl').waitFor({ state: 'hidden', timeout: 10_000 })
      checar(true, 'Enter renovou o prazo e o aviso saiu da tela')
    },
  },
  {
    nome: 'sair da lição com trabalho feito pede confirmação, e cancelar não sai',
    executar: async (page) => {
      await page.request.post(`${BASE.url}/api/_fixture/estado?trabalhou=1`)
      await page.goto(`${BASE.url}/licao/${LICAO_AUDITADA}`, { waitUntil: 'domcontentloaded' })
      await page.locator('.licao__titulo').waitFor({ state: 'visible', timeout: 15_000 })
      // A contagem de ações do aluno chega na primeira leitura de estado; a
      // nota do painel só existe depois dela, então serve de sinal de chegada.
      await page.locator('.estado__nota').waitFor({ state: 'visible', timeout: 15_000 })

      const tabs = await tabularAte(page, porLink('/'))
      checar(tabs > 0, `o breadcrumb "Trilhas" é alcançável por Tab (${tabs} paradas)`)
      await page.keyboard.press('Enter')

      const aberto = await page.locator('dialog.confirmacao[open]').count()
      checar(aberto > 0, 'sair com trabalho feito abre a confirmação em vez de destruir o lab')

      await page.keyboard.press('Escape')
      checar(
        /\/licao\//.test(page.url()),
        `cancelar mantém o aluno na lição (URL: ${new URL(page.url()).pathname})`,
      )

      // E confirmar leva mesmo embora — senão a guarda seria uma parede.
      await page.keyboard.press('Enter')
      await page.locator('dialog.confirmacao[open]').waitFor({ state: 'attached', timeout: 10_000 })
      const confirmar = await tabularAte(page, porNome(/Sair e destruir/i))
      checar(confirmar > 0, `o botão de confirmar é alcançável por Tab (${confirmar} paradas)`)
      await page.keyboard.press('Enter')
      await page.waitForURL(/\/$/, { timeout: 10_000 })
      checar(true, 'confirmar saiu da lição')

      // Devolve o fixture ao padrão: os passos seguintes não herdam este estado.
      await page.request.post(`${BASE.url}/api/_fixture/estado`)
    },
  },
  {
    nome: 'o skip link é a primeira parada e funciona',
    executar: async (page) => {
      await page.goto(page.url(), { waitUntil: 'domcontentloaded' })
      await page.locator('h1').first().waitFor({ state: 'visible' })
      await page.keyboard.press('Tab')
      const primeiro = await focoAtual(page)
      checar(
        /Pular para o conteúdo/i.test(primeiro.nome),
        `a primeira parada de Tab é o skip link (foi: "${primeiro.nome.slice(0, 40)}")`,
      )
      const visivel = await page.locator('.pular').first().isVisible()
      checar(visivel, 'o skip link fica visível ao receber foco')
    },
  },
]

async function principal(): Promise<number> {
  const { url, fechar } = await subirServidorDeFixtures()
  BASE.url = url
  let navegador: Browser | undefined

  try {
    navegador = await chromium.launch()
    const contexto = await navegador.newContext({ viewport: JANELA, reducedMotion: 'reduce' })
    await contexto.addInitScript(() => {
      localStorage.setItem('devlab.tema', 'escuro')
      localStorage.setItem('devlab.escala', '1')
    })
    const page = await contexto.newPage()

    await page.request.post(`${url}/api/_fixture/estado`)
    await page.goto(`${url}/`, { waitUntil: 'domcontentloaded' })
    await page.locator('h1').first().waitFor({ state: 'visible', timeout: 15_000 })

    for (const passo of PASSOS) {
      console.log(`\n  ${passo.nome}`)
      await passo.executar(page)
    }
  } finally {
    await navegador?.close()
    await fechar()
  }

  console.log('\n' + '='.repeat(62))
  if (falhas.length > 0) {
    console.log(`  [31m✘ ${falhas.length} passo(s) do percurso reprovaram[0m`)
    return 1
  }
  console.log('  [32m✔ percurso central inteiro operável só com teclado[0m')
  return 0
}

process.exitCode = await principal()
