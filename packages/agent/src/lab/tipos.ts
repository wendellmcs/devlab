export type EstadoLab = 'subindo' | 'pronto' | 'erro' | 'destruido'

export type LabInfo = {
  id: string
  containerId: string
  licaoId: string
  imagem: string
  usuario: string
  workdir: string
  estado: EstadoLab
  criadoEm: number
  /**
   * Quando o ALUNO mexeu no lab pela última vez.
   *
   * "Atividade" aqui é ação deliberada — digitar no terminal, verificar,
   * resetar, pedir para manter vivo. NÃO é o app perguntando alguma coisa ao
   * container. A distinção não é acadêmica: o painel de estado lê a árvore de
   * arquivos a cada 2,5 s, e enquanto essa leitura contava como atividade o
   * relógio de ociosidade era zerado a cada 2,5 s. O TTL de 45 min nunca
   * disparava com a tela aberta, e nenhum aviso construído sobre este campo
   * apareceria uma única vez.
   */
  ultimaAtividade: number
  /**
   * Ações deliberadas do aluno neste lab.
   *
   * Serve para distinguir "abri a lição e voltei" de "trabalhei aqui" — só o
   * segundo caso justifica interromper quem está saindo com uma confirmação.
   */
  acoesDoAluno: number
  /** Quantas vezes este lab foi reiniciado nesta sessão. */
  resets: number
  limites: {
    cpus: number
    memoriaMb: number
    pids: number
    rede: string
    capacidadesExtras: string[]
  }
  erro?: string
}

/**
 * O que sai pela API: o lab mais o relógio da coleta por ociosidade.
 *
 * O tempo restante é RELATIVO de propósito. Mandar o instante da expiração
 * obrigaria o browser a subtrair do relógio dele, e os dois relógios não são o
 * mesmo — num app que avisa "faltam 5 minutos" antes de destruir trabalho, um
 * desvio de relógio vira aviso que chega tarde. Relativo não tem esse modo de
 * falha, e é calculado no instante da resposta.
 */
export type LabComPrazo = LabInfo & {
  /** Quanto falta para a coleta por ociosidade, em ms, no momento da resposta. */
  ociosidadeRestanteMs: number
  /** O TTL configurado, em ms — é o "45 minutos" que a interface anuncia. */
  ttlMs: number
}

export type ResultadoExec = {
  /**
   * Código de saída do processo. Fora da faixa POSIX 0–255 quando não houve
   * código: 124 = estourou o tempo, -1 = não foi possível determinar.
   */
  exit: number
  stdout: string
  stderr: string
  /** true quando o comando estourou o tempo e foi interrompido. */
  expirou: boolean
  /**
   * true quando o daemon não informou o código de saída — lab destruído no
   * meio, socket caído. Nunca deve ser tratado como sucesso.
   */
  indeterminado: boolean
}

export type Recursos = {
  cpuPercent: number
  memoriaUsadaMb: number
  memoriaLimiteMb: number
  pids: number
}
