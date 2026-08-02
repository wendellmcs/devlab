import { config } from '../config.ts'
import { log } from '../log.ts'
import type { Licao } from '../conteudo/schema.ts'
import type { ResultadoVerificacao } from '../verificacao/executor.ts'
import { montarMensagens, recortarTerminal, REGRAS, sanitizar } from './prompts.ts'
import type { ContextoDaLicao, DiagnosticoIa, Momento, ProvedorDeIa } from './tipos.ts'

export type RespostaDaIa = {
  momento: Momento
  rotulo: string
  texto: string
  modelo: string
  duracaoMs: number
  /** Sempre true: toda saída de IA é marcada, e maestria "sem ajuda" cai. */
  assistidaPorIa: true
  /** true quando a rede de segurança teve de remover comando da resposta. */
  podado: boolean
}

export type EstadoDaIa = DiagnosticoIa & {
  ligada: boolean
  momentos: { id: Momento; rotulo: string; permiteComando: boolean }[]
}

/**
 * Camada de IA opcional.
 *
 * Três garantias, nesta ordem de importância:
 *  1. Desligada por padrão. Sem ela, nada no DevLab deixa de funcionar.
 *  2. Nunca vê a solução: o contexto é montado por lista de permissões, então
 *     dicas, `solucao_referencia` e os scripts de check não existem para ela.
 *  3. Nunca sai de graça: usar custa o mesmo que a dica de nível 3 e derruba
 *     o selo de "resolvido sem ajuda".
 */
export class ServicoDeIa {
  readonly #provedor: ProvedorDeIa

  constructor(provedor: ProvedorDeIa) {
    this.#provedor = provedor
  }

  get ligada(): boolean {
    return config.ia.ligada
  }

  async estado(): Promise<EstadoDaIa> {
    const momentos = (Object.keys(REGRAS) as Momento[]).map((id) => ({
      id,
      rotulo: REGRAS[id].rotulo,
      permiteComando: REGRAS[id].permiteComando,
    }))

    if (!this.ligada) {
      return {
        ligada: false,
        disponivel: false,
        provedor: this.#provedor.nome,
        url: config.ia.url,
        modelo: this.#provedor.modelo,
        modelosLocais: [],
        sugestao:
          'A IA vem desligada por princípio. Para ligar, suba o agente com DEVLAB_IA=1 ' +
          '(o modelo roda na sua máquina via Ollama; nenhum dado sai daqui).',
        momentos,
      }
    }

    return { ...(await this.#provedor.diagnosticar()), ligada: true, momentos }
  }

  async responder(entrada: {
    momento: Momento
    licao: Licao
    terminal: string
    ultimaVerificacao?: ResultadoVerificacao
  }): Promise<RespostaDaIa> {
    if (!this.ligada) {
      throw new Error('a camada de IA está desligada (suba o agente com DEVLAB_IA=1)')
    }

    const contexto = montarContextoSeguro(entrada)
    const mensagens = montarMensagens(entrada.momento, contexto)

    log.debug(`IA: ${entrada.momento} para a lição ${entrada.licao.id}`)
    const bruta = await this.#provedor.conversar(mensagens)
    const { texto, podado } = sanitizar(entrada.momento, bruta.texto)

    return {
      momento: entrada.momento,
      rotulo: REGRAS[entrada.momento].rotulo,
      texto,
      modelo: bruta.modelo,
      duracaoMs: bruta.duracaoMs,
      assistidaPorIa: true,
      podado,
    }
  }
}

/**
 * Monta o contexto por lista de permissões.
 *
 * Exportada porque é aqui que mora a garantia 2 — e garantia que não é testada
 * é promessa. O teste `servico.test.ts` prova que nem a dica, nem a
 * `solucao_referencia`, nem o corpo dos checks atravessam esta função.
 */
export function montarContextoSeguro(entrada: {
  licao: Licao
  terminal: string
  ultimaVerificacao?: ResultadoVerificacao
}): ContextoDaLicao {
  const { licao, ultimaVerificacao } = entrada

  return {
    titulo: licao.titulo,
    nivel: licao.nivel,
    trilha: licao.trilha,
    capacidade: licao.capacidade,
    objetivo: licao.objetivo_md,
    criterios: licao.verificar.map((c) => c.descricao),
    terminal: recortarTerminal(entrada.terminal, config.ia.maxContextoChars),
    checksReprovados: (ultimaVerificacao?.checks ?? [])
      .filter((c) => !c.aprovado)
      .map((c) => ({
        descricao: c.descricao,
        ...(c.mensagem !== undefined ? { mensagem: c.mensagem } : {}),
      })),
    errosReconhecidos: (ultimaVerificacao?.errosDetectados ?? []).map((e) => e.titulo),
  }
}
