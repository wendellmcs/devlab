import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { montarArvore } from './extrator.ts'

/** Linhas no formato de `find -printf '%y\t%s\t%M\t%u\t%P\n'`. */
function linha(tipo: string, tamanho: number, perm: string, caminho: string): string {
  return `${tipo}\t${tamanho}\t${perm}\taluno\t${caminho}`
}

describe('montarArvore', () => {
  it('monta a hierarquia a partir dos caminhos relativos do find', () => {
    const saida = [
      linha('d', 4096, 'drwxr-xr-x', ''),
      linha('d', 4096, 'drwxr-xr-x', 'logs'),
      linha('f', 512, '-rw-r--r--', 'logs/chamadas.log'),
      linha('f', 120, '-rw-r--r--', 'README.txt'),
    ].join('\n')

    const { raiz } = montarArvore(saida, '/home/aluno')

    assert.equal(raiz?.nome, 'aluno')
    assert.equal(raiz?.filhos.length, 2)

    // diretórios primeiro, depois arquivos, ambos em ordem alfabética
    assert.equal(raiz?.filhos[0]?.nome, 'logs')
    assert.equal(raiz?.filhos[0]?.tipo, 'diretorio')
    assert.equal(raiz?.filhos[1]?.nome, 'README.txt')

    const log = raiz?.filhos[0]?.filhos[0]
    assert.equal(log?.nome, 'chamadas.log')
    assert.equal(log?.tamanho, 512)
    assert.equal(log?.permissoes, '-rw-r--r--')
  })

  it('reconhece links simbólicos', () => {
    const saida = [linha('d', 4096, 'drwxr-xr-x', ''), linha('l', 7, 'lrwxrwxrwx', 'atalho')].join(
      '\n',
    )
    const { raiz } = montarArvore(saida, '/home/aluno')
    assert.equal(raiz?.filhos[0]?.tipo, 'link')
  })

  it('aceita nome de arquivo com tabulação sem quebrar as colunas', () => {
    const saida = [
      linha('d', 4096, 'drwxr-xr-x', ''),
      linha('f', 10, '-rw-r--r--', 'nome\tesquisito.txt'),
    ].join('\n')
    const { raiz } = montarArvore(saida, '/home/aluno')
    assert.equal(raiz?.filhos[0]?.caminho, 'nome\tesquisito.txt')
  })

  it('devolve raiz nula quando o find não produziu nada', () => {
    const { raiz } = montarArvore('', '/home/aluno')
    assert.equal(raiz, null)
  })

  it('ignora linhas malformadas', () => {
    const saida = [linha('d', 4096, 'drwxr-xr-x', ''), 'lixo sem tabs'].join('\n')
    const { raiz } = montarArvore(saida, '/home/aluno')
    assert.equal(raiz?.filhos.length, 0)
  })

  it('marca como truncada quando passa do teto de entradas', () => {
    const linhas = [linha('d', 4096, 'drwxr-xr-x', '')]
    for (let i = 0; i < 500; i += 1) linhas.push(linha('f', 1, '-rw-r--r--', `arq-${i}.txt`))
    const { truncada } = montarArvore(linhas.join('\n'), '/home/aluno')
    assert.equal(truncada, true)
  })
})
