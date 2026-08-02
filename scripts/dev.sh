#!/usr/bin/env bash
# Sobe o devlab-agent e a UI juntos, em modo desenvolvimento.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

AGENTE=""
INTERFACE=""

# `kill 0` sinaliza o grupo inteiro — inclusive o processo PAI quando este
# script é chamado de um contexto não interativo (wrapper, make, task de
# editor, CI), que compartilha o grupo. Matar só os filhos conhecidos.
encerrar() {
  trap - EXIT INT TERM
  echo ""
  echo "[devlab] encerrando..."
  [ -n "$AGENTE" ] && kill "$AGENTE" 2>/dev/null || true
  [ -n "$INTERFACE" ] && kill "$INTERFACE" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap encerrar EXIT INT TERM

echo "[devlab] agente  -> http://127.0.0.1:${DEVLAB_PORTA:-7788}"
echo "[devlab] interface-> http://127.0.0.1:5173"
echo ""

npm run dev --workspace @devlab/agent &
AGENTE=$!
npm run dev --workspace @devlab/ui &
INTERFACE=$!

# `wait` sem argumento sempre devolve 0: se o agente morre ao subir (porta
# ocupada, socket do Docker sumido), o aluno ficaria com uma UI que não fala
# com a API e nenhum erro na tela. Esperar por PID expõe a falha.
if wait -n "$AGENTE" "$INTERFACE"; then
  echo "[devlab] um dos processos encerrou."
else
  echo "[devlab] um dos processos falhou (código $?). Veja o log acima." >&2
fi
