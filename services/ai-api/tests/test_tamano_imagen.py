"""Tamaño de la foto desde su cabecera (ADR-0032, decisión 29)."""

import pytest

from app.amaterasu.tamano_imagen import tamano_imagen


def _png(ancho: int, alto: int) -> bytes:
    ihdr = b"\x00\x00\x00\rIHDR" + ancho.to_bytes(4, "big") + alto.to_bytes(4, "big")
    return b"\x89PNG\r\n\x1a\n" + ihdr + b"\x08\x02\x00\x00\x00"


def _jpeg(ancho: int, alto: int) -> bytes:
    # SOI, un APP0 de 16 bytes, relleno 0xFF y el SOF2 (progresivo) con alto y ancho.
    app0 = b"\xff\xe0\x00\x10" + b"JFIF\x00" + bytes(9)
    sof = b"\xff\xc2\x00\x11\x08" + alto.to_bytes(2, "big") + ancho.to_bytes(2, "big") + bytes(12)
    return b"\xff\xd8" + app0 + b"\xff" + sof


def _webp(fragmento: bytes, cuerpo: bytes) -> bytes:
    return b"RIFF" + bytes(4) + b"WEBP" + fragmento + bytes(4) + cuerpo


@pytest.mark.parametrize(
    ("datos", "tamano"),
    [
        (_png(270, 480), (270, 480)),
        (_jpeg(1280, 720), (1280, 720)),
        # VP8 con pérdida: marca de cuadro, código de inicio y 14 bits por lado.
        (
            _webp(
                b"VP8 ",
                bytes(3)
                + b"\x9d\x01\x2a"
                + (640).to_bytes(2, "little")
                + (360).to_bytes(2, "little"),
            ),
            (640, 360),
        ),
        # VP8L sin pérdida: firma 0x2F y ancho-1, alto-1 en 14 bits cada uno.
        (_webp(b"VP8L", b"\x2f" + ((299) | (499 << 14)).to_bytes(4, "little")), (300, 500)),
        # VP8X extendido: lienzo en 24 bits, menos uno.
        (
            _webp(b"VP8X", bytes(4) + (1023).to_bytes(3, "little") + (767).to_bytes(3, "little")),
            (1024, 768),
        ),
    ],
)
def test_lee_el_tamano_de_la_cabecera(datos: bytes, tamano: tuple[int, int]) -> None:
    assert tamano_imagen(datos) == tamano


@pytest.mark.parametrize(
    "datos",
    [
        b"",
        b"GIF89a" + bytes(20),
        _png(0, 480),
        _png(270, 480)[:20],
        b"\xff\xd8\xff\xe0\x00\x10" + bytes(4),  # JPEG cortado antes del SOF
        b"\xff\xd8\x00\x00" + bytes(20),  # JPEG sin marcador donde toca
        _webp(b"VP8 ", bytes(10)),  # sin código de inicio
    ],
)
def test_sin_cabecera_legible_no_hay_tamano(datos: bytes) -> None:
    assert tamano_imagen(datos) is None
