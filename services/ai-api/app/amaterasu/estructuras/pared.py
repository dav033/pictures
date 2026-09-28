"""Pared de globos: una superficie plana, leída como rejilla."""

from app.amaterasu.estructuras.base import DefinicionEstructura

DEFINICION = DefinicionEstructura(
    clave="pared",
    inicio_de_pieza="the top-left corner of a wall",
    como_contar=(
        "a flat surface of balloons read as a grid. Count the balloons of one row and the "
        "rows (rows times balloons per row); an airy wall with gaps is counted balloon by "
        "balloon. Give racimos and globos_por_racimo only when the wall is built from "
        "clusters"
    ),
)
