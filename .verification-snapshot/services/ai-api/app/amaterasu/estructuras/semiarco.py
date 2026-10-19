"""Semiarco: un solo lado que sube y se curva, abierto arriba."""

from app.amaterasu.estructuras.base import DefinicionEstructura

DEFINICION = DefinicionEstructura(
    clave="semiarco",
    inicio_de_pieza="the base of a half-arch toward its open tip",
    como_contar=(
        "one side that rises from its base and curves, open at the top. Count it like an "
        "arch, along its single side from the base to the tip, which is usually thinner"
    ),
)
