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
- **Um filtro por porta conta o mesmo pacote duas vezes quando ninguém o
  recebe.** Ver a correção abaixo. Os números absolutos de um `tshark | wc -l`
  sobre este lab não correspondem ao que foi enviado; compare **sentidos entre
  si**, ou use `tshark -z rtp,streams`.

### Correção medida (2026-08-04): não existe duplicação em `lo`

Este documento afirmava, e a lição 5 ensinava, que a loopback grava cada pacote
**entregue** duas vezes — uma na saída, outra na entrada. **Está errado**, e o
mecanismo real é quase o inverso. Medido com 100 datagramas UDP para uma porta
aberta e 100 para uma porta fechada, capturando tudo em `lo`:

| destino | enviados | quadros com `udp.dstport==porta` | destes, ICMP |
|---|---|---|---|
| porta **aberta** (há socket) | 100 | **100** | 0 |
| porta **fechada** (ninguém escuta) | 100 | **200** | **100** |

Quem dobra a contagem é o **ICMP port unreachable**: ele carrega dentro dele
uma cópia do pacote original, cabeçalho UDP incluído, e por isso um filtro por
`udp.dstport` casa o pacote **e** o aviso que reclama dele. É o mesmo motivo
pelo qual a lição 5 já filtrava `and not icmp` na anatomia — a explicação é que
estava trocada.

Por que isso aparece o tempo todo no lab: **nenhum lado abre socket de RTP.**
Durante uma chamada, `ss -unap` mostra só 5060 e 5061; o SIPp toca o pcap de
áudio sem nunca ficar escutando na porta de mídia. Logo **todo** pacote RTP
gera um ICMP de porta fechada, e a contagem por porta sai sempre dobrada.

E é isso que explica o número que gerou a leitura errada. Com a regra de DROP
em INPUT, o pacote é descartado **antes** da camada UDP, o aviso ICMP não chega
a ser gerado, e a contagem cai de 500 para 250. Nada mudou na duplicação: o que
sumiu foram os avisos.

| | pacotes enviados | `udp.dstport==6100` | `... and not icmp` | ICMP |
|---|---|---|---|---|
| sem regra | 250 | 500 | 250 | 250 |
| DROP em INPUT na porta 6100 | 250 | 250 | 250 | 0 |

As três consequências práticas continuam valendo, e uma delas fica mais forte:

- **Filtrar `and not icmp` não é preciosismo**, é o que separa contar pacote de
  contar reclamação sobre o pacote.
- O que a decisão 21 afirma continua de pé, e é o que importa: **os pacotes
  aparecem na captura, no sentido certo, e a aplicação não recebe nenhum.** A
  lista de sentidos de uma chamada muda é idêntica à de uma chamada boa —
  verificado, e é a demonstração central da lição 5.
- **Não se pode ensinar "a contagem caiu pela metade" como técnica.** Ela cai
  porque o lab não tem ninguém escutando na porta de mídia; num endpoint real,
  que escuta, não haveria ICMP nenhum para sumir e o número não mudaria. As
  lições comparam **presença de sentido** e consultam o contador do firewall —
  nunca o total de pacotes.

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

## 23. Cada código de recusa é um cenário próprio, e o aluno pede por SINTOMA

As lições 3 e 4 precisam de chamadas que terminem em 404, 480, 486, 488 e 503.
A forma econômica seria um cenário só, parametrizado — e ela **não funciona**:
o SIPp valida o código ao CARREGAR o cenário, antes de substituir palavra-chave
alguma. Medido:

```
$ sipp -sf uas-recusa.xml -key codigo 486 -key motivo "Busy Here" ...
Response codes must be in the range of 100-700
```

Pior que falhar, falha em silêncio para quem está olhando: a mensagem vai para
o log do processo em segundo plano, e o sintoma aparente é um UAS que sobe e
nunca responde — quem liga só vê `ICMP port unreachable`. Por isso são cinco
arquivos, cada um com o número literal onde o parser o encontra.

A segunda metade da decisão é de conteúdo: `devlab-chamada --destino` recebe
**nome de sintoma** (`ocupado`, `ausente`, `sem-codec`, `sobrecarga`,
`desconhecido`), nunca o código. Um `--destino 486` publicaria a resposta do
exercício na própria linha de comando — o aluno leria o que ele mesmo digitou
em vez de ler a captura. Pelo mesmo motivo, nas lições em que a tarefa é
descobrir o código, quem escolhe o destino é o `lab.break`, e o aluno roda
`devlab-chamada` sem opção nenhuma: ele reproduz a chamada do cliente, não a
resposta do gabarito.

## 24. A captura com várias chamadas é gerada no BUILD, não no `lab.setup`

A lição 6 (sngrep) precisa de uma captura com várias chamadas misturadas, que é
o que existe numa central de verdade. Produzi-la são três chamadas reais:
**~30 s medidos**, contra um teto de 60 s para o setup de um lab. Metade do
orçamento gasto em toda criação de lab, e numa máquina mais lenta a lição
simplesmente não abriria.

Ela passou a ser gerada no build da imagem (`gerar-captura-central.sh`), o que
resolve três coisas de uma vez: o lab nasce instantâneo, o arquivo fica
**congelado** — e portanto a demonstração da lição tem saída estável entre
execuções, que é o que `capturar-demonstracao.py --conferir` exige — e o
cenário fica mais realista, porque o técnico de verdade recebe um arquivo
pronto, gravado por outra pessoa.

O script falha o build se qualquer uma das três chamadas não estiver na captura.
Entregar ao aluno uma lição cuja matéria-prima veio pela metade é pior do que
não construir a imagem.

## 25. `capturar-demonstracao.py` passou a rodar o `lab.break`

Ele já rodava o `lab.setup` e ignorava o `break`. Enquanto nenhuma lição usava
injeção de falha isso não tinha sintoma; a partir da lição 3 tem. Uma lição de
quebra/conserta entrega ao aluno um lab **já defeituoso**, e a demonstração
gravada num lab saudável mostraria uma saída que ele nunca vai ver — deriva
inventada justamente pelo arquivo que existe para impedir deriva.

O validador já rodava os dois. Agora os dois motores reproduzem o mesmo lab.

---

# As decisões do nível Construtor

O nível ensina a **capturar no ponto certo e medir**. As quatro decisões abaixo
foram o que tornou isso possível sem inventar comportamento nenhum.

## 28. O lab tem cenário de UAC próprio, e o Call-ID vem do `-cid_str`

O cenário embutido `uac_pcap` toca `g711a.pcap` (sequência 1000..1249) e emenda
`dtmf_2833_1.pcap` (sequência 2000..2009). São dois arquivos com espaços de
numeração **disjuntos**, e o salto de 1249 para 2000 é lido como perda por
qualquer receptor. Medido, numa chamada perfeita:

```
Pkts 260   Lost 750 (74.3%)
```

Não é bug do tshark: é o que o RFC 3550 manda concluir de um buraco de
sequência desse tamanho. Num aparelho real o DTMF de RFC 4733 continua a mesma
numeração do áudio e não abre buraco nenhum — ou seja, os 74% eram artefato do
lab. Como o nível inteiro mede fluxo de mídia, uma linha de base suja tornaria
toda medição uma exceção a explicar, e a regra do projeto é não ensinar em
volta de um artefato removível.

O cenário próprio (`cenarios/uac-com-audio.xml`) toca só o áudio. O SDP é cópia
literal do embutido — inclusive o `telephone-event` —, porque é ele que a lição
de SDP disseca, e mudá-lo mexeria em conteúdo auditado sem ganho.

A segunda metade da decisão é o **determinismo do texto**. Tags e branches
saem dos cenários com valor derivado do número discado. O `Call-ID`, não: em
modo cliente o SIPp **indexa a chamada pelo Call-ID que ele mesmo gerou**, e um
valor escrito no cenário faz com que ele descarte as respostas do outro lado
como *out-of-call* — medido, a chamada morre em timeout depois de cinco
retransmissões do INVITE. A forma suportada é o `-cid_str` da linha de comando,
que troca o `%p` (PID) pelo número discado.

Isso apagou a pendência registrada em `gerar-captura-central.sh`: os Call-ID da
captura de central não dependem mais de quais PIDs o build sorteou. E abriu o
que o nível precisava — `-z follow,udp,ascii,N` de duas chamadas distintas
produz **texto idêntico**, verificado, e por isso pode virar demonstração
gravada.

## 29. O "proxy" do lab encaminha sinalização e não toca na mídia

Sem intermediário, todo ponto de captura vê a mesma coisa e "capturar no ponto
certo" vira afirmação sem prova. `devlab-chamada --por-proxy` põe um relay em
`127.0.0.2` entre quem liga (`127.0.0.1`) e quem atende (`127.0.0.3`) — três
endereços da própria loopback, que `--network none` mantém.

O relay **não reescreve o SDP**, e é essa omissão que produz o fato que a lição
cobra: as duas pontas combinam os endereços de mídia entre si e o áudio vai
direto, sem passar pelo proxy. Medido: no ponto do proxy, 12 mensagens SIP (as
duas pernas) e **zero** fluxos de RTP; no ponto de quem liga, 6 mensagens e os
dois fluxos, trocados com um endereço que a sinalização dali nunca mostra.

É o chamado clássico "capturei no SBC e não tem RTP na captura" acontecendo de
verdade, e não encenado.

Duas honestidades registradas: ele não é proxy de verdade (não reescreve `Via`,
não acrescenta `Record-Route`, não mantém transações — o lab tem uma chamada de
cada vez), e os três papéis moram na mesma máquina, então o **ponto** é
representado por um filtro de captura por endereço. A lição diz as duas coisas
ao aluno; o que sai do arquivo é o que sairia lá.

## 30. A degradação de mídia nasce dentro do arquivo de áudio

Para ensinar a medir é preciso uma chamada ruim reproduzível. As duas formas
óbvias não servem, e as duas foram medidas:

- **`iptables` não produz perda visível numa captura local.** A captura se
  enxerta antes do netfilter (decisão 21), então o pacote descartado em INPUT
  aparece na gravação inteiro. Uma regra de DROP degrada o áudio e não deixa
  rastro nenhum no `-z rtp,streams`.
- **`tc netem` produz, e é aleatório.** Funciona (inclusive o arranjo classful,
  que degrada só a porta de mídia e deixa a sinalização intacta), mas perda e
  jitter mudam a cada execução, e nenhuma saída de demonstração sobreviveria ao
  `--conferir`.

A degradação passou a ser gerada dentro de `pcap/g711a-picotado.pcap`, que o
`uas-picotado.xml` toca: 1 pacote em cada 10 não é gravado — o número de
sequência é consumido e o buraco aparece em quem recebe — e o espaçamento
oscila num passeio limitado, o que o SIPp reproduz porque ele respeita o
intervalo do arquivo. Resultado medido, em execuções repetidas: **225 pacotes,
24 perdidos (9,6%)**, sempre. O `--destino picotado` é mais um nome de sintoma,
como manda a decisão 23.

## 31. RTCP não existe no lab, e por isso é sintetizado numa gravação

O PRD §7 G.2 pede "analisar RTCP", e o SIPp **não gera RTCP**: durante uma
chamada, `ss -unap` mostra só as portas de sinalização, e `-Y rtcp` sobre
qualquer captura do lab não devolve nada.

Sintetizar era a única saída honesta, e ela cabia no mesmo lugar onde o nível já
precisava de números estáveis. `gerar-midia.py --captura` escreve
`/usr/share/devlab/midia-do-cliente.pcap`: os dois sentidos da chamada picotada
com carimbos de tempo **escolhidos**, mais um Sender Report de cada lado. O
arquivo é byte-idêntico em qualquer máquina e em qualquer build, então a tabela
do `-z rtp,streams` — com jitter, mínimo e máximo — pode ser demonstração
gravada, o que numa captura ao vivo seria impossível (as colunas de tempo mudam
na terceira casa a cada execução).

Ele não tem sinalização, de propósito: é uma captura só de mídia, como as que
chegam de cliente, e por isso exige o `-d` para ser lida — que é justamente o
que a primeira lição do nível ensina.

Um detalhe que virou conteúdo: o relatório do endpoint diz **25** perdidos e o
`-z rtp,streams` mede **24**. Os dois estão certos. O último pacote da chamada
também se perdeu, e quem só tem a captura não tem como saber que ele existiu —
a numeração termina antes. O endpoint sabe porque conta o que esperava. É a
decisão 21 aparecendo num terceiro disfarce.

## 32. Uma captura só de mídia não se decodifica sozinha

Descoberto pelo validador, não por leitura: o check da primeira lição reprovava
depois da solução de referência, e a causa não era flush nem corrida. **RTP não
se anuncia.** Quem diz ao leitor que um UDP qualquer é RTP é o **SDP** da
chamada; sem a sinalização no mesmo arquivo, `-Y rtp` não casa nada e o
`-z io,phs` classifica os 500 pacotes como `data`. Medido:

| leitura | resultado |
|---|---|
| `-Y "rtp and not icmp"` | 0 quadros |
| `-Y udp` | 500 quadros |
| com `-d udp.port==6000,rtp -d udp.port==6100,rtp` | 500 quadros de RTP |

Isso virou o terceiro conceito da lição 1 em vez de virar uma pegadinha: a
tarefa manda separar sinalização e mídia em dois arquivos, e o aluno esbarra
nisso ao conferir o seu próprio resultado. É também o motivo prático da regra
"quando puder, guarde a sinalização junto — ela é pequena e é o que dá sentido
ao resto".

---

# As decisões do nível Engenheiro

O nível vira a trilha do avesso: até o Construtor o aluno **lia** chamadas que
o lab produziu; a partir daqui ele **produz** a chamada que reproduz o defeito.
Isso exigiu duas peças novas na imagem, e as duas nasceram de uma medição que
disse que o caminho óbvio não funcionava.

## 33. O registrar é do DevLab porque o SIPp não sabe conferir digest

O PRD §7 G.5 pede "registro falhando (401/403, realm errado, `a1-hash`)", e a
decisão 18 já resolveu que a trilha não tem PBX. A tentativa natural era usar o
SIPp dos dois lados, como em todo o resto da trilha — e ela não fecha.

O SIPp sabe **mandar** um `REGISTER` autenticado (é o que o `[authentication]`
faz do lado cliente). Do lado servidor ele só sabe responder um texto fixo: não
calcula MD5 nenhum e portanto **não distingue a senha certa da errada**. Um
registrar que aceita qualquer credencial não consegue ensinar por que uma
credencial é recusada — e a lição inteira é sobre o porquê da recusa.

`bin/devlab-registrar` implementa o desafio e a conferência do RFC 2617 em ~60
linhas úteis: `401` sem `Authorization`, `403` quando o digest não bate ou o
ramal não existe, `200 OK` quando bate. Ele é honesto sobre o que não é — uma
transação por vez, sem `qop`, sem `nonce-count`, sem expiração real — e o que
falta está na trilha F e na H.

O oráculo do check é o **arquivo de registros que ele escreve**, nunca o pcap.
É a decisão 21 aplicada a registro em vez de chamada, e ela não muda.

## 34. O nonce é fixo e o ramal guarda `a1-hash` — as duas coisas por medida

Um registrar de verdade sorteia o nonce a cada desafio; é o que impede repetição
de credencial gravada. Aqui ele é constante, e isso é o que torna o `response`
um **valor literal**: com usuário, realm, senha, método, URI e nonce fixos, o
digest é sempre o mesmo hexadecimal. Sem isso, nenhuma saída de demonstração da
lição sobreviveria ao `--conferir` (decisão 27), e o aluno não teria como
recalcular na mão o que viu na tela.

A segunda metade é o que produz o defeito. O cadastro guarda
`MD5(usuario:realm:senha)` em vez da senha — o `a1-hash` do FreeSWITCH, o
`md5secret` do Asterisk. **O realm está dentro do hash.** Trocar o realm
anunciado pelo servidor invalida, em silêncio, todo hash já armazenado, e o
sintoma é o pior que existe: `403` para quem digitou a senha certa. Medido:

| realm anunciado | hash guardado (feito com `devlab.local`) | resultado |
|---|---|---|
| `devlab.local` | `7faf5fb0…` | **200 OK** |
| `pbx.novodominio.com` | `7faf5fb0…` | **403** |
| `pbx.novodominio.com` | `5086a539…` (refeito) | **200 OK** |

Os dois consertos aparecem na tabela, e a escolha entre eles é de operação, não
de técnica. A lição fixa a migração como irreversível de propósito: com o realm
podendo voltar, o exercício viraria "desfaça o `break`" e nunca chegaria à
conta.

Um efeito colateral que virou conteúdo: o `sipsak` 0.9.8.1 monta o usuário de
autenticação a partir do endereço e envia `username="1001@"` quando não se passa
`-u`. Como o `@` entra no `HA1`, o registro dá `403` com tudo certo. Ficou como
erro comum da lição — é exatamente a família de erro que ela ensina a ler.

## 35. `SO_REUSEADDR` em UDP deixa dois processos na mesma porta — medido

Descoberto pelo pior caminho: um roteiro de teste em que o registro **passava**
com o realm trocado, o que era impossível. A captura mostrou dois `401`, cada
um com um realm diferente, na mesma execução.

A causa é que em UDP no Linux o `SO_REUSEADDR` permite dois sockets ligados ao
**mesmo endereço:porta**, e o datagrama vai para um ou para o outro sem regra
que se possa prever. Medido:

```
sem  SO_REUSEADDR: o segundo bind falhou — [Errno 98] Address already in use
com  SO_REUSEADDR: o segundo bind PASSOU — duas escutas na mesma porta
```

Um registrar esquecido de uma execução anterior passaria a responder metade dos
desafios com o realm antigo. A lição viraria loteria e o aluno não teria como
descobrir por quê — o sintoma é indistinguível de um bug do próprio exercício.

Por isso o `devlab-registrar` e o `devlab-anel-sip` **não** usam a opção, e
morrem com uma mensagem que diz o que fazer. O `devlab-relay-sip` do nível
Construtor continua como está, e a assimetria tem razão: ninguém o sobe à mão —
quem o gerencia é o `devlab-chamada`, que mata o anterior pelo arquivo de PID.
As duas peças novas o aluno sobe com o próprio dedo.

## 36. O anel empilha `Via`, e não responde `483` a um `ACK`

O `devlab-relay-sip` não serve para montar um loop: ele decide o sentido pela
ORIGEM do datagrama, e num anel toda mensagem vem do outro proxy. Daí o
`devlab-anel-sip`, que faz o que o RFC 3261 §16.6 manda: decrementa
`Max-Forwards`, responde `483 Too Many Hops` quando ele chega a zero (§16.3), e
**empilha um `Via` próprio ao encaminhar**, desempilhando-o na volta (§16.7).

O `Via` não é enfeite: é o mecanismo que faz a resposta achar o caminho de
volta. Sem ele o `483` do septuagésimo salto ficaria quicando entre os dois
proxies para sempre, e o aluno veria um lab quebrado no lugar do comportamento
que o protocolo define.

A exceção do `ACK` saiu de uma medição. Na primeira versão a captura tinha
**duas** voltas completas — 142 respostas `483` para 71 INVITEs. O SIPp manda o
`ACK` do `483`, esse `ACK` também dá a volta no anel, e um segundo `483` nascia
em resposta a ele. Além de confuso pelas razões erradas, é proibido: §17 não
admite resposta a `ACK`. Corrigido, o percurso ficou determinístico e legível —
verificado em duas execuções idênticas:

| | quantidade |
|---|---|
| INVITE (`Max-Forwards` de 70 a 0) | 71 |
| ACK | 71 |
| 483 | 71 |
| 483 que chegam a quem ligou | 1 |

## 37. O que o nível NÃO cobre, e por quê

Duas coisas do PRD §7 G ficaram de fora, e é melhor dizê-lo aqui do que deixar
a capacidade da trilha prometendo:

- **NAT.** Com `rede: nenhuma` o diálogo inteiro acontece em `127.0.0.0/8`, e
  não há tradução de endereço para observar. Encenar NAT com `iptables` dentro
  do container produziria um sintoma que o aluno não conseguiria relacionar com
  o que vê em campo. O assunto tem casa: é a trilha H (`nathelper`,
  `fix_nated_contact`, RTPengine), onde existe topologia para ele.
- **Geração de carga e teste de capacidade** (G.3). O SIPp faz isso bem, e o
  lab tem `devlab-chamada -n`. O que falta é o objeto: medir capacidade contra
  outro SIPp mede o lab, não um sistema. O lugar é a trilha F, com um PBX de
  verdade do outro lado.

A capacidade declarada do nível engenheiro em `trilha.yaml` foi reescrita para
o que ele entrega de fato. O rótulo é onde a honestidade mora — a mesma razão
pela qual trilha sem lição aparece como "em breve" em vez de sumir do mapa.

## 38. O relógio do RFC 3261 é visível no lab, e o teto do SIPp não é dele

A lição de retransmissão precisava de números estáveis, e eles existem. Medido
três vezes, com resultado idêntico, arredondando ao décimo:

| transação | intervalos entre as cópias |
|---|---|
| **INVITE** (SIPp) | 0,5 · 1 · 2 · 4 · 8 s — dobra sempre |
| **REGISTER** (sipsak) | 0,5 · 1 · 2 · 4 · 4 · 4 · 4 · 4 · 4 · 4 s — trava em `T2` |

São exatamente os *Timer A* e *Timer E* do RFC 3261, com `T1` = 500 ms e
`T2` = 4 s. O `sipsak` desiste depois de 11 transmissões, em 32 s, que é o
`64 × T1` do *Timer F* — a lição usa esse número porque é ele que sai pela boca
do usuário ("fica mudo uns trinta segundos e desiste").

Uma honestidade que ficou registrada na própria lição: o INVITE do lab para na
**quinta** retransmissão por causa do `-max_retrans 5` do SIPp, e não do
protocolo. Com `-max_invite_retrans 10` aparece a sexta, em 31,5 s, e aí sim é
o *Timer B* que encerra. Arredondar ao décimo é o que torna a projeção
determinística: a variação medida entre execuções ficou em ~1 ms, com ~50 ms de
folga até o próximo décimo.

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
