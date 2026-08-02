#!/bin/bash
# Rotina de backup dos logs de chamada.
# Observe que este arquivo ainda NAO tem permissao de execucao.

set -euo pipefail

ORIGEM="$HOME/logs"
DESTINO="$HOME/downloads/backup-$(date +%Y%m%d).tar.gz"

tar -czf "$DESTINO" -C "$ORIGEM" .
echo "backup gravado em $DESTINO"
