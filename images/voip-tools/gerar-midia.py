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


def quadro(carga: bytes, porta: int = 6000) -> bytes:
    """Empacota uma carga UDP em Ethernet + IPv4, pronta para o pcap."""
    udp = struct.pack("!HHHH", porta, porta, 8 + len(carga), 0) + carga
    local = b"\x7f\x00\x00\x01"
    ip = struct.pack(
        "!BBHHHBBH4s4s",
        0x45, 0x00, 20 + len(udp), 0, 0, 64, 17, 0, local, local,
    )
    ip = ip[:10] + struct.pack("!H", soma_verificacao(ip)) + ip[12:]
    ethernet = b"\x00" * 12 + b"\x08\x00"
    return ethernet + ip + udp


def rtp(pt: int, seq: int, ts: int, carga: bytes, marcador: bool = False) -> bytes:
    """Cabeçalho RTP de 12 bytes (V=2, sem padding, sem extensão, CC=0)."""
    return struct.pack(
        "!BBHII", 0x80, (0x80 if marcador else 0x00) | pt,
        seq & 0xFFFF, ts & 0xFFFFFFFF, 0x1234ABCD,
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


if __name__ == "__main__":
    main()
