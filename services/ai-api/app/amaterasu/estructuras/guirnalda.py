"""Guirnalda: recorrido orgánico a lo largo de una superficie o del piso."""

from app.amaterasu.estructuras.base import DefinicionEstructura

DEFINICION = DefinicionEstructura(
    clave="guirnalda",
    inicio_de_pieza="the left end of a garland",
    como_contar=(
        "an organic run of clusters along a wall, a table, the floor or another piece, "
        "usually with small filler balloons between the clusters. Count the clusters from "
        "one end to the other and the balloons of each, then add the fillers and any foils "
        "on it"
    ),
)
