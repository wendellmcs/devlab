# Prompt — DevLab: nova interface e novo modelo de conteúdo, a padrão AAA

## Missão

Reconstrua **a interface e o modelo de conteúdo** do DevLab, um curso + oficina
prática de infraestrutura e telefonia IP onde o aluno resolve exercícios num
container Docker real.

Duas falhas de fundo a corrigir:

1. **A interface é protótipo.** Rola sem fim, não separa os módulos, não tem
   área do aluno e não tem navegação de volta utilizável.
2. **O curso não ensina.** A lição já chega pedindo a tarefa — "crie
   `saudacao.txt` com o texto X" — assumindo que o aluno conhece `echo` e `>`.
   As dicas só socorrem quem travou. Quem nunca viu um terminal não tem por
   onde começar.

O alvo é o padrão dos maiores players de educação técnica, do **completo
iniciante ao avançado**, com explicação de verdade antes da prática.

Isto é reconstrução no lugar: mesmo repositório, mesmo agente, mesmo contrato
de API. O que muda é `packages/ui/src`, o schema de conteúdo e `content/`.

---

## Contexto técnico que você herda

- **Stack:** React 19 + TypeScript + Vite. Sem framework de CSS: 1166 linhas de
  `styles.css` escritas à mão.
- **Servida pelo agente Node** em `http://127.0.0.1:7788`, mesma origem da API.
  Sem backend separado, sem CDN — tudo funciona **offline**, servido de
  `packages/ui/dist`.
- **Terminal real:** `xterm.js` sobre WebSocket (`/ws/pty`), um `docker exec -t`
  por aba. É o coração do produto.
- **Conteúdo em YAML** sob `content/`, validado por `zod` em
  `packages/agent/src/conteudo/schema.ts` e por `scripts/valida-conteudo.py`,
  que **executa os checks numa árvore falsa** e exige que reprovem antes da
  solução e aprovem depois.
- **Idioma:** português do Brasil. Comandos, flags e mensagens de erro em inglês.
- **API existente e estável:** `GET /api/trilhas`, `GET /api/licoes/:id`,
  `POST /api/licoes/:id/dica`, `GET|POST /api/labs`,
  `POST /api/labs/:id/verificar`, `POST /api/labs/:id/reset`,
  `DELETE /api/labs/:id`, `GET /api/labs/:id/estado`, `GET /api/progresso`,
  `GET /api/erros`, `GET /api/doctor`, `GET|POST /api/ia/*`, `WS /ws/pty`.

### Não-negociáveis — quebrar qualquer um reprova a entrega

1. **Sem dependência nativa.** Nada de `node-gyp`, compilador ou binário por
   plataforma.
2. **Sem rede em tempo de execução.** Nenhuma fonte de CDN, ícone remoto ou
   telemetria. O DevLab roda offline.
3. **O terminal continua real.** Nada de simular ou gravar o shell.
4. **Uma porta, uma origem.** Sem servidor próprio, sem proxy.
5. **Verificação por ESTADO, nunca por texto digitado.** Os checks inspecionam o
   container. Nenhum conteúdo novo pode olhar o histórico de comandos.
6. **As dicas não reveladas não trafegam.** O custo em XP é real; se o texto
   chegar ao browser antes de comprado, vira encenação.
7. **`prefers-reduced-motion` respeitado de verdade.**

---

## PARTE 1 — Modelo de conteúdo e pedagogia

Esta parte vem **antes** da interface: a interface é a apresentação do conteúdo,
e desenhar tela para um modelo de conteúdo errado é retrabalho garantido.

### O problema

A lição hoje tem: `objetivo_md` (a tarefa), `dicas` (escada de 3 degraus),
`verificar` (os checks), `erros_comuns`, `cards_revisao`. **Não existe campo de
ensino.** O `objetivo_md` de 3 linhas é tudo que o aluno recebe antes de ter que
produzir.

### O que exigir

Um modelo de lição que **ensine, demonstre e só então peça prática**. Proponha
a estrutura concreta (é entregável da fase de design), atendendo a estes
requisitos:

- **Motivação**: por que isso importa no trabalho real. O projeto já acerta o
  tom no capstone ("chegou o chamado 1042"); leve isso para todas as lições.
- **Conceito**: modelo mental antes de sintaxe. O que o computador está fazendo,
  não só que letras digitar. Analogia quando ajudar.
- **Anatomia**: dissecar o comando — executável, opção, argumento, e o que cada
  parte faz. Um aluno que só decora `ls -lah` não sabe ler `tar -xzvf`.
- **Demonstração comentada**: exemplo completo com a saída esperada, explicada
  linha a linha. O aluno vê funcionar antes de tentar.
- **Prática**: o exercício (o que existe hoje).
- **Verificação**: os checks (o que existe hoje).
- **Aprofundamento opcional**: o que acontece por baixo, casos de borda, `man`
  relevante. Para quem quer mais, sem travar quem não quer.
- **Consolidação**: o que você aprendeu, erros comuns *com a explicação do
  porquê*, cards de revisão.

Regras de qualidade:

- **Nenhum conceito usado antes de ensinado.** Isso precisa ser
  **verificável por script**: cada lição declara os conceitos/comandos que
  introduz, e o validador falha se uma lição usa algo que nenhuma lição anterior
  no grafo de pré-requisitos introduziu. Sem isso, a promessa é papel.
- **Carga cognitiva controlada**: poucos conceitos novos por lição. Defina o
  teto e justifique.
- **Explicação não é opcional nem é dica.** Dica continua custando XP; ensino é
  de graça e vem antes.
- **Continua tudo em YAML**, fora do código. Escrever lição não pode exigir
  recompilar a aplicação — é princípio do projeto e o que faz as trilhas caberem.

### Currículo: do zero ao avançado

Hoje existe uma trilha (Linux · Operador, 12 lições, 242 XP). O alvo é a escada
completa. Proponha e implemente:

- **Níveis nomeados** com fronteira clara (o projeto já prevê Operador,
  Construtor, Engenheiro) — o que define a passagem de um para o outro.
- **Sequência de tópicos por nível**, do "nunca abri um terminal" até
  administração de verdade: navegação, arquivos, permissões, processos, texto e
  pipes, usuários, pacotes, serviços/systemd, rede, logs, disco, shell script,
  diagnóstico.
- **Quantidade de lições por nível** e estimativa de tempo.
- **Capstone por nível**, no formato integrativo que o projeto já usa.
- Manter o **portão de pré-requisitos** (DAG) e o **XP ponderado por
  dificuldade** que já existem.

Cada lição nova precisa passar em `npm run valida` — inclusive na execução real
dos checks contra a árvore falsa, com solução de referência.

### Contra a cola

O modelo atual já tem defesas boas (verificação por estado, dica custa XP, refazer
não rende XP, IA nunca vê a solução). Some a elas o que a pesquisa recomendar
para **retenção**, não só para detecção — repetição espaçada sobre os
`cards_revisao` é o caminho previsto no projeto (SM-2).

---

## PARTE 2 — Interface

### Os problemas concretos

| # | Problema | Evidência hoje |
|---|---|---|
| 1 | Sem navegação de volta usável | `BarraSuperior.tsx:45` tem um *toggle* rotulado "← Voltar à lição" quando você está na lista — rótulo invertido, e não é navegação |
| 2 | Rolagem infinita | não há app shell; o `<body>` rola e os painéis vão junto |
| 3 | Módulos sem definição | trilha → nível → lição não se distinguem; o aluno não sabe onde está nem quanto falta |
| 4 | Sem área do aluno | `GET /api/progresso` devolve XP, autonomia, conclusões e histórico de erros, e **nada disso tem tela** |
| 5 | Sem landmarks nem skip link | zero `<nav>`; `<main>` só na tela de erro |
| 6 | Hierarquia de cabeçalhos quebrada | `<h1>` disputado entre componentes |
| 7 | Nenhum lugar para o conteúdo de ensino | o painel de objetivo foi desenhado para 3 linhas de tarefa |

### App shell, não documento

Altura fixa (`100dvh`). **O `<body>` nunca rola.** Cada região rola por conta
própria, com indicação visual de que há mais conteúdo.

### Navegação — três níveis, sempre visíveis

```
Trilha (Linux)  ›  Nível (Operador)  ›  Lição 3 de 12 · Caminhos
```

- **Breadcrumb real** (`<nav aria-label="Trilha de navegação">` + `<ol>`), item
  atual com `aria-current="page"`. Atende WCAG 2.4.8 (AAA) e resolve o problema
  #1 de raiz — com orientação permanente, não com um botão escondido.
- **Voltar explícito** que nomeia o destino ("Voltar para Linux · Operador").
- **Anterior / Próxima lição**, respeitando o portão de pré-requisitos —
  `desbloqueada: false` precisa comunicar **por que** está travada.
- **Rota no URL**, para o botão voltar do navegador funcionar. Roteamento
  client-side leve; o servidor já faz fallback de SPA.

### Mapa da trilha — resolve #3

Progressão legível, não lista. Cada lição mostra sem clique: estado (bloqueada /
disponível / concluída / concluída sem ajuda), XP e o pré-requisito que falta.
Agrupada por **nível**, com cabeçalho e progresso do nível. Capstone distinto.

### Tela da lição — resolve #7

Precisa comportar **conteúdo longo de ensino** e o exercício sem virar rolagem
infinita. O enunciado atual (3 linhas) vai virar várias telas de texto, exemplo
e anatomia de comando. Proponha a estrutura: seções recolhíveis, sub-abas
(Aprender / Praticar / Aprofundar), ou progressão guiada. Justifique a escolha —
e garanta que o terminal continue alcançável enquanto o aluno lê.

Três regiões: objetivo/ensino · terminal real · estado ao vivo do container.
Divisórias **redimensionáveis pelo teclado** (`role="separator"`,
`aria-valuenow`, setas ajustam).

### Área do aluno — resolve #4

Tela própria, alimentada por `GET /api/progresso`:

- XP total e por trilha; **Autonomia** (% resolvido sem ajuda) com explicação do
  que significa — é a métrica que o projeto valoriza mais que XP.
- Conclusões, tentativas, e o **histórico de erros** virando material de estudo:
  "você tropeçou 4× em *Permission denied*", com link para o catálogo
  (`GET /api/erros`).
- Cards de revisão acumulados, com a revisão espaçada quando existir.
- Resumo do ambiente (`GET /api/doctor`) e da camada de IA.

Não invente dado que a API não devolve. Se faltar campo, proponha.

### Padrão visual e conforto

- **Design system em tokens** (`--cor-*`, `--espaco-*`, `--raio-*`, `--tipo-*`),
  escala de espaçamento 4/8px, escala tipográfica modular. Sem valores mágicos.
- **Tema claro e escuro**, ambos completos e ambos AAA — não um modo escuro com
  contraste pior. Respeita `prefers-color-scheme` e oferece alternância manual
  persistida.
- **≤ 80 caracteres por linha** no texto de lição; entrelinha ≥ 1.5;
  espaçamento entre parágrafos ≥ 1.5× a entrelinha (WCAG 1.4.8 AAA). Isso vale
  em dobro agora que há texto longo.
- **Ajuste de fonte** (80%–160%) continua funcionando, inclusive no terminal,
  **sem derrubar a sessão** — isso foi corrigido; não regrida.
- **Estados nunca só por cor** (1.4.1): aprovado/reprovado/bloqueado levam ícone
  ou texto.
- **Código dentro do texto de ensino**: realce de sintaxe legível a 7:1, com o
  bloco rolando dentro do próprio contêiner, e o botão de inserir no terminal
  que já existe (insere sem executar — quem aperta Enter é o aluno).
- **Erros com saída.** O agente devolve `codigo` e `sugestao` em quase tudo; use.

### Responsividade — **desktop apenas**

Alvos: **1024px**, **1280px**, **1440px**, **1920px+**. Abaixo de 1024px a
interface exibe um aviso claro de que o DevLab exige tela maior, em vez de
degradar mal. Sem tentativa de layout para celular ou tablet.

Isso **não** dispensa: zoom 200% sem rolagem horizontal (WCAG 1.4.10 e 1.4.8
AAA), testado a 320px de largura efetiva — que é requisito de acessibilidade,
não de responsividade, e continua obrigatório.

---

## PARTE 3 — Acessibilidade AAA: o que exatamente isso significa aqui

Alvo: **WCAG 2.2, nível AAA**, com os critérios abaixo explicitamente atendidos.
Não escreva "AAA" sem cumprir a lista.

| Critério | O que exige aqui |
|---|---|
| **1.4.6** Contraste (Melhorado) | **7:1** texto normal, **4.5:1** texto grande — nos DOIS temas, incluindo hover/focus/disabled e o realce de sintaxe |
| **1.4.8** Apresentação visual | ≤80 caracteres por linha, entrelinha 1.5, sem justificar, cores ajustáveis, 200% sem rolagem horizontal |
| **1.4.9** Imagens de texto | nenhum texto dentro de imagem |
| **2.1.3** Teclado (Sem Exceção) | tudo operável por teclado, incluindo redimensionar painéis e sair do terminal |
| **2.2.3** Sem tempo | nenhum limite de tempo na interface |
| **2.2.6** Timeout | o lab morre por TTL de 45 min — **avise antes** e ofereça manter vivo; perder trabalho em silêncio reprova |
| **2.3.3** Animação por interação | toda animação não essencial desligável |
| **2.4.8** Localização | breadcrumb + posição na trilha |
| **2.4.9** Finalidade do link (só o link) | o texto do link basta; nada de "clique aqui" |
| **2.4.12** Foco não obscurecido | o item focado nunca fica atrás de barra fixa ou painel |
| **2.4.13** Aparência do foco | ≥2px, contraste ≥3:1 contra adjacente, envolvendo o componente |
| **2.5.5** Tamanho do alvo | **44×44 CSS px** mínimo |
| **3.1.3 / 3.1.4** Termos e abreviações | glossário para jargão de infra (PTY, cgroup, TTL, SIP) e `<abbr>` na primeira ocorrência — **isso vira parte do conteúdo de ensino** |
| **3.1.5** Nível de leitura | enunciados legíveis por quem está começando; jargão explicado na primeira aparição |
| **3.2.5** Mudança sob demanda | nada muda de contexto sozinho |
| **3.3.5** Ajuda | ajuda contextual acessível de qualquer tela |
| **3.3.6** Prevenção de erro (Todos) | resetar e destruir lab confirmam e explicam o que se perde |

**Dispensados, com justificativa obrigatória no relatório:** `1.2.6` (língua de
sinais), `1.2.7`, `1.2.8`, `1.2.9`, `1.4.7` — não há mídia nem áudio no produto.
Se isso mudar, voltam a valer.

### Estrutura semântica

Um `<h1>` por tela, hierarquia sem pular níveis. Landmarks (`<header>`, `<nav>`,
`<main>`, `<aside>`) rotulados quando houver mais de um. **Skip links** para
conteúdo e para o terminal. `aria-live="polite"` no resultado da verificação
(`assertive` só para erro que interrompe). Foco gerenciado: ao abrir lição vai
para o `<h1>`; ao fechar diálogo volta para quem abriu.

### O terminal — o ponto mais difícil, com o conflito já medido

- Ligue `screenReaderMode` do `xterm.js` e verifique que a saída é anunciada.
- O terminal **não pode prender o teclado** (já corrigido: `Esc` devolve o foco,
  com botões de entrada e saída). Mantenha e teste.
- Documente o que é conteúdo gerado pelo shell (fora do controle da aplicação) e
  o que é responsabilidade da interface.

#### A paleta ANSI a 7:1 — restrição medida, não hipótese

Foi calculado o contraste WCAG das 16 cores ANSI padrão. Resultado:

| Fundo | Cores que REPROVAM em 7:1 |
|---|---|
| escuro (`#0f1216`) | **8 de 16** — red, blue, magenta, black e os quatro *bright* correspondentes |
| claro (`#ffffff`) | **14 de 16** — só `black` e `blue` passam |

E o problema não é só elevar contraste: **corrigir ingenuamente destrói a
distinção normal/bright** que os programas de terminal usam como informação.
Ajustando só a luminosidade até bater 7:1, colidem:

- no tema escuro: `black`≡`brightBlack`, `red`≡`brightRed`, `blue`≡`brightBlue`,
  `magenta`≡`brightMagenta` — 4 pares viram a mesma cor;
- no tema claro: pior — `white`, `brightWhite` e `brightBlack` **colapsam todos
  em `#595959`**, e mais 5 pares colidem. Um programa que imprime "branco
  brilhante" para destacar produz cinza médio idêntico ao cinza de comentário.

**Portanto, a paleta é um problema de otimização com duas restrições
simultâneas**, e a entrega precisa satisfazer as duas:

1. contraste ≥ 7:1 contra o fundo do terminal;
2. diferença perceptível entre cada par normal/bright (defina o limiar — ΔE ou
   razão de contraste entre os dois — e prove que passa).

**Recomendação:** manter o **terminal com fundo escuro nos dois temas**. É o que
ferramentas profissionais fazem (o terminal do VS Code em tema claro costuma
seguir escuro), preserva a convenção de cor que o aluno vai encontrar no
trabalho, e evita o colapso de três cores em uma. Se a decisão for terminal
claro, o remapeamento semântico de `white`/`brightWhite` precisa ser explícito e
documentado — não pode ser efeito colateral silencioso.

O script que produziu estes números deve ser versionado e virar o teste de
contraste que falha o build (critério de aceite 2).

---

## Referências de mercado

Estude e cite o que aproveitou de cada uma; entenda a decisão, não copie o visual.

- **Boot.dev**, **Exercism**, **KodeKloud**, **Instruqt/Katacoda** — exercício com
  terminal real ao lado do enunciado.
- **Linux Journey**, **The Missing Semester (MIT)**, **Linux Upskill Challenge** —
  como se ensina linha de comando do zero com profundidade.
- **Duolingo** — mapa de progressão e portão de pré-requisito sem infantilizar.
- **Frontend Masters**, **Codecademy** — hierarquia curso → módulo → lição.
- **GitHub Codespaces**, **VS Code Web** — painéis redimensionáveis, densidade.
- **GOV.UK Design System**, **USWDS** — como se atinge AAA de verdade.

---

## Critérios de aceite — é isto que define "pronto"

Nada de autoavaliação subjetiva. Todos precisam passar.

**Interface e acessibilidade**

1. **axe-core**: 0 violações em todas as telas, nos dois temas. Automatizado.
   **Feito** — `npm run a11y:axe`, 7 telas × 2 temas, com a regra
   `color-contrast-enhanced` ligada e um auto-teste que reprova o harness se ela
   não estiver rodando. Tamanho de alvo (2.5.5) e refluxo (1.4.10) são medidos
   fora do axe, porque as regras dele param no AA.
2. **Contraste**: script que extrai todos os pares de token e prova ≥7:1 (texto
   normal) e ≥4.5:1 (texto grande), nos dois temas, **falhando o build**. Inclui
   a paleta ANSI do terminal e o realce de sintaxe.
3. **Lighthouse**: Acessibilidade 100; Melhores Práticas ≥95.
4. **Teclado**: roteiro escrito percorrendo criar lab → ler a lição → resolver →
   verificar → dica → resetar → voltar → área do aluno **sem tocar no mouse**,
   sem armadilha de foco e sem foco invisível. Executado e registrado.
5. **Leitor de tela**: passagem com NVDA ou Orca no fluxo principal, com as
   falhas encontradas e corrigidas listadas.
6. **Zoom**: 200% e largura efetiva de 320px sem rolagem horizontal.
7. **Alvos**: nenhum controle interativo abaixo de 44×44 px.
8. **`prefers-reduced-motion`**: com a preferência ligada, nenhuma animação de
   movimento roda.
9. **Offline**: o bundle não faz nenhuma requisição externa. Verificado na aba
   de rede.

**Conteúdo**

10. **`npm run valida` passa** para toda lição nova, incluindo a execução real
    dos checks (reprovam antes da solução, aprovam depois).
11. **Verificador de pré-requisito de conceito**: script que falha se uma lição
    usa comando ou conceito que nenhuma lição anterior no DAG introduziu.
12. **Toda lição tem conteúdo de ensino** antes da prática — verificado por
    schema, não por inspeção humana.

**Regressão**

13. `npm run tipos`, `npm run teste`, `npm run teste:integracao` e
    `npm run fumaca` continuam passando. O loop central não pode quebrar.

---

## Entregáveis

1. **Proposta de design aprovada antes do código**: arquitetura de informação,
   modelo de lição, tokens e 2–3 direções visuais. Não escreva componente antes
   disso.
2. `packages/ui/src` reconstruído, tipos limpos, build passando.
3. **Schema de conteúdo estendido** (`conteudo/schema.ts`) + validador
   atualizado, incluindo o verificador de pré-requisito de conceito.
4. **Currículo**: trilha Linux do zero ao avançado, com as lições escritas em
   YAML e passando na validação.
5. **Documento de design system**: tokens, escalas, componentes e a decisão por
   trás de cada um, com o que veio de qual referência.
6. **Relatório de conformidade AAA**: critério por critério, com evidência.
   Dispensados com justificativa.
7. **Testes automatizados** de acessibilidade no CI, incluindo o verificador de
   contraste que falha o build.
8. **Roteiro de teste manual** (teclado e leitor de tela) versionado.
   **Parcial** — `docs/ROTEIRO-TECLADO.md` existe e a metade mecânica dele roda
   sozinha (`npm run a11y:teclado`). A passagem com leitor de tela real segue
   pendente e está registrada lá como pendente, não como feita.

---

## Como trabalhar

- **Conteúdo antes de tela.** O modelo de lição decide o layout, não o contrário.
- Entregue em fatias verificáveis: modelo de conteúdo → shell + navegação → mapa
  da trilha → tela da lição → área do aluno → currículo completo. Cada fatia com
  seus critérios atendidos.
- Quando um critério AAA conflitar com a usabilidade — acontece, 7:1 restringe
  muito a paleta — **traga o conflito com opções**, não decida em silêncio.
