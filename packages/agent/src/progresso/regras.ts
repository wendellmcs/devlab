/**
 * Regras de XP e de desbloqueio.
 *
 * Princípio 5: o jogo serve à competência demonstrada. Por isso o XP é
 * ponderado pela dificuldade declarada na lição, pedir dica custa de verdade,
 * e repetir uma lição já concluída não rende XP novo — grinding de fácil não
 * pode pagar mais que resolver o difícil.
 */

/** Fração do XP descontada conforme o nível de dica mais fundo que foi revelado. */
export const CUSTO_DE_DICA: Record<number, number> = {
  0: 0,
  1: 0.1,
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
