"""La línea guía de una estructura orgánica: por dónde pasa la banda de globos y qué grosor tiene.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/organico/espina.ts``.

``Espina`` es el contrato entre cada estructura y el motor: la guirnalda trae la suya
(``app.guirnalda.espina``) y el arco la de aquí. El motor solo mira ``puntos``, ``largo``, ``grosor``, ``pie``
y los límites opcionales, así que una estructura nueva no toca el motor.

Los campos conservan el nombre del original (``largoCompleto``, ``indiceEn``, ``fraCima``, ``xMin``…): son el
mismo objeto que el motor consume y renombrarlos aquí solo daría un sitio más donde perder uno.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from math import (
    log,
)  # `mate` no trae `log`: solo lo usa la espina del arco, que la guirnalda no recorre.

from app.motores import mate
from app.motores.js import _maximo, _minimo
from app.organico.tipos import ConfigOrg

N_PUNTOS = 720


@dataclass(slots=True)
class PuntoEspina:
    """Un punto de la línea guía, en metros (x a la derecha, y arriba, y = 0 es el suelo)."""

    x: float
    y: float
    #: Tangente unitaria, de izquierda a derecha.
    tx: float
    ty: float
    #: Normal unitaria, hacia afuera de la estructura.
    nx: float
    ny: float
    #: Largo acumulado desde el extremo izquierdo (m).
    s: float


@dataclass(slots=True)
class Espina:
    """La línea guía armada, con sus funciones de grosor y de posición.

    ``grosor``, ``pie`` e ``indiceEn`` son cierres que cada estructura construye: el motor no sabe de qué
    fórmula salen. Los límites opcionales (``xMin``, ``xMax``, ``yMax``) son *o un número o nada*, y el motor
    distingue los dos casos — una guirnalda fija ``xMin``/``xMax`` y deja ``yMax`` sin definir, y poner un 0
    en su lugar aplastaría los globos contra el suelo.
    """

    puntos: list[PuntoEspina]
    #: Largo de la parte que se arma (m).
    largo: float
    #: Largo completo antes de cortar (m).
    largoCompleto: float
    grosor: Callable[[float], float]
    #: Fracción del recorrido completo medida desde la pata (0 = pata).
    pie: Callable[[float], float]
    indiceEn: Callable[[float], int]
    #: Dónde se mide el grosor «de la cima» (la guirnalda: 0,5, su centro).
    fraCima: float | None = None
    #: Los dos lados de la línea son iguales: las ramas salen a ambos por igual.
    simetrica: bool | None = None
    yMax: float | None = None
    xMin: float | None = None
    xMax: float | None = None
    #: Área de la banda ya integrada: se pide hasta cinco veces por diseño y la integral no cambia.
    areaCache: float | None = field(default=None, repr=False, compare=False)


def medir(lista: list[tuple[float, float]]) -> list[PuntoEspina]:
    """Tangente, normal y largo acumulado de una lista de puntos (x, y).

    La tangente de cada punto se toma de sus dos vecinos; en los extremos, del propio punto y su único
    vecino. Un tramo de largo 0 usa 1 como divisor, como el ``|| 1`` del original.
    """
    salida: list[PuntoEspina] = []
    s = 0.0
    ultimo = len(lista) - 1
    for i, (x, y) in enumerate(lista):
        if i > 0:
            s += mate.hypot(x - lista[i - 1][0], y - lista[i - 1][1])
        a0 = lista[max(0, i - 1)]
        b0 = lista[min(ultimo, i + 1)]
        dx = b0[0] - a0[0]
        dy = b0[1] - a0[1]
        m = mate.hypot(dx, dy) or 1
        salida.append(PuntoEspina(x=x, y=y, tx=dx / m, ty=dy / m, nx=-dy / m, ny=dx / m, s=s))
    return salida


def hacer_indice_en(puntos: list[PuntoEspina], largo: float) -> Callable[[float], int]:
    """Búsqueda binaria del punto que está en la fracción ``fr`` del largo, medido sobre la curva."""

    def indice_en(fr: float) -> int:
        objetivo = _minimo(1, _maximo(0, fr)) * largo
        lo = 0
        hi = len(puntos) - 1
        while hi - lo > 1:
            m = (lo + hi) >> 1
            if puntos[m].s <= objetivo:
                lo = m
            else:
                hi = m
        return lo

    return indice_en


def memorizar(grosor: Callable[[float], float]) -> Callable[[float], float]:
    """El mismo grosor, calculado una vez por fracción.

    El motor lo pide tres veces sobre los mismos 721 puntos (el área de la banda, la medida acumulada y la
    tabla de grosores) y otra vez por cada candidato de relleno. Es una función pura de ``fr``, así que
    recordar el resultado no cambia ni un bit.
    """
    recordado: dict[float, float] = {}

    def envuelto(fr: float) -> float:
        valor = recordado.get(fr)
        if valor is None:
            valor = grosor(fr)
            recordado[fr] = valor
        return valor

    return envuelto


def _signo(v: float) -> float:
    """El ``signo`` del original: 0 cuenta como positivo."""
    return -1 if v < 0 else 1


def crear_espina(cfg: ConfigOrg, fase: list[float]) -> Espina:
    """Línea guía del **arco** orgánico: una superelipse con la cima corrida y una ondulación suave.

    La guirnalda no la usa (tiene la suya), pero el motor compartido sí: ``estimar_globos`` del arco y su
    ``sanear`` pasan por aquí.
    """
    f = cfg["forma"]
    v = cfg["volumen"]
    a = _maximo(0.2, (f["anchoM"] - v["grosorPatasM"]) / 2)
    hs = _maximo(0.3, f["altoM"] - v["grosorCimaM"] / 2)
    p = 2 / f["curva"]
    gamma = log(f["cima"]) / log(0.5)

    pts: list[tuple[float, float]] = []
    for i in range(N_PUNTOS + 1):
        th = mate.pi * (1 - i / N_PUNTOS)
        c = mate.cos(th)
        s = mate.sin(th)
        xr = _signo(c) * mate.pow(mate.fabs(c), p)
        yr = mate.pow(mate.fabs(s), p)
        u = (xr + 1) / 2
        pts.append((a * (2 * mate.pow(u, gamma) - 1), hs * yr))

    puntos = medir(pts)
    largo = puntos[-1].s

    if f["ondulacion"] > 0:
        amp = f["ondulacion"] * 0.09 * _minimo(f["anchoM"], f["altoM"])
        k1 = 1.4 + fase[0] * 1.4
        k2 = 3 + fase[1] * 2
        movidos: list[tuple[float, float]] = []
        for q in puntos:
            u = q.s / largo
            env = mate.pow(mate.sin(mate.pi * u), 0.8)
            d = (
                amp
                * env
                * (
                    0.7 * mate.sin(2 * mate.pi * k1 * u + fase[2] * 6.283)
                    + 0.3 * mate.sin(2 * mate.pi * k2 * u + fase[3] * 6.283)
                )
            )
            movidos.append((q.x + q.nx * d, _maximo(0, q.y + q.ny * d)))
        puntos = medir(movidos)
        largo = puntos[-1].s

    largo_completo = largo
    corte = _minimo(1, _maximo(0.55, f["corte"]))
    if corte < 1:
        limite = corte * largo_completo
        puntos = medir([(q.x, q.y) for q in puntos if q.s <= limite])
        largo = puntos[-1].s
    if f["espejo"]:
        puntos = medir([(-q.x, q.y) for q in reversed(puntos)])
        largo = puntos[-1].s

    espejo = f["espejo"]
    largo_armado = largo

    def pie(fr: float) -> float:
        u = _minimo(1, _maximo(0, fr))
        desde_pata = (1 - u) * largo_armado if espejo else u * largo_armado
        return float(desde_pata / largo_completo)

    irreg = v["irregularidad"]

    def grosor(fr: float) -> float:
        u = _minimo(1, _maximo(0, fr))
        p_pie = pie(u)
        h = mate.pow(mate.sin(mate.pi * _minimo(1, p_pie)), 0.7)
        base = v["grosorPatasM"] + (v["grosorCimaM"] - v["grosorPatasM"]) * h
        if corte < 1:
            t = _minimo(1, _maximo(0, (p_pie - (corte - 0.22)) / 0.22))
            base *= 1 - 0.45 * (t * t * (3 - 2 * t))
        carga = 1 - 0.22 * f["carga"] * (1 - 2 * u)
        ruido = (
            0.5 * mate.sin(2 * mate.pi * (1.1 * u) + fase[4] * 6.283)
            + 0.3 * mate.sin(2 * mate.pi * (2.7 * u) + fase[5] * 6.283)
            + 0.2 * mate.sin(2 * mate.pi * (4.9 * u) + fase[6] * 6.283)
        )
        return float(_maximo(0.25, base * carga * (1 + irreg * 0.5 * ruido)))

    return Espina(
        puntos=puntos,
        largo=largo,
        largoCompleto=largo_completo,
        grosor=memorizar(grosor),
        pie=pie,
        indiceEn=hacer_indice_en(puntos, largo),
    )
