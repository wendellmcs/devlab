# devlab/freeswitch-lab — a imagem da trilha F (PBX com FreeSWITCH).
#
# Por que compilada do fonte: os pacotes oficiais do FreeSWITCH exigem token da
# SignalWire — HTTP 401 nos dois repositórios, reconferido em 2026-08-05. Um
# curso que pede conta em serviço de terceiro antes da primeira lição quebra a
# promessa do PRD §4.8 ("o primeiro build exige internet; depois disso,
# offline"). Compilar custa 221 s a frio nesta máquina de 10 núcleos e 83 MB
# instalados — medido, não estimado. As decisões 39 a 42 estão em
# docs/DESIGN-PBX.md, e LER AQUELE ARQUIVO É OBRIGATÓRIO antes de mexer aqui:
# ele traz as cinco paredes que custaram uma tentativa cada.
#
# Multi-stage porque o construtor pesa 1,92 GB e o que interessa são os 83 MB
# de /usr/local/freeswitch mais duas bibliotecas compiladas junto (sofia-sip e
# spandsp). O resto — compiladores, headers, três árvores de fonte — fica no
# estágio descartado.
#
# A base é um ARG com padrão FIXO, pelo mesmo motivo da linux-base e da
# voip-tools: o catálogo de erros casa mensagens LITERAIS por regex, e elas
# mudam entre releases. Só a base padrão é exercitada pelo CI.
ARG BASE=ubuntu:24.04

# ---------------------------------------------------------------------------
# Estágio 1 — construtor. Descartado inteiro; só saem daqui três caminhos.
# ---------------------------------------------------------------------------
FROM ${BASE} AS construtor

ENV DEBIAN_FRONTEND=noninteractive

# Versões fixadas, e cada uma por um motivo medido:
#   sofia-sip 1.13.17  o Ubuntu traz a 1.12.11 e o FreeSWITCH 1.10 exige a série 1.13
#   spandsp   3.1.1    a série 3.0 que o FreeSWITCH pede NÃO EXISTE no repositório
#   freeswitch 1.10.12 a última da série estável 1.10
ARG VERSAO_SOFIA=v1.13.17
ARG VERSAO_SPANDSP=v3.1.1
ARG VERSAO_FREESWITCH=v1.10.12

RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates wget curl build-essential automake autoconf libtool \
      libtool-bin pkg-config cmake yasm nasm \
      libssl-dev libcurl4-openssl-dev libpcre3-dev libedit-dev libsqlite3-dev \
      libspeex-dev libspeexdsp-dev libtiff-dev libopus-dev libldns-dev \
      libvpx-dev libmpg123-dev libshout3-dev libmp3lame-dev libsndfile1-dev \
      liblua5.2-dev uuid-dev libjpeg-dev zlib1g-dev libpq-dev unixodbc-dev \
      libavformat-dev libswscale-dev libavcodec-dev libavutil-dev \
 && rm -rf /var/lib/apt/lists/*

# `--disable-stun`: o STUN da sofia-sip não serve a nada num lab sem rede, e a
# decisão 41 mostra que consulta de STUN é justamente o que derruba o mod_sofia
# num container `--network none`.
RUN git clone --depth 1 --branch ${VERSAO_SOFIA} \
      https://github.com/freeswitch/sofia-sip.git /usr/src/sofia-sip \
 && cd /usr/src/sofia-sip \
 && ./bootstrap.sh \
 && ./configure --prefix=/usr --disable-stun \
 && make -j"$(nproc)" && make install

# A spandsp existe aqui só para satisfazer o `configure` do FreeSWITCH, que
# cobra `spandsp >= 3.0` mesmo com o mod_spandsp fora da lista. Ver a decisão 40.
RUN git clone --depth 1 --branch ${VERSAO_SPANDSP} \
      https://github.com/freeswitch/spandsp.git /usr/src/spandsp \
 && cd /usr/src/spandsp \
 && ./bootstrap.sh \
 && ./configure --prefix=/usr \
 && make -j"$(nproc)" && make install && ldconfig

RUN git clone --depth 1 --branch ${VERSAO_FREESWITCH} \
      https://github.com/signalwire/freeswitch.git /usr/src/freeswitch

# ORDEM CRÍTICA: o `bootstrap.sh` REGENERA o modules.conf a partir do `.in`.
# A lista reduzida só pode entrar DEPOIS dele. Trocar as duas linhas compila os
# ~100 módulos padrão sem dar aviso nenhum — o build passa, demora o triplo e
# a imagem engorda.
#
# E o modules.conf NÃO É um arquivo comentável (decisão 43): `configure.ac`
# monta a lista de ativos com `grep -v "#"` e a de DESABILITADOS com
# `grep "#" | grep -v "##"`, então cada linha de prosa vira um módulo
# desabilitado de nome arbitrário e o `src/mod/Makefile` gerado sai quebrado
# ("missing separator"). Duas ausências deliberadas, explicadas na decisão 40:
# `mod_spandsp` (não compila contra a spandsp 3.1, e a série 3.0 que o
# FreeSWITCH pede não existe mais — custo: sem fax T.38 e sem DTMF inband, e o
# DTMF do curso é o RFC 2833, que o core resolve) e `mod_signalwire` (conector
# da nuvem da SignalWire, que arrastaria `libks` e `signalwire-c`).
RUN cd /usr/src/freeswitch && ./bootstrap.sh -j
COPY modules.conf /usr/src/freeswitch/modules.conf

RUN cd /usr/src/freeswitch \
 && ./configure --prefix=/usr/local/freeswitch \
      --disable-dependency-tracking --enable-portable-binary \
      --with-gnu-ld --with-openssl \
 && make -j"$(nproc)" \
 && make install \
 && make sounds-install moh-install

# As correções da decisão 41, aplicadas no BUILD em vez de à mão. Sem elas o
# mod_sofia não carrega num container sem rede, e o sintoma aparente é um
# FreeSWITCH que sobe, responde `status` e não tem stack SIP nenhum:
#
#   [ERR]  sofia.c:5178 Invalid ext-rtp-ip
#   [CRIT] Error Loading module .../mod_sofia.so
#
# 1) Perfis IPv6: a config vanilla traz internal-ipv6.xml e external-ipv6.xml;
#    sem endereço IPv6 o profile falha e derruba o load do módulo INTEIRO.
# 2) STUN no vars.xml: external_rtp_ip e external_sip_ip são resolvidos por
#    `stun:stun.freeswitch.org`. Sem rede a consulta volta vazia.
# 3) mod_event_socket escuta em `::` por padrão — mesma família de problema, e
#    o ESL é ferramenta de lição do currículo F.
RUN C=/usr/local/freeswitch/etc/freeswitch \
 && rm -f "$C"/sip_profiles/*ipv6*.xml \
 && sed -i 's|stun:stun.freeswitch.org|127.0.0.1|g' "$C/vars.xml" \
 && sed -i 's|<param name="listen-ip" value="::"/>|<param name="listen-ip" value="127.0.0.1"/>|' \
      "$C/autoload_configs/event_socket.conf.xml" \
 && rm -rf /usr/local/freeswitch/include

# A senha padrão, e ela NÃO é cosmética (decisão 45). O dialplan vanilla pune
# quem deixa `default_password=1234`, e a punição é dupla:
#
#   <condition field="${default_password}" expression="^1234$" break="never">
#     <action application="log" data="CRIT ... change the default_password."/>
#     <action application="sleep" data="10000"/>
#
# Ou seja: quatro [CRIT] no log E DEZ SEGUNDOS de atraso em TODA chamada, antes
# de qualquer coisa do dialplan. O sintoma que isso produz num lab é péssimo de
# diagnosticar — uma chamada curta é cancelada pelo próprio chamador antes de
# ser atendida, e o CDR registra `ORIGINATOR_CANCEL`, que aponta para o lado
# errado. Custou uma medição inteira aqui.
#
# A senha do lab passa a ser `devlab`. O que se perde é o aviso, e ele não se
# perde: vira material. Uma lição da trilha F devolve `1234` pelo `lab.break` e
# manda o aluno explicar por que as chamadas ficaram lentas — que é exatamente
# o defeito que ele vai encontrar em campo, num PBX que alguém subiu com a
# config de exemplo.
RUN C=/usr/local/freeswitch/etc/freeswitch \
 && sed -i 's|data="default_password=1234"|data="default_password=devlab"|' "$C/vars.xml" \
 && grep -q 'default_password=devlab' "$C/vars.xml"

# A quarta correção, e ela é de ENSINO (decisão 44). A config vanilla manda
# carregar módulos que a lista reduzida não compilou, e o FreeSWITCH grita nove
# vezes ao subir:
#
#   [CRIT] switch_loadable_module.c:1754 Error Loading module .../mod_av.so
#
# Nada disso é defeito, e é exatamente por isso que precisa sumir: a trilha F
# ensina a LER o log de subida de um PBX. Um aluno que aprende a ignorar nove
# CRIT de rotina é um aluno treinado a ignorar o décimo, que seria real.
#
# O passo é derivado, não uma lista escrita à mão: para cada `<load>` ATIVO
# (o vanilla desativa comentando na própria linha, então `^\s*<load` já filtra),
# se o `.so` não existe, a linha vira um comentário que DIZ o porquê — quem
# abrir o arquivo aprende alguma coisa em vez de achar um buraco.
RUN C=/usr/local/freeswitch/etc/freeswitch \
 && MOD=/usr/local/freeswitch/lib/freeswitch/mod \
 && XML="$C/autoload_configs/modules.conf.xml" \
 && for m in $(grep -oP '^\s*<load module="\K[^"]+' "$XML"); do \
      [ -f "$MOD/$m.so" ] && continue; \
      sed -i "s|^\( *\)<load module=\"$m\"/>|\1<!-- $m: fora dos 34 modulos do DevLab (docs/DESIGN-PBX.md) -->|" "$XML"; \
    done
# Quem confere se isto funcionou é o teste de fumaça do estágio 2, e não uma
# segunda varredura aqui. A varredura existiu e foi REMOVIDA: dentro de
# `"$(...)"` o shell come o `\K` do PCRE e o grep passa a procurar por `K`
# literal, então ela nunca casava nada e teria aprovado qualquer coisa. Uma
# verificação que não pode falhar é pior do que nenhuma — ela dá o mesmo verde
# nos dois casos. O teste de fumaça sobe o PBX de verdade e conta os `[CRIT]`.

# ---------------------------------------------------------------------------
# Estágio 1b — o softphone. Estágio SEPARADO de propósito: ele não depende do
# FreeSWITCH, então o BuildKit o constrói em paralelo, e mexer num não invalida
# o cache do outro.
#
# Decisão 42, resolvida: é o `pjsua`, compilado. Ele não está empacotado no
# Ubuntu 24.04 (nem `pjproject`, nem `libpjproject-dev`, nem `python3-pjsua2`),
# e a saída óbvia seria trocá-lo por `linphone-cli` ou `baresip`, que estão. O
# que decidiu foi o custo medido — 52 s de build e 2,1 MB de binário — contra o
# que só o pjsua dá: `--null-audio`, `--auto-answer` e `--duration`, ou seja,
# um softphone que roda sem placa de som e termina sozinho. Num projeto em que
# todo check é automático, um softphone que exige interação não serviria. E de
# quebra o PRD, que nomeia `pjsua` em §7 F.3 e G.4, continua literal.
# ---------------------------------------------------------------------------
FROM ${BASE} AS construtor-pjsip

ENV DEBIAN_FRONTEND=noninteractive
ARG VERSAO_PJPROJECT=2.15.1

RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates build-essential pkg-config \
      libasound2-dev libssl-dev libopus-dev \
 && rm -rf /var/lib/apt/lists/*

# Vídeo e os codecs de vídeo saem fora: a trilha é de telefonia, e cada um
# deles arrastaria uma biblioteca para o runtime sem servir a nenhuma lição.
RUN git clone --depth 1 --branch ${VERSAO_PJPROJECT} \
      https://github.com/pjsip/pjproject.git /usr/src/pjproject \
 && cd /usr/src/pjproject \
 && ./configure --disable-video --disable-libwebrtc --disable-openh264 \
      --disable-vpx --disable-ffmpeg --disable-sdl --disable-v4l2 \
 && make dep && make -j"$(nproc)" \
 && cp pjsip-apps/bin/pjsua-* /usr/local/bin/pjsua \
 && strip /usr/local/bin/pjsua

# ---------------------------------------------------------------------------
# Estágio 2 — o lab. É esta imagem que o aluno recebe.
# ---------------------------------------------------------------------------
FROM ${BASE}

ARG BASE
LABEL devlab.base="${BASE}"

LABEL org.opencontainers.image.title="devlab/freeswitch-lab" \
      org.opencontainers.image.description="Lab de PBX com FreeSWITCH do DevLab" \
      devlab.imagem="freeswitch-lab" \
      devlab.versao="1.0.0" \
      devlab.freeswitch="1.10.12"

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TERM=xterm-256color \
    PATH=/usr/local/freeswitch/bin:$PATH

# `wireshark-common` abre um debconf perguntando se não-root pode capturar. Num
# build não interativo isso trava; e a resposta certa é "não" — a captura no lab
# é feita por processo com CAP_NET_RAW, não por binário setuid (que o
# `no-new-privileges` do lab bloquearia de qualquer forma).
RUN echo 'wireshark-common wireshark-common/install-setuid boolean false' \
      | debconf-set-selections

# Três grupos, e o primeiro é o que separa esta imagem de um `FROM scratch`:
#
# 1) As libs de runtime que o FreeSWITCH linka. A lista saiu de `ldd` sobre o
#    binário e os 34 módulos, mapeado com `dpkg -S` — não de adivinhação. Só as
#    de topo estão aqui; o apt resolve as 56 transitivas.
# 2) O userspace de sempre, com man pages: a trilha ensina a ler `man`.
# 3) Os instrumentos de prova. Um PBX se diagnostica olhando o SIP que ele
#    emite, e o aluno da trilha F já sabe usá-los pela trilha G.
RUN rm -f /etc/dpkg/dpkg.cfg.d/excludes \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      libasound2t64 \
      libcurl4t64 \
      libedit2 \
      libjpeg-turbo8 \
      libldns3t64 \
      liblua5.2-0 \
      libltdl7 \
      libmp3lame0 \
      libmpg123-0t64 \
      libodbc2 \
      libopus0 \
      libpcre3 \
      libsndfile1 \
      libspeex1 \
      libspeexdsp1 \
      libsqlite3-0 \
      libssl3t64 \
      libtiff6 \
      libuuid1 \
      zlib1g \
      bash \
      bash-completion \
      coreutils \
      findutils \
      grep \
      sed \
      gawk \
      diffutils \
      less \
      file \
      procps \
      psmisc \
      util-linux \
      man-db \
      manpages \
      nano \
      vim-tiny \
      ca-certificates \
      tzdata \
      python3 \
      iproute2 \
      iputils-ping \
      iptables \
      tcpdump \
      tshark \
      sngrep \
      sipsak \
      sip-tester \
 && apt-get install -y --reinstall --no-install-recommends \
      coreutils findutils grep sed gawk diffutils less procps util-linux bash \
 && ln -sf /usr/bin/vim.tiny /usr/bin/vim \
 && mandb -q \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# As duas bibliotecas que vieram do fonte. Vão para /usr/lib (e não para o
# diretório multiarch) porque é onde o `make install` da sofia-sip as pôs no
# build que funcionou, e porque /usr/lib está no caminho padrão do loader —
# assim o COPY não depende do nome da arquitetura.
COPY --from=construtor /usr/lib/libsofia-sip-ua.so.0.6.0 /usr/lib/
COPY --from=construtor /usr/lib/x86_64-linux-gnu/libspandsp.so.4.0.0 /usr/lib/
RUN ln -s libsofia-sip-ua.so.0.6.0 /usr/lib/libsofia-sip-ua.so.0 \
 && ln -s libspandsp.so.4.0.0 /usr/lib/libspandsp.so.4 \
 && ldconfig

# A instalação inteira: binários, os 34 módulos, a config já corrigida e os
# sons. Os 57 MB de áudio são o grosso, e eles não são supérfluos — voicemail e
# URA (PRD §7 F) falam com esses prompts.
COPY --from=construtor /usr/local/freeswitch /usr/local/freeswitch

# O softphone do aluno — ver a decisão 42 no estágio construtor-pjsip.
COPY --from=construtor-pjsip /usr/local/bin/pjsua /usr/local/bin/pjsua

# As duas ferramentas do lab. Cada uma existe por uma corrida medida, e o
# cabeçalho do próprio arquivo diz qual.
COPY bin/ /usr/local/bin/
RUN chmod 0755 /usr/local/bin/devlab-* \
 && mkdir -p /var/lib/devlab /etc/devlab \
 && bash -n /usr/local/bin/devlab-pbx \
 && bash -n /usr/local/bin/devlab-ramal

# Prova, no BUILD, que o runtime está completo. Um `.so` com dependência
# faltando não avisa no `docker build`: ele avisa no dia em que a lição do aluno
# manda carregar o módulo e o FreeSWITCH responde que não conseguiu. Esta linha
# transforma esse silêncio em falha de build.
RUN faltando="$(ldd /usr/local/freeswitch/bin/freeswitch /usr/local/bin/pjsua \
                    /usr/local/freeswitch/lib/freeswitch/mod/*.so 2>/dev/null \
                 | grep 'not found' | sort -u)" \
 && if [ -n "$faltando" ]; then \
      echo "ERRO: bibliotecas faltando no runtime:" >&2; echo "$faltando" >&2; exit 1; \
    fi \
 && /usr/local/freeswitch/bin/freeswitch -version \
 && /usr/local/bin/pjsua --help 2>&1 | head -1

# E o portão que fecha o resto: o PBX SOBE DE VERDADE aqui dentro, ainda no
# build. Um `.so` órfão, um perfil SIP que não abre ou um `[CRIT]` de rotina
# não aparecem em nenhuma checagem estática — aparecem no dia em que o aluno
# abre a lição e o lab não funciona. Aqui isso vira falha de build.
#
# O que ele não pode provar: o build roda com a rede do Docker, não com
# `--network none`. É por isso que as correções da decisão 41 continuam sendo
# verificadas fora, contra o perfil de segurança real do lab.
RUN set -e; \
    /usr/local/freeswitch/bin/freeswitch -nc -nonat; \
    pronto=0; \
    for _ in $(seq 1 60); do \
      /usr/local/freeswitch/bin/fs_cli -x status >/dev/null 2>&1 && { pronto=1; break; }; \
      sleep 1; \
    done; \
    [ "$pronto" = 1 ] || { echo "ERRO: o FreeSWITCH nao respondeu em 60s" >&2; exit 1; }; \
    log=/usr/local/freeswitch/var/log/freeswitch/freeswitch.log; \
    graves="$(grep -cE '\[ERR\]|\[CRIT\]' "$log" || true)"; \
    perfis="$(/usr/local/freeswitch/bin/fs_cli -x 'sofia status' | grep -c 'RUNNING')"; \
    modulos="$(ls /usr/local/freeswitch/lib/freeswitch/mod/*.so | wc -l)"; \
    echo "== fumaça: $modulos módulos, $perfis perfis SIP, $graves erros graves =="; \
    /usr/local/freeswitch/bin/fs_cli -x 'shutdown' >/dev/null 2>&1 || true; \
    sleep 2; \
    if [ "$graves" != 0 ]; then \
      echo "ERRO: o FreeSWITCH subiu com $graves erro(s) grave(s):" >&2; \
      grep -oE '\[(ERR|CRIT)\].*' "$log" | sort -u >&2; exit 1; \
    fi; \
    [ "$perfis" = 2 ] || { echo "ERRO: esperava 2 perfis SIP, achei $perfis" >&2; exit 1; }; \
    rm -rf /usr/local/freeswitch/var/log/freeswitch/* \
           /usr/local/freeswitch/var/db/* \
           /usr/local/freeswitch/var/run/*

# O usuário `ubuntu` ocupa o uid 1000 na imagem oficial; aqui quem manda é o aluno.
#
# Atenção: nas lições desta trilha o shell do aluno roda como ROOT, pela mesma
# razão da voip-tools — capturar pacote exige CAP_NET_RAW, e um processo
# não-root só herdaria essa capacidade pelo conjunto AMBIENT (que o Docker não
# expõe) ou por file capability (que o `no-new-privileges` do lab recusa). O
# FreeSWITCH em si também escreve em /usr/local/freeswitch/var.
RUN userdel -r ubuntu 2>/dev/null || true \
 && groupadd -g 1000 aluno \
 && useradd -u 1000 -g 1000 -m -s /bin/bash aluno \
 && echo 'devlab/freeswitch-lab 1.0.0' > /etc/devlab-imagem \
 && mkdir -p /var/lib/devlab /etc/devlab

WORKDIR /usr/local/freeswitch

# O lab fica de pé esperando `docker exec`, como os demais. O FreeSWITCH NÃO
# sobe sozinho: em boa parte das lições da trilha F subir o PBX e ler o que ele
# diz ao subir é a tarefa. Quem precisa dele de pé o sobe no `lab.setup`.
CMD ["sleep", "infinity"]
