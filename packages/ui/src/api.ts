import type {
  EstadoDaIa,
  EstadoDoLab,
  LabInfo,
  Licao,
  MomentoIa,
  RelatorioDoctor,
  RespostaDaIa,
  ResultadoVerificacao,
  ResumoProgresso,
  Trilha,
} from './tipos.ts'

export class ErroDaApi extends Error {
  readonly status: number
  readonly codigo: string
  readonly detalhe: string | undefined

  constructor(status: number, codigo: string, mensagem: string, detalhe?: string) {
    super(mensagem)
    this.name = 'ErroDaApi'
    this.status = status
    this.codigo = codigo
    this.detalhe = detalhe
  }
}

async function pedir<T>(caminho: string, init?: RequestInit): Promise<T> {
  let resposta: Response
  try {
    resposta = await fetch(caminho, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch {
    throw new ErroDaApi(
      0,
      'agente_offline',
      'não foi possível falar com o devlab-agent',
      'Confira se o agente está rodando: npm run dev',
    )
  }

  const texto = await resposta.text()
  const corpo: unknown = texto === '' ? null : seguro(texto)

  if (!resposta.ok) {
    const e = (corpo ?? {}) as { erro?: string; codigo?: string; detalhe?: string }
    throw new ErroDaApi(
      resposta.status,
      e.codigo ?? 'erro',
      e.erro ?? `falha ${resposta.status}`,
      e.detalhe,
    )
  }

  return corpo as T
}

function seguro(texto: string): unknown {
  try {
    return JSON.parse(texto)
  } catch {
    return null
  }
}

export const api = {
  doctor: () => pedir<RelatorioDoctor>('/api/doctor'),

  trilhas: () => pedir<Trilha[]>('/api/trilhas'),

  licao: (id: string) => pedir<Licao>(`/api/licoes/${encodeURIComponent(id)}`),

  revelarDica: (id: string, nivel: number) =>
    pedir<{ nivel: number; texto: string; custoXp: number; licao: Licao }>(
      `/api/licoes/${encodeURIComponent(id)}/dica`,
      { method: 'POST', body: JSON.stringify({ nivel }) },
    ),

  progresso: () =>
    pedir<{ resumo: ResumoProgresso }>('/api/progresso').then((r) => r.resumo),

  criarLab: (licaoId: string) =>
    pedir<{ lab: LabInfo; licao: Licao }>('/api/labs', {
      method: 'POST',
      body: JSON.stringify({ licaoId }),
    }),

  resetarLab: (labId: string) =>
    pedir<LabInfo>(`/api/labs/${encodeURIComponent(labId)}/reset`, { method: 'POST' }),

  destruirLab: (labId: string) =>
    pedir<{ destruido: boolean }>(`/api/labs/${encodeURIComponent(labId)}`, {
      method: 'DELETE',
    }),

  estadoDoLab: (labId: string) =>
    pedir<EstadoDoLab>(`/api/labs/${encodeURIComponent(labId)}/estado`),

  verificar: (labId: string) =>
    pedir<ResultadoVerificacao>(`/api/labs/${encodeURIComponent(labId)}/verificar`, {
      method: 'POST',
    }),

  iaEstado: () => pedir<EstadoDaIa>('/api/ia/estado'),

  iaResponder: (momento: MomentoIa, labId: string) =>
    pedir<RespostaDaIa>(`/api/ia/${momento}`, {
      method: 'POST',
      body: JSON.stringify({ labId }),
    }),
}

export function urlDoTerminal(labId: string, cols: number, rows: number): string {
  const protocolo = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const p = new URLSearchParams({ lab: labId, cols: String(cols), rows: String(rows) })
  return `${protocolo}//${location.host}/ws/pty?${p.toString()}`
}
