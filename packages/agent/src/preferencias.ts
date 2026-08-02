import fs from 'node:fs'
import path from 'node:path'

import { RAIZ_REPO } from './config.ts'

export const CAMINHO_ENV = path.join(RAIZ_REPO, '.env')

/**
 * Edição cirúrgica do `.env`.
 *
 * O arquivo é do aluno: ele pode ter comentado linhas, reordenado e escrito as
 * próprias notas. Reescrever o arquivo inteiro a partir de um template apagaria
 * tudo isso. Aqui só a linha da chave pedida muda — inclusive quando ela está
 * comentada, caso em que a linha é descomentada no lugar em vez de duplicada.
 */
export function gravarPreferencia(chave: string, valor: string): void {
  const linhas = fs.existsSync(CAMINHO_ENV)
    ? fs.readFileSync(CAMINHO_ENV, 'utf8').split('\n')
    : []

  const ativa = new RegExp(`^\\s*${chave}\\s*=`)
  const comentada = new RegExp(`^\\s*#\\s*${chave}\\s*=`)
  const nova = `${chave}=${valor}`

  const iAtiva = linhas.findIndex((l) => ativa.test(l))
  if (iAtiva !== -1) {
    linhas[iAtiva] = nova
  } else {
    const iComentada = linhas.findIndex((l) => comentada.test(l))
    if (iComentada !== -1) linhas[iComentada] = nova
    else linhas.push(nova)
  }

  let texto = linhas.join('\n')
  if (!texto.endsWith('\n')) texto += '\n'
  fs.writeFileSync(CAMINHO_ENV, texto, { mode: 0o600 })
}

/**
 * O `.env` guarda a chave de API quando o provedor é nuvem. Um arquivo legível
 * por qualquer conta da máquina é um vazamento silencioso — e a permissão só é
 * apertada aqui porque `gravarPreferencia` pode ter criado o arquivo agora.
 */
export function protegerEnv(): void {
  try {
    if (fs.existsSync(CAMINHO_ENV)) fs.chmodSync(CAMINHO_ENV, 0o600)
  } catch {
    // sistema de arquivos sem suporte a modo: não é motivo para falhar
  }
}
