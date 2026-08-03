/**
 * Regras de XP e de desbloqueio.
 *
 * Princípio 5: o jogo serve à competência demonstrada. Por isso o XP é
 * ponderado pela dificuldade declarada na lição, pedir dica custa de verdade,
 * e repetir uma lição já concluída não rende XP novo — grinding de fácil não
 * pode pagar mais que resolver o difícil.
 */

/**
 * Fração do XP descontada conforme o nível de dica mais fundo que foi revelado.
 *
 * A dica 1 é GRÁTIS. Ela é um empurrão conceitual — reancora o modelo mental e
 * não entrega comando nenhum. Cobrar por ela punia exatamente o comportamento
 * que o curso quer: parar e reconsiderar o modelo antes de sair tentando
 * sintaxe. Pior, cobrava por uma explicação que, desde o E-G-P, a lição já dá
 * de graça no bloco 3 — o aluno pagava por ler de novo o que estava acima.
 *
 * As dicas 2 e 3 continuam custando: aí já é a forma do comando e a solução.
 */
export const CUSTO_DE_DICA: Record<number, number> = {
  0: 0,
  1: 0,
  2: 0.25,
  3: 0.5,
}

/** A IA opcional custa o mesmo que a dica de nível 3 e marca a solução. */
export const CUSTO_DE_IA = CUSTO_DE_DICA[3] as number

export function penalidade(nivelMaximoDica: number, usouIa: boolean): number {
  const porDica = CUSTO_DE_DICA[clampar(nivelMaximoDica, 0, 3)] ?? 0
  return Math.max(porDica, usouIa ? CUSTO_DE_IA : 0)
}

export function xpDaConclusao(
  xpBase: number,
  nivelMaximoDica: number,
  usouIa: boolean,
): number {
  const fator = 1 - penalidade(nivelMaximoDica, usouIa)
  return Math.max(1, Math.round(xpBase * fator))
}

/** "Resolveu sem ajuda" — o que a métrica de autonomia mede. */
export function resolvidaSemAjuda(nivelMaximoDica: number, usouIa: boolean): boolean {
  return nivelMaximoDica === 0 && !usouIa
}

/** A skill tree é um DAG: uma lição abre quando todos os prereqs estão concluídos. */
export function licaoDesbloqueada(prereqs: string[], concluidas: Set<string>): boolean {
  return prereqs.every((p) => concluidas.has(p))
}

function clampar(valor: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(valor)))
}
