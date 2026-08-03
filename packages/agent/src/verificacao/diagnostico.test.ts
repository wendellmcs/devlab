import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { classificarErros, extrairDiagnostico } from './diagnostico.ts'
import type { EntradaCatalogo, ErroComumLicao } from '../conteudo/schema.ts'

const CATALOGO: EntradaCatalogo[] = [
  {
    id: 'linux-command-not-found',
    trilhas: ['linux'],
    match: 'command not found',
    titulo: 'command not found (código 127)',
    categoria: 'ferramenta_errada',
    significa: 'o shell não achou o programa',
    porque: 'erro de digitação ou PATH',
    investigar: 'type e which',
    corrigir: 'corrija o nome',
  },
  {
    id: 'git-detached-head',
    trilhas: ['git'],
    match: 'detached HEAD',
    titulo: 'detached HEAD',
    categoria: 'conceitual',
    significa: 'HEAD aponta para um commit, não para um branch',
    porque: 'checkout de um commit',
    investigar: 'git status',
    corrigir: 'crie um branch',
  },
]

describe('extrairDiagnostico', () => {
  it('separa o JSON estruturado do texto normal', () => {
    const { texto, diagnostico } = extrairDiagnostico(
      'linha um\nDEVLAB_JSON:{"mensagem":"faltou o arquivo"}\nlinha dois',
    )
    assert.equal(texto, 'linha um\nlinha dois')
    assert.equal(diagnostico.mensagem, 'faltou o arquivo')
  })

  it('aceita a linha indentada', () => {
    const { diagnostico } = extrairDiagnostico('   DEVLAB_JSON:{"mensagem":"ok"}')
    assert.equal(diagnostico.mensagem, 'ok')
  })

  it('a última linha vence, e os campos se somam', () => {
    const { diagnostico } = extrairDiagnostico(
      [
        'DEVLAB_JSON:{"mensagem":"primeira","dica_diagnostica":"olhe o log"}',
        'DEVLAB_JSON:{"mensagem":"segunda"}',
      ].join('\n'),
    )
    assert.equal(diagnostico.mensagem, 'segunda')
    assert.equal(diagnostico.dica_diagnostica, 'olhe o log')
  })

  it('preserva a linha quando o JSON está quebrado, em vez de engolir', () => {
    const bruto = 'DEVLAB_JSON:{isto nao e json}'
    const { texto, diagnostico } = extrairDiagnostico(bruto)
    assert.equal(texto, bruto)
    assert.deepEqual(diagnostico, {})
  })

  it('ignora campos de tipo errado', () => {
    const { diagnostico } = extrairDiagnostico('DEVLAB_JSON:{"mensagem":42}')
    assert.equal(diagnostico.mensagem, undefined)
  })
})

describe('classificarErros', () => {
  const errosDaLicao: ErroComumLicao[] = [
    {
      match: 'command not found',
      digita: 'lss ~/logs',
      mensagem: 'bash: lss: command not found',
      causa: 'o shell procurou um executável chamado `lss` no PATH e não achou',
      conserto: 'ls ~/logs',
      categoria: 'sintaxe',
    },
  ]

  it('devolve a linha original inteira, não só o trecho casado', () => {
    const saida = 'bash: lss: command not found'
    const [primeiro] = classificarErros(saida, [], CATALOGO, 'linux')
    assert.equal(primeiro?.trecho, 'bash: lss: command not found')
  })

  it('põe o erro da lição antes do catálogo global', () => {
    const achados = classificarErros(
      'bash: lss: command not found',
      errosDaLicao,
      CATALOGO,
      'linux',
    )
    assert.equal(achados[0]?.origem, 'licao')
    assert.equal(achados[1]?.origem, 'catalogo')
  })

  it('filtra entradas do catálogo que são de outra trilha', () => {
    const achados = classificarErros('You are in detached HEAD state', [], CATALOGO, 'linux')
    assert.equal(achados.length, 0)
  })

  it('casa a entrada quando a trilha bate', () => {
    const achados = classificarErros('You are in detached HEAD state', [], CATALOGO, 'git')
    assert.equal(achados[0]?.id, 'git-detached-head')
  })

  it('não repete a mesma entrada quando o erro aparece várias vezes', () => {
    const saida = 'bash: a: command not found\nbash: b: command not found'
    const achados = classificarErros(saida, [], CATALOGO, 'linux')
    assert.equal(achados.length, 1)
  })

  it('devolve vazio para saída em branco', () => {
    assert.deepEqual(classificarErros('   \n  ', errosDaLicao, CATALOGO, 'linux'), [])
  })

  it('sobrevive a uma regex inválida no conteúdo', () => {
    const quebrado: ErroComumLicao[] = [
      {
        match: '([',
        digita: 'qualquer coisa',
        mensagem: 'regex ruim',
        causa: 'regex ruim',
        conserto: 'regex ruim',
        categoria: 'conceitual',
      },
    ]
    assert.deepEqual(classificarErros('qualquer coisa', quebrado, [], 'linux'), [])
  })
})
