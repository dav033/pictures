"""Registro de tipos de estructura de globos de Amaterasu.

Un submódulo por tipo, con lo que las lecturas de la foto necesitan saber de
él (ADR-0030). El orden de ``DEFINICIONES`` es el orden en que el prompt de
patrones nombra los tipos: cambiarlo cambia ``PROMPT_VERSION``.
"""

from __future__ import annotations

from app.amaterasu.estructuras import (
    arco,
    bouquet,
    centro_mesa,
    columna,
    guirnalda,
    pared,
    semiarco,
)
from app.amaterasu.estructuras.base import DefinicionEstructura

DEFINICIONES: tuple[DefinicionEstructura, ...] = (
    columna.DEFINICION,
    arco.DEFINICION,
    semiarco.DEFINICION,
    guirnalda.DEFINICION,
    pared.DEFINICION,
    centro_mesa.DEFINICION,
    bouquet.DEFINICION,
)

_POR_CLAVE = {definicion.clave: definicion for definicion in DEFINICIONES}


def definicion(clave: str) -> DefinicionEstructura | None:
    """La definición de un tipo o estructura oficial, o ``None`` si Amaterasu no lo describe."""
    return _POR_CLAVE.get(clave)


def frase_inicio_de_pieza() -> str:
    """La frase del prompt de patrones que dice dónde empieza cada tipo de pieza."""
    partes = [d.inicio_de_pieza for d in DEFINICIONES if d.inicio_de_pieza is not None]
    return f"The start of a piece is: {'; '.join(partes)}."


__all__ = ["DEFINICIONES", "DefinicionEstructura", "definicion", "frase_inicio_de_pieza"]
