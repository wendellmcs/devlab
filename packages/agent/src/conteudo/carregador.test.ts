import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import { config } from '../config.ts'
import { carregarConteudo } from './carregador.ts'

const temporarios: string[] = []

async function conteudoTemporario(arquivos: Record<string, string>): Promise<string> {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'devlab-conteudo-'))
  temporarios.push(raiz)
  for (const [relativo, texto] of Object.entries(arquivos)) {
    const destino = path.join(raiz, relativo)
    await fs.mkdir(path.dirname(destino), { recursive: true })
    await fs.writeFile(destino, texto, 'utf8')
  }
  return raiz
}

const TRILHA = `
id: t
titulo: Trilha de teste
resumo: só para o teste
ordem: 0
`

function licao(id: string, prereqs: string[] = []): string {
  return `
id: ${id}
trilha: t
nivel: operador
ordem: 1
titulo: ${id}
capacidade: Sei testar.
objetivo_md: faça
xp: 10
prereqs: [${prereqs.join(', ')}]
verificar:
  - descricao: ok
    script: exit 0
`
}

after(async () => {
  await Promise.all(temporarios.map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe('carregarConteudo', () => {
  it('carrega a trilha Linux do repositório sem nenhum problema de conteúdo', async () => {
    const conteudo = await carregarConteudo(config.dirConteudo)

    assert.deepEqual(conteudo.problemas, [])
    assert.ok(conteudo.trilhas.some((t) => t.id === 'linux'))

    const linux = conteudo.licoes.filter((l) => l.trilha === 'linux')
    assert.ok(linux.length >= 12, `esperava ao menos 12 lições, achei ${linux.length}`)
    assert.ok(linux.some((l) => l.capstone), 'a trilha precisa de um capstone')
  })

  it('a trilha Linux forma uma corrente de pré-requisitos coerente', async () => {
    const conteudo = await carregarConteudo(config.dirConteudo)
    const ids = new Set(conteudo.licoes.map((l) => l.id))
    for (const l of conteudo.licoes) {
      for (const pre of l.prereqs) {
        assert.ok(ids.has(pre), `${l.id} depende de ${pre}, que não existe`)
      }
    }
  })

  it('todo check da trilha Linux inspeciona estado dentro do lab', async () => {
    const conteudo = await carregarConteudo(config.dirConteudo)
    for (const l of conteudo.licoes) {
      assert.ok(l.verificar.length > 0, `${l.id} não tem check`)
      for (const check of l.verificar) {
        assert.ok(
          check.script !== undefined || check.run !== undefined,
          `${l.id}: check sem corpo`,
        )
      }
    }
  })

  it('carrega o catálogo de erros com as assinaturas mínimas de Linux', async () => {
    const conteudo = await carregarConteudo(config.dirConteudo)
    const matches = conteudo.catalogo.map((e) => e.match)
    for (const esperado of [
      'command not found',
      'No such file or directory',
      'Permission denied',
      'Is a directory',
      'Device or resource busy',
      'No space left on device',
    ]) {
      assert.ok(matches.includes(esperado), `catálogo sem a assinatura: ${esperado}`)
    }
  })

  it('reporta YAML inválido sem derrubar a carga', async () => {
    const raiz = await conteudoTemporario({
      'trilhas/t/trilha.yaml': TRILHA,
      'trilhas/t/a.yaml': licao('a'),
      'trilhas/t/quebrado.yaml': 'id: [isto: nao\n  fecha',
    })
    const conteudo = await carregarConteudo(raiz)

    assert.equal(conteudo.licoes.length, 1)
    assert.equal(conteudo.problemas.length, 1)
    assert.match(conteudo.problemas[0] ?? '', /quebrado\.yaml/)
  })

  it('detecta prereq inexistente', async () => {
    const raiz = await conteudoTemporario({
      'trilhas/t/trilha.yaml': TRILHA,
      'trilhas/t/a.yaml': licao('a', ['fantasma']),
    })
    const conteudo = await carregarConteudo(raiz)
    assert.ok(conteudo.problemas.some((p) => p.includes('fantasma')))
  })

  it('detecta ciclo de pré-requisitos: a skill tree tem que ser um DAG', async () => {
    const raiz = await conteudoTemporario({
      'trilhas/t/trilha.yaml': TRILHA,
      'trilhas/t/a.yaml': licao('a', ['b']),
      'trilhas/t/b.yaml': licao('b', ['a']),
    })
    const conteudo = await carregarConteudo(raiz)
    assert.ok(conteudo.problemas.some((p) => p.startsWith('ciclo de prereqs')))
  })

  it('devolve vazio, e não erro, quando o diretório não existe', async () => {
    const conteudo = await carregarConteudo('/caminho/que/nao/existe')
    assert.equal(conteudo.licoes.length, 0)
    assert.equal(conteudo.problemas.length, 1)
  })
})
