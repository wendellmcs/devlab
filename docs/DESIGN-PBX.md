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
| build a frio, ponta a ponta | **221 s** |
| só o FreeSWITCH (`configure` + `make -j10` + `install`) | ~60 s, 407 unidades compiladas |
| instalação em disco | **83 MB** (22 MB módulos, 57 MB áudios, 1,5 MB config) |
| imagem single-stage, com o builder dentro | 1,92 GB — o multi-stage descarta quase tudo |
| módulos compilados | 34, contra os ~100 do `modules.conf` padrão |

A lista reduzida de módulos é metade da explicação do tempo; os núcleos são a
outra. Num laptop de 4 núcleos espere algo em torno de 8 a 10 minutos.

E o portão não paga isso repetidamente: `scripts/build-imagens.sh` compara uma
impressão digital do contexto com o label `devlab.contexto` da imagem e **não
chama o `docker build`** quando nada mudou. O custo é uma vez por máquina e uma
vez por mudança na imagem — a verificação por worktree (decisão 15) passa
batido, porque o checkout tem os mesmos bytes.

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

## 42. `pjsua` não está empacotado, e o PRD conta com ele

O PRD nomeia `pjsua` em §7 F.3 e G.4 ("softphone `pjsua` real"). Medido: nem
`pjsua`, nem `pjproject`, nem `libpjproject-dev`, nem `python3-pjsua2` existem
nos repositórios do Ubuntu 24.04.

O que existe empacotado: `linphone-cli` 5.2.0, `baresip` 1.0.0, `twinkle`
1.10.2. As saídas são três, e a escolha ainda não foi feita:

| saída | custo |
|---|---|
| compilar `pjproject` junto | mais um build de fonte na mesma imagem |
| trocar por `linphone-cli` | `linphonec`/`linphonecsh`, roteirizável |
| trocar por `baresip` | CLI mais simples, boa para script |

A decisão só é urgente na lição de registro do softphone (F.3).

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

## O que ainda não foi decidido

- **O softphone** (decisão 42).
- **Multi-container ou um só.** O PRD §4.2 prevê `compose.yaml` para labs de
  VoIP, e o `GerenciadorDeLabs` hoje só sabe subir uma imagem. Com FreeSWITCH e
  softphone na mesma imagem, conversando por `127.0.0.1`, a trilha F cabe no
  gerenciador atual — como coube a G. É o caminho de menor risco, e vale
  medi-lo antes de mexer no agente.
- **Se o Asterisk entra.** Ele está nos repos (1:20.6.0), sobe em container e
  tem PJSIP completo — provado em 2026-08-05. O PRD reserva a trilha I para
  ele, e a comparação direta FreeSWITCH × Asterisk é conteúdo do currículo.
  Uma armadilha já paga: **`--no-install-recommends` instala o Asterisk sem
  módulo nenhum**; é preciso pedir `asterisk asterisk-modules asterisk-config`
  explicitamente, e os módulos ficam em
  `/usr/lib/x86_64-linux-gnu/asterisk/modules`.
