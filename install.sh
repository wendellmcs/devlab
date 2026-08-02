#!/usr/bin/env bash
#
# DevLab — instalação em um comando.
#
#   curl -fsSL https://raw.githubusercontent.com/wendellmax/devlab/main/install.sh | bash
#
# O que este script faz: garante o git, clona (ou atualiza) o repositório e
# entrega o resto para scripts/setup.sh, que cuida de Node, Docker, Ollama,
# dependências e imagens de lab.
#
# Variáveis aceitas:
#   DEVLAB_REPO   URL do repositório          (padrão: o oficial)
#   DEVLAB_DIR    onde clonar                 (padrão: ~/devlab)
#   DEVLAB_REF    branch ou tag               (padrão: main)
#   DEVLAB_ARGS   opções repassadas ao setup  (ex.: "-y --sem-ia")
set -euo pipefail

REPO="${DEVLAB_REPO:-https://github.com/wendellmax/devlab.git}"
DESTINO="${DEVLAB_DIR:-$HOME/devlab}"
REF="${DEVLAB_REF:-main}"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  VERDE=$'\033[32m'; VERMELHO=$'\033[31m'; NEGRITO=$'\033[1m'; FRACO=$'\033[2m'; RESET=$'\033[0m'
else
  VERDE=''; VERMELHO=''; NEGRITO=''; FRACO=''; RESET=''
fi

abortar() { printf '\n%serro:%s %s\n' "$VERMELHO" "$RESET" "$1" >&2; exit 1; }

printf '\n%sDevLab — Oficina Prática de Infraestrutura e VoIP%s\n' "$NEGRITO" "$RESET"
printf '%sinstalação em um comando%s\n\n' "$FRACO" "$RESET"

if [ "$(uname -s)" != "Linux" ]; then
  case "$(uname -s)" in
    Darwin) abortar "macOS não é suportado: as trilhas dependem de systemd e cgroups reais. Use Linux ou uma VM Linux." ;;
    *)      abortar "o DevLab roda em Linux. No Windows, abra o Ubuntu do WSL2 e rode este comando lá dentro." ;;
  esac
fi

# ── git ────────────────────────────────────────────────────────────────────
if ! command -v git >/dev/null 2>&1; then
  printf '  git não encontrado — instalando...\n'
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update && sudo apt-get install -y git
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y git
  elif command -v pacman >/dev/null 2>&1; then
    sudo pacman -Sy --noconfirm git
  else
    abortar "instale o git pelo gerenciador da sua distro e rode de novo"
  fi
fi

# ── clone ou atualização ───────────────────────────────────────────────────
# Sem isto, um repositório inexistente ou privado faz o git PERGUNTAR o usuário
# do GitHub — e a "instalação em um comando" parece simplesmente travada.
export GIT_TERMINAL_PROMPT=0
export GIT_ASKPASS=/bin/true

if [ -d "$DESTINO/.git" ]; then
  printf '  repositório já existe em %s — atualizando\n' "$DESTINO"
  if ! git -C "$DESTINO" fetch --depth 1 origin "$REF" 2>/dev/null; then
    abortar "não consegui atualizar a partir de $REPO (ref '$REF'). Verifique a conexão."
  fi
  # Aterrissar num BRANCH local, não em HEAD destacado. Com HEAD destacado o
  # `git pull --ff-only` de `devlab atualizar` morre com "You are not currently
  # on a branch" — então rodar o instalador duas vezes quebrava o comando de
  # atualização. `checkout -B` cria ou mexe o branch para o commit buscado.
  git -C "$DESTINO" checkout -q -B "$REF" FETCH_HEAD
  git -C "$DESTINO" reset -q --hard FETCH_HEAD
  # Sem upstream configurado o `git pull --ff-only` também não sabe de onde
  # puxar. Um clone --depth 1 fresco já vem com isto; o caminho de update não.
  git -C "$DESTINO" branch --set-upstream-to "origin/$REF" "$REF" >/dev/null 2>&1 || true
elif [ -e "$DESTINO" ]; then
  abortar "$DESTINO já existe e não é um clone do DevLab. Use DEVLAB_DIR=<outro caminho>."
else
  printf '  clonando %s em %s\n' "$REPO" "$DESTINO"
  if ! git clone --depth 1 --branch "$REF" "$REPO" "$DESTINO" 2>&1; then
    rm -rf "$DESTINO"
    abortar "não consegui clonar $REPO (ref '$REF').
  · sem internet? teste com: curl -sI https://github.com
  · repositório privado? use: DEVLAB_REPO=git@github.com:usuario/repo.git
  · outra branch ou tag? use: DEVLAB_REF=<nome>"
  fi
fi

cd "$DESTINO"
[ -x scripts/setup.sh ] || chmod +x scripts/setup.sh 2>/dev/null || true
[ -f scripts/setup.sh ] || abortar "scripts/setup.sh não encontrado — o clone veio incompleto?"

printf '\n%s  repositório pronto.%s Seguindo para o bootstrap do ambiente.\n' "$VERDE" "$RESET"

# curl | bash não tem stdin livre: reconecta ao terminal para o setup poder
# perguntar. Sem terminal de controle (ssh não-interativo, cron, CI, container),
# roda no modo automático.
#
# O teste tem de ABRIR /dev/tty, não só olhar as permissões: o nó de dispositivo
# é crw-rw-rw- e passa em `[ -r /dev/tty ]` mesmo sem terminal de controle —
# e aí o `exec ... </dev/tty` morreria com "No such device or address".
# shellcheck disable=SC2086
if (exec 3</dev/tty) 2>/dev/null; then
  exec bash scripts/setup.sh ${DEVLAB_ARGS:-} </dev/tty
else
  printf '  %ssem terminal interativo — seguindo em modo automático%s\n' "$FRACO" "$RESET"
  exec bash scripts/setup.sh -y ${DEVLAB_ARGS:-}
fi
