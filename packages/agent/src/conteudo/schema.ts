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
  /**
   * Obriga `valida-conteudo.py` a exercitar esta lição DENTRO do container.
   *
   * O validador tem dois motores, e escolhe pela imagem: `devlab/linux-base`
   * roda numa árvore falsa no host, que é o que mantém `npm run valida`
   * utilizável sem Docker. Essa árvore é uma ficção que só se sustenta
   * enquanto o estado medido pela lição são arquivos sob `/home/aluno`.
   *
   * Passando disso ela não falha — ela MENTE, que é pior. A lição que lê
   * `/etc/passwd` recebe o do host (medido: 27 linhas, sem o usuário `aluno`);
   * a que roda `ps` vê os 60 processos da máquina de quem estuda em vez dos 6
   * do lab; e a que mede dono não mede nada, porque `adapta()` apaga toda linha
   * de `chown` — o script roda, o check aprova, e o veredito é sobre outro
   * sistema. Nenhum desses casos produz erro.
   *
   * Quem declara `true` paga ~0,3 s de container e recebe um veredito real. O
   * validador ainda tem uma guarda que reprova o build quando a lição usa uma
   * dessas construções sem declarar isto — esquecer é o modo de falha provável,
   * e ele é silencioso.
   */
  exige_container: z.boolean().default(false),
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

/**
 * Erro comum — bloco 6 do E-G-P, e também o classificador de tempo de execução.
 *
 * Uma lista só, dois usos, de propósito. O `match` é o que reconhece o erro na
 * saída real do terminal; os quatro campos de texto são o que a lição MOSTRA
 * antes de o aluno errar. Separar em duas listas parecia mais limpo e garantia
 * que uma envelhecesse: a lição ensinaria um conserto e o app sugeriria outro
 * para a mesma mensagem.
 *
 * O formato de quatro campos é fixo porque é o que transforma "erros comuns"
 * em diagnóstico: a mensagem sozinha não ensina nada, e a causa sem a mensagem
 * não é localizável quando ela aparece na tela.
 */
const ErroComum = z.object({
  /** Expressão regular casada contra a saída do terminal e dos checks. */
  match: z.string().min(1),
  /** 1. O que você digita — o comando plausível que produz o erro. */
  digita: z.string().min(1),
  /** 2. A mensagem exata, como a ferramenta a emite. Sem parafrasear. */
  mensagem: z.string().min(1),
  /** 3. A causa no modelo mental — por que o computador respondeu isso. */
  causa: z.string().min(1),
  /** 4. O conserto. */
  conserto: z.string().min(1),
  categoria: z.enum(CATEGORIAS_DE_ERRO).default('conceitual'),
})

// ── E-G-P: Ensina → Guia → Pratica ─────────────────────────────────────────
//
// O modelo de dez blocos, sendo que os blocos 1 a 7 acontecem ANTES de
// qualquer tarefa avaliada.
//
// A dívida que ele paga: até aqui a lição tinha `objetivo_md`, `dicas` e
// `verificar` — ou seja, pedia a tarefa e media o resultado, sem nunca
// ensinar. Quem já sabia, passava; quem não sabia, adivinhava o comando ou
// pagava dica. Isso não é curso, é prova. O PRD §5 pede "exemplos resolvidos →
// orientação que desvanece" desde o começo, e é isto.

/**
 * Verbos de Bloom, do concreto ao abstrato.
 *
 * Lista fechada para o objetivo não virar "entender X" — verbo que ninguém
 * sabe verificar, e por isso não vira check. Cada objetivo aqui é uma promessa
 * de comportamento observável.
 */
export const VERBOS_DE_BLOOM = [
  'identificar',
  'descrever',
  'explicar',
  'prever',
  'executar',
  'construir',
  'diagnosticar',
  'comparar',
  'escolher',
  'adaptar',
] as const

const Objetivo = z.object({
  verbo: z.enum(VERBOS_DE_BLOOM),
  texto: z.string().min(1),
})

const PARTES_DE_COMANDO = ['comando', 'opcao', 'argumento', 'operador'] as const

const ParteDeComando = z.object({
  /** O pedaço literal, como aparece na linha. */
  trecho: z.string().min(1),
  papel: z.enum(PARTES_DE_COMANDO),
  explica: z.string().min(1),
})

/** Bloco 4 — anatomia: o que cada pedaço da linha é e faz. */
const Anatomia = z.object({
  linha: z.string().min(1),
  partes: z.array(ParteDeComando).min(2),
})

/**
 * Bloco 5 — demonstração comentada: o *worked example*.
 *
 * `saida` é transcrição REAL, copiada de uma execução no container da lição,
 * não uma saída plausível escrita de cabeça. É o bloco que substitui o
 * "adivinhe o comando": ver alguém resolver antes de tentar sozinho é o achado
 * mais replicado da pesquisa sobre carga cognitiva.
 */
const PassoDemonstrado = z.object({
  comando: z.string().min(1),
  saida: z.string().default(''),
  /** A anotação linha a linha. É ela que faz a demonstração ensinar. */
  nota: z.string().min(1),
})

/**
 * Bloco 7 — prática guiada: a ponte entre ver e fazer.
 *
 * `modelo` é o comando quase dado, com lacuna. É o degrau que faltava: hoje o
 * aluno salta da demonstração direto para a tarefa avaliada, e é exatamente aí
 * que ele para e pede dica.
 */
const PassoGuiado = z.object({
  instrucao: z.string().min(1),
  /** Comando com lacuna (`____`). Ausente = o aluno monta do zero. */
  modelo: z.string().optional(),
  resposta: z.string().min(1),
})

const TIPOS_DE_PERGUNTA = ['predicao', 'diagnostico', 'transferencia'] as const

/**
 * Bloco 9 — verificação de compreensão.
 *
 * Os três tipos são os que colar não resolve: prever a saída, diagnosticar uma
 * mensagem, transferir para um caso que a lição não mostrou. "Qual comando
 * lista arquivos?" seria respondível por quem decorou e não entendeu nada.
 */
const PerguntaDeCompreensao = z.object({
  tipo: z.enum(TIPOS_DE_PERGUNTA),
  pergunta: z.string().min(1),
  resposta: z.string().min(1),
})

const Conceito = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'use kebab-case minúsculo'),
  titulo: z.string().min(1),
})

/**
 * O que esta lição INTRODUZ. É a declaração que o validador cobra.
 *
 * Sem isto, "ensina antes de pedir" é promessa de prosa. Com isto, o
 * `valida-conteudo.py` reprova o build quando uma lição usa um comando ou
 * referencia um conceito que nenhuma lição anterior no grafo de pré-requisitos
 * ensinou.
 */
const Ensina = z.object({
  /**
   * Teto de três conceitos novos por lição.
   *
   * Memória de trabalho real é 4±1 itens, e parte dela já está ocupada com o
   * terminal, a sintaxe e o próprio nervosismo. A quarta ideia nova de uma
   * lição não é aprendida — ela desloca a primeira.
   */
  conceitos: z.array(Conceito).max(3).default([]),
  /** Comandos que esta lição apresenta pela primeira vez. */
  comandos: z.array(z.string().min(1)).default([]),
})

const Ensino = z.object({
  /** 1. Gancho — cenário real de suporte. Não abstração. */
  gancho: z.string().min(1),
  /** 2. Objetivos observáveis. */
  objetivos: z.array(Objetivo).min(2).max(5),
  /** 3. Modelo mental — a *notional machine*. O bloco que mais faltava. */
  modelo_mental: z.string().min(1),
  /** 4. Anatomia. */
  anatomia: z.array(Anatomia).default([]),
  /** 5. Demonstração comentada, com saída real. */
  demonstracao: z.array(PassoDemonstrado).default([]),
  /** 7. Prática guiada. Some no nível engenheiro — ver o superRefine da lição. */
  pratica_guiada: z.array(PassoGuiado).max(4).default([]),
  /** 9. Verificação de compreensão. */
  compreensao: z.array(PerguntaDeCompreensao).max(3).default([]),
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

  /** Blocos 1 a 7 e 9 do E-G-P. Tudo o que acontece ANTES da tarefa avaliada. */
  ensino: Ensino,
  /** Conceitos e comandos que esta lição introduz. Ver `Ensina`. */
  ensina: Ensina.default({}),

  /** Bloco 8 — prática independente: a tarefa que vale XP. */
  objetivo_md: z.string().min(1),

  verificar: z.array(Check).min(1, 'toda lição precisa de ao menos um check'),

  /** Escada de três níveis. Vazio = tarefa sem ajuda (nível engenheiro, capstone). */
  dicas: z.array(z.string().min(1)).max(3).default([]),
  erros_comuns: z.array(ErroComum).default([]),
  /**
   * Bloco 10 — cartão de revisão. Referencia por id os conceitos de `ensina`
   * desta lição ou de uma anterior no grafo; `valida-conteudo.py` cobra isso.
   */
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
}).superRefine((licao, ctx) => {
  const exigir = (condicao: boolean, caminho: string[], mensagem: string): void => {
    if (!condicao) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: caminho, message: mensagem })
    }
  }

  /**
   * Fading do andaime por nível — *expertise reversal effect*.
   *
   * O mesmo bloco que sustenta o operador atrapalha o engenheiro: quem já tem
   * o esquema formado gasta memória de trabalho reconciliando a explicação com
   * o que já sabe, e aprende MENOS do que aprenderia sem ela. Não é questão de
   * gosto nem de economia de texto — é efeito medido.
   *
   * Por isso o andaime não é opcional embaixo nem permitido em cima: no nível
   * operador a demonstração e a prática guiada são obrigatórias, e no nível
   * engenheiro a prática guiada é proibida.
   */
  if (licao.nivel === 'operador' && !licao.capstone) {
    exigir(
      licao.ensino.demonstracao.length > 0,
      ['ensino', 'demonstracao'],
      'lição de operador precisa de demonstração comentada (bloco 5): é o exemplo resolvido que substitui o "adivinhe o comando"',
    )
    exigir(
      licao.ensino.pratica_guiada.length > 0,
      ['ensino', 'pratica_guiada'],
      'lição de operador precisa de prática guiada (bloco 7): é a ponte entre ver resolvido e resolver sozinho',
    )
  }

  // O capstone é o ponto em que o andaime sai — inclusive no nível operador.
  // Ele existe para medir se a pessoa integra sozinha o que aprendeu solto; um
  // passo a passo ali mediria a capacidade de seguir passo a passo.
  if (licao.nivel === 'engenheiro' || licao.capstone) {
    exigir(
      licao.ensino.pratica_guiada.length === 0,
      ['ensino', 'pratica_guiada'],
      licao.capstone
        ? 'capstone não leva prática guiada: ele mede integração sem ajuda, e um passo a passo mediria outra coisa'
        : 'lição de engenheiro não leva prática guiada: andaime demais atrapalha quem já tem o esquema formado',
    )
  }

  // "No máximo 5 flags" por anatomia: passar disso deixa de dissecar um
  // comando e vira transcrição de man page.
  licao.ensino.anatomia.forEach((a, i) => {
    const opcoes = a.partes.filter((p) => p.papel === 'opcao').length
    exigir(
      opcoes <= 5,
      ['ensino', 'anatomia', String(i)],
      `anatomia dissecando ${opcoes} opções; o teto é 5`,
    )
  })
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
  /**
   * Trilha sem lições ainda escritas aparece no mapa como "em breve".
   *
   * Mostrar o caminho inteiro é decisão pedagógica, não vitrine: sem isso o
   * aluno abre o app, vê uma trilha só e conclui que o produto acabou — em vez
   * de entender que está no começo de uma jornada de dez. A honestidade está
   * no rótulo: o que não existe é dito que não existe, em vez de escondido.
   */
  situacao: z.enum(['disponivel', 'em_breve']).default('disponivel'),
  /** Declaração de capacidade por nível, mostrada na skill tree. */
  capacidades: z.record(z.enum(NIVEIS), z.string()).default({}),
})

export type Trilha = z.infer<typeof TrilhaSchema>
