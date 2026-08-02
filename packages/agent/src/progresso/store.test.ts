import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ArmazemDeProgresso } from './store.ts'
import { penalidade, resolvidaSemAjuda, xpDaConclusao } from './regras.ts'

function armazem(): ArmazemDeProgresso {
  return new ArmazemDeProgresso(':memory:')
}

const BASE = { licaoId: 'linux-op-01-shell', trilha: 'linux', xpBase: 100 }

describe('regras de XP', () => {
  it('cobra mais caro conforme a dica é mais profunda', () => {
    assert.equal(xpDaConclusao(100, 0, false), 100)
    assert.equal(xpDaConclusao(100, 1, false), 90)
    assert.equal(xpDaConclusao(100, 2, false), 75)
    assert.equal(xpDaConclusao(100, 3, false), 50)
  })

  it('a IA custa o mesmo que a dica de nível 3', () => {
    assert.equal(penalidade(0, true), penalidade(3, false))
    assert.equal(xpDaConclusao(100, 0, true), 50)
  })

  it('não empilha o custo da IA sobre o da dica: vale o maior', () => {
    assert.equal(xpDaConclusao(100, 3, true), 50)
  })

  it('nunca zera o XP de quem terminou a lição', () => {
    assert.ok(xpDaConclusao(1, 3, true) >= 1)
  })

  it('só conta como sem ajuda quem não pediu dica nem usou IA', () => {
    assert.equal(resolvidaSemAjuda(0, false), true)
    assert.equal(resolvidaSemAjuda(1, false), false)
    assert.equal(resolvidaSemAjuda(0, true), false)
  })
})

describe('ArmazemDeProgresso', () => {
  it('não credita XP em tentativa reprovada', () => {
    const store = armazem()
    const r = store.registrarTentativa({
      ...BASE,
      aprovada: false,
      duracaoMs: 10,
      checks: [],
      erros: [],
    })
    assert.equal(r.xpCreditado, 0)
    assert.equal(r.progresso.estado, 'em_andamento')
    assert.equal(store.resumo().xpTotal, 0)
    store.fechar()
  })

  it('credita o XP cheio na primeira conclusão sem ajuda', () => {
    const store = armazem()
    const r = store.registrarTentativa({
      ...BASE,
      aprovada: true,
      duracaoMs: 10,
      checks: [],
      erros: [],
    })
    assert.equal(r.xpCreditado, 100)
    assert.equal(r.primeiraConclusao, true)
    assert.equal(r.progresso.semAjuda, true)
    assert.equal(store.resumo().xpTotal, 100)
    assert.equal(store.resumo().licoesSemAjuda, 1)
    store.fechar()
  })

  it('desconta a dica revelada antes da conclusão', () => {
    const store = armazem()
    store.revelarDica(BASE.licaoId, BASE.trilha, 2)
    const r = store.registrarTentativa({
      ...BASE,
      aprovada: true,
      duracaoMs: 10,
      checks: [],
      erros: [],
    })
    assert.equal(r.xpCreditado, 75)
    assert.equal(r.progresso.semAjuda, false)
    assert.deepEqual(store.dicasReveladas(BASE.licaoId), [2])
    store.fechar()
  })

  it('guarda o nível mais fundo de dica, não o último pedido', () => {
    const store = armazem()
    store.revelarDica(BASE.licaoId, BASE.trilha, 3)
    store.revelarDica(BASE.licaoId, BASE.trilha, 1)
    const r = store.registrarTentativa({
      ...BASE,
      aprovada: true,
      duracaoMs: 10,
      checks: [],
      erros: [],
    })
    assert.equal(r.xpCreditado, 50)
    store.fechar()
  })

  it('refazer uma lição concluída não rende XP de novo', () => {
    const store = armazem()
    const entrada = { ...BASE, aprovada: true, duracaoMs: 10, checks: [], erros: [] }

    const primeira = store.registrarTentativa(entrada)
    const segunda = store.registrarTentativa(entrada)

    assert.equal(primeira.xpCreditado, 100)
    assert.equal(segunda.xpCreditado, 0)
    assert.equal(segunda.primeiraConclusao, false)
    assert.equal(store.resumo().xpTotal, 100)
    store.fechar()
  })

  it('conta as tentativas, aprovadas ou não', () => {
    const store = armazem()
    store.registrarTentativa({ ...BASE, aprovada: false, duracaoMs: 1, checks: [], erros: [] })
    store.registrarTentativa({ ...BASE, aprovada: false, duracaoMs: 1, checks: [], erros: [] })
    store.registrarTentativa({ ...BASE, aprovada: true, duracaoMs: 1, checks: [], erros: [] })

    assert.equal(store.progresso(BASE.licaoId)?.tentativas, 3)
    assert.equal(store.resumo().tentativasTotais, 3)
    store.fechar()
  })

  it('guarda o histórico de erros das tentativas reprovadas', () => {
    const store = armazem()
    store.registrarTentativa({
      ...BASE,
      aprovada: false,
      duracaoMs: 1,
      checks: [],
      erros: [{ id: 'linux-command-not-found' }],
    })
    const historico = store.historicoDeErros()
    assert.equal(historico.length, 1)
    assert.equal(historico[0]?.licaoId, BASE.licaoId)
    store.fechar()
  })

  it('marca uso de IA e isso derruba o selo de sem ajuda', () => {
    const store = armazem()
    store.marcarUsoDeIa(BASE.licaoId, BASE.trilha)
    const r = store.registrarTentativa({
      ...BASE,
      aprovada: true,
      duracaoMs: 1,
      checks: [],
      erros: [],
    })
    assert.equal(r.progresso.usouIa, true)
    assert.equal(r.progresso.semAjuda, false)
    assert.equal(r.xpCreditado, 50)
    store.fechar()
  })

  it('agrupa o progresso por trilha', () => {
    const store = armazem()
    store.registrarTentativa({ ...BASE, aprovada: true, duracaoMs: 1, checks: [], erros: [] })
    store.registrarTentativa({
      licaoId: 'git-op-01',
      trilha: 'git',
      xpBase: 20,
      aprovada: true,
      duracaoMs: 1,
      checks: [],
      erros: [],
    })

    const resumo = store.resumo()
    assert.equal(resumo.licoesConcluidas, 2)
    assert.equal(resumo.xpTotal, 120)
    assert.deepEqual(
      resumo.porTrilha.map((t) => t.trilha),
      ['git', 'linux'],
    )
    store.fechar()
  })

  it('lista as lições concluídas para o portão de maestria', () => {
    const store = armazem()
    store.registrarTentativa({ ...BASE, aprovada: true, duracaoMs: 1, checks: [], erros: [] })
    store.registrarTentativa({
      licaoId: 'linux-op-02-listar',
      trilha: 'linux',
      xpBase: 12,
      aprovada: false,
      duracaoMs: 1,
      checks: [],
      erros: [],
    })

    const concluidas = store.concluidas()
    assert.equal(concluidas.has(BASE.licaoId), true)
    assert.equal(concluidas.has('linux-op-02-listar'), false)
    store.fechar()
  })
})
