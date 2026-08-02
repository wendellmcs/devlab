import Anthropic from '@anthropic-ai/sdk'

import { config, type Esforco } from '../config.ts'
import { log } from '../log.ts'
import type { DiagnosticoIa, MensagemChat, ProvedorDeIa, RespostaModelo } from './tipos.ts'

/**
 * Provedor de IA na nuvem — BYO key.
 *
 * Existe por um motivo prático: um modelo local útil pede 8 GB de RAM livres, e
 * nem toda máquina de aluno tem isso. Quem não consegue rodar o Ollama pode
 * trazer a própria chave e usar a mesma camada de tutoria.
 *
 * O que muda em relação ao Ollama, dito sem rodeio para quem for escolher:
 *  - a chave é SUA e fica só no seu .env (que está no .gitignore);
 *  - o enunciado da lição e as últimas linhas do SEU terminal saem da máquina
 *    e vão para a API da Anthropic. O `montarContextoSeguro` continua valendo,
 *    então dica, solução e script de check seguem fora do pacote — mas o
 *    princípio "nada sai daqui" do modo local deixa de valer, e é por isso que
 *    o padrão continua sendo o Ollama;
 *  - as chamadas são cobradas na sua conta;
 *  - o princípio 4 (offline após o primeiro build) vale para o núcleo, não
 *    para esta camada. Sem rede, a IA em nuvem simplesmente não responde e o
 *    resto do DevLab segue funcionando.
 */
export class ProvedorNuvem implements ProvedorDeIa {
  readonly nome = 'anthropic'
  readonly modelo: string
  readonly #chave: string | undefined
  readonly #timeoutMs: number
  readonly #esforco: Esforco
  #cliente: Anthropic | null = null

  constructor(opcoes: { chave?: string; modelo?: string; timeoutMs?: number } = {}) {
    this.#chave = opcoes.chave ?? config.ia.chaveNuvem
    this.modelo = opcoes.modelo ?? config.ia.modeloNuvem
    this.#timeoutMs = opcoes.timeoutMs ?? config.ia.timeoutMs
    this.#esforco = config.ia.esforco
  }

  /** A URL não é endereço de rede aqui: é o rótulo que o doctor mostra. */
  get url(): string {
    return 'https://api.anthropic.com'
  }

  #obterCliente(): Anthropic {
    if (this.#chave === undefined || this.#chave === '') {
      throw new Error('nenhuma chave de API configurada (defina ANTHROPIC_API_KEY no .env)')
    }
    this.#cliente ??= new Anthropic({
      apiKey: this.#chave,
      // O SDK conta em milissegundos e já retenta 429/5xx duas vezes sozinho.
      timeout: this.#timeoutMs,
    })
    return this.#cliente
  }

  async diagnosticar(): Promise<DiagnosticoIa> {
    const base = { provedor: this.nome, url: this.url, modelo: this.modelo }

    if (this.#chave === undefined || this.#chave === '') {
      return {
        ...base,
        disponivel: false,
        modelosLocais: [],
        erro: 'nenhuma chave de API configurada',
        sugestao:
          'Ponha ANTHROPIC_API_KEY=sk-ant-... no .env (o arquivo está no .gitignore). ' +
          'A chave é sua e as chamadas são cobradas na sua conta. ' +
          'Prefere não usar nuvem? Volte para DEVLAB_IA_PROVEDOR=ollama.',
      }
    }

    // `models.retrieve` valida a chave E o id do modelo numa ida só, e não
    // gasta token nenhum. Errar o id do modelo é o engano mais comum aqui.
    try {
      const m = await this.#obterCliente().models.retrieve(this.modelo)
      return { ...base, disponivel: true, modelosLocais: [], modelo: m.id }
    } catch (e) {
      const { erro, sugestao } = traduzirErro(e, this.modelo)
      return { ...base, disponivel: false, modelosLocais: [], erro, sugestao }
    }
  }

  /** Lista os modelos que a chave enxerga — alimenta `devlab modelo`. */
  async listarModelos(): Promise<string[]> {
    const ids: string[] = []
    for await (const m of this.#obterCliente().models.list()) ids.push(m.id)
    return ids
  }

  async conversar(mensagens: MensagemChat[]): Promise<RespostaModelo> {
    const inicio = Date.now()

    // A API separa o papel de sistema do histórico: o prompt de sistema é um
    // parâmetro próprio, não uma mensagem. Juntar tudo em `messages` faria a
    // instrução virar texto de usuário, que o modelo trata com outro peso.
    const sistema = mensagens
      .filter((m) => m.papel === 'sistema')
      .map((m) => m.texto)
      .join('\n\n')
    const conversa = mensagens
      .filter((m) => m.papel === 'usuario')
      .map((m) => ({ role: 'user' as const, content: m.texto }))

    if (conversa.length === 0) throw new Error('nenhuma mensagem de usuário para enviar')

    let resposta
    try {
      resposta = await this.#obterCliente().messages.create({
        model: this.modelo,
        // O teto cobre raciocínio + texto: nos modelos atuais o pensamento vem
        // ligado e divide este orçamento. Apertar aqui trunca a resposta no
        // meio. `temperature`/`top_p` não entram: são recusados com 400.
        max_tokens: 2048,
        output_config: { effort: this.#esforco },
        system: sistema,
        messages: conversa,
      })
    } catch (e) {
      const { erro } = traduzirErro(e, this.modelo)
      throw new Error(erro)
    }

    // Os classificadores podem recusar o pedido: HTTP 200, `content` vazio ou
    // parcial. Ler `content[0]` direto quebraria com um erro sem sentido para
    // o aluno — que, aqui, quase sempre é falso positivo de conteúdo de
    // segurança (a trilha de VoIP fala de captura de pacote o tempo todo).
    if (resposta.stop_reason === 'refusal') {
      throw new Error(
        'o modelo recusou responder a este pedido' +
          (resposta.stop_details?.category != null
            ? ` (categoria: ${resposta.stop_details.category})`
            : '') +
          '. Reformule a pergunta, ou use a IA local (DEVLAB_IA_PROVEDOR=ollama).',
      )
    }

    // `content` é uma união discriminada: texto, raciocínio, uso de ferramenta.
    // Só o texto interessa — os blocos de raciocínio vêm vazios por padrão.
    const texto = resposta.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()

    if (texto === '') {
      throw new Error(
        resposta.stop_reason === 'max_tokens'
          ? 'a resposta estourou o limite de tokens antes de produzir texto'
          : 'o modelo devolveu uma resposta vazia',
      )
    }

    return { texto, modelo: resposta.model, duracaoMs: Date.now() - inicio }
  }
}

/**
 * Traduz a exceção do SDK em mensagem acionável.
 *
 * As classes são tipadas justamente para isto: casar texto de mensagem quebra
 * na primeira mudança de redação do servidor. A ordem vai do específico ao
 * genérico, e separa o que adianta retentar do que não adianta.
 */
export function traduzirErro(e: unknown, modelo: string): { erro: string; sugestao: string } {
  if (e instanceof Anthropic.AuthenticationError) {
    return {
      erro: 'chave de API inválida ou revogada',
      sugestao: 'Confira ANTHROPIC_API_KEY no .env — gere outra em console.anthropic.com.',
    }
  }
  if (e instanceof Anthropic.PermissionDeniedError) {
    return {
      erro: `a chave não tem acesso ao modelo '${modelo}'`,
      sugestao: 'Escolha outro com "devlab modelo --listar", ou revise o plano da sua conta.',
    }
  }
  if (e instanceof Anthropic.NotFoundError) {
    return {
      erro: `o modelo '${modelo}' não existe`,
      sugestao: 'Veja os disponíveis com "devlab modelo --listar" e ajuste DEVLAB_IA_MODELO_NUVEM.',
    }
  }
  if (e instanceof Anthropic.RateLimitError) {
    return {
      erro: 'limite de requisições atingido',
      sugestao: 'Espere alguns segundos e tente de novo. O SDK já retentou sozinho.',
    }
  }
  if (e instanceof Anthropic.APIConnectionTimeoutError) {
    return {
      erro: `a API não respondeu em ${Math.round(config.ia.timeoutMs / 1000)}s`,
      sugestao: 'Aumente DEVLAB_IA_TIMEOUT_MS no .env, ou tente de novo.',
    }
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return {
      erro: 'não foi possível alcançar a API (sem rede?)',
      sugestao:
        'A IA em nuvem precisa de internet. Sem rede, use a local: DEVLAB_IA_PROVEDOR=ollama. ' +
        'O núcleo do DevLab não depende de nenhuma das duas.',
    }
  }
  if (e instanceof Anthropic.APIError) {
    log.debug('erro da API de IA', e)
    return {
      erro: `a API devolveu ${String(e.status ?? '?')}: ${e.message}`,
      sugestao: 'Se persistir, desligue a IA com DEVLAB_IA=0 — nada mais depende dela.',
    }
  }
  return {
    erro: e instanceof Error ? e.message : String(e),
    sugestao: 'Desligue a IA com DEVLAB_IA=0 se quiser seguir sem ela.',
  }
}
