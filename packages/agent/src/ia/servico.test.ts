import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { LicaoSchema, type Licao } from '../conteudo/schema.ts'
import type { ResultadoVerificacao } from '../verificacao/executor.ts'
import { montarMensagens, recortarTerminal, sanitizar } from './prompts.ts'
import { montarContextoSeguro } from './servico.ts'
import { temModelo } from './ollama.ts'

const SEGREDO_DICA = 'ESTA-E-A-DICA-SECRETA'
const SEGREDO_SOLUCAO = 'ESTA-E-A-SOLUCAO-SECRETA'
const SEGREDO_CHECK = 'ESTE-E-O-CORPO-DO-CHECK'
const SEGREDO_SETUP = 'ESTE-E-O-SETUP'
const SEGREDO_BREAK = 'ESTA-E-A-INJECAO-DE-FALHA'

function licaoComSegredos(): Licao {
  return LicaoSchema.parse({
    id: 'linux-op-teste',
    trilha: 'linux',
    nivel: 'operador',
    ordem: 1,
    titulo: 'Lição com segredos',
    capacidade: 'Sei testar a vedação da IA.',
    objetivo_md: 'crie o arquivo alvo.txt',
    xp: 10,
    lab: { setup: `echo ${SEGREDO_SETUP}`, break: `echo ${SEGREDO_BREAK}` },
    verificar: [
      { descricao: 'alvo.txt existe', script: `echo ${SEGREDO_CHECK}; exit 1` },
      { descricao: 'conteúdo confere', script: `echo ${SEGREDO_CHECK}; exit 1` },
    ],
    dicas: ['empurrão', 'com lacuna', SEGREDO_DICA],
    solucao_referencia: SEGREDO_SOLUCAO,
  })
}

const VERIFICACAO: ResultadoVerificacao = {
  aprovado: false,
  duracaoMs: 12,
  errosDetectados: [
    {
      origem: 'catalogo',
      id: 'linux-command-not-found',
      titulo: 'command not found (código 127)',
      categoria: 'ferramenta_errada',
      trecho: 'bash: lss: command not found',
      significa: 'o shell não achou o programa',
      porque: undefined,
      investigar: undefined,
      corrigir: undefined,
    },
  ],
  checks: [
    {
      indice: 0,
      descricao: 'alvo.txt existe',
      aprovado: false,
      exit: 1,
      esperadoExit: 0,
      expirou: false,
      mensagem: 'o arquivo ainda não existe',
      dicaDiagnostica: undefined,
      saida: `alguma saída com ${SEGREDO_CHECK}`,
    },
  ],
}

describe('vedação do contexto da IA', () => {
  it('não deixa a dica, a solução, o check, o setup nem o break atravessarem', () => {
    const ctx = montarContextoSeguro({
      licao: licaoComSegredos(),
      terminal: 'aluno@lab:~$ ls\nREADME.txt\n',
      ultimaVerificacao: VERIFICACAO,
    })

    const tudo = JSON.stringify(ctx)
    for (const segredo of [
      SEGREDO_DICA,
      SEGREDO_SOLUCAO,
      SEGREDO_CHECK,
      SEGREDO_SETUP,
      SEGREDO_BREAK,
    ]) {
      assert.ok(!tudo.includes(segredo), `o contexto vazou: ${segredo}`)
    }
  })

  it('a vedação sobrevive à montagem das mensagens enviadas ao modelo', () => {
    const ctx = montarContextoSeguro({
      licao: licaoComSegredos(),
      terminal: '',
      ultimaVerificacao: VERIFICACAO,
    })
    const enviado = montarMensagens('explicar_erro', ctx)
      .map((m) => m.texto)
      .join('\n')

    for (const segredo of [SEGREDO_DICA, SEGREDO_SOLUCAO, SEGREDO_CHECK]) {
      assert.ok(!enviado.includes(segredo), `a mensagem vazou: ${segredo}`)
    }
  })

  it('leva o que a IA precisa: enunciado, critérios e o erro real', () => {
    const ctx = montarContextoSeguro({
      licao: licaoComSegredos(),
      terminal: 'bash: lss: command not found',
      ultimaVerificacao: VERIFICACAO,
    })

    assert.deepEqual(ctx.criterios, ['alvo.txt existe', 'conteúdo confere'])
    assert.equal(ctx.checksReprovados[0]?.mensagem, 'o arquivo ainda não existe')
    assert.deepEqual(ctx.errosReconhecidos, ['command not found (código 127)'])
    assert.match(ctx.terminal, /command not found/)
  })

  it('funciona quando ainda não houve verificação nenhuma', () => {
    const ctx = montarContextoSeguro({ licao: licaoComSegredos(), terminal: '' })
    assert.deepEqual(ctx.checksReprovados, [])
    assert.deepEqual(ctx.errosReconhecidos, [])
  })
})

describe('sanitizar', () => {
  it('remove bloco de código quando o momento proíbe comando', () => {
    const { texto, podado } = sanitizar(
      'explicar_erro',
      'Veja o que houve.\n```bash\nrm -rf /\n```\nEntendeu?',
    )
    assert.equal(podado, true)
    assert.ok(!texto.includes('rm -rf'))
    assert.match(texto, /Entendeu\?/)
  })

  it('remove também o bloco que o modelo esqueceu de fechar', () => {
    const { texto, podado } = sanitizar('dica_socratica', 'Pense nisto:\n```\ntouch alvo.txt')
    assert.equal(podado, true)
    assert.ok(!texto.includes('touch alvo.txt'))
  })

  it('preserva comandos na revisão, que acontece depois de o aluno passar', () => {
    const original = 'Ficou bom.\n```bash\nfind . -type f\n```'
    const { texto, podado } = sanitizar('revisar_solucao', original)
    assert.equal(podado, false)
    assert.equal(texto, original)
  })
})

describe('recortarTerminal', () => {
  it('devolve o texto inteiro quando cabe', () => {
    assert.equal(recortarTerminal('curto', 100), 'curto')
  })

  it('corta pelo fim: o que interessa é o que acabou de acontecer', () => {
    const saida = ['linha velha', 'linha do meio', 'linha recente'].join('\n')
    const recorte = recortarTerminal(saida, 20)
    assert.ok(recorte.includes('linha recente'))
    assert.ok(!recorte.includes('linha velha'))
  })

  it('não devolve linha cortada pela metade', () => {
    const recorte = recortarTerminal('aaaaaaaaaa\nbbbbbbbbbb\ncccc', 15)
    assert.ok(!recorte.startsWith('b'.repeat(3)) || recorte.startsWith('cccc'))
  })
})

describe('temModelo', () => {
  it('casa com e sem a tag explícita', () => {
    assert.equal(temModelo(['qwen2.5-coder:7b'], 'qwen2.5-coder:7b'), true)
    assert.equal(temModelo(['llama3.1:latest'], 'llama3.1'), true)
    assert.equal(temModelo(['qwen2.5-coder:7b'], 'qwen2.5-coder:14b'), false)
    assert.equal(temModelo([], 'qwen2.5-coder:7b'), false)
  })
})
