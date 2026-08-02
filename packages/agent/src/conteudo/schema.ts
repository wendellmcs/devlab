import { z } from 'zod'

/**
 * Modelo de conteúdo declarativo.
 *
 * As chaves ficam em português porque o conteúdo é escrito por quem ensina,
 * não por quem programa — comandos e termos técnicos seguem em inglês.
 */

export const CATEGORIAS_DE_ERRO = [
  'sintaxe',
  'ferramenta_errada',
  'flag_errada',
  'permissao',
  'conceitual',
  'config_nao_recarregada',
] as const

export const NIVEIS = ['operador', 'construtor', 'engenheiro'] as const

/**
 * Capacidades que uma lição pode pedir além do conjunto mínimo.
 *
 * A lista é o que as trilhas planejadas realmente precisam: captura de pacote
 * e firewall (NET_ADMIN, NET_RAW), depuração (SYS_PTRACE), prioridade de
 * processo (SYS_NICE) e log de auditoria (AUDIT_WRITE). Ficam de fora, por
 * decisão explícita, as que dão o host: SYS_ADMIN, SYS_MODULE, SYS_RAWIO,
 * DAC_READ_SEARCH, BPF e o coringa ALL.
 */
export const CAPACIDADES_PERMITIDAS = [
  'NET_ADMIN',
  'NET_RAW',
  'NET_BIND_SERVICE',
  'SYS_PTRACE',
  'SYS_NICE',
  'AUDIT_WRITE',
] as const

const Limites = z.object({
  cpus: z.number().positive().max(8).default(1),
  memoria_mb: z.number().int().positive().max(8192).default(512),
  pids: z.number().int().positive().max(4096).default(256),
})

const Lab = z.object({
  /** Imagem única. Labs multi-container (compose) chegam na Fase 3. */
  imagem: z.string().min(1).default('devlab/linux-base:1.0.0'),
  /** Usuário do shell do aluno. Checks e setup rodam sempre como root. */
  usuario: z.string().min(1).default('aluno'),
  workdir: z.string().startsWith('/').default('/home/aluno'),
  /**
   * Princípio 6: sem rede externa por padrão. Só a lição que precisar habilita —
   * decisão pedagógica e de segurança ao mesmo tempo.
   */
  rede: z.enum(['nenhuma', 'ponte']).default('nenhuma'),
  /**
   * Capacidades extras, de uma lista fechada.
   *
   * Não é string livre de propósito. O conteúdo é YAML solto em `content/`, o
   * projeto convida a escrever lição sem recompilar nada, e uma lição com
   * `capacidades: [SYS_MODULE]` carregaria um módulo de kernel — ou seja,
   * comprometeria o host inteiro. `ALL` anularia o CapDrop logo acima.
   * Quem precisar de algo fora daqui muda o código e assume a decisão.
   */
  capacidades: z.array(z.enum(CAPACIDADES_PERMITIDAS)).default([]),
  /** Teto de CPU, memória e PIDs. Um lab não pode derrubar a máquina do aluno. */
  limites: Limites.default({}),
  /** Roda como root logo após subir o container. Prepara o estado inicial. */
  setup: z.string().optional(),
  /** Injeção de falha, para labs quebra/conserta. Roda depois do setup. */
  break: z.string().optional(),
})

const Check = z
  .object({
    descricao: z.string().min(1),
    tipo: z.literal('script').default('script'),
    /** Corpo do script, embutido na lição. */
    script: z.string().min(1).optional(),
    /** Alternativa: caminho de um script já presente na imagem. */
    run: z.string().min(1).optional(),
    esperado_exit: z.number().int().min(0).max(255).default(0),
    /** Mostrado quando o check reprova e o script não emitiu diagnóstico próprio. */
    dica_diagnostica: z.string().optional(),
  })
  .superRefine((valor, ctx) => {
    const temScript = typeof valor.script === 'string'
    const temRun = typeof valor.run === 'string'
    if (temScript === temRun) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "cada check precisa de exatamente um entre 'script' e 'run'",
      })
    }
  })

const ErroComum = z.object({
  /** Expressão regular casada contra a saída do terminal e dos checks. */
  match: z.string().min(1),
  explica: z.string().min(1),
  categoria: z.enum(CATEGORIAS_DE_ERRO).default('conceitual'),
})

export const LicaoSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'use kebab-case minúsculo'),
  trilha: z.string().min(1),
  nivel: z.enum(NIVEIS),
  ordem: z.number().int().nonnegative(),
  titulo: z.string().min(1),
  /** Declaração de capacidade visível ao aluno: "o que eu já sei fazer agora". */
  capacidade: z.string().min(1),

  lab: Lab.default({}),
  objetivo_md: z.string().min(1),

  verificar: z.array(Check).min(1, 'toda lição precisa de ao menos um check'),

  /** Escada de três níveis. Vazio = tarefa sem ajuda (nível engenheiro, capstone). */
  dicas: z.array(z.string().min(1)).max(3).default([]),
  erros_comuns: z.array(ErroComum).default([]),
  cards_revisao: z.array(z.string().min(1)).default([]),

  xp: z.number().int().positive().max(500),
  prereqs: z.array(z.string().min(1)).default([]),

  /**
   * Solução de referência, usada apenas por `scripts/valida-conteudo.py` para
   * provar que os checks reprovam antes e aprovam depois. NUNCA é enviada ao
   * browser. Quando ausente, o validador cai na dica de nível 3.
   */
  solucao_referencia: z.string().optional(),

  /** Capstone/tarefa integrativa conta para o portão de maestria. */
  capstone: z.boolean().default(false),
})

export type Licao = z.infer<typeof LicaoSchema>
export type ConfigLab = z.infer<typeof Lab>
export type CheckLicao = z.infer<typeof Check>
export type ErroComumLicao = z.infer<typeof ErroComum>
export type CategoriaDeErro = (typeof CATEGORIAS_DE_ERRO)[number]
export type Nivel = (typeof NIVEIS)[number]

/** Entrada do catálogo de erros — o ativo central do app. */
export const EntradaCatalogoSchema = z.object({
  id: z.string().min(1),
  trilhas: z.array(z.string().min(1)).default([]),
  /** Assinatura real do erro, como a ferramenta o emite. */
  match: z.string().min(1),
  titulo: z.string().min(1),
  significa: z.string().min(1),
  porque: z.string().min(1),
  investigar: z.string().min(1),
  corrigir: z.string().min(1),
  categoria: z.enum(CATEGORIAS_DE_ERRO),
})

export const CatalogoSchema = z.object({
  versao: z.number().int().positive(),
  erros: z.array(EntradaCatalogoSchema),
})

export type EntradaCatalogo = z.infer<typeof EntradaCatalogoSchema>

export const TrilhaSchema = z.object({
  id: z.string().min(1),
  titulo: z.string().min(1),
  resumo: z.string().min(1),
  ordem: z.number().int().nonnegative(),
  icone: z.string().default('•'),
  fase: z.number().int().nonnegative().default(0),
  /** Declaração de capacidade por nível, mostrada na skill tree. */
  capacidades: z.record(z.enum(NIVEIS), z.string()).default({}),
})

export type Trilha = z.infer<typeof TrilhaSchema>
