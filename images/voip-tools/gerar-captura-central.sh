#!/usr/bin/env bash
# Gera a "captura que o cliente mandou": várias chamadas misturadas num arquivo.
#
# Por que ela é feita no BUILD e não no `lab.setup` da lição:
#
# Produzir três chamadas de verdade leva ~30 s, e o teto do setup de um lab é
# 60 s. Deixar isso no setup gastaria metade do orçamento em toda criação de
# lab, e numa máquina mais lenta a lição simplesmente não abriria. Aqui o custo
# é pago uma vez, no build, e o lab nasce instantâneo.
#
# E há um ganho pedagógico: o cenário real do técnico é receber um arquivo
# pronto, gravado por outra pessoa, com o tráfego de uma central inteira
# dentro. É esse arquivo que a lição 6 manda separar.
#
# O conteúdo é deterministicamente construído — três números distintos, três
# desfechos distintos — e fica congelado na imagem. Isso é o que permite que a
# demonstração da lição tenha saída estável entre execuções.
#
# Um acoplamento que vale saber, porque não é óbvio: o `Call-ID` que o SIPp
# gera é `[call_number]-[pid]@[ip]`, então os Call-ID desta captura carregam o
# PID que os processos tiveram DURANTE O BUILD. A lição 6 mostra esses valores
# numa demonstração. Medido: o PID se repete entre builds, porque a sequência
# de processos dentro deste RUN é sempre a mesma — duas reconstruções seguidas
# deram `1-21`, `1-37` e `1-50` nas duas.
#
# Mas é estabilidade por consequência, não por garantia: acrescentar um comando
# aqui desloca os PIDs e a saída gravada da lição 6 passa a divergir. Quem
# mexer neste arquivo deve rodar `python3 scripts/capturar-demonstracao.py
# voip-op-06-sngrep` depois. O `--conferir` detecta e falha alto — o modo de
# falha é barulhento, não silencioso.
set -uo pipefail

DESTINO=${1:-/usr/share/devlab/central.pcap}

mkdir -p "$(dirname "$DESTINO")"

tcpdump -i lo -w "$DESTINO" -q 2>/dev/null &
sleep 1

# 2001 completa e tem áudio; 2002 está ocupado; 2003 não está registrado.
# Três desfechos diferentes para que separar uma chamada da outra tenha o que
# mostrar depois de separada.
devlab-chamada -q --numero 2001
devlab-chamada -q --numero 2002 --destino ocupado
devlab-chamada -q --numero 2003 --destino ausente

sleep 1
pkill -x tcpdump
sleep 1

if ! tcpdump -r "$DESTINO" -c 1 >/dev/null 2>&1; then
  echo "erro: a captura de exemplo não ficou legível" >&2
  exit 1
fi

# Falhar aqui, no build, é muito melhor do que entregar ao aluno uma lição cuja
# matéria-prima veio pela metade.
for numero in 2001 2002 2003; do
  if ! tshark -r "$DESTINO" -Y "sip.Method==INVITE" -T fields -e sip.Request-Line -n 2>/dev/null \
       | grep -q "sip:$numero@"; then
    echo "erro: a captura de exemplo não contém a chamada para $numero" >&2
    exit 1
  fi
done

echo "captura de exemplo gerada em $DESTINO"
