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
  ultimaAtividade: number
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
