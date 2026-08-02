import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ALVO_BORDA_FUNCIONAL,
  ALVO_TEXTO_GRANDE,
  ALVO_TEXTO_NORMAL,
  ANSI_ESCURO,
  ANSI_EXCECOES,
  contraste,
  PALETAS,
  type Paleta,
  type Tema,
} from './tokens.ts'

/**
 * O portão de contraste.
 *
 * "AAA" só significa alguma coisa se for medido. Este teste roda em `npm run
 * teste` e QUEBRA O BUILD quando um par texto×superfície reprova — inclusive
 * numa mudança de cor feita de boa-fé meses depois.
 *
 * O que ele pega e a revisão manual não pega: o token que passa contra o canvas
 * e reprova dentro de um card elevado. Foi a causa de TODAS as seis falhas da
 * paleta anterior — `--acento` passava a 7.43 no canvas e caía para 5.59 sobre
 * `--fundo-4`. Por isso aqui cada texto é testado contra TODAS as superfícies,
 * e não contra o fundo "de referência".
 */

const TEMAS: Tema[] = ['escuro', 'claro']

function superficies(p: Paleta): [string, string][] {
  return Object.entries(p.superficie)
}

describe('contraste dos tokens — WCAG 1.4.6 (AAA)', () => {
  for (const tema of TEMAS) {
    const p = PALETAS[tema]

    describe(`tema ${tema}`, () => {
      it('texto primário e secundário ≥ 7:1 em TODA superfície', () => {
        for (const [nomeTexto, cor] of [
          ['primario', p.texto.primario],
          ['secundario', p.texto.secundario],
        ] as const) {
          for (const [nomeSup, fundo] of superficies(p)) {
            const r = contraste(cor, fundo)
            assert.ok(
              r >= ALVO_TEXTO_NORMAL,
              `texto.${nomeTexto} (${cor}) sobre ${nomeSup} (${fundo}) = ${r.toFixed(2)}:1, precisa ≥ ${ALVO_TEXTO_NORMAL}`,
            )
          }
        }
      })

      it('acentos ≥ 7:1 em TODA superfície — é onde a paleta antiga quebrava', () => {
        for (const [nomeAcento, cor] of Object.entries(p.acento)) {
          for (const [nomeSup, fundo] of superficies(p)) {
            const r = contraste(cor, fundo)
            assert.ok(
              r >= ALVO_TEXTO_NORMAL,
              `acento.${nomeAcento} (${cor}) sobre ${nomeSup} (${fundo}) = ${r.toFixed(2)}:1, precisa ≥ ${ALVO_TEXTO_NORMAL}`,
            )
          }
        }
      })

      it('texto.grande ≥ 4.5:1 — só vale em ≥24px ou ≥18.66px bold', () => {
        for (const [nomeSup, fundo] of superficies(p)) {
          const r = contraste(p.texto.grande, fundo)
          assert.ok(
            r >= ALVO_TEXTO_GRANDE,
            `texto.grande sobre ${nomeSup} = ${r.toFixed(2)}:1, precisa ≥ ${ALVO_TEXTO_GRANDE}`,
          )
        }
      })

      it('texto.grande NÃO alcança 7:1 — se alcançasse, seria texto normal', () => {
        // Guarda contra uso indevido: se alguém "consertar" este token subindo o
        // contraste, ele deixa de ter razão de existir e o uso restrito a ≥24px
        // vira regra sem motivo — que é como regra morre.
        const pior = Math.min(...superficies(p).map(([, f]) => contraste(p.texto.grande, f)))
        assert.ok(
          pior < ALVO_TEXTO_NORMAL,
          `texto.grande atinge ${pior.toFixed(2)}:1 em toda superfície — promova para texto.secundario`,
        )
      })

      it('borda.forte ≥ 3:1 — WCAG 1.4.11, obrigatório em input e botão outline', () => {
        for (const [nomeSup, fundo] of superficies(p)) {
          const r = contraste(p.borda.forte, fundo)
          assert.ok(
            r >= ALVO_BORDA_FUNCIONAL,
            `borda.forte sobre ${nomeSup} = ${r.toFixed(2)}:1, precisa ≥ ${ALVO_BORDA_FUNCIONAL}`,
          )
        }
      })

      it('a rampa de superfícies é curta — senão ela come o orçamento do texto', () => {
        // Δ grande entre canvas e elevado é o que faz um token de texto passar
        // embaixo e reprovar em cima. Teto de 1.5:1 mantém a rampa honesta.
        const cores = superficies(p).map(([, c]) => c)
        const extremos = contraste(cores[0] as string, cores[cores.length - 1] as string)
        assert.ok(
          extremos <= 1.5,
          `rampa canvas→elevado = ${extremos.toFixed(2)}:1; acima de 1.5 o texto não fecha em cima`,
        )
      })
    })
  }
})

describe('paleta ANSI do terminal', () => {
  const teto = PALETAS.escuro.superficie.sup3

  it('≥ 7:1 contra a superfície mais clara, exceto as exceções documentadas', () => {
    for (const [nome, cor] of Object.entries(ANSI_ESCURO)) {
      if (ANSI_EXCECOES.includes(nome)) continue
      const r = contraste(cor, teto)
      assert.ok(r >= ALVO_TEXTO_NORMAL, `ansi.${nome} (${cor}) = ${r.toFixed(2)}:1 sobre ${teto}`)
    }
  })

  it('normal e bright continuam distinguíveis — elevar contraste sozinho os colide', () => {
    // Corrigir a paleta ANSI só pela luminosidade faz `red` e `brightRed` virarem
    // a MESMA cor, e o programa perde um canal de informação. Medido: no tema
    // escuro colidiam 4 pares; no claro, `white`/`brightWhite`/`brightBlack`
    // colapsavam os três em #595959.
    const pares = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'] as const
    for (const base of pares) {
      const normal = ANSI_ESCURO[base]
      const bright = ANSI_ESCURO[`bright${base[0]!.toUpperCase()}${base.slice(1)}` as keyof typeof ANSI_ESCURO]
      assert.notEqual(normal, bright, `ansi.${base} e bright${base} são a mesma cor`)
      const entre = contraste(normal, bright)
      assert.ok(
        entre >= 1.3,
        `ansi.${base} vs bright = ${entre.toFixed(2)}:1 — indistinguíveis na prática`,
      )
    }
  })
})
