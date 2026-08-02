/** Os momentos em que a IA é oferecida. Cada um tem regras próprias. */
export const MOMENTOS = ['explicar_erro', 'revisar_solucao', 'dica_socratica'] as const
export type Momento = (typeof MOMENTOS)[number]

export type MensagemChat = {
  papel: 'sistema' | 'usuario'
  texto: string
}

export type RespostaModelo = {
  texto: string
  modelo: string
  duracaoMs: number
}

export interface ProvedorDeIa {
  readonly nome: string
  readonly modelo: string
  /** Diz se o provedor está de pé e se o modelo configurado existe. */
  diagnosticar(): Promise<DiagnosticoIa>
  conversar(mensagens: MensagemChat[]): Promise<RespostaModelo>
}

export type DiagnosticoIa = {
  disponivel: boolean
  provedor: string
  url: string
  modelo: string
  /** Modelos presentes localmente, quando o provedor sabe informar. */
  modelosLocais: string[]
  erro?: string
  sugestao?: string
}

/**
 * Contexto que a IA pode ver.
 *
 * É uma lista de permissões, não de proibições: nada além destes campos chega
 * ao modelo. A solução da lição, as dicas não reveladas, os scripts de check,
 * o `setup` e o `break` ficam de fora por construção — não por instrução no
 * prompt, que um modelo pode ignorar.
 */
export type ContextoDaLicao = {
  titulo: string
  nivel: string
  trilha: string
  capacidade: string
  objetivo: string
  /** Só as descrições dos checks. Nunca o corpo dos scripts. */
  criterios: string[]
  /** Últimas linhas do terminal do aluno. */
  terminal: string
  /** Diagnóstico dos checks que reprovaram, sem revelar como passar. */
  checksReprovados: { descricao: string; mensagem?: string }[]
  /** Erros já reconhecidos pelo catálogo, para a IA não repetir o óbvio. */
  errosReconhecidos: string[]
}
