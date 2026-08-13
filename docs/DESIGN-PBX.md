# Trilha F — as decisões do PBX, resolvidas antes das lições

O Prompt-Mestre manda resolver a imagem antes da primeira lição. Para a trilha
G isso virou `docs/DESIGN-VOIP.md`; para a trilha F o bloqueio era outro e mais
antigo: **qual PBX**, já que os pacotes do FreeSWITCH exigem token da
SignalWire.

**Decidido em 2026-08-05: FreeSWITCH, compilado do fonte.** As medições abaixo
são o que sustenta a decisão — e o que impede a próxima pessoa de repetir as
cinco tentativas que custaram para chegar num build que funciona.

---

## 39. Compilar do fonte é viável, e custa 3m41s — não meia hora

A objeção contra compilar era o custo no portão. Ela não se sustenta, medido
nesta máquina (10 núcleos):

| | medido |
|---|---|
| build a frio, ponta a ponta | **221 s** no protótipo, **235 s** na imagem final |
| só o FreeSWITCH (`configure` + `make -j10` + `install`) | ~60 s, 407 unidades compiladas |
| instalação em disco | **83 MB** (22 MB módulos, 57 MB áudios, 1,5 MB config) |
| imagem single-stage, com o builder dentro | 1,92 GB |
| **imagem final, multi-stage** | **661 MB** |
| módulos compilados | 34, contra os ~100 do `modules.conf` padrão |

Os 14 s a mais da imagem final pagam o pjproject e o teste de fumaça, e não os
1,26 GB que o multi-stage descartou. Medido de novo com `--no-cache` depois de
a imagem estar pronta: **3m55s**.

A lista reduzida de módulos é metade da explicação do tempo; os núcleos são a
outra. Num laptop de 4 núcleos espere algo em torno de 8 a 10 minutos.

E o portão não paga isso repetidamente: `scripts/build-imagens.sh` compara uma
impressão digital do contexto com o label `devlab.contexto` da imagem e **não
chama o `docker build`** quando nada mudou. O custo é uma vez por máquina e uma
vez por mudança na imagem.

Isso quase não foi verdade, e a imagem do FreeSWITCH é o que expôs. A digital
era calculada com `find … | xargs sha256sum` **sem entrar no diretório**, e o
`sha256sum` imprime o nome junto do hash: os nomes saíam com o caminho
absoluto, então a digital dependia de onde o repositório estava. O mesmo commit
conferido num `git worktree` sob `/tmp` reconstruía tudo, com `diff -r`
acusando zero diferença. Enquanto reconstruir custava segundos ninguém notou;
com um build de quatro minutos, a verificação da decisão 15 passaria a parecer
lenta em vez de errada. Corrigido — as três imagens dão a mesma digital nos
dois caminhos.

O que isso preserva: a promessa do PRD §4.8, *"o primeiro build exige internet;
depois disso, offline"*, continua literalmente verdadeira. Era o token da
SignalWire que a transformaria em "internet **e uma conta em serviço de
terceiro**".

## 40. O par spandsp/`mod_spandsp` é o ponto que não fecha sozinho

Três medições encadeadas, cada uma derrubando a saída óbvia da anterior:

1. **`spandsp v3.0.0` não existe.** O FreeSWITCH 1.10.12 pede a série 3.0, e o
   repositório `freeswitch/spandsp` só publica `v3.1.0` e `v3.1.1`.
2. **`mod_spandsp` não compila contra a 3.1.** A assinatura do `v18_init`
   mudou: `error: 'V18_MODE_5BIT_4545' undeclared`, `too few arguments to
   function 'v18_init'`.
3. **Tirar o módulo não tira a dependência.** O `configure` cobra
   `spandsp >= 3.0` de qualquer jeito: *"no usable spandsp; please install
   spandsp3 devel package or equivalent"*.

O arranjo que fecha os três é **compilar a lib v3.1.1 e deixar `mod_spandsp`
fora do `modules.conf`**: o `configure` fica satisfeito e o arquivo que não
compila deixa de ser compilado. O que se perde é fax T.38 e detecção de DTMF
*inband* — e o currículo do PRD §7 F não pede nenhum dos dois. O DTMF do curso
é o RFC 2833, que o core resolve.

`mod_signalwire` fica fora pelo mesmo tipo de razão, com ganho maior: é o
conector da nuvem da SignalWire, não serve ao curso, e é ele que arrastaria
`libks` e `signalwire-c` — mais dois builds de fonte.

## 41. `--network none` funciona, mas exige desarmar o STUN e o IPv6

Esta é a decisão que preserva o Princípio 6 para a trilha F, e ela quase se
perdeu: na primeira execução o `mod_sofia` **não carregava**, e o sintoma
aparente era um FreeSWITCH que sobe, responde `status` e não tem stack SIP
nenhum. Duas causas, as duas do container sem rede:

- **Os perfis IPv6.** A config vanilla traz `internal-ipv6.xml` e
  `external-ipv6.xml`; sem endereço IPv6 o profile falha e derruba o load do
  módulo inteiro.
- **O STUN no `vars.xml`.** `external_rtp_ip` e `external_sip_ip` são
  resolvidos por `stun:stun.freeswitch.org`. Sem rede a consulta volta vazia, e
  o log diz `[ERR] sofia.c:5178 Invalid ext-rtp-ip` — seguido de
  `[CRIT] Error Loading module ... mod_sofia.so`.

Removidos os perfis IPv6 e fixados os dois endereços em `127.0.0.1`, com o
perfil de segurança COMPLETO do lab (`--cap-drop ALL`,
`no-new-privileges`, `--network none`):

```
     internal   profile   sip:mod_sofia@127.0.0.1:5060   RUNNING (0)
     external   profile   sip:mod_sofia@127.0.0.1:5080   RUNNING (0)
2 profiles 1 alias
```

35 ramais no diretório. **A trilha F não pede exceção de segurança nenhuma**,
igual à G.

Dois avisos aparecem no log e são inofensivos:
`Failed to set SCHED_FIFO scheduler` e `Could not set nice level` — ambos por
falta de `CAP_SYS_NICE`, que o lab não concede e o FreeSWITCH não exige.

## 42. O softphone é o `pjsua`, compilado — RESOLVIDO

O PRD nomeia `pjsua` em §7 F.3 e G.4 ("softphone `pjsua` real"). Medido: nem
`pjsua`, nem `pjproject`, nem `libpjproject-dev`, nem `python3-pjsua2` existem
nos repositórios do Ubuntu 24.04. O que existe empacotado: `linphone-cli`
5.2.0, `baresip` 1.0.0, `twinkle` 1.10.2 — os três presentes e instaláveis,
confirmado.

**Decidido em 2026-08-05: compilar o `pjproject` 2.15.1 junto**, num estágio
separado do Dockerfile. O que decidiu foi o custo medido contra o que só o
pjsua entrega:

| | medido |
|---|---|
| build do pjproject (sem vídeo) | **52 s** |
| binário, depois do `strip` | **2,1 MB** |
| peso que soma à imagem | ~5 MB, com a `libasound2t64` |

E o que ele dá e as alternativas não dão de graça: `--null-audio` (roda sem
placa de som), `--auto-answer 200` e `--duration` — ou seja, **um softphone que
termina sozinho**. Num projeto em que todo check é automático e determinístico,
um softphone que exige interação não serviria. De quebra, o PRD continua
literal.

O estágio é separado de propósito: ele não depende do FreeSWITCH, então o
BuildKit constrói os dois em paralelo e mexer num não invalida o cache do outro.

Provado no perfil de segurança completo do lab (`--network none`, `--cap-drop
ALL`, `no-new-privileges`, 512 MB, 256 pids): REGISTER autenticado por digest
(`401` → REGISTER → `200`), INVITE → `407` → INVITE → `100` → `200` → ACK,
BYE → `200`, e **RTP nos dois sentidos** entre dois ramais, com o FreeSWITCH no
meio da mídia. O CDR grava `NORMAL_CLEARING` com `billsec` igual à duração.

## 43. O `modules.conf` não é um arquivo comentável

Custou um build inteiro. O `configure.ac` do FreeSWITCH monta duas listas a
partir do mesmo arquivo (linhas 2300 e 2301):

```sh
CONF_MODULES='$$(grep -v "\#" modules.conf | ...)'                       # os ativos
CONF_DISABLED_MODULES='$$(grep "\#" modules.conf | grep -v "\#\#" | ...)' # os desligados
```

Ou seja: neste arquivo `#` **não abre comentário — desliga um módulo**. Um
cabeçalho de prosa com `#`, como qualquer outro arquivo de configuração
aceitaria, faz cada linha de texto virar um "módulo desabilitado" de nome
arbitrário, e o `src/mod/Makefile` gerado sai quebrado:

```
Makefile:730: *** missing separator.  Stop.
```

O escape é `##`, que os dois greps descartam — e é o que o cabeçalho do nosso
arquivo usa. Mesmo assim, **não escreva prosa livre ali**: `src/mod/Makefile.am`
faz `grep "$$modname$$"` sobre o arquivo INTEIRO, então um comentário que
termine com o nome de um módulo casa e envenena o `confmoddir` daquele módulo.
O cabeçalho seguro tem três linhas, nenhum nome de módulo e nenhum `|`. A
explicação de cada ausência mora no Dockerfile e aqui.

## 44. Um log de subida limpo é requisito de ENSINO, não estética

A config vanilla manda carregar ~50 módulos; a lista reduzida compila 34. Os
que sobram gritam ao subir:

```
[CRIT] switch_loadable_module.c:1754 Error Loading module .../mod_av.so
```

Nove deles: `mod_av`, `mod_dialplan_asterisk`, `mod_enum`, `mod_fsv`,
`mod_png`, `mod_rtc`, `mod_signalwire`, `mod_spandsp`, `mod_verto`. Nenhum é
defeito — e é exatamente por isso que precisam sumir. **A trilha F ensina a ler
o log de subida de um PBX.** Um aluno que aprende a ignorar nove `[CRIT]` de
rotina é um aluno treinado a ignorar o décimo, que seria real.

O passo é derivado, não uma lista escrita à mão: para cada `<load>` ativo cujo
`.so` não existe, a linha vira um comentário que diz o porquê. Quem abrir o
`modules.conf.xml` aprende alguma coisa em vez de achar um buraco.

Quem verifica isso é o **teste de fumaça dentro do build**: o Dockerfile sobe o
FreeSWITCH ainda no estágio final, conta os `[CRIT]`, exige 2 perfis SIP e
falha o build se algo escapar. Uma segunda varredura estática existiu e foi
removida — dentro de `"$(...)"` o shell come o `\K` do PCRE, o grep passa a
procurar `K` literal e a verificação aprovava qualquer coisa. Verificação que
não pode falhar é pior que nenhuma: dá o mesmo verde nos dois casos.

## 45. A senha padrão custa dez segundos em toda chamada

Esta é a parede mais cara desta rodada, porque o sintoma aponta para o lado
errado. O dialplan vanilla **pune** quem deixa `default_password=1234`:

```xml
<condition field="${default_password}" expression="^1234$" break="never">
  <action application="log" data="CRIT ... change the default_password."/>
  <action application="sleep" data="10000"/>
</condition>
```

Quatro `[CRIT]` no log **e dez segundos de espera em toda chamada**, antes de
qualquer coisa do dialplan. O que isso produz num lab: uma chamada curta é
cancelada pelo próprio chamador antes de ser atendida, e o CDR registra
`ORIGINATOR_CANCEL` — que descreve o chamador, não a causa. Medido: com
`--duracao 5` a chamada morre com `billsec=0`; com `--duracao 12` ela completa
com `billsec=2`, ou seja, dez segundos depois.

A senha do lab passou a ser `devlab`. O aviso não se perde: **vira material**.
Uma lição da trilha F devolve `1234` pelo `lab.break` e manda o aluno explicar
por que as chamadas ficaram lentas — que é o defeito real de um PBX que alguém
subiu com a config de exemplo.

## 46. O oráculo é o PBX, porque o log do softphone tem buffer

Duas versões erradas do `devlab-ramal`, as duas úteis de registrar.

**A primeira perguntava "existe um 200 OK no log?"** — e isso aprova toda
chamada que falhou, porque o REGISTER que veio antes também é respondido com
200 OK. Um INVITE morto em `487 Request Terminated` era relatado como
`chamada=completou`. O certo é o estado da chamada no softphone: só
`state changed to CONFIRMED` significa atendida.

**A segunda esperava a linha `registration success` aparecer no log.** Ela
aparece — mas o pjsua escreve o stdout com **buffer de bloco** quando a saída é
arquivo, então a linha só chega ao disco quando o buffer enche ou o processo
morre. O mesmo comando dava `registro=ok` numa execução e `registro=falhou` na
seguinte, com o log final, nos dois casos, mostrando `registration success,
status=200 (OK)`. Um check que falha sozinho às vezes é pior do que um que
falha sempre.

O oráculo certo já existia: **o registro é um fato do PBX, e o PBX responde** —
`sofia status profile internal reg`. O `stdbuf -oL` no pjsua ficou, mas para o
ALUNO: sem ele um `tail -f` durante o exercício não mostra nada até o fim.

Corolário para conteúdo: **o `billsec` do CDR não é determinístico.** Três
execuções do mesmo ciclo deram `2s` numa e `3s` nas outras duas, para a mesma
chamada de 3 segundos — é arredondamento de segundo inteiro. Os vereditos
(`registro=`, `chamada=`, `motivo_do_fim=`, código de saída) foram idênticos
nas três. Vale a decisão 27: campo de tempo não entra em saída de demonstração.

## A receita medida, verbatim

Este é o `Dockerfile` que **funcionou**, sem multi-stage — ele é a base do
`images/freeswitch-lab/` a ser escrito, não o arquivo final. O que falta é
separar o estágio de runtime (a instalação inteira são os 83 MB de
`/usr/local/freeswitch`, mais as libs de sofia-sip e spandsp) e embutir as
correções da decisão 41 no build em vez de aplicá-las à mão.

```dockerfile
ARG BASE=ubuntu:24.04
FROM ${BASE} AS construtor
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates wget curl build-essential automake autoconf libtool \
      libtool-bin pkg-config cmake yasm nasm \
      libssl-dev libcurl4-openssl-dev libpcre3-dev libedit-dev libsqlite3-dev \
      libspeex-dev libspeexdsp-dev libtiff-dev libopus-dev libldns-dev \
      libvpx-dev libmpg123-dev libshout3-dev libmp3lame-dev libsndfile1-dev \
      liblua5.2-dev uuid-dev libjpeg-dev zlib1g-dev libpq-dev unixodbc-dev \
      libavformat-dev libswscale-dev libavcodec-dev libavutil-dev \
 && rm -rf /var/lib/apt/lists/*

# O Ubuntu traz sofia-sip 1.12.11; o FreeSWITCH 1.10 exige a série 1.13.
RUN git clone --depth 1 --branch v1.13.17 \
      https://github.com/freeswitch/sofia-sip.git /usr/src/sofia-sip \
 && cd /usr/src/sofia-sip && ./bootstrap.sh \
 && ./configure --prefix=/usr --disable-stun \
 && make -j"$(nproc)" && make install

# Só para satisfazer o `configure` — ver a decisão 40.
RUN git clone --depth 1 --branch v3.1.1 \
      https://github.com/freeswitch/spandsp.git /usr/src/spandsp \
 && cd /usr/src/spandsp && ./bootstrap.sh && ./configure --prefix=/usr \
 && make -j"$(nproc)" && make install && ldconfig

RUN git clone --depth 1 --branch v1.10.12 \
      https://github.com/signalwire/freeswitch.git /usr/src/freeswitch

# O bootstrap REGENERA o modules.conf a partir do .in, então a lista reduzida
# só pode entrar DEPOIS dele. Trocar a ordem compila os ~100 módulos padrão
# sem dar aviso nenhum.
RUN cd /usr/src/freeswitch && ./bootstrap.sh -j
COPY modules.conf /usr/src/freeswitch/modules.conf

RUN cd /usr/src/freeswitch \
 && ./configure --prefix=/usr/local/freeswitch \
      --disable-dependency-tracking --enable-portable-binary \
      --with-gnu-ld --with-openssl \
 && make -j"$(nproc)" && make install && make sounds-install moh-install
```

Os 34 módulos do `modules.conf`, que é a lista mínima para o currículo do
PRD §7 F (registro, dialplan, aplicações de mídia, voicemail, URA, troncos,
CDR, ESL):

```
applications/mod_commands       codecs/mod_g723_1        formats/mod_local_stream
applications/mod_conference     codecs/mod_g729          formats/mod_native_file
applications/mod_db             codecs/mod_amr           formats/mod_sndfile
applications/mod_dptools        codecs/mod_b64           formats/mod_tone_stream
applications/mod_esf            codecs/mod_h26x          languages/mod_lua
applications/mod_expr           codecs/mod_opus          loggers/mod_console
applications/mod_fifo           dialplans/mod_dialplan_xml   loggers/mod_logfile
applications/mod_hash           endpoints/mod_loopback   loggers/mod_syslog
applications/mod_httapi         endpoints/mod_sofia      say/mod_say_en
applications/mod_sms            event_handlers/mod_cdr_csv   say/mod_say_pt
applications/mod_valet_parking  event_handlers/mod_event_socket
applications/mod_voicemail      xml_int/mod_xml_cdr
```

E as correções da decisão 41, a aplicar no build:

```sh
C=/usr/local/freeswitch/etc/freeswitch
rm -f "$C"/sip_profiles/*ipv6*.xml
sed -i 's|stun:stun.freeswitch.org|127.0.0.1|g' "$C/vars.xml"
```

Atenção a dois caminhos que já enganaram: os módulos ficam em
`/usr/local/freeswitch/lib/freeswitch/mod/`, e a configuração em
`/usr/local/freeswitch/etc/freeswitch/` — não em `mod/` e `conf/` sob o prefixo,
como a documentação mais antiga sugere.

---

## As duas ferramentas do lab

`devlab-pbx` e `devlab-ramal` são para a trilha F o que o `devlab-chamada` é
para a G, e cada uma existe por uma corrida medida:

- **`devlab-pbx iniciar`** só volta quando o `fs_cli` responde. O binário volta
  na hora, mas o PBX leva ~4 s para atender; sem a espera o primeiro comando do
  aluno falha com "Error Connecting to ... 8021" e ele conclui que o PBX não
  subiu. A lição viraria uma aula sobre a corrida.
- **`devlab-ramal`** registra e **só então** disca. O pjsua aceita um destino na
  linha de comando, mas quando recebe um ele disca antes de terminar o
  registro: o PBX responde `407` a um INVITE de um ramal que ainda não existe
  para ele, e a chamada morre sem erro visível.

Medido, com os limites padrão de um lab (1 CPU, 512 MB, 256 pids): o PBX sobe
em ~4 s, ocupa **29 pids dos 256** e **54 MB dos 512**. A trilha F não precisa
mexer nos limites nem pedir capacidade nenhuma além do que a G já pede.

## 47. A trilha F não declara prereq da G — e não cita as ferramentas dela

A pergunta estava em aberto: `tcpdump`, `tshark` e `sngrep` têm dono na trilha
G, a imagem da F os traz, e as lições da F vão querer diagnóstico. Decidido: **a F fica dentro das próprias ferramentas, sem
pré-requisito da G**, por três razões que se somam:

1. **A ordem do PRD §7 põe F antes de G.** Um prereq de lição da F para lição
   da G inverteria o currículo sugerido — quem seguisse a ordem oficial
   esbarraria numa trilha trancada pela trilha seguinte.
2. **A decisão 18 já dizia o porquê pedagógico:** na F o objeto de estudo é o
   comportamento do PBX, e o instrumento natural é o próprio PBX — `fs_cli`,
   o siptrace do sofia, a tabela de registro, o log, o CDR. "Ler o trace" do
   PRD §7 F.3 é o **siptrace**, não captura de pacote: a mesma história, pela
   boca de quem a conduziu.
3. **O validador varre até crase em prosa.** Nenhum bloco visível ao aluno
   (incluindo `dicas` e `solucao_referencia`) pode citar `tcpdump`, `tshark`
   ou `sngrep` sem o dono no fecho de prereqs. Os scripts de `verificar`,
   `lab.setup` e `lab.break` não são varridos — se um check da F um dia
   precisar de captura, é lá que ela mora.

As ferramentas continuam na imagem de propósito: quem já fez a G pode
capturar por conta própria dentro do lab da F, e o custo delas já está pago.

## 48. O break do capstone desacopla a senha dos ramais da variável global

O capstone do operador devolve `default_password=1234` (decisão 45) — e a
primeira tentativa produziu o sintoma errado. Medido: com a global em `1234`
depois do `reloadxml`, o **registro** passa a falhar (`403`), porque o
diretório vanilla define a senha de cada ramal como `$${default_password}` —
mudar a global muda junto a senha que os ramais precisam provar. O chamado
viraria "nada registra" em vez de "as chamadas estão lentas".

O break então faz duas trocas, nesta ordem: fixa nos ramais 1000–1019 o valor
**literal** `devlab` (o padrão do `devlab-ramal`) e só então põe a global em
`1234`. O dialplan pune a global (4 `[CRIT]` + `sleep` de dez segundos em toda
chamada), os registros continuam saudáveis, e o estado é plausível em campo:
alguém trocou as senhas dos ramais e esqueceu a variável global de exemplo.

Dois fatos medidos que as lições usam: `reloadxml` **reprocessa** o
`vars.xml` (o conserto não exige derrubar o PBX — `global_getvar` confirma o
valor vivo), e o oráculo de "voltou ao normal" é comportamento, não relógio:
uma chamada com `--duracao 4` só completa se for atendida antes disso — com a
espera de dez segundos ativa, o chamador desiste primeiro e o `devlab-ramal`
sai com erro.

---

# As decisões do nível Construtor (2026-08-07)

O Construtor é o nível em que o aluno **escreve config** pela primeira vez —
directory e dialplan. Isso muda a natureza do lab: até aqui ele interrogava um
PBX pronto; agora ele o modifica, e um erro dele tem de produzir um sintoma que
ENSINE. As seis decisões abaixo saíram de medição, e três delas mudaram o
desenho do nível.

## 49. O aluno escreve num contexto PRÓPRIO, não no `default`

A escolha óbvia era pôr as extensões do aluno em `dialplan/default/`, que é
onde o FreeSWITCH manda pôr (`X-PRE-PROCESS include data="default/*.xml"`, na
linha 796 do `default.xml` vanilla). Ela está errada, e o que a derruba é a
linha 839 — **depois** do include:

```xml
<extension name="acknowledge_call">
  <condition field="destination_number" expression="^(.*)$">
    <action application="acknowledge_call"/>
    <action application="ring_ready"/>
    <action application="playback" data="local_stream://moh"/>
```

O contexto `default` termina num **catch-all que atende qualquer número e toca
música**. Medido, com um número sem rota nenhuma:

| | no contexto `default` | em contexto próprio |
|---|---|---|
| o que o chamador ouve | música de espera, para sempre | nada; a chamada é recusada |
| resposta final | nenhuma — o chamador desiste (`487`) | **`404 Not Found`** |
| CDR | `ORIGINATOR_CANCEL` | **`NO_ROUTE_DESTINATION`** |
| log | silêncio sobre o problema | `No Route, Aborting` |

Ou seja: no `default`, um erro de regex do aluno vira *música de espera* —
sintoma que não aponta para causa nenhuma, e que ele leria como "minha extensão
não carregou". Em contexto próprio, o mesmo erro vira `404` com o CDR dizendo o
nome do defeito.

O segundo motivo é o log. O FreeSWITCH narra o dialplan enquanto o percorre —
`parsing [contexto->extensão]`, `Regex (PASS|FAIL) [nome] destination_number(N)
=~ /regex/` — e essa narração é o melhor material de ensino que o nível tem,
porque mostra **ordem de avaliação** (PRD §7 F.5) acontecendo. Medido no mesmo
número: **mais de 100 linhas** de walk no `default`, contra **5 linhas** no
contexto do aluno. A mesma lição, legível ou ilegível, pela escolha do contexto.

Ligar um usuário ao contexto é uma variável do directory, e isso emenda com a
decisão seguinte: `<variable name="user_context" value="oficina"/>`.

O `default` não vira inimigo — ele continua lá, e é onde os ramais 1000–1019
moram. O aluno vê os dois, e a diferença entre eles é conteúdo.

## 50. `reloadxml` mente três vezes, e a terceira é a cara

Este é o trecho mais caro do nível, porque o sintoma é *nada acontecer*. Com um
`</extension>` faltando no arquivo do aluno:

```
$ devlab-pbx cli reloadxml
+OK [[error near line 7029]: unexpected closing tag </section>]
$ echo $?
0
```

1. **O erro vem dentro de um `+OK`.** Quem lê a primeira palavra conclui que
   deu certo.
2. **O código de saída é 0.** Um check que testasse `reloadxml` por status
   aprovaria XML quebrado — e é por isso que nenhum check do nível faz isso.
3. **O documento ANTERIOR continua vivo.** Medido: com o arquivo quebrado no
   disco, `xml_locate dialplan context name oficina` devolveu as extensões da
   versão *antiga*, e uma chamada continuou sendo roteada por elas. O PBX
   rejeitou o documento novo inteiro e seguiu com o que já tinha.

O número da linha (`7029`) é do documento MONTADO — todos os arquivos
concatenados —, não do arquivo do aluno. Procurar a linha 7029 no próprio
arquivo é perda de tempo, e é o primeiro impulso de quem lê.

A imagem **não tem `xmllint`** (medido). Quem valida o XML do aluno é o próprio
PBX, e a leitura certa da resposta do `reloadxml` é conteúdo da lição 3.

Consequência de projeto: **o oráculo de "a sua config entrou" nunca é o
`reloadxml`** — é o que o PBX tem VIVO na memória (decisão 51) ou o
comportamento de uma chamada.

## 51. O PBX responde três perguntas sobre o directory, e elas são o oráculo

A decisão 46 já dizia que quem sabe se um ramal registrou é o PBX. O Construtor
precisa de mais do que isso — precisa saber se o *usuário existe* e se as
variáveis dele são as que o aluno escreveu. O FreeSWITCH tem as três respostas
prontas, e todas leem a config VIVA (o que as faz atravessar a decisão 50):

```
user_exists id 1050 127.0.0.1              → true | false
user_data 1050@127.0.0.1 param password    → devlab
user_data 1050@127.0.0.1 var user_context  → oficina
```

Medido: com o XML quebrado no disco, essas três continuam respondendo o valor
ANTIGO — que é exatamente o comportamento desejado num oráculo, porque é o que
o PBX vai de fato usar quando a chamada chegar.

Um quarto fato, do CDR: a **coluna 4 é o `context`**. `"1002","1002","7300",
"oficina",…` prova, sem ambiguidade, qual contexto roteou a chamada — é o
oráculo do capstone.

E o `a1-hash` fecha sozinho, medido nos dois sentidos: com
`a1-hash = md5("1051:127.0.0.1:outrasenha")` o ramal registra com
`outrasenha` e é recusado com qualquer outra. O realm é o `domain`
(`127.0.0.1` no lab) — trocar o realm quebra o hash sem mudar a senha, que é o
`403` clássico do PRD §7 G.5, aqui pela porta de quem CRIOU o usuário.

## 52. `--no-vad` é o que torna a aplicação `record` ensinável

`record` está no PRD §7 F.6 e quase não coube, por uma razão que não aparece em
lugar nenhum da documentação do FreeSWITCH: **o detector de silêncio do
softphone**.

Com o `pjsua` no padrão (VAD ligado) e `--null-audio` lhe entregando silêncio
digital, ele para de transmitir RTP em cerca de meio segundo. O que a central
grava então não é a chamada. Medido, numa chamada de 8 segundos com
`record <arquivo> 4`:

| | VAD ligado (padrão) | `--no-vad` |
|---|---|---|
| `record_seconds` | **0** | **4** |
| `record_ms` | 580 | 4380 |
| tamanho | 9324 bytes | ~70 KB |

E o pior: os 9324 bytes eram **idênticos em três execuções**. Determinístico e
errado — um check apoiado neles passaria para sempre, ensinando que uma
gravação de 4 segundos tem meio segundo.

`--no-vad` entrou no `devlab-ramal` por isso. O que se grava continua sendo
silêncio (não há microfone num lab), então **a lição cobra a duração e o
caminho do arquivo, nunca o conteúdo sonoro** — e diz isso ao aluno, em vez de
deixá-lo procurar áudio que não existe.

Corolário para a decisão 27, e ele **corrige o que esta decisão dizia antes**:
nem `record_ms`, nem o tamanho em bytes, nem **`record_seconds`** servem para
demonstração ou check exato.

A primeira versão desta decisão afirmava que `record_seconds` era estável, por
ser "o limite pedido". Não é. O `record` para **perto** do limite, não nele, e
a folga é grande: sete execuções do mesmo roteiro de 4 segundos produziram
arquivos de **65004 a 78444 bytes** — de 4,06 s a 4,9 s de áudio — e a variável
`record_seconds` veio `4` em seis delas e `5` na sétima, que foi justamente a
que o `capturar-demonstracao.py` gravou. Um número que aparece uma vez em sete
é a pior espécie de saída de demonstração: passa em toda conferência que você
roda de propósito e quebra sozinho semanas depois.

O que uma lição pode cobrar de uma gravação é que **ela exista, no caminho
declarado, com conteúdo**. Duração é cronômetro, e vale a decisão 27.

## 53. `--digitos` manda DTMF, e espera o canal ficar `ACTIVE`

`play_and_get_digits` está no PRD §7 F.6 e não havia como exercitá-lo: o
`pjsua` só manda DTMF pelo console interativo (`#`, e a sequência na linha
seguinte). A opção `--digitos` do `devlab-ramal` embrulha isso.

O quando é que era o problema. Dígito mandado antes de o dialplan chegar ao
`play_and_get_digits` cai no vazio, e um `sleep` chutado troca uma corrida por
outra — o defeito que este script existe para matar (decisão 42). O oráculo, de
novo, é o PBX: `show channels` traz uma linha CSV por canal vivo, com o destino
discado e a coluna `callstate`, e **`ACTIVE` é o estado em que o dialplan já
passou do `answer`**.

Medido ponta a ponta: `devlab-ramal 1002 --discar 7400 --digitos "1234#"`
devolve `escolha=1234` na variável de canal, com o FreeSWITCH registrando os
cinco dígitos RFC 2833.

## 54. Condição de horário: quem calcula o ramo esperado é o check

Roteamento por horário está no PRD §7 F.6, e `<condition hour="8-17">` com
`anti-action` funciona (medido: às 19:48 UTC o `Date/TimeMatch (FAIL)` levou ao
ramo de fora de hora). Mas um check que exigisse "caiu no ramo comercial"
**reprovaria o aluno que estudasse de madrugada** — e o relógio do container é o
do host, então não há como fixá-lo sem mentir sobre o ambiente.

**Correção do que esta decisão dizia antes.** "O relógio do container é o do
host" é verdade sobre o *instante* e falsa sobre a *leitura*, e a diferença é
grande o bastante para confundir um aluno. Medido no mesmo minuto:

| | |
|---|---|
| host | `2026-08-12 22:39 -03` (`America/Sao_Paulo`) |
| container do lab | `2026-08-13 01:39 UTC` (`Etc/UTC`) |
| diferença de epoch | **1 s** — só a latência de subir o container |

Mesmo instante, **três horas e um dia** de diferença na leitura. Isso não
quebra o check, porque check e dialplan leem o mesmo relógio (o do container) —
mas quebra o aluno, que confere pelo relógio de pulso. Um aluno em Brasília às
6h da manhã está às 9h para a central: **dentro** do horário comercial,
contrariando o pulso dele.

A saída não foi alinhar o fuso — seria mentir sobre o ambiente, e um PBX cujo
fuso não é o de quem o opera é um defeito de campo, não uma esquisitice de lab.
A lição passou a **dizer** que o lab roda em UTC, a ensinar
`devlab-pbx cli "strftime %H:%M %Z"` como o jeito de perguntar, e as mensagens
dos checks passaram a dizer "são NNh **na central**". O buraco virou o
conteúdo que a própria lição já prometia: *pergunte a hora a quem vai decidir*.

**Nota de ambiente, não do produto:** nesta máquina o relógio do WSL2 **pulou
cinco dias** no meio de uma sessão (containers mostravam 7 de agosto enquanto o
host já estava em 12), e depois os dois voltaram a concordar. É deriva conhecida
de WSL2 depois de o Windows suspender, e corrige sozinha na sincronização
seguinte. Não afeta os checks — eles leem o relógio e cobram o ramo daquele
mesmo instante —, mas se um dia um veredito de horário parecer impossível,
confira o relógio antes de culpar o dialplan.

A saída: o check lê a hora corrente e cobra o ramo que ELA implica. O aluno é
avaliado por ter escrito a condição certa, não por estudar no horário
comercial. Vale a decisão 27 pelo avesso: quando a saída não pode ser fixa, o
oráculo é que se torna função do relógio.

---

# As decisões do nível Engenheiro (2026-08-13)

## 55. O detector de silêncio do voicemail sai, ou não há lição de voicemail

Terceira vez que o mesmo inimigo aparece, e vale nomeá-lo: **um lab sem
microfone quebra tudo o que decide por energia de áudio.** Já custou o VAD do
softphone (decisão 52); agora custa o voicemail.

Com o padrão do FreeSWITCH — `record-silence-threshold=200`,
`record-silence-hits=2` — **nenhuma mensagem chega a ser gravada**. O softphone
manda silêncio digital, energia 0, os dois "hits" acontecem nos primeiros
quadros, e o log diz:

```
Message is less than minimum record length: 3, discarding it.
```

O sintoma é o pior tipo: a chamada completa, a caixa atende, o chamador ouve a
saudação e o bipe, e **a caixa fica vazia sem erro nenhum**. Uma chamada de 35 s
produzia zero mensagens.

Com `record-silence-threshold=0` a detecção sai do caminho e a mensagem é
gravada até o chamador desligar. Medido na imagem, sem ajuste manual: uma
chamada de 28 s deixa uma mensagem de 16 s (a saudação come o resto), e o PBX a
lista com metadados que servem de oráculo:

```
vm_list 1010@127.0.0.1
1786616584:0:1010:127.0.0.1:inbox:/…/msg_….wav:…:Extension 1001:1001:16
   epoch  lida caixa  domínio  pasta    arquivo    uuid    nome      de   dur
```

Estável para check: caixa, domínio, pasta e quem ligou. **Instável:** epoch,
uuid, caminho (que contém o uuid) e duração — vale a decisão 27.

## 56. MWI funciona, e o softphone consegue mostrar a lâmpada

`--mwi` no `pjsua` assina `message-summary` no registro, e o FreeSWITCH
responde com um NOTIFY que o próprio pjsua imprime:

```
Received MWI for acc 1:
Messages-Waiting: yes
Voice-Message: 1/0 (0/0)
```

O `devlab-ramal` ganhou `--mwi` e extrai isso como veredito, no mesmo formato
dos outros: `aviso_de_mensagem=sim` e `mensagens_novas_e_salvas=1/0`. É o único
jeito de um softphone headless mostrar que a lâmpada de recado acendeu.

## 57. `${var:+...}` pergunta se a variável está VAZIA — e `0` não está

Bug introduzido e pego no mesmo dia, pelo `--conferir`. A opção nova entrou como
`${mwi:+--mwi}` com `mwi=0` por padrão — e **`"0"` é string não vazia**, então
todo softphone do lab passou a assinar MWI. Uma SUBSCRIBE e uma NOTIFY a mais no
tráfego SIP de **todas** as lições; quem denunciou foi uma projeção de `From:`
que ganhou uma linha.

O mesmo defeito estava em `${atender:+--auto-answer 200}` desde o começo, calado
porque auto-atender é inofensivo em quem só liga. As duas opções agora vão num
array (`extras=()`), com `[ "$x" = 1 ]` decidindo. Confirmado depois: as 11
demonstrações de PBX voltaram a bater, e `--atender` continua atendendo.

## 58. O FreeSWITCH escreve o veredito de horário de DUAS formas

A mais barata de errar e a mais cara de descobrir:

```
Date/Time Match (PASS)     ← com espaço
Date/TimeMatch (FAIL)      ← sem espaço
```

Não é erro de transcrição: é o que o FreeSWITCH emite. Um filtro com uma das
formas aprova metade das horas do dia e reprova a outra metade.

E o modo como isso apareceu é a parte que interessa: o check da lição
`pbx-con-05-midia` procurava só `Date/TimeMatch`, e **passou em todas as
validações** porque todas rodaram à noite no Brasil — ou seja, fora de 8–17
**UTC**, sempre no ramo FAIL. Bastou validar às 10h UTC para o ramo PASS ser
exercitado pela primeira vez e o check reprovar.

Corolário para qualquer check que dependa do relógio: **ele precisa ser
exercitado nos dois ramos antes de merecer confiança.** Um único horário de
validação esconde metade do código. A lição passou a aceitar `Date/Time ?Match`
e a ENSINAR a discrepância, que é o tipo de coisa que quem filtra log de PBX vai
encontrar sozinho, no pior momento.

---

# As decisões que as seis lições do Engenheiro custaram (2026-08-13)

As seis abaixo saíram de escrever o nível, e três delas **corrigem o que este
documento e a intuição diziam antes**.

## 59. Um `bridge` que falha nem sempre encerra a chamada: depende da causa

A crença — inclusive a que a primeira versão da lição 1 ensinava — era que um
`bridge` sem `continue_on_fail` derruba a chamada. **Não derruba.** Medido nos
três estados em que um ramal chamado pode estar, com o mesmo dialplan:

| estado do ramal | causa | sem `continue_on_fail` | o chamador recebe |
|---|---|---|---|
| registrado, toca, ninguém pega | `NO_ANSWER` (19) | o roteiro **continua** | é atendido pela caixa |
| softphone morto, registro ainda na tabela | `NORMAL_TEMPORARY_FAILURE` (41) | o roteiro **para** | `503` |
| registro já fora da tabela | `USER_NOT_REGISTERED` (806) | o roteiro **para** | `480` |

O estado do meio é o mais provável logo depois de alguém desligar um telefone
(o registro dura minutos), e é o mesmo "aparece registrado e não toca" da lição
3 do operador.

Consequência de conteúdo: a lição não pode ensinar "sem `continue_on_fail` a
caixa postal não atende" — porque atende, no caso em que quase todo mundo
testa. O que ela ensina é que o comportamento padrão **muda com a causa**, e
que declarar é mais barato do que decorar a lista.

Isto também obrigou a criar `devlab-ramal --nao-atender`: sem um ramal
registrado que TOCA e não atende, não há como produzir `NO_ANSWER`, e as duas
primeiras lições do nível ficariam sem o estado que interessa.

## 60. `call_timeout` é da caçada; `leg_timeout` é do membro — e vai na string

Num grupo de toque sequencial (`|`), `set call_timeout=5` **não** dá cinco
segundos a cada telefone: dá cinco segundos à caçada inteira. Medido: o log
mostra um único `New Channel`, `NO_ANSWER`, e o segundo membro nunca é tentado.

O relógio por membro se escreve **dentro** da string de discagem, e as duas
formas funcionam:

```
{leg_timeout=4}user/1071@…|user/1073@…      ← vale para todos os destinos
[leg_timeout=4]user/1071@…|[leg_timeout=4]user/1073@…   ← por destino
```

Com ele, cada membro morre com `ALLOTTED_TIMEOUT` e o seguinte nasce. Sem ele,
o grupo sequencial é um grupo de um membro só, e o defeito passa em qualquer
teste em que o primeiro telefone atenda.

As duas assinaturas que separam as estratégias no log, e que são os oráculos
dos checks (nada de cronômetro — decisão 27):

| estratégia | evidência |
|---|---|
| simultâneo (`,`) | os canais nascem **todos antes** de qualquer morte, e os perdedores morrem com `LOSE_RACE` |
| sequencial (`\|`) | cada `New Channel` vem **depois** do `ALLOTTED_TIMEOUT` do anterior, e não há `LOSE_RACE` |

## 61. O tronco do lab é o próprio perfil externo, e a perna B é quem sabe disso

Um gateway apontando para `127.0.0.1:5080` faz a chamada sair pelo perfil
externo e voltar por ele, caindo no contexto `public` — o mesmo percurso, os
mesmos dois contextos e os mesmos contadores de um tronco real. Medido ponta a
ponta: ramal → `bridge sofia/gateway/operadora/…` → `sofia/external/…` →
`public` → `transfer` → ramal de destino, com `CallsOUT` do gateway indo de 0
a 1. É o que torna troncos, DID e failover ensináveis com `--network none`.

O failover é a mesma lista da decisão 60 aplicada a gateways: um tronco morto
(porta fechada) recusa **na hora**, com `NORMAL_TEMPORARY_FAILURE`, e a lista
segue para o seguinte. Os contadores são o oráculo, e são complementares:
`FailedCallsOUT` sobe no reserva, `CallsOUT` sobe no principal.

E o bilhete: **`${sip_gateway_name}` é variável da perna B**. Com o
`legs="a"` de fábrica a coluna do tronco existe e vem sempre vazia — o pior dos
mundos, porque parece que a central não tem o dado. Com `legs="ab"` uma chamada
que passou por failover deixa duas linhas, uma por tronco tentado, cada uma com
a própria causa.

## 62. `reloadxml` mente mais duas vezes, e a segunda é silenciosa

A decisão 50 listou três mentiras. Faltavam duas, as duas medidas aqui:

**4. Ele não instancia gateway novo.** O arquivo está no disco, o XML está
certo, o `reloadxml` responde `+OK`, e `sofia status gateway <nome>` responde
`Invalid Gateway!`. Quem instancia é `sofia profile external rescan`.

**5. Um `<include>` numa linha só é ignorado sem aviso nenhum.** Isto custou
uma investigação inteira. O pré-processador do FreeSWITCH remove o invólucro
`<include>` por LINHA; um arquivo escrito assim:

```xml
<include><user id="1089"><params>…</params></user></include>
```

é XML perfeitamente válido, passa em `xml.etree`, o `reloadxml` responde
`+OK [Success]` — e `user_exists id 1089` responde **`false`**. O usuário
simplesmente não existe. O mesmo vale para gateway em `sip_profiles/external/`.
A tag de abertura e a de fechamento precisam estar em linhas próprias.

Corolário que já valia e agora vale mais: **o oráculo de "a minha config
entrou" é sempre a central viva** — `user_exists`, `user_data`,
`sofia status gateway` — e nunca o arquivo nem a resposta do `reloadxml`.

## 63. O primeiro teto de capacidade é de config, e o sintoma é recusa, não lentidão

A trilha G deixou carga e capacidade para cá (decisão 37), e o que a F encontra
primeiro não é a máquina:

```
[CRIT] switch_time.c:1243 Over Session Rate of 30!
[CRIT] switch_core_session.c:2422 Throttle Error! 47
```

`sessions-per-second` nasce em **30**. Medido nos limites padrão de um lab
(1 CPU, 512 MB, 256 pids), com `sipp -sn uac` contra a porta 5080:

| teto | 120 chamadas a 60/s | 120 chamadas a 40/s | avisos no log |
|---|---|---|---|
| 30 (fábrica) | ~52 a 58 recusadas | ~22 a 30 recusadas | `Over Session Rate of 30!` |
| 120 | **0 recusadas** | **0 recusadas** | nenhum |

A lição cobra a taxa de **40/s**, e não a de 60: as duas passam do teto de
fábrica com folga, e a de 40 deixa margem para a máquina que roda o teste estar
ocupada com outra coisa — que é o caso toda vez que o `npm run valida` roda a
suíte inteira.

O que o gerador recebe é `SIP/2.0 503 Maximum Calls In Progress`, **na hora** —
descarte de excesso, não degradação. As chamadas que entraram não são afetadas,
e o sintoma em campo é "algumas ligações não completam no pico, mas as que
completam ficam perfeitas". Quem lê isso como lentidão vai investigar codec,
rede e disco e não vai achar nada.

Dois números **não** entram em saída de demonstração (decisão 27): quantas
completaram e quantas falharam sob excesso. Foram medidos 52, 57 e 58 falhas em
execuções do mesmo comando. O que é estável, e por isso é o que as lições
mostram, é a **resposta SIP** e a **linha do log** — as duas idênticas em toda
execução.

E o parâmetro tem dois lugares, com efeitos diferentes: `fsctl sps <n>` vale
agora e morre no restart; `sessions-per-second` no `switch.conf.xml` vale a
partir do próximo restart. **`reloadxml` não aplica nenhum dos dois** — este é
lido pelo núcleo na subida. Quem muda em produção muda os dois.

Um segundo teto existe e não foi encontrado neste hardware: `max-sessions`
nasce em 1000, e o `pids.current` do container ficou em 149 dos 256 no pico da
carga. O muro do hardware está acima do que estes testes exercitaram, e a lição
diz isso em vez de prometer um número.

## 64. `devlab-pbx parar` voltava antes de o processo morrer

Defeito real da ferramenta, encontrado ao escrever a lição de carga e
consertado. O `parar` esperava o `fs_cli` deixar de responder — o que acontece
uns 3 s depois do `shutdown` — e declarava vitória. Mas o processo continua
vivo por **mais de 10 s** depois disso, e um `devlab-pbx iniciar` nessa janela
falha CALADO: a instância nova encontra a antiga ainda de pé, desiste sem
escrever no log, e o `iniciar` fica 60 s esperando um PBX que nunca vai subir.

O `parar` passou a esperar o estado do processo em `/proc`. Ele espera até `Z`,
e não até o processo sumir, porque o PID 1 deste container é um `sleep`, que
não recolhe zumbi nenhum — esperar o desaparecimento travaria para sempre.
Medido depois: três ciclos `parar`/`iniciar` seguidos, todos limpos, com o
`parar` levando ~5 s em vez de ~3 s.

## O que o nível Engenheiro NÃO cobre, e por quê

O PRD §7 F.8 pede **URA com menus aninhados**, e F.10 cita **`mod_conference`**.
Nenhum dos dois virou lição, e a razão é a mesma: o capstone do nível
Construtor já entrega URA de um nível com `play_and_get_digits` e `transfer`, e
aninhar menus é repetir aquele mecanismo mais fundo — custo alto de lição,
capacidade nova baixa. `mod_conference` está compilado e disponível, e ficou
fora porque as seis lições escolhidas cobrem F.7, F.9 e F.10 com defeitos de
campo, que é o critério da trilha. A capacidade declarada em `trilha.yaml` foi
escrita para não prometer nenhum dos dois.

---

## O que ainda não foi decidido

- **Multi-container ou um só.** O PRD §4.2 prevê `compose.yaml` para labs de
  VoIP, e o `GerenciadorDeLabs` hoje só sabe subir uma imagem. Com FreeSWITCH e
  softphone na mesma imagem, conversando por `127.0.0.1`, a trilha F cabe no
  gerenciador atual — como coube a G. Isso está agora **medido, não suposto**:
  dois ramais registrados e uma chamada com RTP bidirecional, tudo dentro de um
  container só, sem rede. Não mexa no agente por causa da trilha F.
- **Se o Asterisk entra.** Ele está nos repos (1:20.6.0), sobe em container e
  tem PJSIP completo — provado em 2026-08-05. O PRD reserva a trilha I para
  ele, e a comparação direta FreeSWITCH × Asterisk é conteúdo do currículo.
  Uma armadilha já paga: **`--no-install-recommends` instala o Asterisk sem
  módulo nenhum**; é preciso pedir `asterisk asterisk-modules asterisk-config`
  explicitamente, e os módulos ficam em
  `/usr/lib/x86_64-linux-gnu/asterisk/modules`.
