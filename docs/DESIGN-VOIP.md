# Fase 3 — as decisões de design, resolvidas antes das lições

O Prompt-Mestre manda resolver três perguntas **antes** de escrever a primeira
lição de VoIP: como fica a imagem, como se captura pacote dentro do container, e
o que "verificar por ESTADO" significa quando o estado é um diálogo SIP e não um
arquivo no disco. Deixar a terceira para o meio de trinta lições significaria
reescrever trinta lições.

Cada decisão abaixo foi **medida**, não deduzida. O experimento está descrito
junto para poder ser repetido — e contestado.

---

## 18. A trilha de troubleshooting não precisa de PBX

O SIPp faz os **dois** papéis. `sipp -sf cenarios/uas-com-audio.xml` atende e
`sipp -sn uac_pcap` origina; entre eles acontece um diálogo SIP de verdade —
INVITE → 180 → 200 → ACK → BYE → 200 — com SDP negociado e RTP nos dois
sentidos, tudo dentro de um container só.

Isso não é um substituto pobre de um PBX: para ensinar a **ler** um diálogo, é
melhor. Uma chamada por PBX real depende de temporização, de registro e de
estado acumulado, e por isso não é reprodutível; um cenário do SIPp é um roteiro
determinístico. Num check automático essa diferença é o que separa um veredito
confiável de um teste que reprova sozinho de vez em quando — e um curso que
acusa o aluno de errar quando quem falhou foi o lab perde a confiança dele de
uma vez.

O PBX continua necessário para a trilha F (registro, dialplan, CDR), que é outra
coisa: lá o objeto de estudo é o comportamento do PBX, não o protocolo.

## 19. `rede: nenhuma` continua valendo — inclusive para capturar pacote

Era a dúvida que parecia forçar uma exceção ao Princípio 6, e não força.
`--network none` **não** remove a interface de loopback:

```
$ docker run --network none ... ip -br addr
lo               UNKNOWN        127.0.0.1/8 ::1/128
```

O diálogo inteiro acontece sobre `127.0.0.1`, entre dois processos do mesmo
container, e é em `lo` que a captura roda. Medido sob o perfil de segurança
real do lab (`CapDrop: ALL`, `no-new-privileges`, `--network none`): o tcpdump
abre a interface, grava o pcap e o tshark decodifica como SIP.

Consequência prática: **nenhuma lição da trilha G precisa de rede externa**, e
`montarHostConfig` não muda. As capacidades que faltam — `NET_RAW` para
capturar e `NET_ADMIN` para injetar a falha — já estavam em
`CAPACIDADES_PERMITIDAS`. A Fase 3 não pediu nenhuma exceção de segurança.

## 20. Nestes labs o shell do aluno roda como root

Não é descuido nem preguiça. Capturar pacote exige `CAP_NET_RAW`, e um processo
não-root não a recebe: o Docker não expõe o conjunto *ambient*, e a saída por
*file capability* está fechada pelo `no-new-privileges` que todo lab carrega.
Medido:

```
$ su aluno -c "tcpdump -i lo -c 1"
tcpdump: lo: You don't have permission to perform this capture on that device
(socket: Operation not permitted)

$ setcap cap_net_raw+eip /usr/bin/tcpdump
unable to set CAP_SETFCAP effective capability: Operation not permitted
```

As duas alternativas seriam ligar o conjunto ambient ou soltar o
`no-new-privileges` — as duas enfraquecem **todos** os labs para beneficiar
uma trilha. `lab.usuario: root` é escopado à lição que precisa, o schema já o
suporta, e na vida real também se troubleshoota telefonia como root.

## 21. Verificar por ESTADO em SIP/RTP é perguntar ao ENDPOINT, não à captura

Esta é a pergunta de design da fase, e a resposta é contraintuitiva.

A tentação é escrever o check por cima do pcap: "existe RTP nos dois sentidos?".
O PRD §4.4 até sugere isso. **Mas um check assim aprova um lab quebrado.**
Medido, com 50 pacotes UDP enviados para uma porta local:

| cenário | `send()` ok | apareceu na captura | a aplicação recebeu |
|---|---|---|---|
| sem regra | 50 | 50 | 50 |
| **DROP em INPUT** | 50 | **50** | **0** |
| DROP em OUTPUT | 0 | 0 | 0 |

O tcpdump se enxerta na camada de dispositivo, **antes** do netfilter. Com um
DROP em INPUT os pacotes aparecem inteiros na captura e a aplicação não recebe
nenhum. Um check que olhasse só o pcap diria "RTP nos dois sentidos, aprovado"
sobre uma chamada que está muda.

Isso não é uma curiosidade de laboratório: é **o** engano clássico do
troubleshooting de VoIP — "capturei no servidor e estou vendo o RTP chegar,
então a rede está boa, o problema é o PBX". A conclusão é falsa pelo mesmo
motivo. O que era um obstáculo para o design do check vira o conteúdo mais
valioso da trilha.

**A regra que fica:**

> A captura é o instrumento do **aluno**. O oráculo do **check** é o registro do
> endpoint — o que o software efetivamente contabilizou.

Na prática o check assere sobre o que o endpoint registrou (as estatísticas do
SIPp, a linha de CDR, a tabela de registro), e usa o pcap só como evidência
corroborante. Quando as duas fontes divergem, a divergência **é** o diagnóstico.

Dois corolários que economizam depuração:

- **A falha se injeta em INPUT, nunca em OUTPUT.** Um DROP em OUTPUT faz o
  próprio `send()` falhar com `EPERM` — o remetente recebe um erro imediato, e
  nenhum firewall remoto do mundo real se comporta assim. O sintoma ensinado
  ficaria errado.
- **Em `lo`, cada pacote é capturado duas vezes** (uma na saída, outra na
  entrada). Os números absolutos de um `tshark | wc -l` sobre loopback não
  correspondem ao que foi enviado; compare **sentidos entre si**, ou use
  `tshark -z rtp,streams`.

## 22. A mídia RTP é sintetizada no build, não baixada

O pacote `sip-tester` do Debian/Ubuntu instala o cenário `uac_pcap`, que
referencia `pcap/g711a.pcap` e `pcap/dtmf_2833_1.pcap`, e **não instala nenhum
dos dois**. Sem eles o cenário morre com `Can't open PCAP file` e a chamada
nunca tem mídia — ou seja, não existiria a linha de base audível da qual o áudio
unidirecional se distingue.

`images/voip-tools/gerar-midia.py` sintetiza os dois (um tom de 440 Hz em G.711
A-law e um dígito RFC 4733). É a mesma razão pela qual a saída das demonstrações
é capturada de container real e não escrita de cabeça (decisão 14): um blob
binário baixado de terceiro no build envelhece em silêncio e ninguém consegue
dizer o que tem dentro.

---

## Pendente: a imagem de FreeSWITCH está bloqueada por credencial

`devlab/freeswitch-lab` **não pode ser construída** do jeito que o PRD §4.3
assume. Desde 2021 os pacotes oficiais exigem um token pessoal da SignalWire.
Medido:

```
freeswitch.signalwire.com/repo/deb/debian-release/  → HTTP 401
files.freeswitch.org/repo/deb/debian-release/       → HTTP 401
```

Não há imagem oficial no Docker Hub (`signalwire/freeswitch` → *object not
found*); só imagens de terceiros, como `safarov/freeswitch`. E o FreeSWITCH não
está nos repositórios do Ubuntu — ao contrário do **Asterisk** (`1:20.6.0`) e do
**Kamailio** (`5.7.4`), que estão.

Isso quebra a promessa do PRD §4.8 ("o primeiro build exige internet; depois
disso, offline"), que passaria a ser "exige internet **e uma conta em serviço de
terceiro**". É uma decisão de produto — qual PBX o curso ensina — e por isso não
foi tomada aqui.

**Isso não bloqueia a trilha G**, que é justamente a que o PRD manda priorizar:
sngrep, tshark, SIPp e sipsak estão todos nos repositórios do Ubuntu, e a
imagem `devlab/voip-tools` já está construída e provada.
