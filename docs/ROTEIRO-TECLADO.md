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
| 11 | `Tab` até "Resetar lab", `Enter` | Explica o que se perde antes de recriar (WCAG 3.3.6) |
| 12 | `Tab` até "Trilhas" no breadcrumb, `Enter` | Volta ao mapa; o lab é destruído |
| 13 | `Tab` até o placar de XP, `Enter` | Abre `/aluno` |
| 14 | `Alt+←` (voltar do navegador) | Volta ao mapa, sem deixar container órfão |

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

- [ ] **Passagem com leitor de tela real** (Orca no Linux, NVDA no Windows).
      Não foi feita: não há leitor de tela instalado nesta máquina, e Chromium
      headless não substitui um. O que a automação prova é a *estrutura* —
      papéis, nomes acessíveis, ordem de foco, regiões `aria-live`. O que ela
      **não** prova é se o que sai pelo áudio é compreensível.
- [ ] **`screenReaderMode` do xterm.js** — a saída do shell é anunciada? É o
      ponto mais difícil do produto e o único que exige o app com Docker de pé
      (`npm run iniciar`), não o servidor de fixtures.
- [ ] **Passo 11** — "Resetar lab" ainda não confirma nem explica o que se
      perde (WCAG 3.3.6, Prevenção de Erro). Está no roteiro como alvo, não
      como aprovado.

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
