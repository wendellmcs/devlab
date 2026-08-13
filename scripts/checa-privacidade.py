#!/usr/bin/env python3
"""Portão de privacidade: nada da máquina nem do autor entra no repositório público.

Este portão nasceu de um vazamento real. No primeiro push público, o
`docs/CONTINUAR.md` — um documento de trabalho interno — foi junto, e com ele o
nome da pasta local, uma seção descrevendo como o autor trabalha e a
configuração desta máquina em particular. Nada era segredo; tudo era
desnecessário, e nada disso é de interesse de quem chega ao projeto.

O conserto (remover, reescrever o histórico, force-push) revelou a segunda
metade da lição: **force-push não apaga nada no GitHub**. Os objetos órfãos
continuam acessíveis por SHA, e os SHAs de push em repositório público são
arquivados por terceiros. A única limpeza confiável foi recriar o repositório.

Ou seja: aqui não existe conserto barato depois. Só prevenção antes — e é o que
este arquivo é.

O que ele varre: **exatamente o que seria publicado**, e nada além disso.
São os arquivos que o git rastreia (`git ls-files`) mais as mensagens de commit
alcançáveis — porque mensagem de commit é conteúdo público como qualquer outro,
e é fácil esquecer disso.

Os valores sensíveis são DERIVADOS DO AMBIENTE, nunca escritos aqui. Um
denylist com "wendell" dentro protegeria uma pessoa e falharia para a próxima —
e, pior, publicaria o nome que veio esconder.

Uso:
    python3 scripts/checa-privacidade.py          # falha com código 1 se achar algo
    python3 scripts/checa-privacidade.py --lista  # só mostra o que está sendo procurado
"""
from __future__ import annotations

import getpass
import os
import re
import socket
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent

VERMELHO = "\033[31m"
VERDE = "\033[32m"
AMARELO = "\033[33m"
FIM = "\033[0m"

# ---------------------------------------------------------------------------
# 1. Caminhos que NUNCA podem ser rastreados.
#
# É a defesa contra a classe inteira de "documento de trabalho interno", que
# nenhuma expressão regular pega: o problema deles não é uma string, é o
# propósito. Se o arquivo existe para você e não para quem clona, ele entra
# aqui e no .gitignore.
# ---------------------------------------------------------------------------
NUNCA_RASTREADOS = (
    "docs/CONTINUAR.md",
    ".env",
    ".env.local",
)


def valores_desta_maquina() -> list[tuple[str, str]]:
    """O que identifica ESTA máquina e ESTE autor, lido do ambiente."""
    achados: list[tuple[str, str]] = []

    lar = os.path.expanduser("~")
    if lar and lar not in ("/", ""):
        achados.append(("caminho do seu diretório pessoal", re.escape(lar)))

    try:
        usuario = getpass.getuser()
    except Exception:
        usuario = ""
    if usuario:
        # Só em contexto que revela a conta do sistema. O nome solto não entra:
        # ele aparece legitimamente na URL do repositório e na licença, e um
        # portão que grita nesses casos é um portão que as pessoas desligam.
        achados.append(
            ("seu usuário do sistema, em caminho ou login",
             rf"(?:/home/|/Users/|~|[Cc]:\\Users\\|\b\w+@){re.escape(usuario)}\b")
        )

    maquina = socket.gethostname()
    if maquina and len(maquina) > 3:
        achados.append(("o nome desta máquina", re.escape(maquina)))

    # A pasta em que o repositório vive. Foi exatamente esta que vazou: o nome
    # de uma pasta local pode ser o de um empregador ou cliente.
    pasta = RAIZ.name
    if pasta and len(pasta) > 3:
        achados.append(("o nome da pasta local do projeto", re.escape(pasta)))
    achados.append(("o caminho absoluto do repositório", re.escape(str(RAIZ))))

    return achados


# ---------------------------------------------------------------------------
# 2. Segredos e identificadores, independentes de quem roda.
# ---------------------------------------------------------------------------
SEGREDOS = [
    ("bloco de chave privada", r"-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----"),
    ("token do GitHub", r"\bgh[pousr]_[A-Za-z0-9]{20,}"),
    ("chave da API da Anthropic", r"\bsk-ant-[A-Za-z0-9_-]{20,}"),
    ("chave da API da OpenAI", r"\bsk-[A-Za-z0-9]{32,}"),
    ("chave de acesso da AWS", r"\bAKIA[0-9A-Z]{16}\b"),
    ("token do Slack", r"\bxox[baprs]-[A-Za-z0-9-]{10,}"),
    ("endereço MAC", r"\b(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\b"),
]

# E-mail real. O `[A-Za-z]{2,}` no fim é o que impede um SIP URI de casar:
# `1050@127.0.0.1` termina em dígito e não é e-mail.
EMAIL = re.compile(r"\b[\w.+-]+@(?:[\w-]+\.)+[A-Za-z]{2,}\b")

# O que NÃO é um endereço pessoal, mesmo casando com a forma de um.
#
# Cada entrada aqui saiu de um falso positivo real na primeira execução deste
# portão. A regra de ouro: portão que grita à toa é portão que alguém desliga —
# e aí ele não protege no dia em que importa.
EMAIL_PERMITIDO = re.compile(
    r"(?:"
    # Domínios que não existem ou existem para não serem usados.
    r"@(?:users\.)?noreply\.[\w.-]+"
    r"|@[\w.-]*(?:example|exemplo)\.[\w.]+"
    r"|@[\w.-]+\.(?:local|invalid|test|localdomain)"
    r"|@localhost"
    r"|@anthropic\.com"
    # URL de SSH de forja, que tem forma de e-mail e não é um.
    r"|^git@(?:github|gitlab|bitbucket|codeberg)\."
    r")",
    re.IGNORECASE,
)

# Endereço cuja parte local é um IP não é e-mail: é fixture de quem testa
# parsing de URL, como `127.0.0.1@evil.com` nos testes da guarda de origem.
LOCAL_E_UM_IP = re.compile(r"^(?:\d{1,3}\.){3}\d{1,3}@")

# Extensões que não fazem sentido varrer como texto.
BINARIAS = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf", ".wav", ".pcap", ".woff", ".woff2"}


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=RAIZ, text=True, capture_output=True, check=False
    ).stdout


def arquivos_publicados() -> list[str]:
    return [l for l in git("ls-files").splitlines() if l.strip()]


def mensagens_de_commit() -> list[tuple[str, str]]:
    """(identificação, texto) de cada mensagem de commit alcançável."""
    bruto = git("log", "--format=%H%x1f%B%x1e", "--all")
    saida: list[tuple[str, str]] = []
    for registro in bruto.split("\x1e"):
        if "\x1f" not in registro:
            continue
        sha, corpo = registro.split("\x1f", 1)
        sha = sha.strip()
        if sha:
            saida.append((f"commit {sha[:9]}", corpo))
    return saida


def procurar(texto: str, regras: list[tuple[str, str]]) -> list[tuple[str, int, str]]:
    """Devolve (rótulo, número da linha, trecho) para cada regra que casar."""
    achados = []
    for rotulo, padrao in regras:
        for m in re.finditer(padrao, texto):
            linha = texto.count("\n", 0, m.start()) + 1
            achados.append((rotulo, linha, m.group(0)[:80]))
    return achados


def procurar_emails(texto: str) -> list[tuple[str, int, str]]:
    achados = []
    for m in EMAIL.finditer(texto):
        endereco = m.group(0)
        if EMAIL_PERMITIDO.search(endereco) or LOCAL_E_UM_IP.match(endereco):
            continue
        linha = texto.count("\n", 0, m.start()) + 1
        achados.append(("endereço de e-mail real", linha, endereco))
    return achados


def auto_teste(regras: list[tuple[str, str]]) -> None:
    """Prova que o varredor DETECTA antes de confiar num relatório limpo.

    É a decisão 12 do projeto aplicada aqui: "0 achados" e "a busca nunca rodou"
    imprimem a mesma linha verde. Sem este passo, um erro de digitação numa
    expressão regular transformaria o portão num carimbo.
    """
    amostra = (
        f"caminho {os.path.expanduser('~')}/coisa\n"
        "chave AKIA0123456789ABCDEF\n"
        "contato fulano@empresa-de-verdade.com.br\n"
    )
    encontrados = procurar(amostra, regras) + procurar_emails(amostra)
    rotulos = {r for r, _, _ in encontrados}
    esperados = {
        "caminho do seu diretório pessoal",
        "chave de acesso da AWS",
        "endereço de e-mail real",
    }
    faltando = esperados - rotulos
    if faltando:
        print(f"{VERMELHO}✘ auto-teste do portão falhou{FIM}: não detectou {sorted(faltando)}")
        print("  Um varredor que não acha o que foi plantado não prova nada.")
        sys.exit(2)


def main() -> int:
    regras = valores_desta_maquina() + SEGREDOS

    if "--lista" in sys.argv:
        print("O que este portão procura no que seria publicado:\n")
        for rotulo, _ in regras:
            print(f"  · {rotulo}")
        print("  · endereço de e-mail real (fora de noreply/example)")
        print("\nE recusa que estes caminhos sejam rastreados:")
        for c in NUNCA_RASTREADOS:
            print(f"  · {c}")
        return 0

    print("\033[1m== portão de privacidade ==\033[0m")
    auto_teste(regras)
    print(f"  {VERDE}✔{FIM} auto-teste: o varredor detecta o que foi plantado")

    problemas: list[str] = []

    rastreados = arquivos_publicados()
    for proibido in NUNCA_RASTREADOS:
        if proibido in rastreados:
            problemas.append(
                f"{proibido} está RASTREADO — é documento interno e não pode ser publicado; "
                f"ponha-o no .gitignore e rode: git rm --cached {proibido}"
            )

    for caminho in rastreados:
        if Path(caminho).suffix.lower() in BINARIAS:
            continue
        arquivo = RAIZ / caminho
        try:
            texto = arquivo.read_text(encoding="utf-8", errors="ignore")
        except (OSError, UnicodeDecodeError):
            continue
        for rotulo, linha, trecho in procurar(texto, regras) + procurar_emails(texto):
            problemas.append(f"{caminho}:{linha} — {rotulo}: {trecho}")

    for identificacao, corpo in mensagens_de_commit():
        for rotulo, _, trecho in procurar(corpo, regras) + procurar_emails(corpo):
            problemas.append(f"{identificacao} (mensagem) — {rotulo}: {trecho}")

    print(f"  varridos: {len(rastreados)} arquivo(s) rastreado(s) e "
          f"{len(mensagens_de_commit())} mensagem(ns) de commit")

    if problemas:
        print(f"\n{VERMELHO}✘ {len(problemas)} achado(s) — isto NÃO pode ir a público{FIM}\n")
        for p in problemas:
            print(f"  {p}")
        print(f"\n{AMARELO}Lembre: force-push não apaga nada no GitHub.{FIM} "
              "Objeto publicado continua acessível por SHA.\n"
              "Resolva ANTES de empurrar.")
        return 1

    print(f"\n{VERDE}✔ nada da máquina nem do autor no que seria publicado{FIM}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
