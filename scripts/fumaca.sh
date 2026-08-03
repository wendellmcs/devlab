#!/usr/bin/env bash
#
# Prova de fumaça: exercita o loop central do DevLab pela API real —
# criar lab → verificar (reprova) → resolver com comando de verdade →
# verificar (aprova, credita XP) → reset → destruir.
#
# Complementa os testes de integração: aqui o sistema está CABEADO
# (HTTP, regras de XP, portão das dicas, IA desligada), não em pedaços.
#
# Usa porta e banco de progresso descartáveis: não encosta no seu progresso.
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DADOS="$(mktemp -d)"
PORTA=7799
API="http://127.0.0.1:$PORTA/api"
LICAO="linux-op-01-shell"
falhou=0

ok()   { echo "  ✔ $1"; }
erro() { echo "  ✘ $1"; falhou=1; }
py()   { python3 "$@" || erro "verificação falhou"; }

# Usa o mesmo Node que o resto do projeto valida (>= 24).
NODE_BIN=""
for c in "$(command -v node || true)" /usr/bin/node /usr/local/bin/node; do
  [ -n "$c" ] && [ -x "$c" ] || continue
  if [ "$("$c" -v | sed 's/^v//; s/\..*//')" -ge 24 ] 2>/dev/null; then NODE_BIN="$c"; break; fi
done
[ -n "$NODE_BIN" ] || { echo "erro: Node 24+ não encontrado. Rode ./scripts/setup.sh"; exit 1; }

cd "$RAIZ" || { echo "erro: não consegui entrar em $RAIZ"; exit 1; }
DEVLAB_PORTA=$PORTA DEVLAB_DADOS="$DADOS" DEVLAB_IA=0 "$NODE_BIN" packages/agent/src/main.ts \
  >"$DADOS/agente.log" 2>&1 &
AGENTE=$!
trap 'kill $AGENTE 2>/dev/null; rm -rf "$DADOS"' EXIT

for _ in $(seq 1 40); do
  curl -sf "$API/saude" >/dev/null 2>&1 && break
  sleep 0.25
done

echo "== agente =="
curl -sf "$API/saude" > "$DADOS/saude.json" || { erro "agente não respondeu"; cat "$DADOS/agente.log"; exit 1; }
py - "$DADOS/saude.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
print('  ✔ saúde: {} lições, node {}'.format(d['licoes'], d['versaoNode']))
PY

echo "== criar lab =="
curl -sf -X POST "$API/labs" -H 'content-type: application/json' \
  -d "{\"licaoId\":\"$LICAO\"}" > "$DADOS/cria.json"
LAB=$(python3 -c "import json;print(json.load(open('$DADOS/cria.json'))['lab']['id'])" 2>/dev/null)
CID=$(python3 -c "import json;print(json.load(open('$DADOS/cria.json'))['lab']['containerId'])" 2>/dev/null)
[ -n "$LAB" ] && ok "lab $LAB criado" || { erro "não criou o lab"; cat "$DADOS/cria.json"; exit 1; }

echo "== as dicas não trafegam antes de reveladas =="
curl -sf "$API/licoes/$LICAO" > "$DADOS/licao.json"
py - "$DADOS/licao.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
bruto = json.dumps(d, ensure_ascii=False)
# A dica 3 desta lição é a linha de comando completa; ela não pode trafegar.
assert 'pwd > onde-estou.txt' not in bruto, 'a dica 3 vazou no payload'
assert d['dicas']['reveladas'] == [], 'veio dica revelada sem ninguém pedir'
# A dica 1 é gratuita: é empurrão conceitual, não comando. Só as duas
# seguintes cobram — nelas já vem a forma do comando e a solução.
assert d['dicas']['total'] == 3 and d['dicas']['custos'] == [0, 3, 5], d['dicas']['custos']
print('  ✔ 3 dicas anunciadas, 0 reveladas, custos {} XP (a primeira é grátis)'.format(d['dicas']['custos']))
print('  ✔ o enunciado trafega; o comando da solução não')
PY

echo "== verificação com o lab intocado =="
curl -sf -X POST "$API/labs/$LAB/verificar" > "$DADOS/v1.json"
py - "$DADOS/v1.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
assert d['aprovado'] is False, 'aprovou sem o aluno fazer nada'
assert d['xpCreditado'] == 0
print('  ✔ reprovou, 0 XP')
for c in d['checks']:
    print('      -', c['descricao'], '→', c.get('mensagem'))
PY

echo "== o aluno resolve: comando real dentro do container =="
docker exec -u aluno "$CID" bash -lc "echo 'bom dia, DevLab' > ~/saudacao.txt; pwd > ~/onde-estou.txt" \
  && ok "comandos executados no lab" || erro "falha ao executar no lab"

echo "== verificação depois =="
curl -sf -X POST "$API/labs/$LAB/verificar" > "$DADOS/v2.json"
py - "$DADOS/v2.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
assert d['aprovado'] is True, 'não aprovou mesmo com o estado correto'
assert d['xpCreditado'] == 10, d['xpCreditado']
assert d['progresso']['semAjuda'] is True
assert d['primeiraConclusao'] is True
print('  ✔ aprovado · +{} XP · sem ajuda'.format(d['xpCreditado']))
PY

echo "== refazer não rende XP de novo =="
curl -sf -X POST "$API/labs/$LAB/verificar" > "$DADOS/v2b.json"
py - "$DADOS/v2b.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
assert d['aprovado'] is True and d['xpCreditado'] == 0
print('  ✔ segunda passada: aprovado, +0 XP (nada de grinding)')
PY

echo "== dica cobra XP =="
curl -sf -X POST "$API/licoes/$LICAO/dica" -H 'content-type: application/json' \
  -d '{"nivel":2}' > "$DADOS/dica.json"
py - "$DADOS/dica.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
assert d['nivel'] == 2 and d['texto']
assert [x['nivel'] for x in d['licao']['dicas']['reveladas']] == [2]
print('  ✔ dica 2 revelada, custo {} XP'.format(d['custoXp']))
PY

echo "== estado ao vivo: dados reais do container =="
curl -sf "$API/labs/$LAB/estado" > "$DADOS/estado.json"
py - "$DADOS/estado.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
nomes = [f['nome'] for f in d['arvore']['filhos']]
assert 'saudacao.txt' in nomes, 'o arquivo criado não apareceu na árvore'
assert 'logs' in nomes and 'documentos' in nomes
print('  ✔ árvore de {} com {} entradas: {}'.format(d['raiz'], len(nomes), ', '.join(nomes[:6])))
r = d['recursos']
print('  ✔ recursos reais: {} MB de {} MB · {} processos'.format(
    r['memoriaUsadaMb'], r['memoriaLimiteMb'], r['pids']))
assert r['memoriaLimiteMb'] == 512, 'o limite de memória não foi aplicado'
PY

# O relógio da coleta por ociosidade tem de medir o ALUNO. Enquanto qualquer
# exec contava, a leitura de estado acima — que a interface repete a cada
# 2,5 s — zerava o relógio, e o TTL de 45 min nunca disparava com a tela
# aberta. É um defeito invisível: nada quebra, o container só nunca morre.
echo "== o relógio de ociosidade mede o aluno, não o app =="
curl -sf "$API/labs/$LAB" > "$DADOS/lab-antes.json"
curl -sf "$API/labs/$LAB/estado" >/dev/null
curl -sf "$API/labs/$LAB" > "$DADOS/lab-depois.json"
curl -sf -X POST "$API/labs/$LAB/renovar" > "$DADOS/lab-renovado.json"
py - "$DADOS/lab-antes.json" "$DADOS/lab-depois.json" "$DADOS/lab-renovado.json" <<'PY'
import json, sys
antes, depois, renovado = (json.load(open(a)) for a in sys.argv[1:4])
assert antes['ultimaAtividade'] == depois['ultimaAtividade'], \
    'ler o estado do lab zerou o relógio de ociosidade'
print('  ✔ ler o estado não conta como atividade (relógio parado em {})'.format(
    depois['ultimaAtividade']))
assert depois['ociosidadeRestanteMs'] < depois['ttlMs'], 'o prazo não está andando'
print('  ✔ o prazo anda: faltam {:.1f} min de {:.0f}'.format(
    depois['ociosidadeRestanteMs'] / 60000, depois['ttlMs'] / 60000))
assert renovado['ociosidadeRestanteMs'] == renovado['ttlMs'], 'renovar não devolveu o prazo cheio'
assert renovado['containerId'] == depois['containerId'], 'renovar recriou o container'
print('  ✔ manter vivo devolve o prazo cheio sem tocar no container')
PY

echo "== IA desligada por padrão =="
curl -sf "$API/ia/estado" > "$DADOS/ia.json"
py - "$DADOS/ia.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
assert d['ligada'] is False, 'a IA não está desligada por padrão'
assert len(d['momentos']) == 3
print('  ✔ ligada={} · modelo configurado: {}'.format(d['ligada'], d['modelo']))
PY
COD=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/ia/dica_socratica" \
  -H 'content-type: application/json' -d "{\"labId\":\"$LAB\"}")
[ "$COD" = "409" ] && ok "rota de IA recusa com 409 quando desligada" || erro "esperava 409, veio $COD"

echo "== reset =="
curl -sf -X POST "$API/labs/$LAB/reset" > "$DADOS/reset.json"
docker exec -u aluno "$CID" test -f /home/aluno/saudacao.txt 2>/dev/null \
  && erro "o container antigo continua vivo depois do reset" || ok "container antigo destruído"
curl -sf -X POST "$API/labs/$LAB/verificar" > "$DADOS/v3.json"
py - "$DADOS/v3.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
assert d['aprovado'] is False, 'o reset não devolveu o lab ao estado inicial'
print('  ✔ depois do reset o mesmo check volta a reprovar')
PY

echo "== destruir =="
curl -sf -X DELETE "$API/labs/$LAB" >/dev/null && ok "lab destruído"
# Filtra pela porta DESTA execução. A prova de fumaça sobe um agente próprio na
# 7799 e não pode reprovar por causa de um lab legítimo que o aluno tenha aberto
# no agente normal (7788) — que é exatamente o cenário de rodar `npm run fumaca`
# com o `devlab iniciar` de pé. Cada instância responde só pelo próprio lixo.
docker ps -a --filter 'label=devlab.gerenciado=true' \
             --filter "label=devlab.porta=$PORTA" --format '{{.ID}}' | grep -q . \
  && erro "sobrou container do devlab (porta $PORTA)" || ok "nenhum container órfão"

echo
if [ $falhou -eq 0 ]; then
  echo "  ✔ loop central provado de ponta a ponta"
else
  echo "  ✘ houve falhas"
fi
exit $falhou
