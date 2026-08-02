import { config } from '../config.ts'
import { log } from '../log.ts'
import type {
  DiagnosticoIa,
  MensagemChat,
  ProvedorDeIa,
  RespostaModelo,
} from './tipos.ts'

const PAPEL_OLLAMA: Record<MensagemChat['papel'], string> = {
  sistema: 'system',
  usuario: 'user',
}

/**
 * Provedor de IA local via Ollama.
 *
 * O modelo roda na máquina do aluno. Não há chave de API, não há requisição
 * para fora e o histórico de conversa não é persistido em lugar nenhum — o que
 * torna esta a única forma de IA compatível com o princípio 4 sem asterisco.
 */
export class ProvedorOllama implements ProvedorDeIa {
  readonly nome = 'ollama'
  readonly modelo: string
  readonly #url: string
  readonly #timeoutMs: number

  constructor(opcoes: { url?: string; modelo?: string; timeoutMs?: number } = {}) {
    this.#url = (opcoes.url ?? config.ia.url).replace(/\/+$/, '')
    this.modelo = opcoes.modelo ?? config.ia.modelo
    this.#timeoutMs = opcoes.timeoutMs ?? config.ia.timeoutMs
  }

  async diagnosticar(): Promise<DiagnosticoIa> {
    const base = { provedor: this.nome, url: this.#url, modelo: this.modelo }

    let modelosLocais: string[]
    try {
      modelosLocais = await this.listarModelos()
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e)
      return {
        ...base,
        disponivel: false,
        modelosLocais: [],
        erro,
        sugestao:
          'O Ollama não respondeu. Instale com "curl -fsSL https://ollama.com/install.sh | sh" ' +
          'e confirme que está de pé com "ollama list". A camada de IA é opcional: ' +
          'sem ela o DevLab continua inteiro.',
      }
    }

    if (!temModelo(modelosLocais, this.modelo)) {
      return {
        ...base,
        disponivel: false,
        modelosLocais,
        erro: `o modelo '${this.modelo}' não está baixado`,
        sugestao: `Baixe uma vez com: ollama pull ${this.modelo}`,
      }
    }

    return { ...base, disponivel: true, modelosLocais }
  }

  async listarModelos(): Promise<string[]> {
    const dados = await this.#pedir<{ models?: { name?: string }[] }>('/api/tags', undefined, 5000)
    return (dados.models ?? [])
      .map((m) => m.name)
      .filter((n): n is string => typeof n === 'string')
  }

  async conversar(mensagens: MensagemChat[]): Promise<RespostaModelo> {
    const inicio = Date.now()

    const dados = await this.#pedir<{ message?: { content?: string } }>(
      '/api/chat',
      {
        model: this.modelo,
        stream: false,
        messages: mensagens.map((m) => ({ role: PAPEL_OLLAMA[m.papel], content: m.texto })),
        options: {
          // Tutoria pede resposta estável, não criativa.
          temperature: 0.2,
          top_p: 0.9,
          num_predict: 600,
        },
      },
      this.#timeoutMs,
    )

    const texto = (dados.message?.content ?? '').trim()
    if (texto === '') throw new Error('o modelo devolveu uma resposta vazia')

    return { texto, modelo: this.modelo, duracaoMs: Date.now() - inicio }
  }

  async #pedir<T>(caminho: string, corpo: unknown, timeoutMs: number): Promise<T> {
    const controle = new AbortController()
    const timer = setTimeout(() => controle.abort(), timeoutMs)
    try {
      const resposta = await fetch(`${this.#url}${caminho}`, {
        method: corpo === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: controle.signal,
      })
      if (!resposta.ok) {
        throw new Error(`${caminho} devolveu ${resposta.status} ${resposta.statusText}`)
      }
      return (await resposta.json()) as T
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new Error(`o modelo não respondeu em ${Math.round(timeoutMs / 1000)}s`)
      }
      log.debug(`falha ao falar com o Ollama em ${this.#url}`, e)
      throw e
    } finally {
      clearTimeout(timer)
    }
  }
}

/** `qwen2.5-coder:7b` e `qwen2.5-coder` devem casar com o que o Ollama lista. */
export function temModelo(locais: string[], procurado: string): boolean {
  const normalizar = (n: string): string => (n.includes(':') ? n : `${n}:latest`)
  const alvo = normalizar(procurado)
  return locais.some((n) => normalizar(n) === alvo)
}
