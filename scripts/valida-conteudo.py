#!/usr/bin/env python3
"""Valida o conteúdo declarativo do DevLab sem precisar de Docker.

Escrever lição é o gargalo do projeto, e um check quebrado só aparece quando o
aluno trava. Este validador fecha esse buraco antes de a lição chegar ao lab:

  1. schema (chaves obrigatórias, kebab-case, dicas <= 3, um corpo por check)
  2. grafo de pré-requisitos: existência e ausência de ciclo
  3. `bash -n` em todo script de setup, break, check e solução
  4. execução de verdade: monta uma árvore falsa a partir do seed da imagem,
     roda os checks (têm de REPROVAR), aplica a solução de referência e roda
     de novo (têm de APROVAR)

O passo 4 é o que pega o erro caro: check que aprova sozinho — e portanto não
mede nada — e dica de nível 3 que não é um comando executável.

Uso:
    python3 scripts/valida-conteudo.py [--so-schema]

Requisitos: python3 com PyYAML e bash. Nenhum container é criado.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("erro: PyYAML ausente. Instale com: sudo apt-get install -y python3-yaml")

RAIZ = Path(__file__).resolve().parent.parent
CONTENT = RAIZ / "content"
SEED = RAIZ / "images/linux-base/seed/home/aluno"

NIVEIS = ("operador", "construtor", "engenheiro")
CHAVES_OBRIGATORIAS = (
    "id", "trilha", "nivel", "ordem", "titulo",
    "capacidade", "ensino", "objetivo_md", "verificar", "xp",
)
ASSINATURAS_MINIMAS_LINUX = (
    "command not found",
    "No such file or directory",
    "Permission denied",
    "Is a directory",
    "Device or resource busy",
    "No space left on device",
)

falhas: list[str] = []
avisos: list[str] = []


def erro(msg: str) -> None:
    falhas.append(msg)
    print(f"  \033[31m✘\033[0m {msg}")


def ok(msg: str) -> None:
    print(f"  \033[32m✔\033[0m {msg}")


def secao(titulo: str) -> None:
    print(f"\n\033[1m== {titulo} ==\033[0m")


# ── carga ──────────────────────────────────────────────────────────────────

def carregar():
    licoes, trilhas, catalogo = [], [], []
    for arq in sorted(CONTENT.rglob("*.yaml")):
        try:
            dados = yaml.safe_load(arq.read_text(encoding="utf-8"))
        except Exception as e:
            erro(f"{arq.relative_to(RAIZ)}: YAML inválido — {e}")
            continue
        if not isinstance(dados, dict):
            erro(f"{arq.relative_to(RAIZ)}: raiz do YAML não é um mapa")
            continue
        if arq.name == "trilha.yaml":
            trilhas.append((arq, dados))
        elif "erros" in dados and "versao" in dados:
            catalogo.append((arq, dados))
        else:
            licoes.append((arq, dados))
    return licoes, trilhas, catalogo


# ── schema ─────────────────────────────────────────────────────────────────

def valida_schema(licoes) -> None:
    vistos: set[str] = set()
    for arq, l in licoes:
        nome = arq.relative_to(RAIZ)
        for chave in CHAVES_OBRIGATORIAS:
            if chave not in l:
                erro(f"{nome}: falta a chave '{chave}'")
        ident = l.get("id")
        if isinstance(ident, str):
            if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", ident):
                erro(f"{nome}: id fora do kebab-case: {ident}")
            if ident in vistos:
                erro(f"id de lição duplicado: {ident}")
            vistos.add(ident)
        if l.get("nivel") not in NIVEIS:
            erro(f"{nome}: nivel deve ser um de {NIVEIS}")
        if len(l.get("dicas") or []) > 3:
            erro(f"{nome}: a escada de dicas tem no máximo 3 degraus")
        if not l.get("verificar"):
            erro(f"{nome}: toda lição precisa de ao menos um check")
        for i, c in enumerate(l.get("verificar") or []):
            if ("script" in c) == ("run" in c):
                erro(f"{nome}: check {i} precisa de exatamente um entre 'script' e 'run'")
            if "descricao" not in c:
                erro(f"{nome}: check {i} sem 'descricao'")
        for e in l.get("erros_comuns") or []:
            try:
                re.compile(e["match"])
            except (re.error, KeyError, TypeError) as ex:
                erro(f"{nome}: erros_comuns.match inválido ({ex})")


def valida_grafo(licoes, trilhas) -> None:
    por_id = {l["id"]: l for _, l in licoes if "id" in l}
    ids_trilha = {d.get("id") for _, d in trilhas}

    for _, l in licoes:
        if l.get("trilha") not in ids_trilha:
            erro(f"{l.get('id')}: trilha inexistente '{l.get('trilha')}'")
        for p in l.get("prereqs") or []:
            if p not in por_id:
                erro(f"{l.get('id')}: prereq inexistente '{p}'")

    estado: dict[str, str] = {}

    def visita(ident: str, caminho: list[str]) -> None:
        if estado.get(ident) == "pronto":
            return
        if estado.get(ident) == "visitando":
            erro(f"ciclo de prereqs: {' -> '.join(caminho + [ident])}")
            return
        estado[ident] = "visitando"
        for p in por_id.get(ident, {}).get("prereqs") or []:
            if p in por_id:
                visita(p, caminho + [ident])
        estado[ident] = "pronto"

    for ident in por_id:
        visita(ident, [])
    if not falhas:
        ok(f"{len(por_id)} lições, grafo acíclico")


# ── E-G-P ──────────────────────────────────────────────────────────────────

VERBOS_DE_BLOOM = {
    "identificar", "descrever", "explicar", "prever", "executar",
    "construir", "diagnosticar", "comparar", "escolher", "adaptar",
}
PAPEIS_DE_COMANDO = {"comando", "opcao", "argumento", "operador"}
TIPOS_DE_PERGUNTA = {"predicao", "diagnostico", "transferencia"}
CAMPOS_DO_ERRO = ("match", "digita", "mensagem", "causa", "conserto")

# Teto de conceitos novos por lição: memória de trabalho real é 4±1, e parte
# dela já está ocupada com o terminal e com a própria sintaxe.
TETO_DE_CONCEITOS = 3


def valida_ensino(licoes) -> None:
    """Cobra os blocos do E-G-P, com as exigências que variam por nível."""
    for arq, l in licoes:
        nome = arq.relative_to(RAIZ)
        lid = l.get("id", "?")
        ensino = l.get("ensino")

        if not isinstance(ensino, dict):
            erro(f"{nome}: falta o bloco 'ensino' — a lição pede a tarefa sem nunca ensinar")
            continue

        for chave in ("gancho", "objetivos", "modelo_mental"):
            if not ensino.get(chave):
                erro(f"{lid}: ensino.{chave} ausente ou vazio")

        objetivos = ensino.get("objetivos") or []
        if not 2 <= len(objetivos) <= 5:
            erro(f"{lid}: ensino.objetivos tem {len(objetivos)}; o intervalo é de 2 a 5")
        for o in objetivos:
            if o.get("verbo") not in VERBOS_DE_BLOOM:
                erro(f"{lid}: verbo de Bloom desconhecido em objetivo: {o.get('verbo')!r}")

        for i, a in enumerate(ensino.get("anatomia") or []):
            partes = a.get("partes") or []
            if len(partes) < 2:
                erro(f"{lid}: anatomia[{i}] disseca menos de 2 partes")
            for p in partes:
                if p.get("papel") not in PAPEIS_DE_COMANDO:
                    erro(f"{lid}: anatomia[{i}] com papel inválido: {p.get('papel')!r}")
            opcoes = sum(1 for p in partes if p.get("papel") == "opcao")
            if opcoes > 5:
                erro(f"{lid}: anatomia[{i}] disseca {opcoes} opções; o teto é 5")

        for i, p in enumerate(ensino.get("compreensao") or []):
            if p.get("tipo") not in TIPOS_DE_PERGUNTA:
                erro(f"{lid}: compreensao[{i}] com tipo inválido: {p.get('tipo')!r}")

        # Bloco 6 em formato fixo de quatro campos. Sem os quatro, "erro comum"
        # vira uma frase solta que não localiza nada quando aparece na tela.
        for i, e in enumerate(l.get("erros_comuns") or []):
            for campo in CAMPOS_DO_ERRO:
                if not e.get(campo):
                    erro(f"{lid}: erros_comuns[{i}] sem '{campo}'")

        nivel = l.get("nivel")
        demo = ensino.get("demonstracao") or []
        guiada = ensino.get("pratica_guiada") or []

        # Fading por nível (expertise reversal): o andaime que sustenta o
        # operador atrapalha o engenheiro. O capstone é o ponto em que o
        # andaime sai mesmo no nível operador — ele mede integração sem ajuda.
        capstone = bool(l.get("capstone"))
        if nivel == "operador" and not capstone:
            if not demo:
                erro(f"{lid}: lição de operador sem demonstração comentada (bloco 5)")
            if not guiada:
                erro(f"{lid}: lição de operador sem prática guiada (bloco 7)")
        if (nivel == "engenheiro" or capstone) and guiada:
            erro(f"{lid}: {'capstone' if capstone else 'lição de engenheiro'} não leva prática guiada (bloco 7)")

        if len(guiada) > 4:
            erro(f"{lid}: prática guiada com {len(guiada)} passos; o teto é 4")

        conceitos = (l.get("ensina") or {}).get("conceitos") or []
        if len(conceitos) > TETO_DE_CONCEITOS:
            erro(
                f"{lid}: introduz {len(conceitos)} conceitos novos; o teto é "
                f"{TETO_DE_CONCEITOS} (memória de trabalho é 4±1)"
            )

        # O conserto de um erro comum conserta o ERRO, não entrega a tarefa.
        # Sem isto, o bloco 6 — que é pré-tarefa e gratuito — publicaria de
        # graça o que a dica 3 cobra 50% do XP para mostrar.
        solucao = (l.get("solucao_referencia") or "").strip()
        if solucao:
            for i, e in enumerate(l.get("erros_comuns") or []):
                if solucao and solucao in (e.get("conserto") or ""):
                    erro(
                        f"{lid}: erros_comuns[{i}].conserto contém a solução de "
                        f"referência inteira — o bloco 6 é gratuito e pré-tarefa"
                    )


# Separadores de comando no shell: cada segmento começa um comando novo.
SEPARADORES = re.compile(r"\|\||&&|[|;&\n]")
# Trecho de código no markdown: cercado por ``` ou por `.
CERCADO = re.compile(r"```[a-z]*\n(.*?)```", re.S)
EM_LINHA = re.compile(r"`([^`\n]+)`")


def comandos_em(linha: str) -> set[str]:
    """Nomes de comando de uma linha de shell — o 1º token de cada segmento."""
    achados: set[str] = set()
    for segmento in SEPARADORES.split(linha or ""):
        for token in segmento.strip().split():
            # `FOO=bar cmd` — a atribuição precede o comando, não é um.
            if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", token):
                continue
            # Lacuna da prática guiada, flag, caminho, variável, redirecionamento.
            if token.startswith(("-", "/", "~", "$", "'", '"', "_", ">", "<", "(", "{")):
                break
            if not re.fullmatch(r"[a-z][a-z0-9._-]*", token):
                break
            achados.add(token)
            break  # só o primeiro token do segmento é o comando
    return achados


def comandos_usados(licao) -> set[str]:
    """Todo comando que a lição escreve, em qualquer bloco."""
    ensino = licao.get("ensino") or {}
    linhas: list[str] = []

    for passo in ensino.get("demonstracao") or []:
        linhas.append(passo.get("comando", ""))
    for a in ensino.get("anatomia") or []:
        linhas.append(a.get("linha", ""))
    for passo in ensino.get("pratica_guiada") or []:
        linhas.append(passo.get("resposta", ""))
        linhas.append(passo.get("modelo", "") or "")
    for e in licao.get("erros_comuns") or []:
        linhas.append(e.get("digita", ""))
        linhas.append(e.get("conserto", ""))
    linhas.extend(licao.get("dicas") or [])
    if licao.get("solucao_referencia"):
        linhas.append(licao["solucao_referencia"])

    # Markdown: só o que está marcado como código. Prosa viraria ruído.
    for texto in (licao.get("objetivo_md"), ensino.get("gancho"), ensino.get("modelo_mental")):
        if not texto:
            continue
        for bloco in CERCADO.findall(texto):
            linhas.extend(bloco.splitlines())
        for trecho in EM_LINHA.findall(CERCADO.sub("", texto)):
            linhas.append(trecho)

    usados: set[str] = set()
    for linha in linhas:
        usados |= comandos_em(linha)
    return usados


def ancestrais(lid: str, por_id: dict) -> set[str]:
    """Fecho transitivo dos pré-requisitos — tudo que vem comprovadamente antes."""
    vistos: set[str] = set()
    pilha = list((por_id.get(lid) or {}).get("prereqs") or [])
    while pilha:
        atual = pilha.pop()
        if atual in vistos or atual not in por_id:
            continue
        vistos.add(atual)
        pilha.extend((por_id[atual].get("prereqs") or []))
    return vistos


def valida_grafo_de_conceitos(licoes) -> None:
    """
    "Ensina antes de pedir" deixa de ser promessa e vira build quebrado.

    Cada lição declara em `ensina` os comandos e conceitos que INTRODUZ. Se uma
    lição usa um comando que outra lição reivindica como seu, aquela outra tem
    de estar no fecho transitivo dos pré-requisitos desta. Senão o aluno chega
    ao comando antes da aula dele — que é exatamente o defeito que o modelo
    E-G-P veio corrigir, e que só a ordem do currículo pode garantir.

    Comando que NENHUMA lição reivindica é ignorado de propósito: seria
    impossível distinguir, sem executar, um utilitário fora de escopo de um
    argumento que por acaso parece nome de comando. O gate mede o que o
    currículo afirma sobre si mesmo.
    """
    por_id = {l["id"]: l for _, l in licoes if "id" in l}

    dono_do_comando: dict[str, str] = {}
    dono_do_conceito: dict[str, str] = {}

    for _, l in sorted(licoes, key=lambda t: t[1].get("ordem", 0)):
        lid = l.get("id", "?")
        ensina = l.get("ensina") or {}
        for cmd in ensina.get("comandos") or []:
            if cmd in dono_do_comando:
                erro(
                    f"{lid}: reivindica ensinar '{cmd}', que "
                    f"{dono_do_comando[cmd]} já ensina — um comando tem um dono só"
                )
            else:
                dono_do_comando[cmd] = lid
        for c in ensina.get("conceitos") or []:
            cid = c.get("id")
            if not cid:
                continue
            if cid in dono_do_conceito:
                erro(
                    f"{lid}: reivindica o conceito '{cid}', que "
                    f"{dono_do_conceito[cid]} já ensina"
                )
            else:
                dono_do_conceito[cid] = lid

    problemas = 0
    for _, l in sorted(licoes, key=lambda t: t[1].get("ordem", 0)):
        lid = l.get("id", "?")
        antes = ancestrais(lid, por_id)

        for cmd in sorted(comandos_usados(l)):
            dono = dono_do_comando.get(cmd)
            if dono is None or dono == lid or dono in antes:
                continue
            erro(
                f"{lid}: usa '{cmd}', que é ensinado em '{dono}' — e '{dono}' "
                f"não é pré-requisito (direto ou transitivo) desta lição"
            )
            problemas += 1

        # Bloco 10: o cartão de revisão é a fonte canônica do item de repetição
        # espaçada, então ele só pode revisar conceito que já foi ensinado.
        for card in l.get("cards_revisao") or []:
            dono = dono_do_conceito.get(card)
            if dono is None:
                erro(
                    f"{lid}: cards_revisao referencia '{card}', que nenhuma lição "
                    f"declara em ensina.conceitos"
                )
                problemas += 1
            elif dono != lid and dono not in antes:
                erro(
                    f"{lid}: revisa o conceito '{card}', ensinado em '{dono}', que "
                    f"não é pré-requisito desta lição"
                )
                problemas += 1

    if problemas == 0 and dono_do_comando:
        ok(
            f"{len(dono_do_comando)} comando(s) e {len(dono_do_conceito)} conceito(s) "
            f"com dono declarado; nenhum é usado antes de ser ensinado"
        )


def valida_sintaxe(licoes) -> int:
    total = 0

    def bash_n(rotulo: str, corpo: str) -> None:
        r = subprocess.run(["bash", "-n"], input=corpo, text=True, capture_output=True)
        if r.returncode != 0:
            erro(f"{rotulo}: {r.stderr.strip()}")

    for _, l in licoes:
        lab = l.get("lab") or {}
        for campo in ("setup", "break"):
            if lab.get(campo):
                total += 1
                bash_n(f"{l.get('id')}.lab.{campo}", lab[campo])
        for i, c in enumerate(l.get("verificar") or []):
            if "script" in c:
                total += 1
                bash_n(f"{l.get('id')}.verificar[{i}]", c["script"])
        if l.get("solucao_referencia"):
            total += 1
            bash_n(f"{l.get('id')}.solucao_referencia", l["solucao_referencia"])
    return total


# ── execução ───────────────────────────────────────────────────────────────

def prepara_raiz() -> tuple[Path, Path]:
    """Árvore falsa equivalente ao /home/aluno da imagem devlab/linux-base."""
    base = Path(tempfile.mkdtemp(prefix="devlab-valida-"))
    home = base / "home" / "aluno"
    home.parent.mkdir(parents=True)
    shutil.copytree(SEED, home)
    # o seed vem da imagem; estes dois nascem do /etc/skel no useradd
    (home / ".bashrc").write_text("# bashrc de validação\n")
    (home / ".profile").write_text("# profile de validação\n")
    return base, home


def adapta(texto: str, home: Path) -> str:
    """Reescreve o script para rodar fora do container, sem root."""
    texto = texto.replace("/home/aluno", str(home))
    texto = re.sub(r"install -o aluno -g aluno -d", "mkdir -p", texto)
    texto = re.sub(r"^\s*chown .*$", ":", texto, flags=re.M)
    return texto


def roda(corpo: str, home: Path):
    env = dict(os.environ, HOME=str(home))
    return subprocess.run(
        ["bash", "-c", corpo], cwd=home, env=env,
        text=True, capture_output=True, timeout=60,
    )


def valida_execucao(licoes) -> int:
    if not SEED.is_dir():
        avisos.append(f"seed da imagem não encontrado em {SEED} — passo 4 pulado")
        return 0

    exercitadas = 0
    for _, l in sorted(licoes, key=lambda t: t[1].get("ordem", 0)):
        lid = l.get("id", "?")
        dicas = l.get("dicas") or []
        solucao = l.get("solucao_referencia") or (dicas[2] if len(dicas) >= 3 else None)
        if solucao is None:
            avisos.append(f"{lid}: sem solução de referência — não foi exercitada")
            continue
        if any("script" not in c for c in l.get("verificar") or []):
            avisos.append(f"{lid}: usa check por 'run' (dentro da imagem) — não foi exercitada")
            continue

        base, home = prepara_raiz()
        try:
            setup = (l.get("lab") or {}).get("setup")
            if setup:
                r = roda(adapta(setup, home), home)
                if r.returncode != 0:
                    erro(f"{lid}: o setup falhou — {r.stderr.strip()[:200]}")
                    continue

            checks = [adapta(c["script"], home) for c in l["verificar"]]

            if all(roda(c, home).returncode == 0 for c in checks):
                erro(f"{lid}: os checks já aprovam ANTES da solução — não medem nada")

            r = roda(adapta(solucao, home), home)
            if r.returncode != 0:
                erro(f"{lid}: a solução de referência falhou — {r.stderr.strip()[:300]}")
                continue

            reprovados = [
                (i, x) for i, x in enumerate(roda(c, home) for c in checks)
                if x.returncode != 0
            ]
            if reprovados:
                for i, x in reprovados:
                    desc = l["verificar"][i].get("descricao", "?")
                    erro(f"{lid}: check[{i}] '{desc}' reprova DEPOIS da solução "
                         f"(exit {x.returncode}) {x.stdout.strip()[:200]}")
            else:
                ok(f"{lid}: {len(checks)} check(s) reprovam antes e aprovam depois")
                exercitadas += 1
        finally:
            shutil.rmtree(base, ignore_errors=True)
    return exercitadas


def valida_catalogo(catalogo) -> None:
    assinaturas = [e.get("match") for _, d in catalogo for e in d.get("erros") or []]
    for esperado in ASSINATURAS_MINIMAS_LINUX:
        if esperado not in assinaturas:
            erro(f"catálogo sem a assinatura mínima: {esperado}")
    for _, d in catalogo:
        for e in d.get("erros") or []:
            for chave in ("id", "match", "titulo", "significa",
                          "porque", "investigar", "corrigir", "categoria"):
                if chave not in e:
                    erro(f"catálogo: entrada '{e.get('id')}' sem '{chave}'")
            try:
                re.compile(e.get("match", ""))
            except re.error as ex:
                erro(f"catálogo: regex inválida em '{e.get('id')}' ({ex})")
    if not any("catálogo" in f for f in falhas):
        ok(f"{len(assinaturas)} assinaturas, todas as mínimas presentes")


def main() -> int:
    so_schema = "--so-schema" in sys.argv

    licoes, trilhas, catalogo = carregar()
    secao("carga")
    total_erros = sum(len(d.get("erros") or []) for _, d in catalogo)
    print(f"  {len(trilhas)} trilha(s), {len(licoes)} lição(ões), "
          f"{total_erros} erro(s) no catálogo")

    secao("schema")
    antes = len(falhas)
    valida_schema(licoes)
    if len(falhas) == antes:
        ok("todas as lições passam no schema")

    secao("grafo de prereqs")
    valida_grafo(licoes, trilhas)

    secao("blocos de ensino (E-G-P)")
    antes = len(falhas)
    valida_ensino(licoes)
    if len(falhas) == antes:
        ok("todas as lições trazem os blocos exigidos pelo nível")

    secao("ensina antes de pedir")
    valida_grafo_de_conceitos(licoes)

    secao("sintaxe bash")
    total = valida_sintaxe(licoes)
    ok(f"{total} scripts verificados com bash -n")

    exercitadas = 0
    if not so_schema:
        secao("execução dos checks (árvore falsa, sem Docker)")
        exercitadas = valida_execucao(licoes)

    secao("catálogo de erros")
    valida_catalogo(catalogo)

    print("\n" + "=" * 62)
    for a in avisos:
        print(f"  \033[33m!\033[0m {a}")
    if not so_schema:
        print(f"  lições exercitadas de ponta a ponta: {exercitadas}/{len(licoes)}")
    if falhas:
        print(f"  \033[31m✘ {len(falhas)} problema(s)\033[0m")
        return 1
    print("  \033[32m✔ conteúdo válido\033[0m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
