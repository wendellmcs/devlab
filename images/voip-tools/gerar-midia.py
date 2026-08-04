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


def escrever_pcap(caminho: str, pacotes: list[bytes]) -> None:
    with open(caminho, "wb") as f:
        # Cabeçalho global: magic, versão 2.4, sem fuso, snaplen, LINKTYPE_EN10MB.
        f.write(struct.pack("!IHHiIII", 0xA1B2C3D4, 2, 4, 0, 0, 65535, 1))
        for n, pacote in enumerate(pacotes):
            us = n * MS_POR_PACOTE * 1000
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
    args = p.parse_args()

    audio = f"{args.destino}/g711a.pcap"
    dtmf = f"{args.destino}/dtmf_2833_1.pcap"

    n = gerar_audio(audio, args.segundos, args.tom)
    print(f"{audio}: {n} pacotes RTP PCMA — {args.segundos:g}s de tom de {args.tom} Hz")
    n = gerar_dtmf(dtmf, digito=1)
    print(f"{dtmf}: {n} pacotes telephone-event — dígito 1")


if __name__ == "__main__":
    main()
