import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ENSINO_MINIMO } from './ensino-minimo.ts'
import { LicaoSchema } from './schema.ts'

const MINIMA = {
  id: 'linux-op-teste',
  trilha: 'linux',
  nivel: 'operador',
  ordem: 1,
  titulo: 'Teste',
  capacidade: 'Sei testar.',
  objetivo_md: 'faça algo',
  verificar: [{ descricao: 'existe', script: 'exit 0' }],
  xp: 10,
  ensino: ENSINO_MINIMO,
}

describe('LicaoSchema', () => {
  it('aplica os padrões seguros do lab quando a lição não declara nada', () => {
    const licao = LicaoSchema.parse(MINIMA)

    assert.equal(licao.lab.imagem, 'devlab/linux-base:1.0.0')
    assert.equal(licao.lab.usuario, 'aluno')
    assert.equal(licao.lab.workdir, '/home/aluno')
    // Princípio 6: sem rede externa salvo quando a lição exigir.
    assert.equal(licao.lab.rede, 'nenhuma')
    assert.deepEqual(licao.lab.capacidades, [])
    assert.equal(licao.lab.limites.cpus, 1)
    assert.equal(licao.lab.limites.memoria_mb, 512)
    assert.equal(licao.lab.limites.pids, 256)
  })

  it('assume dicas vazias, sem prereqs e sem capstone', () => {
    const licao = LicaoSchema.parse(MINIMA)
    assert.deepEqual(licao.dicas, [])
    assert.deepEqual(licao.prereqs, [])
    assert.equal(licao.capstone, false)
    assert.equal(licao.verificar[0]?.esperado_exit, 0)
  })

  it('recusa um check sem script e sem run', () => {
    const r = LicaoSchema.safeParse({
      ...MINIMA,
      verificar: [{ descricao: 'sem corpo' }],
    })
    assert.equal(r.success, false)
  })

  it('recusa um check com script e run ao mesmo tempo', () => {
    const r = LicaoSchema.safeParse({
      ...MINIMA,
      verificar: [{ descricao: 'ambíguo', script: 'exit 0', run: '/checks/x.sh' }],
    })
    assert.equal(r.success, false)
  })

  it('recusa lição sem nenhum check: verificação é obrigatória', () => {
    const r = LicaoSchema.safeParse({ ...MINIMA, verificar: [] })
    assert.equal(r.success, false)
  })

  it('recusa id fora do kebab-case', () => {
    assert.equal(LicaoSchema.safeParse({ ...MINIMA, id: 'Linux OP 1' }).success, false)
  })

  it('limita a escada de dicas a três degraus', () => {
    const r = LicaoSchema.safeParse({ ...MINIMA, dicas: ['a', 'b', 'c', 'd'] })
    assert.equal(r.success, false)
  })
})
