"""Los límites de un arco clásico y cómo se corrige uno que no es viable.

Porteado de ``clasificador-decoraciones/src/lib/arco/limites.ts``: ``limites``,
``anchoMinimo`` y ``sanear``. Es la pieza que faltaba del motor, y faltaba
entera.

**La diferencia que arregla.** Allá nada falla nunca: `sanear` recibe un diseño
cualquiera —de un enlace viejo, de un control movido a mano— y devuelve uno
viable más la lista de lo que cambió, en español, para enseñárselo a quien lo
pidió. Aquí la política estaba invertida: nueve excepciones y un solo aviso. Cada
una de esas excepciones era un 422 para el cliente o un croquis que desaparecía,
donde allá había una pieza armada y una frase que explicaba el ajuste.

Y al no existir, las piezas entraban crudas al motor: arcos de veinte metros de
alto, con patas de un centímetro, o con una banda ocupando el 42 % del ancho.

Vive aparte de ``app.arco_clasico`` por lo que es: ``arco_clasico`` **arma** un
arco que ya es viable; esto decide **cuál** es el arco viable más parecido al
que se pidió. Dos trabajos, dos módulos, como allá.

Lo que no se portó, y por qué: el arcoíris (``N_MAX_ARCOIRIS``, ``bandas``,
``nPaso``) es un patrón que pide una banda de color por carril y aquí no existe;
y ``tamanosQueCaben`` alimenta un control de la interfaz de allá que aquí no
tiene equivalente.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from app.silueta import diametro_inflado_m

#: Globos a lo ancho que admite una banda. Dos es una tira; ocho es el ``N_MAX``
#: del original (allá lo llama «por diseño de la interfaz y de la estructura»).
MIN_GLOBOS_ANCHO = 2
MAX_GLOBOS_ANCHO = 8

#: Diámetro del globo respecto a la separación entre columnas (``globo.tamano``).
SOLAPE = 1.14

#: Lo más ancha que puede ser la banda respecto al ancho del arco
#: (``RAZON_GROSOR_MAX``): pasado el 36 %, tapa la abertura.
RAZON_GROSOR_MAX = 0.36


def paso_columna_m(diametro_m: float) -> float:
    """Separación entre dos columnas vecinas (m): los globos se solapan un 12 %."""
    return diametro_m / SOLAPE

#: Los topes de la pieza, tal cual (`limites.ts`).
ANCHO_MIN_M = 0.8
ANCHO_MAX_M = 10.0
ALTO_MIN_M = 0.8
ALTO_MAX_M = 6.0

#: Alto respecto al ancho: por encima de esto el arco es una torre.
RAZON_ALTO_MAX = 2.0

#: Rango de la separación entre filas. Es el del deslizador del original
#: («Separación entre filas», 0,7 a 1,4, con 1 por defecto): 1 es el
#: empaquetado hexagonal justo. Fuera de ahí las filas se encaraman o se sueltan.
MIN_SEPARACION = 0.7
MAX_SEPARACION = 1.4

#: Margen de pata de una herradura sobre el semicírculo: lo que más dé entre
#: 0,25 m y un 8 % del ancho. Por debajo de eso no hay patas, hay un semicírculo.
_PATA_MINIMA_M = 0.25
_PATA_MINIMA_RAZON = 0.08


def _arriba(valor: float) -> float:
    """Redondea hacia arriba a décimas de metro (el ``arriba`` del original)."""
    return math.ceil(valor * 10 - 1e-9) / 10


def _abajo(valor: float) -> float:
    """Redondea hacia abajo a décimas de metro (el ``abajo`` del original)."""
    return math.floor(valor * 10 + 1e-9) / 10


def _acotar(valor: float, minimo: float, maximo: float) -> float:
    return min(maximo, max(minimo, valor))


def _coma(valor: float, decimales: int = 2) -> str:
    """Un número como lo escribe el original: con coma decimal."""
    return f"{valor:.{decimales}f}".replace(".", ",")


def ancho_minimo_m(pulgadas: int, globos_ancho: int) -> float:
    """Ancho mínimo (m) para que quepan ``globos_ancho`` carriles sin tapar el vano.

    Porta ``anchoMinimo``: la banda no puede pasar de ``RAZON_GROSOR_MAX`` del
    ancho, así que el ancho tiene que ser al menos ``grosor / 0,36``, redondeado
    hacia arriba a décimas.
    """
    paso = paso_columna_m(diametro_inflado_m(pulgadas))
    return max(ANCHO_MIN_M, _arriba(globos_ancho * paso / RAZON_GROSOR_MAX))


def globos_ancho_maximo(ancho_m: float, pulgadas: int) -> int:
    """Carriles que caben en ese ancho, porte de ``limites().nMax``."""
    paso = paso_columna_m(diametro_inflado_m(pulgadas))
    if paso <= 0:
        return MIN_GLOBOS_ANCHO
    return max(MIN_GLOBOS_ANCHO, min(MAX_GLOBOS_ANCHO, math.floor(RAZON_GROSOR_MAX * ancho_m / paso)))


@dataclass(frozen=True)
class LimitesArco:
    """El rango vivo de cada medida con el arco que hay (porte de ``limites``)."""

    ancho_min_m: float
    ancho_max_m: float
    alto_min_m: float
    alto_max_m: float
    globos_ancho_min: int
    globos_ancho_max: int


def limites(ancho_m: float, pulgadas: int) -> LimitesArco:
    alto_min = max(
        ALTO_MIN_M,
        _arriba(ancho_m / 2 + max(_PATA_MINIMA_M, _PATA_MINIMA_RAZON * ancho_m)),
    )
    return LimitesArco(
        ancho_min_m=ancho_minimo_m(pulgadas, MIN_GLOBOS_ANCHO),
        ancho_max_m=ANCHO_MAX_M,
        alto_min_m=alto_min,
        alto_max_m=max(alto_min, _abajo(min(ALTO_MAX_M, RAZON_ALTO_MAX * ancho_m))),
        globos_ancho_min=MIN_GLOBOS_ANCHO,
        globos_ancho_max=globos_ancho_maximo(ancho_m, pulgadas),
    )


@dataclass(frozen=True)
class MedidasSaneadas:
    """Las medidas ya viables, y qué se cambió para que lo fueran."""

    ancho_m: float
    alto_m: float
    globos_ancho: int
    separacion_filas: float
    cambios: tuple[str, ...]


def sanear(
    ancho_m: float,
    alto_m: float,
    globos_ancho: int,
    pulgadas: int,
    separacion_filas: float = 1.0,
) -> MedidasSaneadas:
    """El arco viable más parecido al pedido, y qué se le cambió.

    Mismo orden de correcciones que el original: el ancho dentro de su rango; el
    ancho suficiente para la banda —**primero se quitan carriles**, y solo si ni
    con el mínimo cabe se sube el ancho—; y el alto según la forma.

    Nunca lanza. Ese es el punto.
    """
    cambios: list[str] = []
    pedido_ancho, pedido_alto = ancho_m, alto_m
    ancho_m = _acotar(ancho_m, ANCHO_MIN_M, ANCHO_MAX_M)
    if abs(ancho_m - pedido_ancho) > 1e-9:
        cambios.append(
            f"El ancho se ajustó a {_coma(ancho_m)} m: un arco va de"
            f" {_coma(ANCHO_MIN_M, 1)} a {_coma(ANCHO_MAX_M, 1)} m."
        )
    globos_ancho = int(round(_acotar(globos_ancho, MIN_GLOBOS_ANCHO, MAX_GLOBOS_ANCHO)))

    # Ancho suficiente para la banda más fina que existe: con globos grandes hace
    # falta un arco más ancho, y entonces sí se sube el ancho.
    necesario = ancho_minimo_m(pulgadas, MIN_GLOBOS_ANCHO)
    if ancho_m < necesario - 1e-9:
        cambios.append(
            f"Con globos R-{pulgadas} el arco necesita al menos {_coma(necesario)} m de"
            f" ancho: se subió el ancho y quedaron {MIN_GLOBOS_ANCHO} globos a lo ancho."
        )
        ancho_m = min(ANCHO_MAX_M, necesario)
        globos_ancho = MIN_GLOBOS_ANCHO

    tope = globos_ancho_maximo(ancho_m, pulgadas)
    if globos_ancho > tope:
        cambios.append(
            f"Con globos R-{pulgadas} en {_coma(ancho_m)} m caben como máximo {tope} a lo"
            " ancho: se redujeron para que la banda no tape la abertura."
        )
        globos_ancho = tope

    rango = limites(ancho_m, pulgadas)
    alto_m = _acotar(alto_m, rango.alto_min_m, rango.alto_max_m)
    if abs(alto_m - pedido_alto) > 1e-6:
        cambios.append(
            f"El alto se ajustó a {_coma(alto_m)} m: fuera de ese rango el arco deja de"
            " parecer un arco."
        )

    separacion = _acotar(separacion_filas, MIN_SEPARACION, MAX_SEPARACION)
    if abs(separacion - separacion_filas) > 1e-9:
        cambios.append(
            f"La separación entre filas se ajustó a {_coma(separacion)}: va de"
            f" {_coma(MIN_SEPARACION, 1)} a {_coma(MAX_SEPARACION, 1)} diámetros."
        )

    return MedidasSaneadas(
        ancho_m=ancho_m,
        alto_m=alto_m,
        globos_ancho=globos_ancho,
        separacion_filas=separacion,
        cambios=tuple(cambios),
    )
