#!/usr/bin/env python3
"""Preenche a `saida` da demonstração de cada lição rodando os comandos DE VERDADE.

O bloco 5 do E-G-P — a demonstração comentada — só ensina se a saída for a que
o aluno vai ver. Saída escrita de cabeça envelhece em silêncio: muda a versão
do coreutils, muda o seed da imagem, e a lição passa a mostrar uma coisa
enquanto o terminal mostra outra. O aluno conclui que errou.

Este script tira a saída das mãos de quem escreve. Para cada lição:

  1. sobe um container da imagem declarada em `lab.imagem`;
  2. roda `lab.setup` como root, se houver;
  3. executa os comandos de `ensino.demonstracao` NA ORDEM, numa única sessão
     de shell — então `cd` e arquivos criados persistem de um passo ao outro,
     como aconteceria com o aluno;
  4. grava a saída real de volta no YAML.

Uso:
    python3 scripts/capturar-demonstracao.py                 # todas as lições
    python3 scripts/capturar-demonstracao.py linux-op-10-globbing ...
    python3 scripts/capturar-demonstracao.py --conferir      # não grava; falha se divergir

`--conferir` é o modo de CI: ele não escreve nada e sai com código 1 se a saída
gravada não for mais a que o container produz. É o detector de deriva.

Requisitos: docker acessível (nesta máquina, via `sg docker -c '...'`).
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("erro: PyYAML ausente. Instale com: sudo apt-get install -y python3-yaml")

RAIZ = Path(__file__).resolve().parent.parent
CONTENT = RAIZ / "content"

# Improvável de aparecer em saída de comando, e fácil de casar linha a linha.
SEPARADOR = "<<<DEVLAB-DEMO-SEP>>>"
# Teto de linhas por saída: demonstração é exemplo, não despejo de log.
MAX_LINHAS = 24


def docker(args: list[str], entrada: str | None = None) -> subprocess.CompletedProcess[str]:
    """Chama o docker pelo grupo, que é como esta máquina o alcança."""
    comando = " ".join(f"'{a}'" if " " in a else a for a in ["docker", *args])
    return subprocess.run(
        ["sg", "docker", "-c", comando],
        input=entrada, text=True, capture_output=True, timeout=180,
    )


def roteiro(comandos: list[str]) -> str:
    """Um script só: o estado de um passo é o ponto de partida do seguinte."""
    linhas = ["export LC_ALL=C.UTF-8", "cd ~", "set +e", "exec 2>&1"]
    for comando in comandos:
        linhas.append(f"printf '%s\\n' '{SEPARADOR}'")
        linhas.append(comando)
    linhas.append(f"printf '%s\\n' '{SEPARADOR}'")
    return "\n".join(linhas) + "\n"


def executar(licao: dict, comandos: list[str]) -> list[str]:
    lab = licao.get("lab") or {}
    imagem = lab.get("imagem", "devlab/linux-base:1.0.0")
    usuario = lab.get("usuario", "aluno")

    criado = docker([
        "run", "-d", "--rm", "--network", "none",
        "--entrypoint", "sleep", imagem, "600",
    ])
    if criado.returncode != 0:
        raise RuntimeError(f"não subiu o container: {criado.stderr.strip()}")
    cid = criado.stdout.strip()

    try:
        if lab.get("setup"):
            r = docker(["exec", "-i", "-u", "root", cid, "bash", "-s"], entrada=lab["setup"])
            if r.returncode != 0:
                raise RuntimeError(f"setup falhou: {r.stderr.strip()[:400]}")

        r = docker(
            ["exec", "-i", "-u", usuario, cid, "bash", "-s"],
            entrada=roteiro(comandos),
        )
        bruto = r.stdout

        # O roteiro emite N+1 separadores para N comandos (um antes de cada e um
        # ao final), então o split entrega N+2 pedaços: o vazio antes do
        # primeiro marcador, uma saída por comando, e o vazio depois do último.
        partes = bruto.split(SEPARADOR + "\n")
        if len(partes) != len(comandos) + 2:
            raise RuntimeError(
                f"esperava {len(comandos) + 2} pedaços, vieram {len(partes)} — "
                f"algum comando emitiu o separador?"
            )
        return [normalizar(s) for s in partes[1:-1]]
    finally:
        docker(["rm", "-f", cid])


def normalizar(texto: str) -> str:
    """Tira sequências ANSI, espaço à direita e o excesso de linhas."""
    texto = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", texto)
    linhas = [l.rstrip() for l in texto.split("\n")]
    while linhas and linhas[-1] == "":
        linhas.pop()
    while linhas and linhas[0] == "":
        linhas.pop(0)
    if len(linhas) > MAX_LINHAS:
        cortadas = len(linhas) - MAX_LINHAS
        linhas = linhas[:MAX_LINHAS] + [f"... (mais {cortadas} linha(s))"]
    return "\n".join(linhas)


def bloco_yaml(texto: str, recuo: str) -> str:
    """
    Escreve a saída como bloco literal, preservando o que o terminal mostrou.

    O `2` em `|-2` é o indicador explícito de indentação, e não é enfeite. Sem
    ele o YAML DEDUZ a indentação do bloco a partir da primeira linha — então
    uma saída cujas linhas começam todas com espaço (é o caso do `wc -l`, que
    alinha os números à direita) tem esse espaço comido na leitura. A saída
    gravada deixava de ser a saída real, silenciosamente, exatamente no
    arquivo que existe para garantir o contrário.

    O `-` continua descartando a quebra de linha final.
    """
    if texto == "":
        return '""'
    corpo = "\n".join(f"{recuo}{l}" if l else "" for l in texto.split("\n"))
    return "|-2\n" + corpo


def reescrever(arquivo: Path, saidas: list[str]) -> bool:
    """
    Substitui só o campo `saida:` de cada passo, no arquivo original.

    Reserializar o YAML inteiro com o PyYAML seria mais curto e destruiria o
    arquivo: ele reordena chaves, reindenta os scripts de check e apaga todo
    comentário. Os comentários dentro dos checks explicam por que cada um mede
    o que mede — perdê-los custaria mais do que este parsing manual.
    """
    linhas = arquivo.read_text(encoding="utf-8").split("\n")
    saida_de = iter(saidas)
    resultado: list[str] = []
    i = 0
    dentro_da_demo = False
    mudou = False

    while i < len(linhas):
        linha = linhas[i]

        if re.match(r"^\s{2}demonstracao:\s*$", linha):
            dentro_da_demo = True
            resultado.append(linha)
            i += 1
            continue

        # Sai da demonstração ao encontrar outra chave no mesmo nível.
        if dentro_da_demo and re.match(r"^\s{2}\w+:", linha) and "demonstracao" not in linha:
            dentro_da_demo = False

        if dentro_da_demo and re.match(r"^\s+saida:", linha):
            recuo = " " * (len(linha) - len(linha.lstrip()))
            try:
                nova = next(saida_de)
            except StopIteration:
                raise RuntimeError(f"{arquivo.name}: mais campos 'saida' do que comandos")
            antigo_inicio = i
            # Consome o valor antigo: escalar na mesma linha ou bloco recuado.
            i += 1
            if re.search(r"[|>][-+]?\d?\s*$", linhas[antigo_inicio]):
                while i < len(linhas) and (linhas[i].strip() == "" or linhas[i].startswith(recuo + " ")):
                    i += 1
            substituta = f"{recuo}saida: " + bloco_yaml(nova, recuo + "  ")
            if "\n".join(linhas[antigo_inicio:i]) != substituta:
                mudou = True
            resultado.extend(substituta.split("\n"))
            continue

        resultado.append(linha)
        i += 1

    restantes = list(saida_de)
    if restantes:
        raise RuntimeError(f"{arquivo.name}: {len(restantes)} comando(s) sem campo 'saida' no YAML")

    if mudou:
        arquivo.write_text("\n".join(resultado), encoding="utf-8")
    return mudou


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("licoes", nargs="*", help="ids a capturar (padrão: todas)")
    p.add_argument("--conferir", action="store_true",
                   help="não grava; sai com 1 se a saída gravada divergir da real")
    args = p.parse_args()

    arquivos = sorted(CONTENT.rglob("*.yaml"))
    divergiram: list[str] = []
    tocadas = 0

    for arquivo in arquivos:
        if arquivo.name == "trilha.yaml":
            continue
        dados = yaml.safe_load(arquivo.read_text(encoding="utf-8"))
        if not isinstance(dados, dict) or "ensino" not in dados:
            continue
        if args.licoes and dados.get("id") not in args.licoes:
            continue

        passos = (dados.get("ensino") or {}).get("demonstracao") or []
        if not passos:
            continue

        comandos = [p_["comando"] for p_ in passos]
        print(f"  {dados['id']}: {len(comandos)} comando(s)…", flush=True)
        saidas = executar(dados, comandos)

        if args.conferir:
            gravadas = [(p_.get("saida") or "").rstrip() for p_ in passos]
            for i, (gravada, real) in enumerate(zip(gravadas, saidas)):
                if gravada != real.rstrip():
                    divergiram.append(f"{dados['id']}.demonstracao[{i}] ({comandos[i]})")
                    print(f"    \033[31m✘\033[0m passo {i}: a saída gravada não é mais a real")
                    print(f"      gravada: {gravada[:160]!r}")
                    print(f"      real:    {real[:160]!r}")
        else:
            if reescrever(arquivo, saidas):
                tocadas += 1
                print(f"    \033[32m✔\033[0m saída real gravada")
            else:
                print(f"    · já estava igual")

    if args.conferir:
        if divergiram:
            print(f"\n  \033[31m✘ {len(divergiram)} demonstração(ões) com saída defasada\033[0m")
            print("  Rode: python3 scripts/capturar-demonstracao.py")
            return 1
        print("\n  \033[32m✔ toda demonstração mostra a saída que o container produz hoje\033[0m")
        return 0

    print(f"\n  {tocadas} arquivo(s) atualizado(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
