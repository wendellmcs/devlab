# devlab/voip-tools — imagem da trilha de Troubleshooting SIP/RTP.
#
# O que ela resolve, e por que ela sozinha basta para a trilha inteira:
#
# A trilha G do PRD ensina a LER e PROVAR um diálogo SIP — sngrep, tshark,
# SIPp. Nada disso exige um PBX: o SIPp faz os dois papéis (UAC e UAS) e gera
# INVITE/100/180/200/ACK/RTP/BYE de verdade, com SDP negociado e RTP nos dois
# sentidos. E, por ser roteirizado, a chamada é DETERMINÍSTICA — coisa que uma
# chamada por um PBX real não é, e que num check automático é a diferença entre
# um veredito confiável e um teste que falha sozinho às vezes.
#
# O diálogo acontece inteiro sobre 127.0.0.1, DENTRO do container. Por isso o
# lab continua nascendo com `rede: nenhuma` (Princípio 6): `--network none` não
# remove a interface de loopback, e é nela que a captura acontece. Nenhuma
# lição desta trilha precisa de rede externa.
#
# A base é um ARG com padrão FIXO, pelo mesmo motivo da linux-base: o catálogo
# de erros casa mensagens LITERAIS por regex, e elas mudam entre releases. Só a
# base padrão é exercitada pelo CI.
ARG BASE=ubuntu:24.04
FROM ${BASE}

ARG BASE
LABEL devlab.base="${BASE}"

LABEL org.opencontainers.image.title="devlab/voip-tools" \
      org.opencontainers.image.description="Lab de troubleshooting SIP/RTP do DevLab" \
      devlab.imagem="voip-tools" \
      devlab.versao="1.0.0"

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TERM=xterm-256color

# `wireshark-common` abre um debconf perguntando se não-root pode capturar.
# Num build não interativo isso trava; e a resposta certa aqui é "não", porque
# a captura no lab é feita por processo com CAP_NET_RAW, não por binário setuid
# (que o `no-new-privileges` do lab bloquearia de qualquer forma).
RUN echo 'wireshark-common wireshark-common/install-setuid boolean false' \
      | debconf-set-selections

# 1) Devolve as man pages: a trilha ensina a ler `man tshark` e `man sngrep`.
# 2) Ferramentas de VoIP: sngrep (a nº 1 do dia a dia), SIPp (`sip-tester` é o
#    nome do pacote), tshark/tcpdump para captura e decodificação, ngrep e
#    sipsak para os casos pontuais.
# 3) iptables: é com ele que a lição injeta a falha de RTP bloqueado.
RUN rm -f /etc/dpkg/dpkg.cfg.d/excludes \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
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
      ngrep \
      sipsak \
      sip-tester \
 && apt-get install -y --reinstall --no-install-recommends \
      coreutils findutils grep sed gawk diffutils less procps util-linux bash \
 && ln -sf /usr/bin/vim.tiny /usr/bin/vim \
 && mandb -q \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# A mídia que o SIPp reproduz. O pacote do Debian traz os cenários que a
# referenciam mas não os arquivos; ver o cabeçalho de gerar-midia.py.
COPY gerar-midia.py /usr/local/bin/devlab-gerar-midia
RUN chmod 0755 /usr/local/bin/devlab-gerar-midia \
 && mkdir -p /usr/share/sipp/pcap /usr/share/devlab \
 && python3 /usr/local/bin/devlab-gerar-midia /usr/share/sipp/pcap --segundos 5 \
      --captura /usr/share/devlab/midia-do-cliente.pcap

# Cenários do DevLab. Ficam junto do `pcap/` porque o `play_pcap_audio` resolve
# o caminho RELATIVO ao diretório de trabalho de quem roda o sipp — e é por
# isso que /usr/share/sipp é o workdir dos labs desta trilha.
COPY cenarios/ /usr/share/sipp/cenarios/

# A chamada reproduzível que as lições mandam originar, o proxy de sinalização
# do nível Construtor, e as duas peças que o nível Engenheiro exigiu: o
# registrar que desafia com 401 e confere o digest, e o anel de dois proxies
# que decrementam `Max-Forwards`. As razões de cada um estão no cabeçalho do
# próprio arquivo.
COPY bin/ /usr/local/bin/
RUN chmod 0755 /usr/local/bin/devlab-* \
 && mkdir -p /var/lib/devlab /etc/devlab

# A captura com várias chamadas misturadas, que a lição de sngrep manda separar.
# Fica pronta na imagem porque gerá-la custa ~30 s — metade do teto do setup de
# um lab. Ver o cabeçalho do script.
COPY gerar-captura-central.sh /usr/local/bin/devlab-gerar-captura-central
RUN chmod 0755 /usr/local/bin/devlab-gerar-captura-central \
 && /usr/local/bin/devlab-gerar-captura-central /usr/share/devlab/central.pcap

# O usuário `ubuntu` ocupa o uid 1000 na imagem oficial; aqui quem manda é o aluno.
#
# Atenção: nas lições desta trilha o shell do aluno roda como ROOT, não como
# `aluno`. Não é descuido — capturar pacote exige CAP_NET_RAW, e um processo
# não-root só herdaria essa capacidade pelo conjunto AMBIENT (que o Docker não
# expõe) ou por file capability (que o `no-new-privileges` do lab recusa).
# Trocar qualquer um dos dois enfraqueceria TODOS os labs para beneficiar um.
# Na vida real também se troubleshoota telefonia como root.
RUN userdel -r ubuntu 2>/dev/null || true \
 && groupadd -g 1000 aluno \
 && useradd -u 1000 -g 1000 -m -s /bin/bash aluno \
 && echo 'devlab/voip-tools 1.0.0' > /etc/devlab-imagem

WORKDIR /usr/share/sipp

# O lab fica de pé esperando `docker exec`. Quem dá vida a ele é o PTY Bridge.
CMD ["sleep", "infinity"]
