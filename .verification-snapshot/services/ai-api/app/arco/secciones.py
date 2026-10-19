"""Mover una sección del arco como se mueve una capa en un panel de capas.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/arco/secciones.ts``.
"""

from __future__ import annotations

from typing import TypeVar

from app.arco.tipos import SeccionArco

T = TypeVar("T")


def permutar(lista: list[T], desde: int, hacia: int) -> list[T]:
    """La lista con el elemento de ``desde`` puesto en ``hacia`` y los de en medio corridos un lugar."""
    salida = list(lista)
    if desde == hacia or desde < 0 or hacia < 0 or desde >= len(salida) or hacia >= len(salida):
        return salida
    movida = salida.pop(desde)
    salida.insert(hacia, movida)
    return salida


def reordenar_secciones(
    previas: list[SeccionArco],
    contenidos: list[list[str]],
    desde: int,
    hacia: int,
) -> list[SeccionArco]:
    """La sección de ``desde`` pasa a ``hacia`` y las de en medio se corren un lugar.

    No se intercambian dos: se reordena. ``contenidos`` es cómo se ve cada sección ahora (un color por capa a
    lo ancho), de abajo hacia arriba; las secciones del tramo que cambia quedan personalizadas con esos
    colores, y las de fuera del tramo no se tocan.
    """
    n = len(contenidos)
    salida: list[SeccionArco] = [previas[k] if k < len(previas) else None for k in range(n)]
    if desde == hacia or desde < 0 or hacia < 0 or desde >= n or hacia >= n:
        return salida
    orden = permutar(contenidos, desde, hacia)
    for k in range(min(desde, hacia), max(desde, hacia) + 1):
        salida[k] = {"colores": list(orden[k])}
    return salida
