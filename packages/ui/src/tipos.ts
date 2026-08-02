export type Nivel = 'operador' | 'construtor' | 'engenheiro'
export type EstadoLicao = 'nao_iniciada' | 'em_andamento' | 'concluida'

export type ProgressoLicao = {
  licaoId: string
  trilha: string
  estado: EstadoLicao
  tentativas: number
  dicaMaxima: number
  usouIa: boolean
  xpGanho: number
  semAjuda: boolean
}

export type ResumoLicao = {
  id: string
  titulo: string
  nivel: Nivel
  ordem: number
  xp: number
  capstone: boolean
  capacidade: string
  prereqs: string[]
  desbloqueada: boolean
  progresso: ProgressoLicao | null
}

export type Trilha = {
  id: string
  titulo: string
  resumo: string
  ordem: number
  icone: string
  fase: number
  capacidades: Partial<Record<Nivel, string>>
  licoes: ResumoLicao[]
}

export type Licao = {
  id: string
  trilha: string
  nivel: Nivel
  ordem: number
  titulo: string
  capacidade: string
  objetivo_md: string
  xp: number
  capstone: boolean
  prereqs: string[]
  desbloqueada: boolean
  cards_revisao: string[]
  lab: {
    imagem: string
    usuario: string
    workdir: string
    limites: {
      cpus: number
      memoriaMb: number
      pids: number
      rede: string
      capacidadesExtras: string[]
    }
    quebraConserta: boolean
  }
  checks: { indice: number; descricao: string }[]
  dicas: {
    total: number
    custos: number[]
    reveladas: { nivel: number; texto: string }[]
  }
  progresso: ProgressoLicao | null
}

export type LabInfo = {
  id: string
  containerId: string
  licaoId: string
  imagem: string
  usuario: string
  workdir: string
  estado: 'subindo' | 'pronto' | 'erro' | 'destruido'
  criadoEm: number
  ultimaAtividade: number
  resets: number
  limites: Licao['lab']['limites']
  erro?: string
}

export type NoArvore = {
  nome: string
  caminho: string
  tipo: 'diretorio' | 'arquivo' | 'link' | 'outro'
  tamanho: number
  permissoes: string
  dono: string
  filhos: NoArvore[]
}

export type Recursos = {
  cpuPercent: number
  memoriaUsadaMb: number
  memoriaLimiteMb: number
  pids: number
}

export type EstadoDoLab = {
  raiz: string
  arvore: NoArvore | null
  truncada: boolean
  recursos: Recursos | null
  atualizadoEm: number
}

export type CategoriaDeErro =
  | 'sintaxe'
  | 'ferramenta_errada'
  | 'flag_errada'
  | 'permissao'
  | 'conceitual'
  | 'config_nao_recarregada'

export type ErroDetectado = {
  origem: 'licao' | 'catalogo'
  id?: string
  titulo: string
  categoria: CategoriaDeErro
  trecho: string
  significa: string
  porque?: string
  investigar?: string
  corrigir?: string
}

export type ResultadoCheck = {
  indice: number
  descricao: string
  aprovado: boolean
  exit: number
  esperadoExit: number
  expirou: boolean
  mensagem?: string
  dicaDiagnostica?: string
  saida: string
}

export type ResumoProgresso = {
  xpTotal: number
  licoesConcluidas: number
  licoesSemAjuda: number
  tentativasTotais: number
  porTrilha: { trilha: string; concluidas: number; xp: number }[]
}

export type ResultadoVerificacao = {
  aprovado: boolean
  checks: ResultadoCheck[]
  errosDetectados: ErroDetectado[]
  duracaoMs: number
  lab: string
  xpCreditado: number
  primeiraConclusao: boolean
  progresso: ProgressoLicao
  resumo: ResumoProgresso
}

export type MomentoIa = 'explicar_erro' | 'revisar_solucao' | 'dica_socratica'

export type EstadoDaIa = {
  ligada: boolean
  disponivel: boolean
  provedor: string
  url: string
  modelo: string
  modelosLocais: string[]
  erro?: string
  sugestao?: string
  momentos: { id: MomentoIa; rotulo: string; permiteComando: boolean }[]
}

export type RespostaDaIa = {
  momento: MomentoIa
  rotulo: string
  texto: string
  modelo: string
  duracaoMs: number
  assistidaPorIa: true
  podado: boolean
  custoXp: number
  licao: Licao
}

export type Verificacao = {
  id: string
  titulo: string
  estado: 'ok' | 'aviso' | 'falha'
  detalhe: string
  correcao?: string
}

export type RelatorioDoctor = {
  pronto: boolean
  verificacoes: Verificacao[]
  em: number
}
