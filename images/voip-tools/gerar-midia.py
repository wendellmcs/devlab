#!/usr/bin/env python3
"""Sintetiza os pcaps de mídia que o SIPp reproduz como RTP.

Por que este arquivo existe
---------------------------
O pacote `sip-tester` do Debian/Ubuntu instala o cenário embutido `uac_pcap`,
que referencia `pcap/g711a.pcap` e `pcap/dtmf_2833_1.pcap` — mas NÃO instala
nenhum dos dois. Sem eles o cenário morre com "Can't open PCAP file" e a
chamada nunca tem mídia; ou seja, o lab não teria como demonstrar áudio
funcionando, e sem a linha de base não há como ensinar áudio unidirecional.

A mídia é sintetizada aqui em vez de baixada de terceiro pelos mesmos motivos
que a saída das demonstrações é capturada de container real: fica
determinística, versionada e auditável. Um blob binário baixado no build
envelhece em silêncio e ninguém consegue dizer o que tem dentro.

Formato: pcap clássico, LINKTYPE_EN10MB, RTP sobre UDP/IPv4. O SIPp aproveita
daqui a CARGA e o INTERVALO entre pacotes — endereço e porta ele reescreve com
o que foi negociado no SDP.
"""
import argparse
import math
import random
import struct

TAXA = 8000                              # G.711 é sempre 8 kHz
MS_POR_PACOTE = 20                       # 20 ms: o padrão de fato em VoIP
AMOSTRAS = TAXA * MS_POR_PACOTE // 1000  # 160 amostras por pacote

PT_PCMA = 8    # G.711 A-law, o codec da Europa e do Brasil
PT_DTMF = 101  # telephone-event (RFC 4733, ainda chamado de RFC 2833)


def alaw(amostra: int) -> int:
    """Codifica uma amostra PCM linear de 16 bits em G.711 A-law (ITU-T G.191)."""
    sinal = 0x00 if amostra >= 0 else 0x80
    amostra = min(abs(amostra), 32635)

    if amostra >= 256:
        expoente = int(math.log2(amostra)) - 7
        mantissa = (amostra >> (expoente + 3)) & 0x0F
        byte = (expoente << 4) | mantissa
    else:
        byte = amostra >> 4

    return (byte | sinal) ^ 0x55  # A-law inverte bits alternados


def soma_verificacao(dados: bytes) -> int:
    if len(dados) % 2:
        dados += b"\x00"
    total = sum(struct.unpack(f"!{len(dados) // 2}H", dados))
    while total >> 16:
        total = (total & 0xFFFF) + (total >> 16)
    return (~total) & 0xFFFF


def quadro(carga: bytes, porta: int = 6000, porta_destino: int | None = None) -> bytes:
    """Empacota uma carga UDP em Ethernet + IPv4, pronta para o pcap.

    Origem e destino iguais é o padrão porque, nos arquivos que o SIPp
    REPRODUZ, endereço e porta são reescritos com o que o SDP negociou — o que
    o SIPp aproveita dali é a carga e o intervalo. Já numa GRAVAÇÃO sintética,
    que é lida como se tivesse saído da rede, o par origem→destino é o que
    identifica o sentido, e aí os dois importam.
    """
    udp = struct.pack("!HHHH", porta, porta_destino or porta, 8 + len(carga), 0) + carga
    local = b"\x7f\x00\x00\x01"
    ip = struct.pack(
        "!BBHHHBBH4s4s",
        0x45, 0x00, 20 + len(udp), 0, 0, 64, 17, 0, local, local,
    )
    ip = ip[:10] + struct.pack("!H", soma_verificacao(ip)) + ip[12:]
    ethernet = b"\x00" * 12 + b"\x08\x00"
    return ethernet + ip + udp


def rtp(pt: int, seq: int, ts: int, carga: bytes, marcador: bool = False,
        ssrc: int = 0x1234ABCD) -> bytes:
    """Cabeçalho RTP de 12 bytes (V=2, sem padding, sem extensão, CC=0)."""
    return struct.pack(
        "!BBHII", 0x80, (0x80 if marcador else 0x00) | pt,
        seq & 0xFFFF, ts & 0xFFFFFFFF, ssrc,
    ) + carga


def escrever_pcap(caminho: str, pacotes: list[bytes],
                  tempos_us: list[int] | None = None) -> None:
    """Grava o pcap. Sem `tempos_us`, os pacotes ficam na grade regular de 20 ms.

    O tempo importa mais do que parece: o SIPp reproduz o arquivo RESPEITANDO o
    intervalo entre os pacotes gravados. É por isso que um arquivo com
    espaçamento irregular vira, na saída, uma chamada com jitter de verdade —
    e não uma simulação de jitter.
    """
    if tempos_us is None:
        tempos_us = [n * MS_POR_PACOTE * 1000 for n in range(len(pacotes))]
    with open(caminho, "wb") as f:
        # Cabeçalho global: magic, versão 2.4, sem fuso, snaplen, LINKTYPE_EN10MB.
        f.write(struct.pack("!IHHiIII", 0xA1B2C3D4, 2, 4, 0, 0, 65535, 1))
        for pacote, us in zip(pacotes, tempos_us):
            f.write(struct.pack("!IIII", us // 1_000_000, us % 1_000_000,
                                len(pacote), len(pacote)))
            f.write(pacote)


def gerar_audio(caminho: str, segundos: float, tom: int) -> int:
    """Um tom senoidal contínuo: audível, reconhecível e fácil de conferir."""
    pacotes, fase = [], 0.0
    passo = 2 * math.pi * tom / TAXA
    total = int(segundos * 1000 / MS_POR_PACOTE)

    for n in range(total):
        carga = bytearray()
        for _ in range(AMOSTRAS):
            carga.append(alaw(int(math.sin(fase) * 16000)))
            fase += passo
        pacotes.append(quadro(rtp(PT_PCMA, 1000 + n, n * AMOSTRAS,
                                  bytes(carga), marcador=(n == 0))))

    escrever_pcap(caminho, pacotes)
    return total


def gerar_audio_picotado(caminho: str, segundos: float, tom: int,
                         uma_em_cada: int, passo_max_ms: int,
                         teto_ms: int) -> tuple[int, int]:
    """A mesma voz, com perda e jitter EMBUTIDOS no arquivo.

    Por que a degradação nasce aqui e não no `tc`/`iptables` do lab:

    1. **`iptables` não produz perda visível numa captura local.** O gravador se
       enxerta na camada de dispositivo, ANTES do netfilter (decisão 21), então
       o pacote descartado em INPUT aparece na captura inteiro. Perda que o
       aluno possa MEDIR numa gravação precisa ser perda que nunca foi enviada.
    2. **`tc netem` produz, e é aleatório.** Os números mudariam a cada
       execução, e a saída gravada da demonstração divergiria sempre
       (decisão 27). Aqui o buraco de sequência é escolhido, não sorteado: 1 em
       cada `uma_em_cada` pacotes some, e a contagem de perdidos é a mesma
       sempre.

    O que fica: o número de sequência PULA (o pacote não foi enviado) e o
    espaçamento oscila dentro de um teto. É exatamente o que uma rede ruim
    entrega, e é reprodutível.

    O passeio do atraso é limitado a `passo_max_ms` por pacote justamente para
    ficar abaixo dos 20 ms de espaçamento: assim os pacotes continuam chegando
    em ORDEM, e a lição mede jitter sem ter também de explicar reordenação.
    """
    sorteio = random.Random(20260804)   # semente fixa: o arquivo é o mesmo todo build
    pacotes, tempos, fase = [], [], 0.0
    passo = 2 * math.pi * tom / TAXA
    total = int(segundos * 1000 / MS_POR_PACOTE)
    atraso_ms, perdidos = 0, 0

    for n in range(total):
        carga = bytearray()
        for _ in range(AMOSTRAS):
            carga.append(alaw(int(math.sin(fase) * 16000)))
            fase += passo

        atraso_ms = min(teto_ms, max(0, atraso_ms + sorteio.randint(-passo_max_ms, passo_max_ms)))

        # O pacote perdido consome o número de sequência e não é gravado: é
        # isso que faz o buraco aparecer em quem recebe.
        if n % uma_em_cada == uma_em_cada - 1:
            perdidos += 1
            continue

        pacotes.append(quadro(rtp(PT_PCMA, 1000 + n, n * AMOSTRAS,
                                  bytes(carga), marcador=(n == 0))))
        tempos.append((n * MS_POR_PACOTE + atraso_ms) * 1000)

    escrever_pcap(caminho, pacotes, tempos)
    return len(pacotes), perdidos


def rtcp_sender_report(ssrc: int, pacotes: int, octetos: int, ts_rtp: int,
                       sobre_ssrc: int, fracao_perdida: int, perdidos: int,
                       maior_seq: int, jitter: int) -> bytes:
    """Um Sender Report (RFC 3550 §6.4.1) com UM bloco de relatório.

    É o que um telefone manda a cada poucos segundos: "eu enviei tanto" mais
    "do que VOCÊ me mandou, foi isto que chegou". O segundo pedaço é o que faz
    o RTCP valer numa investigação — é a contabilidade de QUEM RECEBEU, e ela
    existe mesmo quando a captura está do outro lado do problema.

    `fracao_perdida` é uma fração em 256 avos, não um percentual: o campo tem
    8 bits. `jitter` vai em unidades de timestamp RTP (aqui 1/8000 s), não em
    milissegundos — dividir por 8 dá o valor em ms para G.711.
    """
    cabecalho = struct.pack(
        "!BBH", 0x81, 200, 12,          # V=2, RC=1, PT=200 (SR), 13 palavras - 1
    ) + struct.pack("!I", ssrc)
    # NTP fixo: a hora do relógio não interessa aqui e um valor variável
    # tornaria o arquivo diferente a cada geração.
    remetente = struct.pack("!IIIII", 0xE5000000, 0x00000000, ts_rtp, pacotes, octetos)
    bloco = (
        struct.pack("!I", sobre_ssrc)
        + struct.pack("!I", (fracao_perdida << 24) | (perdidos & 0xFFFFFF))
        + struct.pack("!IIII", maior_seq, jitter, 0, 0)
    )
    return cabecalho + remetente + bloco


def gerar_captura_do_cliente(caminho: str, segundos: float, tom: int,
                             uma_em_cada: int, passo_max_ms: int,
                             teto_ms: int) -> tuple[int, int, int]:
    """A "gravação que o cliente mandou": os dois sentidos num arquivo só.

    Por que ela é SINTETIZADA e não capturada de uma chamada real, sendo que o
    lab sabe produzir a chamada picotada de verdade:

    A lição que ensina a MEDIR precisa mostrar a tabela do `-z rtp,streams`
    como ela é — com jitter, atraso mínimo e máximo. Numa captura ao vivo essas
    colunas dependem do escalonamento do sistema e mudam na terceira casa a
    cada execução; a saída gravada da demonstração divergiria sempre
    (decisão 27). Aqui os carimbos de tempo são escolhidos, então o arquivo é
    idêntico em toda máquina e em todo build, e a tabela também.

    O que ela contém é o retrato exato da chamada picotada do lab: 6100 → 6000
    perfeito, 6000 → 6100 com um pacote a cada `uma_em_cada` faltando e o
    espaçamento oscilando. Os números que o aluno lê aqui são os mesmos que ele
    vai obter reproduzindo a chamada.

    Não tem sinalização de propósito: é uma captura só de mídia, como as que
    chegam de cliente — e portanto exige o `-d` para ser lida, que é
    exatamente o que a primeira lição do nível ensinou.
    """
    sorteio = random.Random(20260804)
    total = int(segundos * 1000 / MS_POR_PACOTE)
    pacotes: list[tuple[int, bytes]] = []
    fase_ida = fase_volta = 0.0
    passo = 2 * math.pi * tom / TAXA
    atraso_ms, perdidos = 0, 0

    # A mídia só começa depois do ACK; 3 s é o que o lab leva até lá, e deixar
    # esse começo vazio faz a gravação parecer o que é: um trecho de chamada.
    INICIO_MS = 3000

    def voz(fase: float) -> tuple[bytes, float]:
        carga = bytearray()
        for _ in range(AMOSTRAS):
            carga.append(alaw(int(math.sin(fase) * 16000)))
            fase += passo
        return bytes(carga), fase

    # SSRC distintos por sentido, ao contrário dos arquivos que o SIPp
    # reproduz: um relatório RTCP identifica pelo SSRC o fluxo sobre o qual
    # está falando, e com os dois iguais não daria para saber de quem é a
    # queixa. Em campo eles também são sempre distintos.
    SSRC_QUEM_LIGA = 0x1234ABCD
    SSRC_QUEM_ATENDE = 0x5678CDEF
    octetos_ida = octetos_volta = 0
    enviados_volta = 0

    for n in range(total):
        # Sentido de quem liga para quem atende: regular, nada faltando.
        carga, fase_ida = voz(fase_ida)
        pacotes.append((
            (INICIO_MS + n * MS_POR_PACOTE) * 1000,
            quadro(rtp(PT_PCMA, 1000 + n, n * AMOSTRAS, carga,
                       marcador=(n == 0), ssrc=SSRC_QUEM_LIGA),
                   porta=6100, porta_destino=6000),
        ))
        octetos_ida += len(carga)

        # Sentido de volta: o defeito. O atraso passeia dentro de um teto e o
        # pacote perdido consome o número de sequência sem ser gravado.
        carga, fase_volta = voz(fase_volta)
        atraso_ms = min(teto_ms, max(0, atraso_ms + sorteio.randint(-passo_max_ms, passo_max_ms)))
        if n % uma_em_cada == uma_em_cada - 1:
            perdidos += 1
            continue
        pacotes.append((
            (INICIO_MS + n * MS_POR_PACOTE + atraso_ms) * 1000,
            quadro(rtp(PT_PCMA, 1000 + n, n * AMOSTRAS, carga,
                       marcador=(n == 0), ssrc=SSRC_QUEM_ATENDE),
                   porta=6000, porta_destino=6100),
        ))
        octetos_volta += len(carga)
        enviados_volta += 1

    # Os relatórios RTCP, no fim da chamada, um de cada lado. Vão na porta de
    # mídia + 1, que é a convenção do RFC 3550, e cada um fala sobre o fluxo
    # que RECEBEU: é por isso que a perda aparece no relatório de quem ligou.
    #
    # A fração é em 256 avos e o jitter em unidades de timestamp (1/8000 s).
    fracao = round(perdidos / total * 256)
    jitter_ms = 5.5                     # a variação que este espaçamento produz
    fim_us = (INICIO_MS + total * MS_POR_PACOTE + 100) * 1000

    pacotes.append((fim_us, quadro(
        rtcp_sender_report(
            ssrc=SSRC_QUEM_LIGA, pacotes=total, octetos=octetos_ida,
            ts_rtp=total * AMOSTRAS,
            sobre_ssrc=SSRC_QUEM_ATENDE, fracao_perdida=fracao,
            perdidos=perdidos, maior_seq=1000 + total - 1,
            jitter=round(jitter_ms * TAXA / 1000),
        ), porta=6101, porta_destino=6001)))

    pacotes.append((fim_us + 20_000, quadro(
        rtcp_sender_report(
            ssrc=SSRC_QUEM_ATENDE, pacotes=enviados_volta, octetos=octetos_volta,
            ts_rtp=total * AMOSTRAS,
            sobre_ssrc=SSRC_QUEM_LIGA, fracao_perdida=0,
            perdidos=0, maior_seq=1000 + total - 1, jitter=0,
        ), porta=6001, porta_destino=6101)))

    # Numa captura os pacotes aparecem na ordem em que passaram pela interface.
    pacotes.sort(key=lambda p: p[0])
    escrever_pcap(caminho, [p[1] for p in pacotes], [p[0] for p in pacotes])
    return len(pacotes), total, perdidos


def gerar_dtmf(caminho: str, digito: int) -> int:
    """Um dígito DTMF em RFC 4733: 4 bytes de evento, não áudio."""
    pacotes = []
    for n in range(10):
        fim = n == 9
        duracao = (n + 1) * AMOSTRAS
        # evento · (E<<7 | volume) · duração em amostras
        carga = struct.pack("!BBH", digito, (0x80 if fim else 0x00) | 10, duracao)
        pacotes.append(quadro(rtp(PT_DTMF, 2000 + n, 0, carga, marcador=(n == 0))))

    escrever_pcap(caminho, pacotes)
    return len(pacotes)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("destino", help="diretório onde os pcaps são gravados")
    p.add_argument("--segundos", type=float, default=5.0)
    p.add_argument("--tom", type=int, default=440, help="frequência do tom, em Hz")
    p.add_argument("--uma-em-cada", type=int, default=10,
                   help="da mídia picotada, 1 pacote em cada N não é enviado")
    p.add_argument("--passo-max", type=int, default=12,
                   help="variação máxima do atraso entre pacotes vizinhos, em ms")
    p.add_argument("--teto", type=int, default=60,
                   help="atraso acumulado máximo da mídia picotada, em ms")
    p.add_argument("--captura", default=None,
                   help="além dos pcaps de mídia, grava neste caminho a 'gravação "
                        "que o cliente mandou': os dois sentidos, um deles picotado")
    args = p.parse_args()

    audio = f"{args.destino}/g711a.pcap"
    dtmf = f"{args.destino}/dtmf_2833_1.pcap"
    picotado = f"{args.destino}/g711a-picotado.pcap"

    n = gerar_audio(audio, args.segundos, args.tom)
    print(f"{audio}: {n} pacotes RTP PCMA — {args.segundos:g}s de tom de {args.tom} Hz")
    n = gerar_dtmf(dtmf, digito=1)
    print(f"{dtmf}: {n} pacotes telephone-event — dígito 1")
    n, perdidos = gerar_audio_picotado(
        picotado, args.segundos, args.tom,
        uma_em_cada=args.uma_em_cada,
        passo_max_ms=args.passo_max, teto_ms=args.teto,
    )
    print(f"{picotado}: {n} pacotes RTP PCMA — {perdidos} pacote(s) faltando "
          f"(1 em cada {args.uma_em_cada}) e espaçamento irregular até {args.teto} ms")

    if args.captura:
        n, ida, perdidos = gerar_captura_do_cliente(
            args.captura, args.segundos, args.tom,
            uma_em_cada=args.uma_em_cada,
            passo_max_ms=args.passo_max, teto_ms=args.teto,
        )
        print(f"{args.captura}: {n} pacotes — {ida} de 6100 para 6000 e "
              f"{ida - perdidos} de 6000 para 6100 ({perdidos} perdidos)")


if __name__ == "__main__":
    main()
