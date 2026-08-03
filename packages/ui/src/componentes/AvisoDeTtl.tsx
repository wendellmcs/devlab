import { type ReactElement } from 'react'

/** A partir daqui o aviso aparece. Cinco minutos é tempo de terminar a frase. */
export const LIMIAR_AVISO_MS = 5 * 60 * 1000

export function minutosInteiros(ms: number): number {
  return Math.max(0, Math.ceil(ms / 60_000))
}

/**
 * Aviso de que o lab está prestes a ser coletado por ociosidade.
 *
 * WCAG 2.2.6 (Timeouts, AAA) exige avisar sobre a duração de inatividade que
 * causa perda de dado; 2.2.1 (Tempo Ajustável, A) exige poder estender antes
 * de acabar. Antes disto o container morria calado e o aluno voltava do café
 * para um terminal que perdeu tudo — sem nunca ter sido informado de que
 * existia um relógio.
 *
 * Sobre o anúncio: `role="alert"` é assertivo e interrompe o leitor de tela.
 * Isso é adequado UMA vez, quando o aviso surge, e insuportável a cada
 * segundo. Por isso o texto anunciado tem granularidade de MINUTO — o
 * contador de segundos existe só para os olhos, e está fora da região viva.
 */
export function AvisoDeTtl({
  restanteMs,
  aoManterVivo,
  ocupado,
}: {
  restanteMs: number
  aoManterVivo: () => void
  ocupado: boolean
}): ReactElement | null {
  if (restanteMs > LIMIAR_AVISO_MS) return null

  const minutos = minutosInteiros(restanteMs)
  const segundos = Math.max(0, Math.ceil(restanteMs / 1000))
  const mm = String(Math.floor(segundos / 60)).padStart(2, '0')
  const ss = String(segundos % 60).padStart(2, '0')

  return (
    <div className="ttl" role="alert">
      <span className="ttl__icone" aria-hidden="true">
        ⏳
      </span>

      <p className="ttl__texto">
        {minutos > 0 ? (
          <>
            O lab será destruído em <strong>{minutos} minuto{minutos > 1 ? 's' : ''}</strong> por
            inatividade. Tudo o que você criou dentro dele se perde; o XP e o progresso da lição
            ficam.
          </>
        ) : (
          <>
            O lab está sendo destruído por inatividade. Tudo o que você criou dentro dele se perde;
            o XP e o progresso da lição ficam.
          </>
        )}
      </p>

      {/* Só para os olhos: anunciar a cada segundo tornaria a tela inutilizável
          com leitor de tela, e o minuto já está dito no texto acima. */}
      <span className="ttl__relogio" aria-hidden="true">
        {mm}:{ss}
      </span>

      <button type="button" className="botao botao--acento" onClick={aoManterVivo} disabled={ocupado}>
        Manter o lab vivo
      </button>
    </div>
  )
}

/**
 * A regra dita ANTES de ela morder — a outra metade do 2.2.6, que a maioria
 * dos apps esquece: avisar quando falta pouco é 2.2.1; 2.2.6 quer que a pessoa
 * saiba desde o começo que existe um limite.
 */
export function RegraDeTtl({ totalMs }: { totalMs: number }): ReactElement {
  return (
    <p className="estado__nota">
      O lab é destruído após {minutosInteiros(totalMs)} minutos sem atividade sua. Você é avisado
      antes, com opção de mantê-lo vivo.
    </p>
  )
}
