"""Supuestos del plan que escribe Python, dentro del contrato ``plan-decoracion.v1``.

El contrato limita cada supuesto a ``maxLength`` caracteres y la lista a
``maxItems``; un supuesto que se pasa hace fallar la validación del plan entero
(422 ``invalid_plan``) al confirmar. Los límites se leen del contrato exportado
(un solo dueño: el Zod de ``src/lib/plan/tipos.ts``), nunca se copian aquí.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import cast

from app.generated_models import contract_schema

_SUPUESTOS = cast(
    Mapping[str, object], contract_schema("PlanDecoracion")["properties"]["supuestos"]
)
MAX_LARGO_SUPUESTO = cast(int, cast(Mapping[str, object], _SUPUESTOS["items"])["maxLength"])
MAX_SUPUESTOS = cast(int, _SUPUESTOS["maxItems"])
#: El nombre de la pieza que encabeza un supuesto se acorta a este largo, siempre
#: igual (así un supuesto se reconoce por su encabezado): lo que importa es la cifra.
MAX_LARGO_NOMBRE = 40
_ELIPSIS = "…"


def nombre_corto(nombre: str) -> str:
    """El nombre de la pieza tal como encabeza un supuesto: a lo sumo ``MAX_LARGO_NOMBRE``."""
    nombre = nombre.strip()
    if len(nombre) <= MAX_LARGO_NOMBRE:
        return nombre
    return nombre[: MAX_LARGO_NOMBRE - 1].rstrip() + _ELIPSIS


def supuesto(nombre: str, cuerpo: str) -> str:
    """``"<nombre>: <cuerpo>"`` dentro del largo del contrato.

    El nombre se acorta siempre igual (``nombre_corto``); si aun así no cabe, se
    corta el final del cuerpo en la última palabra con "…". El detalle completo
    de un ajuste vive fuera del plan (``conteos_referencia``).
    """
    texto = f"{nombre_corto(nombre)}: {cuerpo}"
    if len(texto) <= MAX_LARGO_SUPUESTO:
        return texto
    recorte = texto[: MAX_LARGO_SUPUESTO - len(_ELIPSIS)]
    espacio = recorte.rfind(" ")
    if espacio > len(recorte) // 2:
        recorte = recorte[:espacio]
    return recorte.rstrip(" ,;:") + _ELIPSIS


def agregar_supuesto(supuestos: list[str], texto: str) -> bool:
    """Agrega ``texto`` si no está y cabe en ``maxItems``; dice si lo agregó."""
    if texto in supuestos or len(supuestos) >= MAX_SUPUESTOS:
        return False
    supuestos.append(texto)
    return True


__all__ = [
    "MAX_LARGO_NOMBRE",
    "MAX_LARGO_SUPUESTO",
    "MAX_SUPUESTOS",
    "agregar_supuesto",
    "nombre_corto",
    "supuesto",
]
