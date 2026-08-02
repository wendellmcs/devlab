import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import Anthropic from '@anthropic-ai/sdk'

import { ProvedorNuvem, traduzirErro } from './nuvem.ts'
import { montarContextoSeguro } from './servico.ts'

/** Constrói o erro tipado do SDK sem tocar na rede. */
function erroDaApi<T>(Classe: new (...a: never[]) => T, status: number, mensagem: string): T {
  return new (Classe as unknown as new (
    s: number,
    e: unknown,
    m: string,
    h: undefined,
  ) => T)(status, { type: 'error' }, mensagem, undefined)
}

describe('ProvedorNuvem sem chave', () => {
  it('não tenta falar com a API e diz exatamente o que fazer', async () => {
    const p = new ProvedorNuvem({ chave: '', modelo: 'claude-opus-5' })
    const d = await p.diagnosticar()

    assert.equal(d.disponivel, false)
    assert.equal(d.provedor, 'anthropic')
    assert.match(d.erro ?? '', /chave de API/i)
    assert.match(d.sugestao ?? '', /ANTHROPIC_API_KEY/)
    // O caminho de volta para o modo local tem de estar na mensagem: é a saída
    // de quem não quer (ou não pode) usar nuvem.
    assert.match(d.sugestao ?? '', /ollama/i)
  })

  it('conversar falha antes de montar requisição, sem vazar contexto', async () => {
    const p = new ProvedorNuvem({ chave: '', modelo: 'claude-opus-5' })
    await assert.rejects(
      () => p.conversar([{ papel: 'usuario', texto: 'oi' }]),
      /chave de API/i,
    )
  })
})

describe('traduzirErro', () => {
  it('usa a classe tipada, não o texto da mensagem', () => {
    const casos = [
      [Anthropic.AuthenticationError, 401, /chave de API inválida/i],
      [Anthropic.PermissionDeniedError, 403, /não tem acesso ao modelo/i],
      [Anthropic.NotFoundError, 404, /não existe/i],
      [Anthropic.RateLimitError, 429, /limite de requisições/i],
    ] as const

    for (const [Classe, status, esperado] of casos) {
      const { erro, sugestao } = traduzirErro(
        erroDaApi(Classe as never, status, 'mensagem crua do servidor'),
        'claude-opus-5',
      )
      assert.match(erro, esperado)
      assert.notEqual(sugestao, '')
    }
  })

  it('sem rede, aponta o caminho offline em vez de só reclamar', () => {
    const { erro, sugestao } = traduzirErro(
      new Anthropic.APIConnectionError({ message: 'fetch failed' }),
      'claude-opus-5',
    )
    assert.match(erro, /alcançar a API/i)
    assert.match(sugestao, /ollama/i)
  })

  it('erro desconhecido não vira "[object Object]"', () => {
    assert.match(traduzirErro(new Error('caiu'), 'x').erro, /caiu/)
    assert.match(traduzirErro('texto solto', 'x').erro, /texto solto/)
  })
})

describe('a garantia de não ver a solução vale para os dois provedores', () => {
  it('o contexto é montado antes da escolha de provedor, então é o mesmo', () => {
    // A trava mora em montarContextoSeguro, que roda no ServicoDeIa — acima do
    // provedor. Trocar Ollama por nuvem não abre caminho novo para a solução.
    const licao = {
      id: 'l1',
      trilha: 'linux',
      titulo: 'T',
      nivel: 'operador',
      capacidade: 'c',
      objetivo_md: 'enunciado',
      dicas: ['dica um', 'dica dois', 'SOLUCAO SECRETA'],
      verificar: [{ descricao: 'existe o arquivo', script: 'test -f /segredo/do/check' }],
      solucao_referencia: 'echo SOLUCAO_DE_REFERENCIA',
      lab: { setup: 'echo SETUP_SECRETO', break: 'echo BREAK_SECRETO' },
    } as never

    const ctx = montarContextoSeguro({ licao, terminal: 'saida do aluno' })
    const serializado = JSON.stringify(ctx)

    for (const segredo of [
      'SOLUCAO SECRETA',
      'SOLUCAO_DE_REFERENCIA',
      'SETUP_SECRETO',
      'BREAK_SECRETO',
      '/segredo/do/check',
    ]) {
      assert.equal(serializado.includes(segredo), false, `vazou: ${segredo}`)
    }
    assert.equal(ctx.criterios[0], 'existe o arquivo')
  })
})
