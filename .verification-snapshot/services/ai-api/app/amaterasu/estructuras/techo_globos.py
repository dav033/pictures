"""Techo de globos: globos suspendidos que cubren el techo.

En el plan es la estructura oficial ``techo_globos`` sobre el tipo
``guirnalda`` con ubicación ``techo`` (el reconocedor la llama
``ceiling_installation``). Sin patrón de color por posición.
"""

from app.amaterasu.estructuras.base import DefinicionEstructura

DEFINICION = DefinicionEstructura(
    clave="techo_globos",
    inicio_de_pieza=None,
    como_contar=(
        "balloons hanging from or covering the ceiling. Count the balloons in one patch "
        "you can see well and how many patches like it the covered area holds; it is "
        "almost never exact"
    ),
)
