# Roteiro de teste manual — teclado e leitor de tela

Percurso central do DevLab **sem tocar no mouse**, com um registro do
resultado. Versionado porque acessibilidade regride em silêncio: nada quebra,
nada fica vermelho, só fica impossível de usar para quem depende do teclado.

> **Metade disto é automática.** `npm run a11y:teclado` percorre este mesmo
> caminho por script e reprova o build. O que sobra para o humano é o que
> máquina nenhuma mede: se o que o leitor de tela anuncia faz sentido, se a
> ordem parece natural, se dá para saber onde se está.

---

## Como rodar

```bash
npm run build              # a auditoria audita o bundle, não o dev server
npm run a11y               # axe-core (7 telas × 2 temas) + percurso de teclado
npm run a11y:fixtures      # sobe as telas em http://127.0.0.1:7799 para você mesmo navegar
```

`a11y:fixtures` serve as telas reais com Docker trocado por dados fixos — é o
que permite chegar à tela de lição sem subir container. Abra o endereço e faça
o percurso abaixo à mão.

Para o percurso com leitor de tela, use o app de verdade (`npm run iniciar`):
o terminal do fixture aparece desconectado, e é justamente o terminal que
precisa ser ouvido.

---

## O percurso

Comece com o foco na barra de endereço e aperte `Tab`. **Não toque no mouse até
o fim.** Em cada passo, anote o que o leitor de tela falou.

| # | Passo | O que tem de acontecer |
|---|---|---|
| 1 | `Tab` na home | A **primeira** parada é "Pular para o conteúdo", e ela aparece na tela ao receber foco |
| 2 | `Tab` até a trilha Linux, `Enter` | Vai para `/trilha/linux`; o foco vai para o conteúdo, não volta ao topo |
| 3 | `Tab` até a lição 10, `Enter` | O lab sobe; o foco cai no `<main>` e o leitor anuncia a tela nova |
| 4 | Ler a lição | Títulos em ordem, sem pular nível: `h1` do título, `h2` das seções |
| 5 | `Tab` até um bloco de código, `Enter` | O comando é **inserido** no terminal, não executado — quem aperta Enter no shell é você |
| 6 | `Tab` até "Dica 1", `Enter` | A dica abre **e recebe o foco**; o leitor lê o texto sem você procurá-lo |
| 7 | `Tab` até "Verificar", `Enter` | O resultado é anunciado por `aria-live` **sem** roubar o foco de onde você está |
| 8 | `Tab` até "Entrar no terminal", `Enter` | O foco entra no terminal e o shell responde às teclas |
| 9 | Dentro do terminal, `Tab` | O shell recebe o `Tab` (completa o comando). O foco **não** sai — isto é intencional |
| 10 | `Esc` | O foco volta para fora do terminal, no marcador "Fim do terminal" |
| 11 | `Tab` até "Resetar lab", `Enter` | Abre a confirmação, que **enumera** o que se perde e o que fica (WCAG 3.3.6). O foco vai para "Cancelar" |
| 12 | Dentro do diálogo, `Tab` | O foco circula **dentro** dele; a página de trás está inerte |
| 13 | `Esc` | Fecha sem resetar, e o foco **volta** para o botão "Resetar lab" |
| 14 | `Tab` até "Trilhas" no breadcrumb, `Enter` | Se você mexeu no lab, pergunta antes de sair e destruir; se não mexeu, sai direto |
| 15 | Com o aviso de prazo na tela, `Tab` até "Manter o lab vivo", `Enter` | O aviso some e o prazo volta ao cheio (WCAG 2.2.1/2.2.6) |
| 16 | `Tab` até o placar de XP, `Enter` | Abre `/aluno` |
| 17 | `Alt+←` (voltar do navegador) | Volta ao mapa, sem deixar container órfão |

### Em cada tela, confira também

- **Foco sempre visível.** O anel é duplo de propósito — um traço escuro por
  dentro, um halo claro por fora — para aparecer tanto em fundo claro quanto
  escuro. Se em algum ponto você não souber onde está, é defeito.
- **Zoom 200%** (`Ctrl` `+` até 200%): sem rolagem horizontal. Abaixo de
  1024px a interface avisa que exige tela maior, em vez de degradar — isso é a
  decisão 7, não um bug.
- **Tema claro e escuro.** Repita o percurso nos dois (`Tab` até o botão de
  tema).

---

## Registro

Uma linha por execução. Não apague as antigas: a comparação é o valor.

### 2026-08-02 — Chromium 151 (headless), tema escuro e claro, 1440×900

**Automático — passou:**

- `npm run a11y` — 14 auditorias (7 telas × 2 temas), **0 violações**, com
  `color-contrast-enhanced` (1.4.6, 7:1) ligada e o auto-teste de controle
  provando que a regra roda de verdade.
- `npm run a11y:teclado` — passos 1 a 14 acima, todos verdes.

**Corrigido nesta passagem (achado pela auditoria, não por leitura de código):**

1. **Ordem de cabeçalho quebrada na tela de lição.** `### Sua tarefa` do
   enunciado virava `h3` logo depois do `h1` do título — pulo de nível, WCAG
   1.3.1. O componente `Markdown` passou a reancorar a hierarquia a partir de
   `nivelBase`, então quem escreve lição não precisa contar níveis do layout.
2. **`h2` antes do `h1`.** Os rótulos de painel ("Objetivo", "Terminal",
   "Estado do lab") eram `h2` e vinham antes do `h1` do título da lição. Viraram
   `<p>`; o `aria-label` do `<section>` continua nomeando o landmark.
3. **Alvos abaixo de 44×44 (WCAG 2.5.5, AAA).** Breadcrumb a 31px, placar de XP
   a 33px, skip link a 41px. O axe não pegaria: a regra dele implementa o 2.5.8,
   que é AA e pede 24×24. Virou verificação própria na auditoria.
4. **Foco perdido ao revelar uma dica.** O `<button>` virava `<div>` de texto, o
   elemento focado deixava de existir e o browser devolvia o foco ao `<body>` —
   o aluno era jogado ao topo do documento sem ouvir a dica que acabou de pagar
   (WCAG 2.4.3). Agora o texto revelado recebe o foco.

**Pendente — precisa de humano:**

- [x] **Passagem com leitor de tela real** — feita em 2026-08-13 com NVDA no
      Windows. Ver o registro daquela data, abaixo.
- [x] **`screenReaderMode` do xterm.js** — verificado na mesma passagem.

### 2026-08-13 — primeira passagem com leitor de tela real (NVDA)

**Quem ouviu:** o autor do projeto, com NVDA no Windows, contra o app REAL
(`npm run iniciar` no WSL2, com Docker e container de verdade), alcançado do
navegador do Windows em `http://localhost:7788`. Não foi o servidor de
fixtures: o terminal precisa estar conectado para ser ouvido.

**O que ficou estabelecido:** o percurso funciona com leitor de tela, incluindo
o terminal. As duas perguntas que só o áudio responde foram respondidas por
quem ouviu, e as duas caixas acima saíram de pendente.

**O que este registro NÃO contém, e a omissão é deliberada:** a transcrição do
que o NVDA falou em cada passo. Ela não foi anotada durante a sessão, e inventar
os anúncios para "completar" o registro seria pior do que a lacuna — o valor
deste arquivo é a comparação entre execuções, e uma comparação contra texto
imaginado não vale nada. Fica como está: atestado pelo autor, sem transcrição.

**Uma observação que veio junto, e que é trabalho futuro:** o relato foi *"ele é
chato, mas funciona"*. Verbosidade é a natureza de um leitor de tela, então isso
pode ser só ele sendo ele. Mas pode também ser a interface **anunciando demais**
— e há candidatos concretos no código: seis regiões com `aria-live="polite"`
(cabeçalho, estado do lab, painel de objetivo, conexão do terminal, escala,
assistente de IA), algumas atualizando com frequência. Se um dia alguém for
medir isso, a pergunta é: quantas dessas precisam mesmo interromper a leitura?
Uma região que anuncia a cada 2,5 s transforma a tela num rádio ligado.

Não está registrado como defeito porque não foi medido como defeito. Está
registrado para que a próxima passagem saiba o que escutar.

### 2026-08-03 — confirmação destrutiva (3.3.6) e prazo do lab (2.2.6)

**Automático — passou:**

- `npm run a11y:axe` — 18 auditorias (**9** telas × 2 temas), 0 violações. As
  duas telas novas são estados efêmeros que ninguém conferiria à mão: o aviso
  de prazo (existe por 5 minutos na vida real) e o diálogo de confirmação
  aberto.
- `npm run a11y:teclado` — passos 1 a 17, incluindo foco inicial no botão que
  não destrói, `Tab` preso no diálogo, `Esc` devolvendo o foco a quem abriu, e
  cancelar a saída mantendo o aluno na lição.
- Contra o app REAL (agente + Docker + terminal de verdade, não fixture):
  arquivo criado pelo PTY sobrevive ao cancelar e some ao confirmar; o
  contador de resets sobe; a guarda de saída dispara só depois de o aluno ter
  mexido no lab.

**Defeito de fundo achado no caminho:** o relógio de ociosidade media o APP,
não o aluno. O painel de estado lê a árvore de arquivos a cada 2,5 s e essa
leitura zerava o TTL — ou seja, o lab de 45 min nunca era coletado com a tela
aberta, e qualquer aviso construído sobre esse relógio jamais apareceria.
Agora só ação deliberada conta (`OpcoesExec.atividade`).

**Limite conhecido, registrado de propósito:** a guarda de saída cobre os links
do app, não o **botão voltar do navegador**. Interceptá-lo exigiria desfazer a
navegação já ocorrida e reempilhar o histórico; um histórico remendado quebra
de formas piores do que o problema que resolveria. Quem usa `Alt+←` sai e
perde o container — como antes.

---

## O que a automação deliberadamente não cobre

- **Qualidade do que é anunciado.** "botão, Verificar" é estruturalmente
  correto e pode ser inútil no contexto. Só ouvindo.
- **O terminal.** O conteúdo dentro do `xterm` é gerado pelo shell e está fora
  do controle da aplicação. A responsabilidade da interface é o entorno: entrar,
  sair, saber que está lá.
- **Carga cognitiva.** Passar em todos os critérios e ainda assim ser exaustivo
  de usar é possível — e é o tipo de coisa que só aparece percorrendo inteiro,
  sem mouse, uma vez.
