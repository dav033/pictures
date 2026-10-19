"""Columna: pila vertical de racimos."""

from app.amaterasu.estructuras.base import DefinicionEstructura

DEFINICION = DefinicionEstructura(
    clave="columna",
    inicio_de_pieza="the base of a column",
    como_contar=(
        "a vertical stack of clusters (usually quartets) on a base. Count the layers from "
        "the base up and the balloons of one layer, then add the topper balloon or foil "
        "and any balloons around the base. The back of each layer is hidden: it goes into "
        "estimado_total"
    ),
)
