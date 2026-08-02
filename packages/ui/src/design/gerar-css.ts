/**
 * Gera `estilos/tokens.css` a partir de `design/tokens.ts`.
 *
 * O CSS é ARTEFATO, não fonte. A fonte é o TypeScript, porque é ele que o teste
 * de contraste consegue ler — e um valor de cor que não passa por teste é um
 * valor que vai reprovar em 1.4.6 mais cedo ou mais tarde.
 *
 * Rode com: npm run tokens --workspace @devlab/ui
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ANSI_ESCURO, CLARO, ESCURO, paraCss } from './tokens.ts'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const DESTINO = path.join(aqui, '..', 'estilos', 'tokens.css')

function bloco(vars: Record<string, string>, indent = '  '): string {
  return Object.entries(vars)
    .map(([k, v]) => `${indent}${k}: ${v};`)
    .join('\n')
}

/**
 * Espaçamento em escala 4/8 e tipografia em Major Third (1.25).
 *
 * A escala tipográfica é larga de propósito. Com contraste 7:1 obrigatório, a
 * cor deixa de separar níveis de informação — quem separa passa a ser tamanho,
 * peso e espaço. Uma escala de 1.2 (Minor Third) só funciona quando a cor
 * ajuda; sem ela, os degraus ficam indistinguíveis.
 */
const ESTRUTURA: Record<string, string> = {
  '--e-1': '4px',
  '--e-2': '8px',
  '--e-3': '12px',
  '--e-4': '16px',
  '--e-5': '24px',
  '--e-6': '32px',
  '--e-7': '48px',

  '--t-xs': '0.75rem',
  '--t-sm': '0.875rem',
  '--t-md': '1rem',
  '--t-lg': '1.25rem',
  '--t-xl': '1.563rem',
  '--t-2xl': '1.953rem',

  '--raio': '6px',
  '--raio-g': '10px',
  '--transicao': '140ms ease',

  '--fonte':
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  '--fonte-mono':
    'ui-monospace, "Cascadia Code", "JetBrains Mono", "Fira Code", Consolas, monospace',
}

/** Anel de foco: dois tons opostos, para um deles sempre contrastar. */
const FOCO_ESCURO = { '--foco-interno': '#0B0E13', '--foco-externo': '#F2F5F8' }
const FOCO_CLARO = { '--foco-interno': '#0B0E13', '--foco-externo': '#F2F5F8' }

const ansi = Object.fromEntries(
  Object.entries(ANSI_ESCURO).map(([k, v]) => [`--ansi-${k.toLowerCase()}`, v]),
)

const css = `/* GERADO por design/gerar-css.ts — não edite à mão.
 * A fonte é design/tokens.ts, que é testado a 7:1 por design/tokens.test.ts.
 * Para mudar uma cor: mude o token, rode o teste, regenere. */

:root {
${bloco(ESTRUTURA)}

  /* terminal — paleta ANSI curada, ≥7:1 e sem colisão normal/bright */
${bloco(ansi)}
}

/* Escuro é o tema canônico: em fundo escuro o AAA custa muito menos croma. */
:root,
:root[data-tema='escuro'] {
${bloco(paraCss(ESCURO))}
${bloco(FOCO_ESCURO)}
  color-scheme: dark;
}

:root[data-tema='claro'] {
${bloco(paraCss(CLARO))}
${bloco(FOCO_CLARO)}
  color-scheme: light;
}

/* Sem escolha manual, segue o sistema. */
@media (prefers-color-scheme: light) {
  :root:not([data-tema]) {
${bloco(paraCss(CLARO), '    ')}
${bloco(FOCO_CLARO, '    ')}
    color-scheme: light;
  }
}
`

fs.mkdirSync(path.dirname(DESTINO), { recursive: true })
fs.writeFileSync(DESTINO, css, 'utf8')
console.log(`tokens.css gerado (${css.split('\n').length} linhas)`)
