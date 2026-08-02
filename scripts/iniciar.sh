#!/usr/bin/env bash
# Sobe o DevLab em modo de USO: um processo, uma porta, uma origem.
#
# O agente serve a própria interface. Sem dev server no meio, sem proxy, e sem
# `node --watch` — que reinicia o agente quando um arquivo carregado muda e, no
# meio de uma lição, isso significa destruir o container do aluno. Trocar o
# modelo de IA com `devlab modelo` grava no .env; sob --watch, isso matava o lab.
#
# Para DESENVOLVER a interface (HMR, recarga automática): scripts/dev.sh
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

PORTA="${DEVLAB_PORTA:-7788}"

# A UI é artefato de build e não é versionada: um clone novo, ou um `git pull`
# que mexeu na interface, chega aqui sem ela. Construir custa ~1s.
if [ ! -f packages/ui/dist/index.html ]; then
  echo "[devlab] construindo a interface (só na primeira vez)..."
  npm run build --workspace @devlab/ui
  echo ""
fi

echo "[devlab] abra http://127.0.0.1:${PORTA}"
echo ""

exec npm run start --workspace @devlab/agent
