import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { casarRota } from './roteador.ts'

describe('casarRota', () => {
  it('casa rota literal', () => {
    assert.deepEqual(casarRota('/api/saude', '/api/saude'), {})
  })

  it('extrai parâmetros nomeados', () => {
    assert.deepEqual(casarRota('/api/labs/:labId/estado', '/api/labs/abc123/estado'), {
      labId: 'abc123',
    })
  })

  it('extrai vários parâmetros', () => {
    assert.deepEqual(casarRota('/api/:a/:b', '/api/um/dois'), { a: 'um', b: 'dois' })
  })

  it('decodifica o valor do parâmetro', () => {
    assert.deepEqual(casarRota('/api/licoes/:id', '/api/licoes/linux%2Dop'), {
      id: 'linux-op',
    })
  })

  it('ignora a barra final', () => {
    assert.deepEqual(casarRota('/api/saude', '/api/saude/'), {})
  })

  it('recusa quando o número de segmentos difere', () => {
    assert.equal(casarRota('/api/labs/:labId', '/api/labs'), null)
    assert.equal(casarRota('/api/labs/:labId', '/api/labs/a/b'), null)
  })

  it('recusa quando um segmento literal não bate', () => {
    assert.equal(casarRota('/api/labs/:labId', '/api/outro/x'), null)
  })

  it('não confunde rotas parecidas', () => {
    assert.equal(casarRota('/api/labs/:labId/reset', '/api/labs/x/estado'), null)
  })
})
