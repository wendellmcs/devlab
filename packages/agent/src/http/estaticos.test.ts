import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, it } from 'node:test'

import { resolverCaminho } from './estaticos.ts'

const RAIZ = path.resolve('/tmp/raiz-ui')

describe('resolverCaminho', () => {
  it('resolve arquivos normais dentro da raiz', () => {
    assert.equal(resolverCaminho('/index.html', RAIZ), path.join(RAIZ, 'index.html'))
    assert.equal(
      resolverCaminho('/assets/index-abc123.js', RAIZ),
      path.join(RAIZ, 'assets', 'index-abc123.js'),
    )
    assert.equal(resolverCaminho('/', RAIZ), RAIZ)
  })

  it('recusa travessia com ..', () => {
    // Um servidor de arquivos que confia no caminho da URL entrega /etc/shadow.
    assert.equal(resolverCaminho('/../../../etc/passwd', RAIZ), null)
    assert.equal(resolverCaminho('/assets/../../segredo', RAIZ), null)
    assert.equal(resolverCaminho('/..', RAIZ), null)
  })

  it('recusa travessia percent-encoded — o decode acontece antes da checagem', () => {
    assert.equal(resolverCaminho('/%2e%2e/%2e%2e/etc/passwd', RAIZ), null)
    assert.equal(resolverCaminho('/%2e%2e%2f%2e%2e%2fetc%2fshadow', RAIZ), null)
    // Dupla codificação: %252e decodifica para %2e, que NÃO é separador — o
    // caminho vira o literal "%2e%2e", que fica dentro da raiz. Sem risco.
    assert.notEqual(resolverCaminho('/%252e%252e/x', RAIZ), null)
  })

  it('recusa byte nulo, que trunca string nas camadas de baixo', () => {
    assert.equal(resolverCaminho('/index.html%00.png', RAIZ), null)
  })

  it('recusa percent-encoding inválido em vez de estourar', () => {
    assert.equal(resolverCaminho('/%zz', RAIZ), null)
    assert.equal(resolverCaminho('/%', RAIZ), null)
  })

  it('não aceita um irmão que só começa com o mesmo prefixo', () => {
    // `/tmp/raiz-ui-malicioso` começa com `/tmp/raiz-ui`: comparar sem o
    // separador deixaria passar.
    assert.equal(resolverCaminho('/../raiz-ui-malicioso/x', RAIZ), null)
  })

  it('barras repetidas no início não escapam da raiz', () => {
    assert.equal(resolverCaminho('///etc/passwd', RAIZ), path.join(RAIZ, 'etc', 'passwd'))
  })
})
