#!/usr/bin/env bash
# Constrói as imagens de lab do DevLab.
#
# Uso:
#   bash scripts/build-imagens.sh              # constrói todas as imagens da fase atual
#   bash scripts/build-imagens.sh linux-base   # constrói apenas uma
#
# Princípio 4 (offline após o primeiro build): este é o único passo que exige internet.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR_IMAGENS="$RAIZ/images"

# Imagens disponíveis nesta fase. Cada linha: <diretorio>:<tag>
IMAGENS_FASE_0=(
  "linux-base:devlab/linux-base:1.0.0"
)

# Base das imagens de lab. O padrão é fixo de propósito: o container traz o
# próprio userspace, então o lab NÃO herda a distro do host — e é isso que faz
# a mesma lição se comportar igual para todo mundo. Trocar é suportado, mas só
# o padrão é exercitado pelo CI.
BASE="${DEVLAB_IMAGEM_BASE:-ubuntu:24.04}"

if ! command -v docker >/dev/null 2>&1; then
  echo "erro: docker não encontrado no PATH. Rode 'npm run doctor' para o diagnóstico completo." >&2
  exit 1
fi

# Impressão digital do contexto de build (Dockerfile + seed).
#
# A tag `devlab/linux-base:1.0.0` é usada como chave de cache em todo o
# projeto. Sem esta comparação, mudar uma lição que dependa do seed — ou o
# próprio Dockerfile — nunca chegaria a quem já instalou: `devlab atualizar`
# veria a tag presente e pularia o build.
digital_do_contexto() {
  # A base entra na digital: trocar de distro tem de forçar reconstrução.
  {
    echo "base=$BASE"
    find "$1" -type f -print0 | sort -z | xargs -0 sha256sum
  } | sha256sum | cut -c1-16
}

construir() {
  local dir="$1" tag="$2"
  local contexto="$DIR_IMAGENS/$dir"
  if [ ! -f "$contexto/Dockerfile" ]; then
    echo "erro: Dockerfile não encontrado em $contexto" >&2
    return 1
  fi

  local atual anterior
  atual="$(digital_do_contexto "$contexto")"
  anterior="$(docker image inspect --format '{{index .Config.Labels "devlab.contexto"}}' \
    "$tag" 2>/dev/null || true)"

  if [ "$FORCAR" -eq 0 ] && [ "$atual" = "$anterior" ]; then
    echo "==> $tag já está em dia (contexto $atual)"
    return 0
  fi

  echo ""
  echo "    base: $BASE"
  if [ -n "$anterior" ]; then
    echo "==> $tag desatualizada ($anterior -> $atual) — reconstruindo"
  else
    echo "==> construindo $tag  (contexto: images/$dir)"
  fi
  docker build --build-arg "BASE=$BASE" --label "devlab.contexto=$atual" --tag "$tag" "$contexto"
}

FORCAR=0
alvo=""
for arg in "$@"; do
  case "$arg" in
    -f|--forcar) FORCAR=1 ;;
    *)           alvo="$arg" ;;
  esac
done
encontrou=0

for entrada in "${IMAGENS_FASE_0[@]}"; do
  dir="${entrada%%:*}"
  tag="${entrada#*:}"
  if [ -z "$alvo" ] || [ "$alvo" = "$dir" ]; then
    construir "$dir" "$tag"
    encontrou=1
  fi
done

if [ "$encontrou" -eq 0 ]; then
  echo "erro: imagem '$alvo' desconhecida nesta fase." >&2
  echo "disponíveis: ${IMAGENS_FASE_0[*]%%:*}" >&2
  exit 1
fi

echo ""
echo "==> pronto. Imagens locais do DevLab:"
docker images --filter "reference=devlab/*" --format 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}'
