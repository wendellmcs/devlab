import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { LicaoSchema } from '../conteudo/schema.ts'
import { ehTransitorio } from './gerenciador.ts'
import { CAPACIDADES_BASE, descreverLimites, montarHostConfig } from './limites.ts'

function labDe(extra: Record<string, unknown> = {}): ReturnType<typeof LicaoSchema.parse>['lab'] {
  return LicaoSchema.parse({
    id: 'x',
    trilha: 't',
    nivel: 'operador',
    ordem: 1,
    titulo: 'x',
    capacidade: 'x',
    objetivo_md: 'x',
    xp: 1,
    verificar: [{ descricao: 'x', script: 'exit 0' }],
    lab: extra,
  }).lab
}

describe('montarHostConfig', () => {
  it('traduz os limites declarados para o Docker', () => {
    const hc = montarHostConfig(labDe({ limites: { cpus: 2, memoria_mb: 256, pids: 64 } }))

    assert.equal(hc.Memory, 256 * 1024 * 1024)
    assert.equal(hc.NanoCpus, 2_000_000_000)
    assert.equal(hc.PidsLimit, 64)
  })

  it('iguala MemorySwap a Memory para o lab não escapar pelo swap', () => {
    const hc = montarHostConfig(labDe({ limites: { memoria_mb: 512 } }))
    assert.equal(hc.MemorySwap, hc.Memory)
  })

  it('deixa o lab sem rede externa por padrão', () => {
    assert.equal(montarHostConfig(labDe()).NetworkMode, 'none')
  })

  it('só liga a rede quando a lição pede', () => {
    assert.equal(montarHostConfig(labDe({ rede: 'ponte' })).NetworkMode, 'bridge')
  })

  it('derruba todas as capacidades e devolve apenas o conjunto mínimo', () => {
    const hc = montarHostConfig(labDe())
    const caps: string[] = hc.CapAdd ?? []

    // A checagem vem antes do deepEqual porque `assert.deepEqual` é uma
    // assertion signature: depois dela, `caps` fica estreitado à tupla literal.
    assert.ok(!caps.includes('NET_ADMIN'), 'NET_ADMIN não pode entrar por padrão')
    assert.deepEqual(hc.CapDrop, ['ALL'])
    assert.deepEqual(caps, [...CAPACIDADES_BASE])
  })

  it('acrescenta capacidade extra pedida pela lição', () => {
    const hc = montarHostConfig(labDe({ capacidades: ['NET_RAW', 'NET_ADMIN'] }))
    assert.deepEqual(hc.CapAdd, [...CAPACIDADES_BASE, 'NET_RAW', 'NET_ADMIN'])
  })

  it('o schema recusa capacidade que daria o host — não é string livre', () => {
    // O conteúdo é YAML solto e o projeto convida a escrever lição sem
    // recompilar nada. Uma lição com SYS_MODULE carregaria módulo de kernel;
    // ALL anularia o CapDrop inteiro.
    for (const perigosa of ['SYS_MODULE', 'SYS_ADMIN', 'ALL', 'SYS_RAWIO', 'BPF']) {
      assert.throws(
        () => labDe({ capacidades: [perigosa] }),
        `esperava recusa de ${perigosa}`,
      )
    }
  })

  it('não monta nada do host e impede escalada de privilégio', () => {
    const hc = montarHostConfig(labDe())
    assert.deepEqual(hc.Binds, [])
    assert.deepEqual(hc.SecurityOpt, ['no-new-privileges=true'])
  })

  it('marca o container como descartável', () => {
    assert.equal(montarHostConfig(labDe()).AutoRemove, true)
  })
})

describe('ehTransitorio', () => {
  it('reconhece a queda do dbus que o runc sofre no WSL2', () => {
    assert.equal(
      ehTransitorio(
        new Error(
          'OCI runtime create failed: unable to apply cgroup configuration: ' +
            'unable to start unit: Message recipient disconnected from message bus without replying',
        ),
      ),
      true,
    )
  })

  it('reconhece quedas de conexão com o daemon', () => {
    assert.equal(ehTransitorio(new Error('read ECONNRESET connection reset by peer')), true)
    assert.equal(ehTransitorio(new Error('unexpected EOF')), true)
  })

  it('não retenta erro de verdade, que retentar não conserta', () => {
    assert.equal(ehTransitorio(new Error('No such image: devlab/nao-existe:1.0.0')), false)
    assert.equal(ehTransitorio(new Error('port is already allocated')), false)
    assert.equal(ehTransitorio('permission denied'), false)
  })
})

describe('descreverLimites', () => {
  it('resume os limites em português para a UI', () => {
    const d = descreverLimites(labDe({ capacidades: ['NET_ADMIN'] }))
    assert.equal(d.cpus, 1)
    assert.equal(d.memoriaMb, 512)
    assert.equal(d.rede, 'sem rede externa')
    assert.deepEqual(d.capacidadesExtras, ['NET_ADMIN'])
  })
})
