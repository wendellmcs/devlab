/**
 * Tokens de design — a fonte da verdade, em dados.
 *
 * Estão aqui e não no CSS por um motivo: o CSS não é testável. Com os valores
 * em TypeScript, `tokens.test.ts` prova que TODO par (texto × superfície) que
 * pode coexistir na tela atinge 7:1 — e quebra o build quando não atinge.
 * O CSS é gerado a partir daqui por `paraCss()`.
 *
 * ── Por que a rampa de superfícies é curta ──────────────────────────────────
 * O erro clássico de paleta AAA: valida-se o texto contra o fundo do canvas e
 * depois usa-se ele dentro de um card elevado, onde o contraste despenca. Foi
 * exatamente o que aconteceu na paleta anterior — `--acento` passava a 7.43
 * sobre o canvas e caía para 5.59 sobre `--fundo-4`.
 *
 * A regra que resolve: todo token de texto é validado contra a superfície MAIS
 * CLARA em que pode aparecer (`sup3`), nunca contra o canvas. Isso obriga a
 * rampa a ser curta (Δ ≈ 1.2:1 do canvas ao elevado), e a hierarquia passa a
 * vir de BORDA e ESPAÇO em vez de luminância.
 *
 * ── Por que não 21:1 ────────────────────────────────────────────────────────
 * Branco puro sobre preto puro dá 21:1 e é PIOR para o usuário real: causa
 * halation (halo/sangramento) em quem tem astigmatismo, e o aluno passa horas
 * lendo saída de terminal. Alvo de texto primário: 12:1–16:1. Daí o canvas ser
 * `#0B0E13` e não `#000`, e o texto ser `#D9E0E7` e não `#fff`.
 *
 * ── O que 1.4.6 NÃO cobre ───────────────────────────────────────────────────
 * O critério AAA de contraste vale só para TEXTO. Bordas, divisores e ícones
 * decorativos caem em 1.4.11, que é AA-only (3:1) e não tem versão AAA. Por
 * isso os cinzas médios sobrevivem aqui — no cromo, não no texto.
 */

export type Tema = 'escuro' | 'claro'

/** Texto ≥24px, ou ≥18.66px bold, cai de 7:1 para 4.5:1 (WCAG 1.4.6). */
export const ALVO_TEXTO_NORMAL = 7
export const ALVO_TEXTO_GRANDE = 4.5
/** Bordas funcionais (input, botão outline) — 1.4.11, AA-only. */
export const ALVO_BORDA_FUNCIONAL = 3

export type Paleta = {
  /** Rampa de superfícies, do canvas ao mais elevado. `sup3` é o teto. */
  superficie: { sup0: string; sup1: string; sup2: string; sup3: string }
  /** `forte` é a única com requisito (3:1); as outras são decorativas. */
  borda: { sutil: string; media: string; forte: string }
  /** `grande` só pode ser usado em ≥24px ou ≥18.66px bold. */
  texto: { primario: string; secundario: string; grande: string }
  acento: { azul: string; verde: string; ambar: string; vermelho: string; roxo: string }
}

/**
 * Tema escuro — o canônico.
 *
 * Em fundo escuro o AAA custa muito menos croma que em fundo claro: o mesmo
 * matiz que sobrevive aqui vira lama no tema claro. Como o DevLab é um app de
 * terminal, escuro é o padrão e o claro é porte.
 */
export const ESCURO: Paleta = {
  superficie: {
    sup0: '#0B0E13', // canvas
    sup1: '#10151C', // painel
    sup2: '#151B24', // card, bloco de código
    sup3: '#1B222C', // hover, elevado — TETO: tudo se valida contra ele
  },
  borda: {
    sutil: '#303942', // divisores, árvore de arquivos — decorativa, sem requisito
    media: '#454F58', // cartões, containers — decorativa
    forte: '#636C76', // inputs, botões outline — 3:1 obrigatório (1.4.11)
  },
  texto: {
    primario: '#D9E0E7', // 12.02 no teto — dentro da faixa 12–16, sem halation
    secundario: '#A6ADB3', // 7.05 no teto — no limite; não escurecer
    grande: '#83898F', // 4.53 no teto — SÓ ≥24px ou ≥18.66px bold
  },
  acento: {
    azul: '#64B1FD', // links, ação primária
    verde: '#61BF79', // sucesso, check aprovado
    ambar: '#E39C5F', // aviso — laranja, não amarelo: amarelo a 7:1 vira mostarda
    vermelho: '#FD8B83', // erro
    roxo: '#BF99FE', // XP
  },
}

/**
 * Tema claro — o difícil.
 *
 * Aqui o AAA cobra caro: âmbar vira marrom e ciano vira petróleo, e não há
 * escapatória matemática. Aceite a dessaturação em vez de tentar "animar" o
 * tema claro — qualquer tentativa reprova em 1.4.6.
 */
export const CLARO: Paleta = {
  superficie: {
    sup0: '#FFFFFF',
    sup1: '#F5F7F9',
    sup2: '#ECEFF3',
    sup3: '#E2E7ED', // TETO (o mais ESCURO, em tema claro)
  },
  borda: {
    sutil: '#D0D7DE',
    media: '#AFB8C1',
    forte: '#6E7781',
  },
  texto: {
    primario: '#21272E',
    secundario: '#454C53',
    grande: '#616870',
  },
  acento: {
    azul: '#034D86',
    verde: '#025814',
    ambar: '#723E06',
    vermelho: '#9A020E',
    roxo: '#621CBB',
  },
}

/**
 * Paleta ANSI do terminal, curada para ≥7:1.
 *
 * As 16 cores ANSI padrão reprovam: 8 de 16 no tema escuro, 14 de 16 no claro.
 * Mas elevar a luminosidade ingenuamente COLIDE normal com bright — `red` e
 * `brightRed` viram a mesma cor, e o programa perde um canal de informação.
 * Esta paleta resolve as duas restrições: ≥7:1 E normal ≠ bright perceptível,
 * com croma contida (~0.11) para não virar neon.
 *
 * `brightBlack` é exceção documentada: precisa ser escuro para cumprir o papel
 * semântico de "texto apagado", e por isso não atinge 7:1. Nada essencial pode
 * depender só dele — é o equivalente ao `texto.grande`.
 */
export const ANSI_ESCURO = {
  black: '#2A323D',
  red: '#F88E83',
  green: '#65BE7A',
  yellow: '#C5AA3B',
  blue: '#67B1FA',
  magenta: '#DF92D8',
  // O ciano é o par mais apertado: a versão original ficava a 7.90 e não deixava
  // espaço para o bright subir sem colar nela (1.27:1 entre os dois — o teste
  // pegou). Baixar o normal para ~7.04 devolve o intervalo.
  cyan: '#21BDCE',
  white: '#D9E0E7',
  brightBlack: '#8D949B', // exceção: 5.22 no teto, ver comentário acima
  brightRed: '#FABFB7',
  brightGreen: '#94DEA3',
  brightYellow: '#E2CC75',
  brightBlue: '#A5D1FF',
  brightMagenta: '#FAB7F3',
  brightCyan: '#8FE4ED',
  brightWhite: '#F2F5F8',
} as const

/** `brightBlack` não atinge 7:1 por necessidade semântica. Ver ANSI_ESCURO. */
export const ANSI_EXCECOES: readonly string[] = ['brightBlack', 'black']

export const PALETAS: Record<Tema, Paleta> = { escuro: ESCURO, claro: CLARO }

// ── contraste WCAG 2 ────────────────────────────────────────────────────────
// Implementado aqui em vez de trazer dependência: são 8 linhas, e o projeto
// tem "zero dependência nativa / bundle offline" como princípio.

function canal(v: number): number {
  const s = v / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return 0.2126 * canal(r as number) + 0.7152 * canal(g as number) + 0.0722 * canal(b as number)
}

/** Razão de contraste WCAG 2, de 1 a 21. */
export function contraste(a: string, b: string): number {
  const [maior, menor] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return ((maior as number) + 0.05) / ((menor as number) + 0.05)
}

/** Variáveis CSS de um tema, para injetar em `:root` ou `[data-tema]`. */
export function paraCss(p: Paleta): Record<string, string> {
  return {
    '--sup-0': p.superficie.sup0,
    '--sup-1': p.superficie.sup1,
    '--sup-2': p.superficie.sup2,
    '--sup-3': p.superficie.sup3,
    '--borda-sutil': p.borda.sutil,
    '--borda-media': p.borda.media,
    '--borda-forte': p.borda.forte,
    '--texto-1': p.texto.primario,
    '--texto-2': p.texto.secundario,
    '--texto-lg': p.texto.grande,
    '--azul': p.acento.azul,
    '--verde': p.acento.verde,
    '--ambar': p.acento.ambar,
    '--vermelho': p.acento.vermelho,
    '--roxo': p.acento.roxo,
  }
}
