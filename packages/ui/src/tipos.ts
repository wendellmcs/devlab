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

export type SituacaoTrilha = 'disponivel' | 'em_breve'

export type Trilha = {
  id: string
  titulo: string
  resumo: string
  ordem: number
  icone: string
  fase: number
  /** `em_breve` = trilha prevista no currículo, sem lições escritas ainda. */
  situacao: SituacaoTrilha
  capacidades: Partial<Record<Nivel, string>>
  licoes: ResumoLicao[]
}

// ── E-G-P: os blocos que acontecem ANTES da tarefa avaliada ────────────────

export type Objetivo = { verbo: string; texto: string }

export type ParteDeComando = {
  trecho: string
  papel: 'comando' | 'opcao' | 'argumento' | 'operador'
  explica: string
}

export type Anatomia = { linha: string; partes: ParteDeComando[] }

/** Transcrição real de terminal, anotada linha a linha. */
export type PassoDemonstrado = { comando: string; saida: string; nota: string }

/** `modelo` é o comando com lacuna; ausente, o aluno monta do zero. */
export type PassoGuiado = { instrucao: string; modelo?: string; resposta: string }

export type PerguntaDeCompreensao = {
  tipo: 'predicao' | 'diagnostico' | 'transferencia'
  pergunta: string
  resposta: string
}

export type Ensino = {
  gancho: string
  objetivos: Objetivo[]
  modelo_mental: string
  anatomia: Anatomia[]
  demonstracao: PassoDemonstrado[]
  pratica_guiada: PassoGuiado[]
  compreensao: PerguntaDeCompreensao[]
}

export type Conceito = { id: string; titulo: string }

/** Bloco 6, no formato fixo de quatro campos. Sem a regex do classificador. */
export type ErroComum = {
  digita: string
  mensagem: string
  causa: string
  conserto: string
  categoria: CategoriaDeErro
}

export type Licao = {
  id: string
  trilha: string
  nivel: Nivel
  ordem: number
  titulo: string
  capacidade: string
  ensino: Ensino
  conceitos: Conceito[]
  erros_comuns: ErroComum[]
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
  /** Última ação DELIBERADA do aluno — a leitura do painel não conta. */
  ultimaAtividade: number
  /** Quantas ações deliberadas o aluno já fez neste lab. */
  acoesDoAluno: number
  resets: number
  limites: Licao['lab']['limites']
  /** Quanto falta para a coleta por ociosidade, no instante da resposta. */
  ociosidadeRestanteMs: number
  /** O TTL configurado no agente, em ms. */
  ttlMs: number
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
  /** Relógio da coleta por ociosidade; viaja junto porque esta é a rota que a
   *  interface já repete a cada 2,5 s. */
  ttl: { restanteMs: number; totalMs: number } | null
  /** Ações deliberadas do aluno neste lab — só o agente sabe contar. */
  acoesDoAluno: number | null
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
