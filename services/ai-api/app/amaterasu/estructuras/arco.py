"""Arco: una curva continua con dos pies en el piso."""

from app.amaterasu.estructuras.base import DefinicionEstructura

DEFINICION = DefinicionEstructura(
    clave="arco",
    inicio_de_pieza="the left foot of an arch (going up over the top and down to the right foot)",
    como_contar=(
        "a continuous band of balloons from one foot, over the top, to the other foot. "
        "Follow the band from foot to foot counting its clusters, or, when it has no clear "
        "clusters, the balloons across one step of the band times the steps. The band is "
        "round: the back half you cannot see goes into estimado_total, never into "
        "globos_visibles"
    ),
)
