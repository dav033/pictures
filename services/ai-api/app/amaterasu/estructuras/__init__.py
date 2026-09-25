"""Registro de tipos de estructura de globos de Amaterasu.

Un submódulo por tipo, con lo que las lecturas de la foto necesitan saber de
él (ADR-0030). El orden de ``DEFINICIONES`` es el orden en que los prompts
nombran los tipos: cambiarlo cambia ``PROMPT_VERSION`` del patrón (solo los
tipos con ``inicio_de_pieza``) y del conteo (todos). Un tipo nuevo sin patrón
va al final para no tocar el prompt del patrón.
"""

from __future__ import annotations

from app.amaterasu.estructuras import (
    arco,
    bouquet,
    centro_mesa,
    columna,
    figura,
    guirnalda,
    pared,
    semiarco,
    techo_globos,
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
    techo_globos.DEFINICION,
    figura.DEFINICION,
)

_POR_CLAVE = {definicion.clave: definicion for definicion in DEFINICIONES}


def definicion(clave: str) -> DefinicionEstructura | None:
    """La definición de un tipo o estructura oficial, o ``None`` si Amaterasu no lo describe."""
    return _POR_CLAVE.get(clave)


def definicion_de_pieza(
    tipo: str, estructura_oficial: str | None = None
) -> DefinicionEstructura | None:
    """La definición de una pieza de la foto: la de su estructura oficial cuando
    el registro la describe (un bouquet es un ``kit``, un techo es una
    ``guirnalda``), si no la de su tipo. Una variante sin submódulo propio
    (``arco_asimetrico``, ``aro_circular``) cae en su tipo."""
    return (definicion(estructura_oficial) if estructura_oficial else None) or definicion(tipo)


def frase_inicio_de_pieza() -> str:
    """La frase del prompt de patrones que dice dónde empieza cada tipo de pieza."""
    partes = [d.inicio_de_pieza for d in DEFINICIONES if d.inicio_de_pieza is not None]
    return f"The start of a piece is: {'; '.join(partes)}."


def reglas_de_conteo() -> str:
    """Las líneas del prompt de conteo que dicen cómo se cuenta cada tipo de pieza."""
    return "\n".join(f"- {d.clave}: {d.como_contar}." for d in DEFINICIONES)


__all__ = [
    "DEFINICIONES",
    "DefinicionEstructura",
    "definicion",
    "definicion_de_pieza",
    "frase_inicio_de_pieza",
    "reglas_de_conteo",
]
