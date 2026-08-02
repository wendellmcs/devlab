# devlab/linux-base — imagem-semente da trilha Linux.
#
# Ubuntu de verdade, com as páginas de manual restauradas (a imagem base do
# Ubuntu as exclui via dpkg) e uma árvore de trabalho semeada com material de
# suporte de TI/telefonia — o mesmo tipo de arquivo que o aluno vê no trabalho.
FROM ubuntu:24.04

LABEL org.opencontainers.image.title="devlab/linux-base" \
      org.opencontainers.image.description="Lab base da trilha Linux do DevLab" \
      devlab.imagem="linux-base" \
      devlab.versao="1.0.0"

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TERM=xterm-256color

# 1) Devolve as man pages: sem `man`, metade da trilha "como pedir ajuda" morre.
# 2) Instala o ferramental que a trilha Operador/Construtor usa.
# 3) Reinstala os pacotes cuja documentação foi podada na imagem base.
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
      tree \
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
 && apt-get install -y --reinstall --no-install-recommends \
      coreutils findutils grep sed gawk diffutils less procps util-linux bash \
 && ln -sf /usr/bin/vim.tiny /usr/bin/vim \
 && mandb -q \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# O usuário `ubuntu` ocupa o uid 1000 na imagem oficial; aqui quem manda é o aluno.
RUN userdel -r ubuntu 2>/dev/null || true \
 && groupadd -g 1000 aluno \
 && useradd -u 1000 -g 1000 -m -s /bin/bash aluno \
 && echo 'devlab/linux-base 1.0.0' > /etc/devlab-imagem

# Árvore semeada: determinística, versionada junto da imagem.
COPY --chown=aluno:aluno seed/home/aluno/ /home/aluno/

# backup.sh entra SEM bit de execução de propósito: é o gancho da lição de
# permissões na trilha Construtor.
RUN chmod 0644 /home/aluno/scripts/backup.sh \
 && chown -R aluno:aluno /home/aluno

WORKDIR /home/aluno

# O lab fica de pé esperando `docker exec`. Quem dá vida a ele é o PTY Bridge.
CMD ["sleep", "infinity"]
