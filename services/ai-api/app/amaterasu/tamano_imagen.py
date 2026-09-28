"""Ancho y alto en píxeles de una foto PNG, JPEG o WebP, leídos de su cabecera.

La lectura de la guirnalda (ADR-0032, decisión 29) recibe puntos en fracciones
de la imagen y necesita su aspecto real para convertirlos en pendientes. Solo
se lee la cabecera: no se decodifica la imagen ni se añade una dependencia
(Pillow llega al entorno solo como dependencia de otra biblioteca). La
orientación EXIF no se aplica: el navegador ya reescribe la foto derecha antes
de subirla (``src/app/page.tsx``). ``None`` si el formato no es uno de los tres
o la cabecera está incompleta; quien llama decide qué hacer sin tamaño.
"""

from __future__ import annotations

import struct

_FIRMA_PNG = b"\x89PNG\r\n\x1a\n"
#: Marcadores SOF de JPEG que llevan el tamaño del cuadro (C4, C8 y CC no son SOF).
_SOF_JPEG = frozenset(
    {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
)
#: Marcadores JPEG sin longitud: SOI, TEM y los RST.
_SIN_LONGITUD_JPEG = frozenset({0xD8, 0x01, *range(0xD0, 0xD8)})


def _png(datos: bytes) -> tuple[int, int] | None:
    if len(datos) < 24 or datos[12:16] != b"IHDR":
        return None
    ancho, alto = struct.unpack(">II", datos[16:24])
    return int(ancho), int(alto)


def _jpeg(datos: bytes) -> tuple[int, int] | None:
    i = 2
    while i + 4 <= len(datos):
        if datos[i] != 0xFF:
            return None
        marcador = datos[i + 1]
        if marcador == 0xFF:  # relleno entre segmentos
            i += 1
            continue
        if marcador in _SIN_LONGITUD_JPEG:
            i += 2
            continue
        (longitud,) = struct.unpack(">H", datos[i + 2 : i + 4])
        if marcador in _SOF_JPEG:
            if i + 9 > len(datos):
                return None
            alto, ancho = struct.unpack(">HH", datos[i + 5 : i + 9])
            return int(ancho), int(alto)
        i += 2 + longitud
    return None


def _webp(datos: bytes) -> tuple[int, int] | None:
    fragmento = datos[12:16]
    if fragmento == b"VP8 " and len(datos) >= 30 and datos[23:26] == b"\x9d\x01\x2a":
        ancho, alto = struct.unpack("<HH", datos[26:30])
        return ancho & 0x3FFF, alto & 0x3FFF
    if fragmento == b"VP8L" and len(datos) >= 25 and datos[20] == 0x2F:
        bits = int.from_bytes(datos[21:25], "little")
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    if fragmento == b"VP8X" and len(datos) >= 30:
        return (
            int.from_bytes(datos[24:27], "little") + 1,
            int.from_bytes(datos[27:30], "little") + 1,
        )
    return None


def tamano_imagen(datos: bytes) -> tuple[int, int] | None:
    """``(ancho, alto)`` en píxeles, ambos mayores que 0, o ``None``."""
    if datos.startswith(_FIRMA_PNG):
        tamano = _png(datos)
    elif datos.startswith(b"\xff\xd8"):
        tamano = _jpeg(datos)
    elif datos[:4] == b"RIFF" and datos[8:12] == b"WEBP":
        tamano = _webp(datos)
    else:
        tamano = None
    if tamano is None or tamano[0] <= 0 or tamano[1] <= 0:
        return None
    return tamano


__all__ = ["tamano_imagen"]
