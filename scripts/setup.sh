#!/usr/bin/env bash
#
# DevLab — bootstrap completo a partir de um clone limpo.
#
#   git clone <repo> && cd devlab && ./scripts/setup.sh
#
# O script é idempotente: rodar de novo só conserta o que faltar. Ele confere
# o que já existe antes de instalar qualquer coisa, mostra o plano e só então
# pede sudo — e apenas para os passos que realmente precisam de root.
#
# Opções:
#   -y, --sim            não pergunta nada (para CI ou reinstalação)
#       --sem-imagens    pula a construção das imagens de lab
#       --sem-ia         pula a instalação do Ollama (IA local, opcional)
#       --com-ia         instala o Ollama e baixa o modelo padrão
#       --so-conferir    só diagnostica, não instala nada
#   -h, --help
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

NODE_MINIMO=24

# Modelo de IA escolhido pela memória disponível. Um modelo grande demais não
# trava: ele fica lento a ponto de a dica chegar depois de o aluno desistir.
#   ~14 GB de arquivo  → 32 GB de RAM   · melhor qualidade de explicação
#   ~4,7 GB            → 16 GB          · o equilíbrio recomendado
#   ~2 GB              → 8 GB           · máquina apertada
escolher_modelo() {
  local kb ram_gb
  kb=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
  ram_gb=$(( kb / 1024 / 1024 ))
  if   [ "$ram_gb" -ge 32 ]; then echo "qwen2.5-coder:14b"
  elif [ "$ram_gb" -ge 15 ]; then echo "qwen2.5-coder:7b"
  elif [ "$ram_gb" -ge 7 ];  then echo "llama3.2:3b"
  else                            echo ""
  fi
}
MODELO_IA_PADRAO="${DEVLAB_IA_MODELO:-$(escolher_modelo)}"

AUTOMATICO=0
PULAR_IMAGENS=0
IA=pergunta
SO_CONFERIR=0

# ── aparência ──────────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  VERDE=$'\033[32m'; VERMELHO=$'\033[31m'; AMARELO=$'\033[33m'
  AZUL=$'\033[36m'; NEGRITO=$'\033[1m'; FRACO=$'\033[2m'; RESET=$'\033[0m'
else
  VERDE=''; VERMELHO=''; AMARELO=''; AZUL=''; NEGRITO=''; FRACO=''; RESET=''
fi

ok()     { printf '  %s✔%s %s\n' "$VERDE" "$RESET" "$1"; }
aviso()  { printf '  %s!%s %s\n' "$AMARELO" "$RESET" "$1"; }
PROBLEMAS=0
falha()  { PROBLEMAS=$((PROBLEMAS + 1)); printf '  %s✘%s %s\n' "$VERMELHO" "$RESET" "$1"; }
passo()  { printf '\n%s== %s ==%s\n' "$NEGRITO" "$1" "$RESET"; }
nota()   { printf '    %s%s%s\n' "$FRACO" "$1" "$RESET"; }

abortar() { printf '\n%serro:%s %s\n' "$VERMELHO" "$RESET" "$1" >&2; exit 1; }

confirmar() {
  [ "$AUTOMATICO" -eq 1 ] && return 0
  local resposta
  printf '  %s?%s %s [S/n] ' "$AZUL" "$RESET" "$1"
  read -r resposta </dev/tty || return 1
  [[ -z "$resposta" || "$resposta" =~ ^[SsYy] ]]
}

tem() { command -v "$1" >/dev/null 2>&1; }

# ── argumentos ─────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    -y|--sim)       AUTOMATICO=1 ;;
    --sem-imagens)  PULAR_IMAGENS=1 ;;
    --sem-ia)       IA=nao ;;
    --com-ia)       IA=sim ;;
    --so-conferir)  SO_CONFERIR=1 ;;
    -h|--help)      sed -n '3,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)              abortar "opção desconhecida: $1" ;;
  esac
  shift
done
[ "$AUTOMATICO" -eq 1 ] && [ "$IA" = pergunta ] && IA=nao

printf '\n%sDevLab — Oficina Prática de Infraestrutura e VoIP%s\n' "$NEGRITO" "$RESET"
printf '%sbootstrap do ambiente%s\n' "$FRACO" "$RESET"

# `$USER` não existe em contêiner nem em vários contextos de cron/systemd, e
# sob `set -u` isso mataria o script. Pior: depois de um `su outro` sem `-`,
# ele ainda aponta para a conta anterior — e o usermod adicionaria a errada.
USUARIO="${SUDO_USER:-$(id -un)}"

# Rodar o instalador inteiro como root é um reflexo comum diante de um script
# que anuncia "usa sudo". Terminaria com sucesso e seria inútil: clone em
# /root, lançador em /root/.local/bin e o grupo docker dado ao root.
if [ "$(id -u)" -eq 0 ] && [ -z "${SUDO_USER:-}" ]; then
  abortar "não rode este script como root.
  Rode como o seu usuário normal — ele pede sudo só nos passos que precisam.
  Se você usou 'curl … | sudo bash', repita sem o sudo."
fi

# ── 0. sistema ─────────────────────────────────────────────────────────────
passo "sistema"

if [ "$(uname -s)" != "Linux" ]; then
  case "$(uname -s)" in
    Darwin) abortar "macOS não é suportado: as trilhas dependem de systemd e cgroups reais. Use Linux ou uma VM Linux." ;;
    *)      abortar "o DevLab roda em Linux. No Windows, abra o Ubuntu do WSL2 e rode este script lá dentro." ;;
  esac
fi

if grep -qi microsoft /proc/version 2>/dev/null; then
  ok "WSL2 · $(uname -r)"
else
  ok "Linux nativo · $(uname -r)"
fi

if [ -f /etc/os-release ]; then
  . /etc/os-release
  ok "distro: ${PRETTY_NAME:-desconhecida}"
  case "${ID:-}${ID_LIKE:-}" in
    *debian*|*ubuntu*) GERENCIADOR=apt ;;
    *)                 GERENCIADOR=desconhecido ;;
  esac
else
  GERENCIADOR=desconhecido
fi

if [ -e /sys/fs/cgroup/cgroup.controllers ]; then
  ok "cgroup v2 montado"
else
  aviso "cgroup v2 ausente — a Fase 0 funciona, a trilha de servidores (Fase 2) não"
fi

LIVRE_GB=$(df -BG --output=avail / 2>/dev/null | tail -1 | tr -dc '0-9')
if [ "${LIVRE_GB:-0}" -ge 25 ]; then
  ok "espaço em disco: ${LIVRE_GB} GB livres"
else
  aviso "só ${LIVRE_GB:-?} GB livres — as imagens de VoIP (Fases 3 e 4) pedem 20–30 GB"
fi

# ── 1. Node.js ─────────────────────────────────────────────────────────────
passo "Node.js (mínimo v${NODE_MINIMO})"

# Procura um Node >= NODE_MINIMO, começando pelo do PATH. Outra ferramenta
# (nvm, asdf, um runtime embutido) pode ter posto um Node antigo na frente —
# nesse caso o binário certo existe, só não é o que o shell encontra primeiro.
# Em vez de mexer no PATH do usuário, o DevLab fixa o caminho absoluto do Node
# correto no lançador que ele instala.
NODE_BIN=""
detectar_node() {
  local candidato maior
  for candidato in "$(command -v node 2>/dev/null)" /usr/bin/node /usr/local/bin/node /opt/node/bin/node; do
    [ -n "$candidato" ] && [ -x "$candidato" ] || continue
    maior=$("$candidato" -v 2>/dev/null | sed 's/^v//; s/\..*//')
    if [ -n "$maior" ] && [ "$maior" -ge "$NODE_MINIMO" ] 2>/dev/null; then
      NODE_BIN="$candidato"
      return 0
    fi
  done
  return 1
}

precisa_node=0
if detectar_node; then
  ok "$("$NODE_BIN" -v) · $NODE_BIN"
  DO_PATH="$(command -v node 2>/dev/null || true)"
  if [ -n "$DO_PATH" ] && [ "$DO_PATH" != "$NODE_BIN" ]; then
    aviso "o node do seu PATH ($DO_PATH) é mais antigo e não serve"
    nota "não vou mexer nele: pode pertencer a outra ferramenta."
    nota "o comando devlab vai usar $NODE_BIN diretamente."
  fi
elif tem node; then
  falha "$(node -v) é antigo demais (mínimo v${NODE_MINIMO})"
  nota "o agente roda TypeScript direto (type stripping) e usa node:sqlite — ambos pedem v${NODE_MINIMO}+"
  precisa_node=1
else
  falha "Node.js não encontrado"
  precisa_node=1
fi

if [ "$precisa_node" -eq 1 ] && [ "$SO_CONFERIR" -eq 0 ]; then
  [ "$GERENCIADOR" = apt ] || abortar \
    "instale o Node ${NODE_MINIMO}+ pelo gerenciador da sua distro e rode este script de novo"
  if confirmar "instalar Node ${NODE_MINIMO} LTS via NodeSource? (usa sudo)"; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MINIMO}.x" | sudo -E bash -
    sudo apt-get install -y nodejs
    hash -r
    detectar_node || abortar "o Node foi instalado mas não consegui encontrá-lo"
    ok "Node $("$NODE_BIN" -v) instalado em $NODE_BIN"
  else
    abortar "sem Node ${NODE_MINIMO}+ o agente não sobe"
  fi
fi

# Tudo daqui para baixo usa o Node certo, mesmo que o PATH aponte para outro.
if [ -n "$NODE_BIN" ]; then
  DIR_NODE="$(dirname "$NODE_BIN")"
  export PATH="$DIR_NODE:$PATH"
  hash -r
fi

# ── 2. Docker Engine ───────────────────────────────────────────────────────
passo "Docker Engine"

if tem docker; then
  ok "docker $(docker --version | awk '{print $3}' | tr -d ,)"
else
  falha "Docker não encontrado"
  if [ "$SO_CONFERIR" -eq 0 ]; then
    # get.docker.com atende Debian/Ubuntu/Fedora/CentOS, mas recusa Arch e
    # derivadas — melhor dizer isso antes do que deixar o script morrer
    # com a mensagem de outro projeto.
    case "${ID:-}${ID_LIKE:-}" in
      *arch*|*manjaro*)
        abortar "instale o Docker pelo pacman e rode este script de novo:
  sudo pacman -S docker && sudo systemctl enable --now docker" ;;
    esac
    if confirmar "instalar o Docker Engine via get.docker.com? (usa sudo)"; then
      curl -fsSL https://get.docker.com | sudo sh
      ok "Docker instalado"
    else
      abortar "sem Docker não há lab: o DevLab executa software real em container"
    fi
  fi
fi

# daemon de pé
if tem docker && ! sudo -n true 2>/dev/null && ! docker info >/dev/null 2>&1; then
  : # segue: a checagem de permissão abaixo trata o caso
fi

if tem docker && ! (docker info >/dev/null 2>&1 || sudo docker info >/dev/null 2>&1); then
  if [ "$SO_CONFERIR" -eq 0 ] && confirmar "o daemon do Docker não responde — iniciar agora? (usa sudo)"; then
    if tem systemctl && [ -d /run/systemd/system ]; then
      sudo systemctl enable --now docker
    else
      sudo service docker start
    fi
    ok "daemon iniciado"
  fi
fi

# grupo docker: o passo mais esquecido, e o que mais gera "permission denied"
if tem docker; then
  if docker info >/dev/null 2>&1; then
    ok "seu usuário fala com o daemon sem sudo"
    PRECISA_RELOGAR=0
    # A CLI segue o `docker context`; o dockerode do agente não. Com Docker
    # Desktop em Linux nativo o socket fica em ~/.docker/desktop/docker.sock,
    # e sem isto o doctor daria ENOENT com um conselho sobre WSL que não se
    # aplica àquela máquina.
    ENDPOINT="$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)"
    if [ -n "$ENDPOINT" ] && [ "$ENDPOINT" != "unix:///var/run/docker.sock" ]; then
      aviso "o Docker responde em $ENDPOINT, não no socket padrão"
      nota "gravando DOCKER_HOST no .env para o agente encontrar o mesmo daemon."
      DOCKER_HOST_DETECTADO="$ENDPOINT"
    fi
  else
    falha "permission denied no socket do Docker — seu usuário não está no grupo 'docker'"
    PRECISA_RELOGAR=1
    if [ "$SO_CONFERIR" -eq 0 ]; then
      if confirmar "adicionar '$USER' ao grupo docker? (usa sudo)"; then
        sudo groupadd -f docker
        sudo usermod -aG docker "$USUARIO"
        ok "adicionado ao grupo docker"
        nota "o grupo só vale em uma sessão nova: feche este shell e abra outro,"
        nota "ou rode 'newgrp docker' e execute este script novamente."
      fi
    fi
  fi
fi

# no WSL2 sem systemd o daemon não sobe sozinho no boot
if grep -qi microsoft /proc/version 2>/dev/null && ! [ -d /run/systemd/system ]; then
  aviso "WSL2 sem systemd: o daemon não sobe sozinho a cada boot"
  nota "inicie com 'sudo service docker start', ou habilite systemd em /etc/wsl.conf:"
  nota "  [boot]"
  nota "  systemd=true"
fi

# ── 3. IA local (opcional) ─────────────────────────────────────────────────
passo "IA local via Ollama (opcional)"

RAM_GB=$(( $(awk '/^MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0) / 1024 / 1024 ))

baixar_modelo() {
  [ -n "$MODELO_IA_PADRAO" ] || return 0
  if confirmar "baixar o modelo ${MODELO_IA_PADRAO}? (alguns GB, uma vez só)"; then
    ollama pull "$MODELO_IA_PADRAO"
    ok "modelo ${MODELO_IA_PADRAO} pronto"
  fi
}

nota "a IA é opcional e vem DESLIGADA: o núcleo do DevLab funciona inteiro sem ela."
nota "quando ligada, o modelo roda nesta máquina — nenhum dado sai daqui."

if [ -z "$MODELO_IA_PADRAO" ]; then
  aviso "${RAM_GB} GB de RAM: pouco para um modelo local com resposta útil"
  nota "pule a IA, ou force um modelo pequeno com DEVLAB_IA_MODELO=llama3.2:1b"
else
  ok "modelo recomendado para ${RAM_GB} GB de RAM: ${MODELO_IA_PADRAO}"
fi

if tem ollama; then
  ok "ollama $(ollama --version 2>/dev/null | awk '{print $NF}' || echo instalado)"
  if [ -n "$MODELO_IA_PADRAO" ] && ollama list 2>/dev/null | grep -q "^${MODELO_IA_PADRAO%%:*}"; then
    ok "modelo ${MODELO_IA_PADRAO} já baixado"
  elif [ "$SO_CONFERIR" -eq 0 ] && [ "$IA" != nao ]; then
    baixar_modelo
  fi
else
  aviso "Ollama não instalado — a camada de IA fica desligada"
  if [ "$SO_CONFERIR" -eq 0 ] && [ "$IA" != nao ] && [ -n "$MODELO_IA_PADRAO" ]; then
    if confirmar "instalar o Ollama agora? (usa sudo)"; then
      curl -fsSL https://ollama.com/install.sh | sh
      tem ollama && baixar_modelo
    fi
  fi
fi

# Grava a escolha para o agente e o doctor concordarem com o que foi instalado.
if [ "$SO_CONFERIR" -eq 0 ] && [ -n "$MODELO_IA_PADRAO" ] && [ ! -f .env ]; then
  cat > .env <<EOF
# Gerado por scripts/setup.sh. Ajuste à vontade.
# A IA fica DESLIGADA por padrão: mude para 1 quando quiser usá-la.
DEVLAB_IA=0
DEVLAB_IA_MODELO=${MODELO_IA_PADRAO}
DEVLAB_IA_URL=http://127.0.0.1:11434
EOF
  if [ -n "${DOCKER_HOST_DETECTADO:-}" ]; then
    echo "DOCKER_HOST=${DOCKER_HOST_DETECTADO}" >> .env
  fi
  ok ".env criado (IA desligada por padrão)"
fi

# ── 4. dependências do projeto ─────────────────────────────────────────────
passo "dependências do projeto"

if [ "$SO_CONFERIR" -eq 1 ]; then
  aviso "modo --so-conferir: npm install não foi executado"
elif [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund
  ok "dependências instaladas a partir do package-lock.json"
else
  npm install --no-audit --no-fund
  ok "dependências instaladas"
fi

# ── 5. imagens de lab ──────────────────────────────────────────────────────
passo "imagens de lab"

if [ "$SO_CONFERIR" -eq 1 ] || [ "$PULAR_IMAGENS" -eq 1 ]; then
  aviso "construção das imagens pulada"
elif ! docker info >/dev/null 2>&1; then
  aviso "sem acesso ao daemon: construa depois com 'npm run imagens'"
else
  # O build-imagens compara a impressão digital do contexto e só reconstrói o
  # que mudou — então isto é barato e mantém a imagem em dia depois de um
  # `git pull` que tenha alterado o Dockerfile ou a árvore semeada.
  nota "o primeiro build é o único passo que precisa de internet"
  bash scripts/build-imagens.sh
fi

# ── 6. comando devlab no PATH ──────────────────────────────────────────────
passo "comando devlab"

BIN_LOCAL="$HOME/.local/bin"
if [ "$SO_CONFERIR" -eq 1 ]; then
  aviso "instalação do comando pulada"
else
  mkdir -p "$BIN_LOCAL"
  cat > "$BIN_LOCAL/devlab" <<EOF
#!/usr/bin/env bash
# Gerado por scripts/setup.sh — aponta para o clone em $RAIZ
set -euo pipefail
RAIZ="$RAIZ"

# Fixa o Node validado na instalação. Sem isto, uma ferramenta que ponha um
# Node antigo na frente do PATH derrubaria o agente com erro obscuro.
export PATH="$(dirname "${NODE_BIN:-/usr/bin/node}"):\$PATH"

cd "\$RAIZ"
case "\${1:-ajuda}" in
  iniciar|start|dev) exec npm run dev ;;
  imagens)           exec npm run imagens ;;
  testar)            exec npm run teste ;;
  validar)           exec npm run valida ;;
  atualizar)
    git pull --ff-only
    npm ci --no-audit --no-fund
    exec bash scripts/setup.sh -y
    ;;
  *) exec node --env-file-if-exists="\$RAIZ/.env" packages/agent/src/cli/devlab.ts "\$@" ;;
esac
EOF
  chmod +x "$BIN_LOCAL/devlab"
  ok "instalado em $BIN_LOCAL/devlab"

  case ":$PATH:" in
    *":$BIN_LOCAL:"*) ok "$BIN_LOCAL já está no PATH" ;;
    *)
      aviso "$BIN_LOCAL não está no PATH"
      for RC in "$HOME/.bashrc" "$HOME/.zshrc"; do
        [ -f "$RC" ] || continue
        grep -q '.local/bin' "$RC" || \
          printf '\n# adicionado pelo DevLab\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$RC"
      done
      nota "acrescentei ao seu ~/.bashrc — vale a partir do próximo shell"
      ;;
  esac
  nota "use: devlab doctor · devlab iniciar · devlab validar · devlab atualizar"
fi

# ── 7. veredito ────────────────────────────────────────────────────────────
passo "diagnóstico final"

if [ "$SO_CONFERIR" -eq 1 ]; then
  printf '\n  modo conferência: nada foi instalado.\n\n'
  # O código de saída reflete o diagnóstico, para dar para usar em
  # `if ./scripts/setup.sh --so-conferir; then ...`.
  [ "$PROBLEMAS" -eq 0 ] || exit 1
  exit 0
fi

if [ "${PRECISA_RELOGAR:-0}" -eq 1 ]; then
  printf '\n%s  Falta um passo seu:%s abra um shell novo (ou rode %snewgrp docker%s)\n' \
    "$AMARELO" "$RESET" "$NEGRITO" "$RESET"
  printf '  e execute %s./scripts/setup.sh%s de novo para concluir.\n\n' "$NEGRITO" "$RESET"
  exit 0
fi

if npm run doctor --silent; then
  printf '\n%s  Pronto.%s Suba tudo com: %snpm run dev%s\n' "$VERDE" "$RESET" "$NEGRITO" "$RESET"
  printf '  Depois abra %shttp://127.0.0.1:5173%s\n\n' "$AZUL" "$RESET"
else
  printf '\n%s  Faltam itens acima.%s Corrija e rode %s./scripts/setup.sh%s de novo.\n\n' \
    "$AMARELO" "$RESET" "$NEGRITO" "$RESET"
  exit 1
fi
