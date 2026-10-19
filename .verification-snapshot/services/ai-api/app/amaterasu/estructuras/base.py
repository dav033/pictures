"""Definición de un tipo de estructura de globos para las lecturas de Amaterasu.

Cada submódulo de este paquete describe un tipo con lo que las lecturas de la
foto necesitan saber de él. Solo lleva lo que alguna lectura usa hoy: agregar
un campo exige un consumidor.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DefinicionEstructura:
    #: Tipo de estructura del plan (`TIPOS_ESTRUCTURA` de `plan-decoracion.v1`), o la
    #: estructura oficial cuando varias comparten tipo (un bouquet es un `kit`).
    clave: str
    #: Dónde empieza la pieza para leer su patrón de color, en inglés, como lo
    #: escribe el prompt de `patron_referencia.py`. ``None``: el tipo no tiene
    #: patrón de color por posición.
    inicio_de_pieza: str | None
    #: Cómo cuenta un decorador los globos de este tipo de pieza en una foto, en
    #: inglés, como lo escribe el prompt de `conteo_referencia.py` (ADR-0031).
    #: Describe qué mirar, nunca cuántos globos lleva: la cantidad por metro o
    #: por densidad es de `app/plan.py` y no se le sugiere al modelo.
    como_contar: str
