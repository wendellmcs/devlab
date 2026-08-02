import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { hostPermitido, origemPermitida } from './origem.ts'

describe('origemPermitida', () => {
  it('aceita a UI do Vite e o próprio agente', () => {
    assert.equal(origemPermitida('http://localhost:5173'), true)
    assert.equal(origemPermitida('http://127.0.0.1:5173'), true)
    assert.equal(origemPermitida('http://127.0.0.1:7788'), true)
  })

  it('recusa qualquer site — é o que protege o WebSocket, que ignora CORS', () => {
    assert.equal(origemPermitida('https://evil.com'), false)
    assert.equal(origemPermitida('http://evil.com'), false)
    // O truque clássico: um domínio que só *parece* loopback.
    assert.equal(origemPermitida('http://localhost.evil.com'), false)
    assert.equal(origemPermitida('http://127.0.0.1.evil.com'), false)
  })

  it('recusa origem ausente ou malformada', () => {
    assert.equal(origemPermitida(undefined), false)
    assert.equal(origemPermitida(''), false)
    assert.equal(origemPermitida('null'), false)
    assert.equal(origemPermitida('nao-e-url'), false)
  })

  it('recusa https em loopback: o agente serve http', () => {
    assert.equal(origemPermitida('https://127.0.0.1:7788'), false)
  })
})

describe('hostPermitido', () => {
  it('aceita loopback na porta do agente', () => {
    assert.equal(hostPermitido('127.0.0.1:7788'), true)
    assert.equal(hostPermitido('localhost:7788'), true)
    assert.equal(hostPermitido('localhost'), true)
  })

  it('recusa nome de domínio — é isso que fecha DNS rebinding', () => {
    // O atacante faz o domínio dele resolver para 127.0.0.1; o browser passa a
    // tratar tudo como same-origin, o que dispensa CORS. O Host, porém, chega
    // com o nome do domínio.
    assert.equal(hostPermitido('rebind.evil.com:7788'), false)
    assert.equal(hostPermitido('meu-pc.local:7788'), false)
  })

  it('recusa porta diferente da do agente', () => {
    assert.equal(hostPermitido('127.0.0.1:9999'), false)
  })

  it('recusa host ausente', () => {
    assert.equal(hostPermitido(undefined), false)
    assert.equal(hostPermitido(''), false)
  })
})
