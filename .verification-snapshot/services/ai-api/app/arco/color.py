"""Utilidades de color del arco: hexadecimales ``#rrggbb`` y referencias del catálogo (``sx:041``).

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/arco/color.ts``. La mezcla y el generador pseudoaleatorio
viven en ``app.motores.js``, que es el puente compartido por los tres motores.
"""

from __future__ import annotations

import math
import re

from app.motores.canonico import codigo_de, es_canonico

_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def es_hex(valor: object) -> bool:
    return isinstance(valor, str) and bool(_HEX.match(valor))


def _canal(hexa: str, indice: int) -> int:
    return int(hexa[1 + 2 * indice : 3 + 2 * indice], 16)


def normalizar_hex(valor: object, respaldo: str) -> str:
    """El color en minúsculas, o ``respaldo`` si no es un ``#rrggbb`` válido."""
    return str(valor).lower() if es_hex(valor) else respaldo


def normalizar_color(valor: object, respaldo: str) -> str:
    """Valida un color que llega de fuera: un hexadecimal libre o una referencia del catálogo.

    No resuelve a propósito: la referencia es lo que se guarda y lo que se comparte por el enlace; el
    hexadecimal se saca al dibujar. Una referencia a un código que no existe cae al respaldo, igual que un
    hexadecimal mal escrito.
    """
    if es_hex(valor):
        return str(valor).lower()
    return str(valor) if es_canonico(valor) and codigo_de(valor) is not None else respaldo


def _distancia(a: str, b: str) -> float:
    """Distancia percibida entre dos colores (aproximación «redmean» en RGB)."""
    rm = (_canal(a, 0) + _canal(b, 0)) / 2
    dr = _canal(a, 0) - _canal(b, 0)
    dg = _canal(a, 1) - _canal(b, 1)
    db = _canal(a, 2) - _canal(b, 2)
    return math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db)


#: Colores vivos con los que marcar una selección; se elige el que más se distingue de lo seleccionado.
COLORES_SELECCION = ["#22d3ee", "#facc15", "#ff2e93", "#a3e635", "#fb923c", "#a78bfa", "#ffffff"]


def color_contraste(colores: list[str], candidatos: list[str] | None = None) -> str:
    """De los colores de selección, el que más contrasta con todos los dados."""
    opciones = COLORES_SELECCION if candidatos is None else candidatos
    validos = [c for c in colores if es_hex(c)]
    mejor = opciones[0]
    if not validos:
        return mejor
    mejor_d = -1.0
    for candidato in opciones:
        d = min(_distancia(candidato, x) for x in validos)
        if d > mejor_d:
            mejor = candidato
            mejor_d = d
    return mejor


def texto_sobre(fondo: str) -> str:
    """Negro o blanco, el que se lee mejor sobre ``fondo``."""
    if not es_hex(fondo):
        return "#0b1220"
    luz = (0.299 * _canal(fondo, 0) + 0.587 * _canal(fondo, 1) + 0.114 * _canal(fondo, 2)) / 255
    return "#0b1220" if luz > 0.55 else "#ffffff"
