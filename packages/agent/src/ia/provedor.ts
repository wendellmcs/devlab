import { config } from '../config.ts'
import { ProvedorOllama } from './ollama.ts'
import { ProvedorNuvem } from './nuvem.ts'
import type { ProvedorDeIa } from './tipos.ts'

/**
 * Escolhe o provedor de IA a partir da configuração.
 *
 * Um único ponto de decisão de propósito: o resto do agente fala com a
 * interface `ProvedorDeIa` e não sabe — nem precisa saber — se o modelo roda
 * na máquina do aluno ou atrás de uma chave de API. É o que mantém a garantia
 * de que a IA nunca vê a solução válida para os dois caminhos, já que ela vive
 * em `montarContextoSeguro`, antes desta escolha.
 *
 * O padrão é `ollama`. Trocar para nuvem é opt-in explícito e muda o contrato
 * de privacidade — ver o cabeçalho de `nuvem.ts`.
 */
export function criarProvedor(): ProvedorDeIa {
  return config.ia.provedor === 'nuvem' ? new ProvedorNuvem() : new ProvedorOllama()
}
