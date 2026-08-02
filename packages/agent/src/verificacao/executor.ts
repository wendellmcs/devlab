import { config } from '../config.ts'
import { log } from '../log.ts'
import type { EntradaCatalogo, Licao } from '../conteudo/schema.ts'
import type { GerenciadorDeLabs } from '../lab/gerenciador.ts'
import {
  classificarErros,
  extrairDiagnostico,
  type ErroDetectado,
} from './diagnostico.ts'

export type ResultadoCheck = {
  indice: number
  descricao: string
  aprovado: boolean
  exit: number
  esperadoExit: number
  expirou: boolean
  /** Resumo do que o check concluiu — do próprio script quando ele informa. */
  mensagem: string | undefined
  dicaDiagnostica: string | undefined
  saida: string
}

export type ResultadoVerificacao = {
  aprovado: boolean
  checks: ResultadoCheck[]
  /** Erros reconhecidos na saída dos checks e no terminal recente. */
  errosDetectados: ErroDetectado[]
  duracaoMs: number
}

/**
 * Verifier Runner.
 *
 * Princípio 3: o sucesso é decidido por um script que inspeciona o ESTADO
 * dentro do container. Nada aqui olha para o que o aluno digitou — o que
 * mantém vários caminhos válidos abertos e ensina diagnóstico de verdade.
 */
export class ExecutorDeChecks {
  readonly #labs: GerenciadorDeLabs
  #catalogo: EntradaCatalogo[]

  constructor(labs: GerenciadorDeLabs, catalogo: EntradaCatalogo[] = []) {
    this.#labs = labs
    this.#catalogo = catalogo
  }

  atualizarCatalogo(catalogo: EntradaCatalogo[]): void {
    this.#catalogo = catalogo
  }

  async verificar(labId: string, licao: Licao): Promise<ResultadoVerificacao> {
    const inicio = Date.now()
    const checks: ResultadoCheck[] = []

    // O buffer do terminal é rolante e sobrevive entre tentativas. Sem zerar
    // aqui, um "No such file or directory" de vinte minutos atrás reapareceria
    // como diagnóstico de uma falha que nada tem a ver com ele — e o aluno
    // perseguiria um fantasma.
    this.#labs.limparSaida(labId)

    for (const [indice, check] of licao.verificar.entries()) {
      checks.push(await this.#rodarCheck(labId, licao, indice, check))
    }

    const aprovado = checks.every((c) => c.aprovado)

    // Classifica sobre a saída dos checks somada ao terminal recente: muita
    // pista real ("command not found", "Permission denied") só aparece lá.
    const material = [
      ...checks.map((c) => c.saida),
      this.#labs.saidaRecente(labId),
    ].join('\n')

    const errosDetectados = aprovado
      ? []
      : classificarErros(material, licao.erros_comuns, this.#catalogo, licao.trilha)

    return {
      aprovado,
      checks,
      errosDetectados,
      duracaoMs: Date.now() - inicio,
    }
  }

  async #rodarCheck(
    labId: string,
    licao: Licao,
    indice: number,
    check: Licao['verificar'][number],
  ): Promise<ResultadoCheck> {
    const base = {
      indice,
      descricao: check.descricao,
      esperadoExit: check.esperado_exit,
    }

    try {
      const resultado =
        check.script !== undefined
          ? await this.#labs.rodarScript(labId, `check-${licao.id}-${indice}`, check.script, {
              usuario: 'root',
              timeoutMs: config.timeoutCheckMs,
            })
          : await this.#labs.exec(labId, ['/bin/bash', check.run as string], {
              usuario: 'root',
              timeoutMs: config.timeoutCheckMs,
            })

      const bruto = [resultado.stdout, resultado.stderr].filter((s) => s !== '').join('\n')
      const { texto, diagnostico } = extrairDiagnostico(bruto)

      const aprovado =
        !resultado.expirou &&
        !resultado.indeterminado &&
        resultado.exit === check.esperado_exit

      return {
        ...base,
        aprovado,
        exit: resultado.exit,
        expirou: resultado.expirou,
        mensagem: resultado.indeterminado
          ? 'não foi possível ler o resultado do check — o lab pode ter sido reiniciado no meio da verificação'
          : diagnostico.mensagem,
        dicaDiagnostica: diagnostico.dica_diagnostica ?? check.dica_diagnostica,
        saida: texto,
      }
    } catch (e) {
      log.aviso(`check ${indice} da lição ${licao.id} não pôde rodar`, e)
      return {
        ...base,
        aprovado: false,
        exit: -1,
        expirou: false,
        mensagem: 'o check não pôde ser executado no lab',
        dicaDiagnostica: check.dica_diagnostica,
        saida: e instanceof Error ? e.message : String(e),
      }
    }
  }
}
