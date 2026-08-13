# DevLab — Oficina Prática de Infraestrutura e VoIP

Curso + oficina prática de infraestrutura e telefonia IP, rodando **localmente**
em Linux (no Windows, dentro do WSL2). O software é **de verdade**, em
containers descartáveis; a aplicação é a camada de **curso, verificação e
visualização** por cima dele.

> **Estado atual: Fases 0 e 3 implementadas.** São **41 lições** em três
> trilhas — Linux, Troubleshooting SIP/RTP e FreeSWITCH/PABX —, com **120
> checks** que rodam contra containers de verdade a cada build. O loop central
> está fechado (comando real → verificação por estado → progresso) e não depende
> de IA em nenhum ponto.

---

## O que já existe

| Peça | Situação |
|---|---|
| `devlab-agent` — Lab Manager, PTY Bridge, Verifier Runner, State Extractor, Progress Store | pronto |
| Interface de 3 painéis (objetivo · terminal real · estado ao vivo) | pronta |
| Trilha **Linux · Operador**: 12 lições, 36 checks, capstone | pronta |
| Trilha **Troubleshooting SIP/RTP**, nos três níveis: 18 lições, 50 checks | pronta |
| Trilha **FreeSWITCH/PABX** · Operador e Construtor: 11 lições, 34 checks | pronta |
| Imagens de lab: `linux-base`, `voip-tools` (tshark, sngrep, SIPp) e `freeswitch-lab` (FreeSWITCH 1.10.12 + softphone `pjsua`, compilados do fonte) | prontas |
| XP, custo de dica, portão de pré-requisitos, progresso em SQLite | pronto |
| Catálogo de erros com assinaturas reais | pronto |
| `devlab doctor` · `devlab ia` · `devlab modelo` | pronto |
| Camada de IA opcional (Ollama local **ou** API na nuvem com a sua chave) | pronta — **desligada por padrão**, adiantada da Fase 2 |
| Acessibilidade **WCAG AAA** com portão que reprova o build | pronta |
| FreeSWITCH · Engenheiro; Git, SQL, Docker, Servidores, Kamailio, Asterisk | Fases 1, 2 e 4 |

---

## Compatibilidade

| Ambiente | Situação |
|---|---|
| **Linux nativo** (Ubuntu, Debian, Fedora, Arch…) | suportado |
| **Windows via WSL2** com distro Linux | suportado — instale *dentro* do WSL2 |
| Windows sem WSL2 · macOS | **não suportado** |

O requisito real é **Linux com Docker**, não WSL2. O WSL2 é apenas o caminho de
quem está no Windows. O gate é explícito: `install.sh` e `scripts/setup.sh`
abortam fora do Linux, e o `devlab doctor` informa se está em Linux nativo ou
sobre WSL2.

Não é uma limitação que dê para contornar de leve: o currículo ensina systemd,
cgroups, firewall e captura de pacote em containers reais. O PRD documenta um
caminho de fallback em navegador puro (§16, Anexo A) — que custa fidelidade e
não é o caminho recomendado.

---

## Instalação

Dentro do **Ubuntu do WSL2** (ou de qualquer Linux), um comando:

```bash
curl -fsSL https://raw.githubusercontent.com/wendellmcs/devlab/main/install.sh | bash
```

Ele clona o repositório em `~/devlab` e chama `scripts/setup.sh`, que cuida do
resto: confere o sistema, instala **Node 24**, o **Docker Engine** e o
**python3 + PyYAML** se faltarem, põe seu usuário no grupo `docker`, oferece o
**Ollama** com o modelo certo para a memória da sua máquina, instala as
dependências, constrói a imagem de lab e roda o diagnóstico final. É
idempotente — rodar de novo só conserta o que faltar.

> **Antes de canalizar para o `bash`, leia.** Isto é um script de terceiro que
> pede `sudo`; desconfiar é o comportamento certo, e não custa nada:
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/wendellmcs/devlab/main/install.sh | less
> ```
>
> São ~100 linhas. O que ele faz: garante o `git`, clona este repositório e
> entrega para [`scripts/setup.sh`](scripts/setup.sh) — que é onde o `sudo`
> realmente acontece, sempre depois de perguntar, e só nos passos que precisam.
> O setup canaliza três scripts oficiais de terceiros para o shell com
> privilégio: `get.docker.com`, `deb.nodesource.com` e `ollama.com/install.sh`.
> Se preferir não usar nenhum, instale Docker, Node 24 e Ollama pelo gerenciador
> da sua distro antes e rode `./scripts/setup.sh` — ele detecta o que já existe
> e não reinstala nada.

Se já clonou o repositório:

```bash
./scripts/setup.sh              # bootstrap completo
./scripts/setup.sh --so-conferir  # só diagnostica, não instala nada
./scripts/setup.sh -y --sem-ia    # sem perguntas, sem IA
```

Depois disso existe o comando `devlab` no seu PATH:

```bash
devlab iniciar      # sobe o DevLab (um processo, http://127.0.0.1:7788)
devlab doctor       # diagnóstico do ambiente
devlab licoes       # lista trilhas e lições carregadas
devlab validar      # valida o conteúdo declarativo
devlab atualizar    # git pull + dependências + setup
devlab ia           # liga/desliga a IA e troca entre modelo local e nuvem
devlab modelo       # mostra, lista e troca o modelo em uso
devlab dev          # só para MEXER na interface (Vite com HMR, :5173)
```

Abra <http://127.0.0.1:7788>, escolha **Linux → Anatomia do shell** e um
container sobe em segundos com um bash de verdade dentro dele.

> **Um processo, uma porta, uma origem.** O agente serve a própria interface.
> Não há dev server no caminho de quem estuda, e não há `--watch` reiniciando o
> agente — o que importa porque um reinício destrói os labs abertos: trocar o
> modelo de IA no meio de uma lição mataria o container. O Vite continua
> existindo, mas só em `devlab dev`, para quem for mexer na UI.

### O que o setup exige

- **Linux** — no Windows, o Ubuntu do WSL2
- **Node.js 24+** — o agente roda TypeScript direto, sem passo de build, e usa
  o módulo nativo `node:sqlite`
- **Docker Engine** (no Windows: dentro do WSL2, ou Docker Desktop com backend WSL2)
- **~4 GB de disco** para as três imagens de lab atuais — `linux-base` 182 MB,
  `voip-tools` 504 MB e `freeswitch-lab` 661 MB, mais as camadas intermediárias
  do build (20–30 GB quando Kamailio e Homer entrarem, na Fase 4)
- **O primeiro `devlab imagens` leva ~4 minutos**, e só por causa do
  FreeSWITCH: os pacotes oficiais exigem token da SignalWire, então a imagem o
  compila do fonte. Depois disso o build é pulado enquanto o contexto não mudar
- **python3 + PyYAML** — só para `devlab validar` (o setup instala; no
  Debian/Ubuntu é `sudo apt install python3-yaml`, **não** `pip install`, que o
  PEP 668 bloqueia)
- **Ollama** — opcional, só para a camada de IA local

> **WSL2 e memória.** Por padrão o WSL2 fica com metade da RAM do Windows. Se o
> `setup.sh` reclamar de pouca memória para o modelo de IA, aumente o teto em
> `C:\Users\<você>\.wslconfig` (`[wsl2]` / `memory=16GB`) e rode `wsl --shutdown`.

---

## As trilhas prontas

Três das dez trilhas do currículo estão no ar, com **1592 XP** somados. Toda
lição é exercitada de ponta a ponta a cada `devlab validar`: o check tem de
**reprovar antes** e **aprovar depois** da solução de referência, dentro de um
container de verdade, com a rede e as capacidades que ela declara.

| Trilha | Níveis | Lições | O que o aluno sai sabendo |
|---|---|---|---|
| **Linux** | Operador | 12 | navegar, ler e manipular arquivos no shell, sem GUI |
| **Troubleshooting SIP/RTP** | Operador · Construtor · Engenheiro | 18 | capturar e ler uma chamada, medir perda e jitter, e **reproduzir** o defeito com SIPp |
| **FreeSWITCH/PABX** | Operador · Construtor | 11 | operar a central e **escrevê-la**: directory, dialplan, mídia |

As lições de VoIP e PBX rodam contra software real — FreeSWITCH atendendo, dois
softphones `pjsua` registrados, RTP nos dois sentidos — e **sem rede nenhuma**:
todas declaram `--network none`, e o tráfego acontece na loopback do próprio
container. Cada lição pede só a capacidade de que precisa: a trilha de PBX não
pede **nenhuma** (`--cap-drop ALL` inteiro), e a de captura pede `NET_RAW`, mais
`NET_ADMIN` nas que mexem em firewall.

Isso é medição, não promessa: `docs/DESIGN-PBX.md` e `docs/DESIGN-VOIP.md`
trazem o experimento por trás de cada decisão — inclusive as que derrubaram a
primeira resposta óbvia.

---

## A trilha Linux · Operador

Doze lições encadeadas num DAG linear, 242 XP, terminando num capstone sem
dicas. A cobertura segue a especificação item a item:

| Lição | O que exercita |
|---|---|
| 1 · Anatomia do shell | `echo`, `pwd`, comando/opções/argumentos, `>` vs `>>` |
| 2 · Enxergar o diretório | `ls -l`, `-a`, `-h` — um check por opção |
| 3 · Caminhos | absoluto vs relativo, `~`, `cd`, e `..` para criar a pasta irmã |
| 4 · Hierarquia | `/etc`, `/var/log`, `/tmp`, `man hier` |
| 5 · Criar | `mkdir -p`, `touch`, chaves `{a,b}`, `tree` |
| 6 · Copiar e mover | `cp` vs `mv`, verificado dos **dois** lados |
| 7 · Remover | `rm`, `rmdir`, `rm -r` numa árvore com conteúdo |
| 8 · Ler arquivos | `head`, `tail`, `wc`, `cat` emendando, `file` |
| 9 · Pedir ajuda | `--help` para descobrir flag, `which` |
| 10 · Globbing e aspas | `*` e a armadilha do espaço em nome de arquivo |
| 11 · Padrões precisos | `?` e classes `[0-9]`, com `porta-10` e `porta-x` como armadilhas |
| 12 · Capstone | organizar as evidências de um chamado, sem dicas |

Cada `verificar:` inspeciona **estado**: nenhum check olha o comando digitado,
o que mantém vários caminhos válidos abertos. `npm run valida` prova que os 36
reprovam antes da solução e aprovam depois.

---

## IA opcional: local (Ollama) ou nuvem (sua chave)

**Desligada por padrão. Nunca resolve a tarefa. Trocável a qualquer momento.**

O padrão é **Ollama local**, e é o caminho recomendado: não há chave para
vazar, nenhum dado do aluno sai da máquina e o princípio 4 — *offline após o
primeiro build* — continua valendo sem asterisco, já que o modelo é baixado uma
vez como as imagens.

Só que um modelo local útil pede ~8 GB de RAM livres, e nem toda máquina tem.
Para esse caso existe o **provedor de nuvem com a sua própria chave** — o BYO
key que o PRD previa. É opt-in explícito, porque o contrato é outro.

```bash
devlab ia               # mostra o estado atual
devlab ia ollama        # modelo local (padrão)
devlab ia nuvem         # API com a sua chave
devlab ia off           # desliga

devlab modelo           # qual modelo está em uso
devlab modelo --listar  # o que está disponível no provedor atual
devlab modelo llama3.2:3b   # troca
```

Nada disso exige reinstalar: os comandos editam só a linha correspondente do
`.env` e valem no próximo `devlab iniciar`.

### Local (Ollama) — o padrão

Modelo por perfil de máquina (o `setup.sh` escolhe sozinho pela RAM, e
`devlab modelo` troca depois):

| RAM | Modelo | Tamanho | Nota |
|---|---|---|---|
| 32 GB+ | `qwen2.5-coder:14b` | ~9 GB | melhor qualidade de explicação |
| 16 GB+ | `qwen2.5-coder:7b` | ~4,7 GB | o equilíbrio recomendado |
| 8 GB+ | `llama3.2:3b` | ~2 GB | máquina apertada |
| menos | — | — | use a nuvem, ou siga sem IA |

### Nuvem (BYO key) — para quem não tem RAM sobrando

```bash
devlab ia nuvem
echo 'ANTHROPIC_API_KEY=sk-ant-...' >> .env
devlab doctor            # confirma chave e modelo numa chamada que não gasta token
```

O padrão é `claude-opus-5`; troque com `devlab modelo <id>` ou
`DEVLAB_IA_MODELO_NUVEM`. `DEVLAB_IA_ESFORCO` (`low`…`max`, padrão `low`)
regula profundidade de raciocínio — tutoria é resposta curta, e `low` já
responde bem, rápido e barato.

**O que muda em relação ao local, sem rodeio:**

| | Ollama local | Nuvem (BYO key) |
|---|---|---|
| Dados do aluno | não saem da máquina | enunciado + últimas linhas do **seu** terminal saem |
| Chave de API | não existe | sua, no `.env` (gitignored, modo `0600`) |
| Custo | zero | cobrado na sua conta |
| Princípio 4 (offline) | vale | não vale **para esta camada** — o núcleo segue offline |
| Dica, solução, script de check | fora do pacote | **fora do pacote, igual** |

A última linha é o ponto: a garantia de que a IA nunca vê a solução mora em
`montarContextoSeguro`, que roda **antes** da escolha de provedor. Trocar de
provedor não abre caminho novo — e há teste provando isso para os dois.

### Os três momentos de uso

| Momento | Quando | Pode mostrar comando? |
|---|---|---|
| **Explicar meu erro** | depois de uma verificação reprovada | não |
| **Revisar minha solução** | depois de você passar | **sim** — o exercício já foi vencido |
| **Pergunta guia** | quando quiser | não — responde com uma pergunta |

### Como "nunca resolve a tarefa" é garantido

Não por instrução no prompt, que um modelo local pequeno ignora com alguma
frequência, mas por construção:

1. **A IA nunca vê a solução.** O contexto é montado por *lista de permissões*
   em [`montarContextoSeguro`](packages/agent/src/ia/servico.ts): passam
   enunciado, descrições dos critérios, saída do terminal e o diagnóstico dos
   checks reprovados. As dicas, a `solucao_referencia`, o corpo dos scripts de
   check, o `setup` e o `break` não existem para ela. Há teste provando que
   nenhum desses segredos atravessa.
2. **Blocos de código são removidos** da resposta nos momentos em que comando é
   proibido, e o aluno é avisado de que isso aconteceu.
3. **Usar custa.** Cada consulta debita o mesmo que a dica de nível 3 e derruba
   o selo de *resolvido sem ajuda* — que é o que a métrica de Autonomia mede.
4. **Retirar a IA não quebra nada.** Sem Ollama, a interface mostra a seção
   explicando como ligar e segue funcionando inteira.

---

## Por que a imagem do lab não segue a distro da sua máquina

O container traz o próprio userspace: o lab é o que o `FROM` disser, esteja o
host em Ubuntu 26.04, Fedora ou Arch. Fazer o lab herdar a distro do host é
tecnicamente possível — e é a decisão errada aqui.

O modelo de verificação depende de as ferramentas se comportarem igual para
todo mundo. O catálogo de erros casa **mensagens literais do GNU** por regex.
Um exemplo real encontrado durante o desenvolvimento: a máquina onde este
projeto nasceu usa **uutils coreutils** e **bfs** no lugar do `find` do GNU —
ali o `mkdir` diz `File exists`, enquanto a lição espera
`cannot create directory … No such file or directory`. Se o lab herdasse o
host, dois alunos veriam mensagens diferentes na mesma lição, o CI provaria
uma imagem que ninguém roda, e "funciona na minha máquina" viraria a regra.

Por isso a base é **fixa por padrão e configurável por escolha**:

```bash
DEVLAB_IMAGEM_BASE=ubuntu:26.04 npm run imagens
```

A base entra na impressão digital do contexto, então trocá-la força a
reconstrução; a imagem carrega o rótulo `devlab.base`, então
`docker image inspect` responde de onde ela veio quando um check falhar só na
sua máquina. Só a base padrão é exercitada pelo CI e pelos testes de
integração — o resto é por sua conta e risco.

---

## Configuração

Copie [`.env.example`](.env.example) para `.env` — o agente carrega
automaticamente. O `setup.sh` já cria um com a IA desligada e o modelo
recomendado preenchido.

---

## Arquitetura

```
Linux  (nativo, ou dentro do WSL2 quando o host é Windows)
    ├── Docker Engine
    ├── devlab-agent  (Node 24 + TypeScript, sem build)  :7788
    │     ├── Lab Manager      → ciclo de vida dos containers, limites, reset, injeção de falha
    │     ├── PTY Bridge       → docker exec -t → WebSocket → xterm.js (uma sessão por aba)
    │     ├── Verifier Runner  → copia e roda os checks dentro do lab
    │     ├── State Extractor  → lê o container e alimenta o painel da direita
    │     ├── Progress Store   → SQLite local (XP, tentativas, dicas, erros)
    │     └── Estáticos        → serve packages/ui/dist na MESMA porta da API
    └── Imagens de lab em cache
Browser (localhost:7788) → UI React + TypeScript (build do Vite)
```

### Decisões de stack e o porquê

| Decisão | Motivo |
|---|---|
| **Node 24 executando `.ts` direto** | O type stripping nativo elimina o passo de build do agente. `tsc` fica só para checagem de tipos (`npm run tipos`). |
| **`node:sqlite` embutido** | Zero dependência nativa. Sem `better-sqlite3`, sem `node-gyp`, sem compilador no ambiente. |
| **`dockerode` para tudo, inclusive o PTY** | `exec` com `Tty: true` devolve um stream duplex — é o terminal, sem precisar de `node-pty` (que exigiria compilação nativa). |
| **`node:http` + `ws` crus** | O agente expõe uma API pequena. Um framework acrescentaria superfície de versão sem ganho. |
| **Conteúdo em YAML, fora do código** | Escrever lição não pode exigir recompilar aplicação. É o que faz as 10 trilhas caberem. |
| **O agente serve a UI (uma porta)** | Com o proxy do Vite no meio, o browser falava na 5173 e a API atendia na 7788 — `Host` e `Origin` chegavam de uma origem diferente da que respondia, e as guardas recusavam o app inteiro. Mesma origem torna a comparação trivial e elimina um processo. O Vite fica para desenvolver. |

---

## Onde cada princípio não-negociável foi atendido

| Princípio | Onde |
|---|---|
| **1. Execução real, ambiente descartável** | `lab/gerenciador.ts` — container por lição, `AutoRemove`, `reiniciar()` destrói e recria a partir da imagem. `rm -rf /` mata só o lab. |
| **2. Núcleo 100% sem IA** | Existe um cliente de IA (`ia/ollama.ts`), mas o núcleo não depende dele: `DEVLAB_IA=0` por padrão, `/api/ia/*` responde 409 quando desligada, e a prova de fumaça verifica isso. Conteúdo, checks, dicas e catálogo são determinísticos. |
| **3. Verificação por estado, nunca por texto** | `verificacao/executor.ts` só roda scripts que inspecionam o container: o veredito sai do código de saída, nada mais. O agente recebe as teclas (é ele quem faz a ponte do terminal) e guarda a saída recente — mas isso alimenta só a classificação de erro depois de reprovar, nunca a decisão. |
| **4. Offline após o primeiro build** | `#garantirImagem()` recusa lab com imagem ausente em vez de puxar da rede. O único passo online é `npm run imagens`. |
| **5. Jogo a serviço da competência** | `progresso/regras.ts`: XP ponderado pela dificuldade da lição, dica desconta de verdade, refazer lição concluída rende zero. A UI mostra **Autonomia** (% resolvido sem ajuda) ao lado do XP. |
| **6. Isolamento por padrão** | `lab/limites.ts`: `NetworkMode: none`, `CapDrop: ALL` + conjunto mínimo, `no-new-privileges`, sem bind mount, limites de CPU/RAM/PIDs, TTL de ocioso. Teste de integração confirma no kernel (`CapEff: 0`, sem rede). **Ressalva honesta:** o disco NÃO tem cota por padrão — `StorageOpt` exige overlay2 sobre XFS com `pquota` e recusaria o container no ext4, que é o caso comum. Um `dd` dentro do lab escreve no disco do host. Ligue com `DEVLAB_LIMITE_DISCO` se o seu sistema de arquivos aceitar. |

---

## Modelo de conteúdo

Cada lição é um YAML em `content/trilhas/<trilha>/<nivel>/`. O formato completo
está em [`packages/agent/src/conteudo/schema.ts`](packages/agent/src/conteudo/schema.ts).

```yaml
id: linux-op-01-shell
trilha: linux
nivel: operador
ordem: 1
titulo: "Anatomia do shell"
capacidade: "Sei executar um comando e gravar a saída dele em um arquivo."
xp: 10
prereqs: []

lab:                      # tudo opcional — os padrões já são os seguros
  setup: |                # roda como root ao subir o lab
    install -o aluno -g aluno -d /home/aluno/temporarios
  break: |                # injeção de falha, para labs quebra/conserta
    iptables -A INPUT -p udp --dport 16384:32768 -j DROP

objetivo_md: |
  Enunciado em Markdown. Blocos de código viram botões que inserem no terminal.

verificar:                # inspeciona ESTADO, nunca o comando digitado
  - descricao: "saudacao.txt tem o texto pedido"
    script: |
      #!/bin/bash
      [ -f /home/aluno/saudacao.txt ] || {
        echo 'DEVLAB_JSON:{"mensagem":"o arquivo ainda nao existe","dica_diagnostica":"liste com ls -l ~"}'
        exit 1
      }
      exit 0

dicas:                    # escada de 3 degraus; vazio = tarefa sem ajuda
  - "empurrão conceitual"
  - "a forma do comando, com lacuna"
  - "a solução"

erros_comuns:
  - match: "command not found"
    explica: "O shell não achou esse programa."
    categoria: sintaxe

cards_revisao: [echo-escreve-na-saida]
```

### Como um check comunica diagnóstico

O script devolve o veredito pelo **código de saída** e, opcionalmente, uma
explicação estruturada numa linha:

```bash
echo 'DEVLAB_JSON:{"mensagem":"o que está errado","dica_diagnostica":"como investigar"}'
```

A UI mostra sempre a mensagem original primeiro e a explicação depois — o aluno
precisa aprender a ler o erro de verdade.

### Adicionando uma lição

1. Crie o YAML em `content/trilhas/<trilha>/<nivel>/`.
2. Rode `npm run valida`. Ele não precisa de Docker: confere o schema, o
   grafo de pré-requisitos, a sintaxe de todo script (`bash -n`) e então
   **executa os checks numa árvore falsa**, exigindo que reprovem antes da
   solução de referência e aprovem depois. É o que pega os dois erros caros:
   check que aprova sozinho (e portanto não mede nada) e dica de nível 3 que
   não é um comando executável.

   Uma ressalva honesta sobre o alcance: ele roda com o **bash e as ferramentas
   do seu host**, não com as da imagem. Se o seu sistema usa uutils coreutils ou
   `bfs` no lugar do `find` do GNU, as mensagens diferem das do lab. Quem prova
   o comportamento contra a imagem de verdade é `npm run teste:integracao`.
3. Recarregue sem reiniciar o agente: `curl -X POST localhost:7788/api/conteudo/recarregar`.

Lições sem dicas (capstones) declaram `solucao_referencia` — um campo que
existe só para o validador e **nunca** é enviado ao browser.

---

## Estrutura do repositório

```
content/                        conteúdo declarativo (YAML), separado do código
  trilhas/linux/                trilha + lições
  catalogo/linux.yaml           catálogo de erros
images/linux-base/              Dockerfile + árvore semeada da imagem
packages/agent/                 devlab-agent
  src/conteudo/                 schema (zod) e carregador
  src/lab/                      Lab Manager e limites de isolamento
  src/verificacao/              Verifier Runner e classificação de erros
  src/estado/                   State Extractor
  src/progresso/                SQLite e regras de XP
  src/http/                     API, roteador, PTY Bridge e estáticos da UI
  src/ia/                       provedores (ollama.ts local · nuvem.ts BYO key)
  src/cli/devlab.ts             devlab doctor · licoes · ia · modelo
packages/ui/                    interface React de 3 painéis
scripts/                        setup.sh · install one-liner
  iniciar.sh                    uso normal: um processo, agente serve a UI
  dev.sh                        desenvolvimento da UI: Vite com HMR
  build-imagens.sh              constrói e detecta imagem desatualizada
  valida-conteudo.py            valida e executa os checks sem Docker
  fumaca.sh                     prova o loop central pela API
```

---

## Testes

```bash
npm run teste              # unitários, sem Docker
npm run valida             # valida o conteúdo e executa os checks sem Docker
npm run teste:integracao   # sobe containers de verdade (pula se faltar Docker ou imagem)
npm run fumaca             # prova o loop central pela API, ponta a ponta
npm run tipos              # checagem de tipos dos dois pacotes
```

A **prova de fumaça** é a que responde "está funcionando?" numa instalação
nova: sobe o agente numa porta e num banco descartáveis, cria um lab, verifica
(tem de reprovar), resolve com um comando de verdade dentro do container,
verifica de novo (tem de aprovar e creditar exatamente 10 XP), confirma que
refazer não rende XP outra vez, que a dica cobra, que a árvore de arquivos do
painel reflete o arquivo recém-criado, que a IA está desligada, que o reset
devolve o lab ao estado inicial e que não sobra container órfão.

Os unitários cobrem schema de conteúdo, carregador (YAML inválido, prereq
fantasma, ciclo no DAG), regras de XP e persistência, extração de diagnóstico,
classificação de erros, montagem da árvore de arquivos, roteamento HTTP e a
tradução dos limites de isolamento para o Docker.

O teste de integração exercita o ciclo completo: criar lab, executar comando,
gravar arquivo por cópia, aplicar `setup`, confirmar limite de memória e
ausência de rede, reprovar e aprovar o mesmo check conforme o estado muda,
resetar, abrir terminal com TTY e destruir o container.

---

## API do agente

| Método | Rota | Para quê |
|---|---|---|
| `GET` | `/api/saude` | estado do agente |
| `GET` | `/api/doctor` | diagnóstico do ambiente |
| `POST` | `/api/conteudo/recarregar` | recarrega os YAML sem reiniciar |
| `GET` | `/api/trilhas` | trilhas, lições e o que está desbloqueado |
| `GET` | `/api/licoes/:id` | lição (sem as dicas ainda não reveladas) |
| `POST` | `/api/licoes/:id/dica` | revela um degrau da escada e debita o XP |
| `POST` | `/api/labs` | cria o lab de uma lição |
| `POST` | `/api/labs/:id/reset` | destrói e recria o lab |
| `DELETE` | `/api/labs/:id` | destrói o lab |
| `GET` | `/api/labs/:id/estado` | árvore de arquivos e recursos, lidos do container |
| `POST` | `/api/labs/:id/verificar` | roda os checks e registra a tentativa |
| `GET` | `/api/progresso` | XP, conclusões, autonomia, histórico de erros |
| `GET` | `/api/erros` | catálogo de erros (material didático) |
| `GET` | `/api/labs` · `/api/labs/:id` | labs ativos |
| `GET` | `/api/ia/estado` | se a IA está ligada e disponível |
| `POST` | `/api/ia/:momento` | `explicar_erro` · `revisar_solucao` · `dica_socratica` |
| `WS` | `/ws/pty?lab=&cols=&rows=` | terminal |

**Todas** as rotas exigem `Host` de loopback — GET inclusive, porque DNS
rebinding não precisa escrever para fazer estrago: bastaria ler `/api/doctor` e
a árvore de arquivos do container. As que mudam estado recusam ainda `Origin`
de outro site e exigem `content-type: application/json`. O WebSocket valida
`Origin` no handshake, já que CORS não protege WebSocket — sem isso, qualquer
página aberta noutra aba poderia abrir um shell dentro do container.

A guarda de `Host` olha o **nome**, não a porta. Em uso normal isso é
redundante — agente e interface vivem na mesma origem (`:7788`). Importa em
`devlab dev`, onde o browser fala com o Vite (5173) e o proxy repassa o `Host`
original: exigir a porta do agente recusaria com 403 o app inteiro. E a porta
não defende nada, porque quem decide o `Host` é a URL que o browser visitou —
uma página em evil.com não emite `Host: 127.0.0.1` em porta nenhuma.

Os arquivos da interface passam pelas MESMAS guardas: o servidor de estáticos
só assume depois que elas rodaram, em vez de ficar num caminho paralelo sem
trava. Caminho fora de `packages/ui/dist` — `..`, `%2e%2e%2f`, byte nulo — é
recusado com 403.

As dicas não reveladas **não** trafegam para o browser: se trafegassem, o custo
de XP seria encenação.

---

## Variáveis de ambiente

| Variável | Padrão | Efeito |
|---|---|---|
| `DEVLAB_PORTA` | `7788` | porta do agente **e da interface** |
| `DEVLAB_CONTEUDO` | `./content` | diretório do conteúdo |
| `DEVLAB_DADOS` | `./.devlab` | onde fica o SQLite |
| `DEVLAB_TTL_LAB_MS` | `2700000` | tempo até um lab ocioso ser destruído |
| `DEVLAB_LOG` | `info` | `debug` \| `info` \| `aviso` \| `erro` |
| `DEVLAB_LIMITE_DISCO` | *(desligado)* | cota da camada gravável do lab (ex.: `10g`); exige XFS + `pquota` |
| `DEVLAB_IA` | `0` | liga a camada de IA |
| `DEVLAB_IA_PROVEDOR` | `ollama` | `ollama` (local) \| `nuvem` (BYO key) |
| `DEVLAB_IA_MODELO` | `qwen2.5-coder:7b` | modelo do Ollama |
| `ANTHROPIC_API_KEY` | — | sua chave, só quando o provedor é `nuvem` |
| `DEVLAB_IA_MODELO_NUVEM` | `claude-opus-5` | modelo da API |
| `DEVLAB_IA_ESFORCO` | `low` | `low` … `max` — profundidade de raciocínio na nuvem |

---

## Antes de publicar no GitHub

O repositório não contém nenhum caminho, nome de usuário, e-mail ou
identificador da máquina onde foi desenvolvido. Os dados semeados nos labs
(ramais, CDR, contatos) são fictícios e usam o domínio de exemplo
`exemplo.local`. `.env`, `.devlab/` (o banco de progresso), `node_modules/` e
`dist/` estão no `.gitignore`; o `package-lock.json` está versionado, para que
`npm ci` reproduza exatamente as mesmas dependências.

O [`.gitattributes`](.gitattributes) força LF em todo o repositório. Não é
preferência de estilo: clonar pelo Git do Windows converteria os `.sh` para
CRLF e eles quebrariam dentro do WSL2 com `bad interpreter: ...^M` — os scripts
de check, que rodam dentro dos containers, falhariam do mesmo jeito.

Se você bifurcar o projeto, troque o caminho do repositório em
[`install.sh`](install.sh) (variável `REPO`) e na seção de instalação deste
README:

```bash
sed -i 's|wendellmcs/devlab|<voce>/<repo>|g' install.sh README.md
```

### Licença

O código deste repositório está sob [MIT](LICENSE) — © 2026 Wendell Max.

Uma distinção que importa neste projeto: a licença cobre **o código do DevLab**,
não o software que os labs instalam. As imagens de lab montam Ubuntu,
FreeSWITCH (MPL 1.1), Asterisk (GPLv2), Kamailio (GPLv2+) e outros, cada um sob
a própria licença. Como o repositório traz apenas os `Dockerfile` que baixam
esse software na sua máquina, nada disso é redistribuído por aqui e não há
conflito. Se um dia você **publicar imagens prontas** num registry, aí sim
estará distribuindo binários GPL — e as obrigações dessas licenças passam a
valer sobre a imagem.

---

## Próxima fase

A Fase 3 — a de maior retorno para quem trabalha com telefonia — foi antecipada
e está entregue: a trilha de Troubleshooting SIP/RTP nos três níveis, e a de
FreeSWITCH em dois. O que vem, em ordem de retorno:

- **FreeSWITCH · Engenheiro** — voicemail e MWI, URA com menus aninhados, hunt
  groups, troncos e gateways pelo perfil externo, CDR, ESL, `mod_conference` e
  endurecimento contra fraude. É o que fecha a trilha F.
- **Fase 1** — Git (DAG animado do repositório real), SQL (Postgres com dataset
  de CDR), completar Linux (Construtor e Engenheiro), repetição espaçada SM-2 e
  Treinos do Dia, material de apoio, skill tree.
- **Fase 4** — topologia carrier: Kamailio balanceando dois FreeSWITCH, com
  RTPengine e prova de failover no Homer.

O que já está pronto para receber qualquer uma delas: labs multi-container via
`compose.yaml` (o schema de `lab` já prevê), capacidades extras por lição
(`NET_ADMIN`/`NET_RAW` para captura de pacote), injeção de falha (`break`) e o
catálogo de erros versionado.
