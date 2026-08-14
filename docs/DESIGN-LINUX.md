# Trilha A — as decisões do Linux Construtor, resolvidas antes das lições

A Fase 0 entregou o nível Operador contra a `devlab/linux-base`, e o nível
Construtor parecia ser mais do mesmo: a imagem existe, o motor de árvore falsa
roda sem Docker, e há 12 lições servindo de molde.

Não é. O Operador mede **arquivos dentro de `/home/aluno`**, e é exatamente
esse o recorte que a árvore falsa reproduz. O Construtor mede dono, usuário,
processo e pacote — quatro coisas que a árvore falsa **não tem** e sobre as
quais ela responde mesmo assim. As decisões abaixo são o que isso custou.

As decisões 18 a 38 vivem em `docs/DESIGN-VOIP.md` e as 39 a 64 em
`docs/DESIGN-PBX.md`; a numeração é global e continua aqui, no 65.

---

## 65. A árvore falsa não falha fora do `/home/aluno` — ela mente

`scripts/valida-conteudo.py` tem dois motores. Lição de `devlab/linux-base`
roda numa árvore falsa montada no host a partir do seed da imagem, sem Docker e
sem root; qualquer outra imagem roda dentro do container. A escolha era só pelo
nome da imagem.

Isso funcionou por 12 lições porque todas mediam a mesma coisa: arquivo debaixo
de `/home/aluno`, que é o único caminho que `adapta()` reescreve. A primeira
lição de permissões com dono sai desse recorte, e o que acontece então não é
erro — é um veredito verde sobre outro sistema.

Medido nesta máquina, rodando como o usuário `wendell` (uid 1000):

| o que a lição mediria | árvore falsa | container do lab |
|---|---|---|
| `wc -l /etc/passwd` | **27** linhas, do host | 19 linhas, da imagem |
| existe o usuário `aluno`? | **não** | sim, uid 1000 |
| `ps aux \| wc -l` | **60** processos do host | 6 do lab |
| `chown aluno:aluno x` | `Operation not permitted` | funciona |
| `useradd` | `Permission denied` | funciona |

E o caso pior é o `chown`, porque ele não devolve nem erro: `adapta()` troca
**toda linha que começa com `chown`** por `:`. O script roda, o check aprova, e
ninguém trocou dono de nada.

```python
# o que adapta() faz, hoje, com o script da lição:
texto = re.sub(r"^\s*chown .*$", ":", texto, flags=re.M)
#  '#!/bin/bash\nchown aluno:aluno /home/aluno/x\n'  ->  '#!/bin/bash\n:\n'
```

**Decisão: `lab.exige_container: true`, e uma guarda que reprova quem esquecer.**
O campo manda a lição para o container mesmo sendo `linux-base`; custa os 0,3 s
de subir o container, medidos. A guarda é a parte que importa, porque esquecer
de declarar é o modo de falha provável e o sintoma dele é um "✔" verde:
`valida_motor_de_validacao` varre os blocos que o motor rápido executaria e
reprova o build quando acha `/etc/passwd`, `useradd`, tabela de processos,
`/proc` ou gestor de pacotes — em qualquer bloco — ou `chown`/`chgrp` **no
veredito**.

O `chown` só conta no veredito de propósito. No `setup` ele é rotina
inofensiva: o container cria como root e devolve ao aluno, e na árvore falsa
quem roda já é dono de tudo. É por isso que `linux-op-07-remover`,
`linux-op-11-padroes-precisos` e `linux-op-12-capstone` seguem, com razão, no
motor rápido — a regra foi conferida contra as 47 lições existentes antes de
entrar, e não marca nenhuma.

Vale a mesma regra da decisão 12 do `DESIGN-VOIP.md`: "passou" e "mediu outra
coisa" não podem imprimir a mesma linha verde.

---

## 66. `sudo` é impossível neste lab, e a culpa é do perfil de segurança

O PRD §7 pede `sudo` no nível Construtor da trilha A. Ele não cabe, e não é por
falta do pacote — é o `no-new-privileges` que todo lab do DevLab carrega.

Medido, com o `sudo` instalado numa imagem derivada e o perfil de segurança do
lab de verdade:

```
$ sudo id
sudo: The "no new privileges" flag is set, which prevents sudo from running as root.
sudo: If sudo is running in a container, you may need to adjust the container
      configuration to disable the flag.
```

Tirado só o `--security-opt no-new-privileges=true`, o mesmo container passa a
elevar. Ou seja: a causa é o flag, não o `cap-drop ALL`, não a rede e não a
configuração do `sudoers`.

O `su`, que a imagem já traz, morre por outro motivo — o root não tem senha:

```
$ su -c id root
Password: su: Authentication failure
```

**Decisão: `sudo` e `su` ficam FORA da trilha A, por escrito.** A alternativa
seria remover `no-new-privileges` do perfil de lab para ensinar um comando — e
esse flag é o que impede um binário setuid dentro de qualquer imagem de lab de
virar escalada de privilégio no host. Trocar a segurança de dez trilhas pela
didática de uma é a troca errada.

O que entra no lugar é melhor: o aluno vive a **negativa**. Ele é `aluno`,
tenta `chown` num arquivo de root e recebe `Operation not permitted` — que é o
sintoma real de campo. A lição diz, em prosa, que num servidor de verdade o
caminho seria `sudo`, e por que aqui não é.

Corolário: `chmod`/`chown` como dono continuam inteiros, e a metade do assunto
que exige elevar é declarada ausente em vez de encenada.

---

## 67. `r` e `x` em diretório não são "ler" e "entrar" — medido

A simplificação corrente é que `r` num diretório deixa ler e `x` deixa entrar.
Isso descreve mal os dois casos que aparecem em chamado real. Medido como
usuário comum, num diretório com um `a.txt` dentro:

| modo | `ls dir` | `cat dir/a.txt` | `cd dir` |
|---|---|---|---|
| `0700` `rwx` | lista | lê | entra |
| `0600` `rw-` | **lista os nomes** | `Permission denied` | falha |
| `0500` `r-x` | lista | lê | entra |
| `0400` `r--` | **lista os nomes** | `Permission denied` | falha |
| `0300` `-wx` | `cannot open directory` | **lê** | entra |

Os dois extremos são o material da lição:

- **`r` sem `x`** (`0600`, `0400`) — você enxerga os nomes e não alcança nada.
  O diretório vira um índice sem conteúdo.
- **`x` sem `r`** (`0300`) — você não consegue listar, mas se souber o nome,
  o arquivo abre. É assim que um diretório de configuração fica "invisível" e
  funcionando ao mesmo tempo.

`r` é permissão sobre a **lista de nomes**; `x` é permissão para **atravessar**
o diretório e alcançar o que está dentro. Ler o conteúdo de um arquivo pede `x`
em cada diretório do caminho, e não pede `r` em nenhum.

Uma armadilha de medição, e ela foi minha: o primeiro teste usou `ls dir` e
concluiu que `0600` não bloqueava nada. `ls` sem `-l` só precisa de `r` — ele
lista nomes sem dar `stat` em ninguém. Quem separa os casos é `ls -l`, `cat` ou
`cd`, nunca o `ls` pelado.

---

## 68. `ps` não é determinístico, e a demonstração paga por isso

Vale a decisão 27 (`DESIGN-VOIP.md`): saída de demonstração só entra se for
determinística, porque `capturar-demonstracao.py --conferir` compara byte a
byte. Três leituras seguidas **do mesmo lab**, sem nada mudar entre elas:

```
bash bash ps tr
bash ps sort tr
bash ps sort tr
```

O que varia é o próprio pipeline: `ps`, `sort` e `tr` são processos, e qual
deles já nasceu quando o `ps` tira a foto é uma corrida. Some a isso o que
`ps aux` imprime em toda linha — PID, `%CPU`, `RSS`, `START`, `TIME` — e a
tabela inteira é deriva garantida, exatamente como o placar de falhas sob carga
da decisão 63.

**Decisão: as colunas de `ps aux` são ensinadas na anatomia, não na saída.** O
bloco `anatomia` disseca a linha de comando e as colunas que ela pede; a
`demonstracao` só grava projeções estáveis — `ps -eo user,comm` filtrado por um
processo que o `setup` plantou com nome conhecido, ou uma contagem desse
processo. PID nunca aparece em saída gravada, pela mesma razão que ele saiu do
`Call-ID` na decisão 28 e do `devlab-ramal --listar` na trilha F.

---

## 68b. Demonstração de permissão usa `stat -c`, nunca `ls -l`

`ls -l` imprime o **mtime** do arquivo, e o mtime do seed é a data de build da
imagem. É a deriva já registrada em `docs/CONTINUAR.md` — ela pegou o
`02-listar.yaml` em 2026-08-04 e volta a cada rebuild da `linux-base`.

Uma lição de permissão não precisa pagar isso: `stat -c '%A %a %n'` imprime
exatamente os dois campos que ela ensina, na forma simbólica e na octal, lado a
lado, e nada mais.

```
$ stat -c '%A %a %n' scripts/backup.sh
-rw-r--r-- 644 scripts/backup.sh
```

É determinístico, é mais legível para o assunto, e ainda mostra as duas
notações juntas — que é justamente o que a lição precisa que o aluno relacione.
Toda demonstração das lições de permissão usa `stat`; `ls -l` continua no
Operador, onde o assunto é a listagem.

Pelo mesmo motivo, a demonstração **não roda o `backup.sh` até o fim**: o nome
que ele grava carrega `$(date +%Y%m%d)`, e a saída mudaria de dia para dia. O
check cobre o resultado com um glob, que é indiferente à data.

**Um artefato do capturador que a nota tem de admitir.** Comando que falha
dentro de `capturar-demonstracao.py` sai com o prefixo do roteiro:

```
bash: line 8: ./scripts/backup.sh: Permission denied
```

O `line 8` é a posição do comando dentro do roteiro que o capturador monta
(`roteiro()` emite quatro linhas de preâmbulo e duas por comando), **não** uma
linha do `backup.sh`. No PTY do aluno a mesma falha sai sem ele. É
determinístico — só muda se a demonstração ganhar ou perder um passo, e aí o
`--conferir` acusa —, mas é diferente do que o aluno vê, então a `nota` do
passo diz isso em vez de fingir que não está lá. Vale para toda demonstração
que grava um comando falhando de propósito.

---

## 69. `jobs` funciona sem terminal; `fg` não — e isso separa o que o check pode medir

O aluno digita num PTY de verdade (a ponte de terminal do agente), onde o
controle de job está ligado. O validador e o `capturar-demonstracao.py` rodam
`bash -s` por `docker exec`, que é não interativo. Não é o mesmo ambiente, e
medi a diferença:

| | `bash -s` não interativo |
|---|---|
| `cmd &` | funciona |
| `jobs` | **funciona** — lista `[1]+ Running` |
| `kill %1` | funciona |
| `fg` / `bg` | exigem `set -m`; sem ele não há o que trazer para frente |

**Decisão: `&`, `jobs` e `kill %n` podem ser cobrados por check; `fg` e `bg`
são ensinados e não são medidos.** Um check que dependesse de `fg` mediria o
`set -m` do próprio validador, não o aluno.

---

## 70. O processo que sobrevive ao TERM é encenável, e é o que ensina sinal

Sinal é o assunto em que a lição vira "decore que 9 mata". O caso que ensina de
verdade é o processo que **ignora** o TERM, porque é ele que mostra que TERM é
um pedido e KILL não é. Medido no lab:

```
$ bash -c 'trap "" TERM; sleep 20' &
$ kill -TERM $P     # vivo depois do TERM
$ kill -KILL $P     # Killed
```

`trap "" TERM` cabe no `lab.setup` e produz o sintoma exato de campo — o
serviço que "não morre" e que alguém mata com `-9` sem entender por quê. A
lição ensina a ordem certa (pedir primeiro, obrigar depois) tendo visto os dois
resultados no mesmo processo.

---

## 70b. O processo morto vira ZUMBI e não some — o PID 1 do lab não recolhe

Custou uma investigação, e o sintoma era "o `kill -9` não mata". Medido:

```
$ kill -9 $(pgrep gravador-vm)
$ pgrep -a gravador-vm
14 [gravador-vm] <defunct>
```

Ele morreu. O que sobrou é um **zumbi**: a entrada na tabela de processos que
o kernel guarda até o pai ler o código de saída. Aqui o pai não lê nunca —
o processo foi iniciado pelo `lab.setup`, cujo shell já terminou, então ele foi
reparentado para o **PID 1 do container**, que é `sleep infinity`. Um `sleep`
não chama `wait()`. O zumbi fica até o container morrer.

Duas consequências, e as duas mordem:

1. **`pgrep -c` conta zumbi.** Um check ingênuo reprova o aluno que fez tudo
   certo. Todo check de "o processo acabou" nesta trilha usa a projeção que
   descarta o estado `Z`:

   ```bash
   ps -eo stat=,comm= | awk '$1 !~ /^Z/ && $2 == "gravador-vm"'
   ```

   Medido: 1 antes, **1** depois do TERM (ele o ignora), **0** depois do KILL.

2. **O aluno vê o `<defunct>` e conclui que falhou.** Como é inevitável no lab,
   a lição ensina o zumbi em vez de escondê-lo — e ele é um assunto real: `Z` em
   `ps` de servidor quer dizer "processo morto cujo pai não recolheu", nunca
   "processo travado a matar".

**Corolário de construção:** processo de fundo do `setup` sobe com
`setpriv --reuid=aluno --regid=aluno --clear-groups …`, e não com `runuser`.
O `runuser` **permanece** como pai, de root, e casa com o mesmo padrão de nome
— o aluno tenta matar e leva `Operation not permitted` de um processo que a
lição nem mencionou. O `setpriv` faz `exec` e não deixa esse resto.

E os nomes dos processos do lab têm **no máximo 15 caracteres**, porque é onde
o `comm` do kernel corta: `gravador-voicemail` aparece como `gravador-voicem`,
e o `pgrep` ainda avisa que um padrão maior que 15 nunca casa.

---

## 71. `tee` e `grep` são ensinados sem dono, e a ordem do currículo é a razão

O portão "ensina antes de pedir" cobra que, se uma lição **usa** um comando,
quem o **reivindica** esteja no fecho dos pré-requisitos dela. Reivindicar um
comando tarde demais quebra o grafo para trás — foi o que já aconteceu com o
`python3`, registrado em `docs/CONTINUAR.md`.

Aconteceu de novo, e o portão pegou na hora:

```
✘ pbx-eng-04-esl-cdr: usa 'tee', que é ensinado em 'linux-con-04-fluxos'
  — e 'linux-con-04-fluxos' não é pré-requisito desta lição
✘ pbx-eng-06-capstone: usa 'tee', ...
```

As duas lições da trilha F usam `tee` dentro de `solucao_referencia`, que é
varrida. A saída aparente seria pôr o Construtor de Linux como pré-requisito
delas — e isso contraria o PRD §7, que manda deixar entrar direto na trilha de
troubleshooting e na de PBX. Um técnico que já é da área não pode ser obrigado
a passar por doze lições de Linux para abrir um chamado de FreeSWITCH.

**Decisão: `tee` fica sem dono declarado, e a lição 4 o ensina do mesmo jeito.**
O portão então o ignora — comando que ninguém reivindica não é cobrado —, e o
custo é que a ordem do currículo deixa de ser *garantida por build* para ele.
É o preço já pago pelo `python3`, pela mesma razão e com o mesmo registro.

Depois desse susto, varri os **candidatos todos** contra as 47 lições
existentes antes de escrever qualquer outra lição. O resultado é maior do que
um caso isolado: **a caixa de ferramentas de texto inteira já está em uso.**

| comando | livre? | quem já usa em bloco varrido |
|---|---|---|
| `grep` | **não** | 22 lições das trilhas F e G |
| `sort` | **não** | 14 lições |
| `sed` | **não** | 9 lições |
| `uniq`, `cut` | **não** | 4 lições cada |
| `awk` | **não** | 3 lições |
| `find` | **não** | 3 lições |
| `tee` | **não** | 2 lições |
| `tr` | **não** | 1 lição |
| `ps`, `kill`, `nice`, `xargs`, `tar`, `gzip` | **sim** | — |
| `chmod`, `stat`, `id`, `groups`, `chown`, `chgrp`, `umask` | **sim** | — |

Ou seja: das lições 5 e 6 da trilha A — as de processamento de texto, que são
o coração do nível Construtor no PRD — **nenhum** comando pode ser
reivindicado. Elas ensinam `grep`, `sort`, `uniq`, `cut`, `sed`, `awk` e `tr`
com `ensina.comandos: []`.

Isso não é defeito das lições, é consequência da ordem em que o produto foi
construído: a Fase 3 (trilhas F e G) veio antes da Fase 1, e ela usou o
ferramental de texto à vontade porque nenhuma lição de Linux o reivindicava
ainda. O portão continua valendo para tudo o mais; para esses nove comandos, a
garantia de ordem passa a ser editorial em vez de automática.

**Alternativa recusada:** pôr o Construtor de Linux como pré-requisito das
lições de F e G. Isso obrigaria um técnico de telefonia a fazer doze lições de
Linux antes de abrir um chamado de FreeSWITCH, contra o PRD §7 — que manda
justamente deixar entrar direto na trilha de maior retorno imediato.

Corolário para quem escrever a trilha B (Git) e as seguintes: **rode a varredura
ANTES de escrever a lição.** Descobrir depois custa reescrever demonstração,
prática guiada e dicas.

---

## 72. O validador exercitava a lição em `/root`, e o aluno nunca esteve lá

Um defeito de ferramenta, achado ao conferir se a **dica de nível 3** de cada
lição realmente resolve a tarefa — o portão não confere isso, porque quando há
`solucao_referencia` ele usa ela e a dica nunca roda.

A dica 3 de `linux-con-03-dono` falhava assim:

```
cp: cannot stat 'entregue/gateway.conf': Permission denied
```

O arquivo existe, é `644` e o diretório é `755`. O que faltava era o
**diretório de trabalho**: `exercita_no_container` subia o container com
`-w lab.get("workdir", "/root")`, e o schema (`packages/agent/src/conteudo/schema.ts`)
tem `workdir` com padrão **`/home/aluno`**. Lição que não declarasse o campo
rodava, no validador, num diretório que o `aluno` não consegue nem atravessar —
daí `Permission denied` em qualquer caminho relativo.

As 36 lições de PBX e VoIP não notaram porque **todas** declaram
`workdir: /root` explicitamente e rodam como root. Quem pagou foi a primeira
lição de `linux-base` a exigir container e usar caminho relativo. E a
`solucao_referencia` das minhas três escondia o problema, porque começava com
um `cd /home/aluno`.

**Corrigido: o padrão do validador passa a ser o do schema.** Divergir dele é o
validador medir um ambiente que o aluno nunca vê — a mesma família da decisão
15 (verificar o commit, não a árvore de trabalho) e da 65 (a árvore falsa que
responde sobre o host).

Fica a lição de método: **exercite também a dica de nível 3.** Ela é o que o
aluno compra por 50% do XP, e é o único bloco executável que nenhum portão
roda quando existe solução de referência.

---

## O que a trilha A Construtor NÃO cobre, e por quê

Declarado aqui em vez de encenado — mesma disciplina da decisão 37, que tirou
NAT da trilha G.

| item do PRD §7 | por que fica de fora |
|---|---|
| `sudo`, `su` | decisão 66: `no-new-privileges` impede, e root não tem senha |
| `apt` (install, update, upgrade) | `rede: nenhuma`; medido, `apt-get update` só devolve `Temporary failure resolving`. O terço que roda offline (`dpkg -l/-L`) é inventário, e inventário sem resolver dependência ensina a parte que menos importa |
| `scp`, `rsync`, `curl`, `wget` | não estão na imagem e exigem rede e um segundo host; é trilha E |
| `top`, `htop` | interativos e de tela cheia: nada do que eles mostram é verificável por check, e `htop` nem está na imagem |
| `fg`, `bg` | decisão 69: ensinados, não medidos |

`tar` e `gzip` ficam **dentro**: são os únicos do grupo "arquivos e
transferência" que funcionam sem rede, e são justamente os que aparecem no
`backup.sh` que a imagem já semeia.
