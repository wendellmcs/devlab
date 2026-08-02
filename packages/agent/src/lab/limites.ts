import type Docker from 'dockerode'
import type { ConfigLab } from '../conteudo/schema.ts'

/**
 * Capacidades mínimas de um lab de aprendizado.
 *
 * Tudo é derrubado e só isto volta: o suficiente para criar/mover/apagar
 * arquivos, ajustar dono e permissão, trocar de usuário e matar processos —
 * que é exatamente o que uma trilha de Linux ensina. Fora daqui (NET_ADMIN,
 * NET_RAW, SYS_ADMIN) só entra por declaração explícita da lição, como nos
 * labs de captura de pacote.
 */
export const CAPACIDADES_BASE = [
  'CHOWN',
  'DAC_OVERRIDE',
  'FOWNER',
  'FSETID',
  'SETGID',
  'SETUID',
  'KILL',
] as const

const MB = 1024 * 1024

export function montarHostConfig(lab: ConfigLab): Docker.HostConfig {
  const memoria = lab.limites.memoria_mb * MB
  const extras = lab.capacidades
    .map((c) => c.toUpperCase().replace(/^CAP_/, ''))
    .filter((c) => !(CAPACIDADES_BASE as readonly string[]).includes(c))

  return {
    Memory: memoria,
    // Igual a Memory: o lab não escapa para swap e o limite é o limite.
    MemorySwap: memoria,
    NanoCpus: Math.round(lab.limites.cpus * 1e9),
    PidsLimit: lab.limites.pids,

    // Princípio 6: sem rede externa salvo quando a lição exigir.
    NetworkMode: lab.rede === 'nenhuma' ? 'none' : 'bridge',

    CapDrop: ['ALL'],
    CapAdd: [...CAPACIDADES_BASE, ...extras],
    // A forma com `=true` é a canônica da API do Engine; a string nua funciona
    // por um caso especial legado do daemon.
    SecurityOpt: ['no-new-privileges=true'],

    // Princípio 6: nada do host é montado de forma gravável. Conteúdo entra por cópia.
    Binds: [],

    // O lab é descartável: some junto com o processo.
    AutoRemove: true,
  }
}

/** Resumo legível dos limites, para o indicador de recursos da UI. */
export function descreverLimites(lab: ConfigLab): {
  cpus: number
  memoriaMb: number
  pids: number
  rede: string
  capacidadesExtras: string[]
} {
  const extras = lab.capacidades
    .map((c) => c.toUpperCase().replace(/^CAP_/, ''))
    .filter((c) => !(CAPACIDADES_BASE as readonly string[]).includes(c))
  return {
    cpus: lab.limites.cpus,
    memoriaMb: lab.limites.memoria_mb,
    pids: lab.limites.pids,
    rede: lab.rede === 'nenhuma' ? 'sem rede externa' : 'ponte',
    capacidadesExtras: extras,
  }
}
