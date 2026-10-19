"""Figura con globos: animal, personaje o número armado con globos.

En el plan es la estructura oficial ``figura`` (tipo ``kit`` o ``escultura``).
Sin patrón de color por posición.
"""

from app.amaterasu.estructuras.base import DefinicionEstructura

DEFINICION = DefinicionEstructura(
    clave="figura",
    inicio_de_pieza=None,
    como_contar=(
        "a figure built from balloons (an animal, a character, a big number). Count the "
        "balloons of each part (head, body, limbs, base) and add them"
    ),
)
