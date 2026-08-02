import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { analisarCaminho, paraCaminho, type Rota } from './rota.ts'

describe('analisarCaminho', () => {
  it('reconhece as quatro telas', () => {
    assert.deepEqual(analisarCaminho('/'), { tela: 'mapa' })
    assert.deepEqual(analisarCaminho('/aluno'), { tela: 'aluno' })
    assert.deepEqual(analisarCaminho('/trilha/linux'), { tela: 'trilha', trilhaId: 'linux' })
    assert.deepEqual(analisarCaminho('/licao/linux-op-01-shell'), {
      tela: 'licao',
      licaoId: 'linux-op-01-shell',
    })
  })

  it('tolera barra final e barras repetidas', () => {
    assert.deepEqual(analisarCaminho('/trilha/linux/'), { tela: 'trilha', trilhaId: 'linux' })
    assert.deepEqual(analisarCaminho('//aluno//'), { tela: 'aluno' })
    assert.deepEqual(analisarCaminho(''), { tela: 'mapa' })
  })

  it('decodifica o id — trilha com caractere especial não pode virar 404', () => {
    assert.deepEqual(analisarCaminho('/trilha/voip%2Dtroubleshooting'), {
      tela: 'trilha',
      trilhaId: 'voip-troubleshooting',
    })
  })

  it('caminho desconhecido cai no mapa, não em tela branca', () => {
    // O servidor faz fallback de SPA para QUALQUER caminho, então a UI recebe
    // coisas como /favicon.ico ou um link velho. Nenhuma pode virar tela vazia.
    assert.deepEqual(analisarCaminho('/inexistente'), { tela: 'mapa' })
    assert.deepEqual(analisarCaminho('/trilha'), { tela: 'mapa' })
    assert.deepEqual(analisarCaminho('/licao/'), { tela: 'mapa' })
  })
})

describe('paraCaminho', () => {
  it('é o inverso de analisarCaminho', () => {
    const rotas: Rota[] = [
      { tela: 'mapa' },
      { tela: 'aluno' },
      { tela: 'trilha', trilhaId: 'linux' },
      { tela: 'licao', licaoId: 'linux-op-12-capstone' },
    ]
    for (const r of rotas) {
      assert.deepEqual(analisarCaminho(paraCaminho(r)), r, `ida e volta falhou em ${r.tela}`)
    }
  })

  it('escapa o id ao montar o caminho', () => {
    assert.equal(paraCaminho({ tela: 'trilha', trilhaId: 'a/b' }), '/trilha/a%2Fb')
    // E a volta preserva o id original, em vez de virar duas partes de caminho.
    assert.deepEqual(analisarCaminho('/trilha/a%2Fb'), { tela: 'trilha', trilhaId: 'a/b' })
  })
})
