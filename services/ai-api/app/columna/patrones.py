"""Los nueve patrones de color de una columna.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/columna/patrones.ts``. El criterio se define allá;
aquí solo se replica. Ver ``app/armado_columna.py`` y ``docs/architecture/decisions/0033-motor-de-columna-migrado.md``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable, Mapping, Sequence

from app.columna.js import _maximo, _minimo, _mod, _piso, _redondear
from app.columna.tipos import PATRON_IDS

# ---------------------------------------------------------------------------
# Patrones (``patrones.ts``)
# ---------------------------------------------------------------------------


@dataclass
class Control:
    """Un mando numérico de un patrón, con su rango y su valor de partida."""

    clave: str
    minimo: float
    maximo: float
    defecto: float


@dataclass
class Ctx:
    """Lo que un patrón sabe de un globo para decidir su color."""

    i: int
    capas: int
    k: int
    q: float
    n: int
    rnd: Callable[[], float]
    vecino: Callable[[int, int], str | None]


def _banda(pos: float, n: float, bandas: float) -> int:
    """Banda (0..bandas−1) de una posición angular en un anillo de ``n`` puestos."""
    return int(_piso((_mod(pos, n) / n) * bandas + 1e-9))


def _vueltas(defecto: float, maximo: float = 3) -> Control:
    return Control("vueltas", 1, maximo, defecto)


def _color_solido(ctx: Ctx, cols: Sequence[str], op: Mapping[str, float]) -> str:
    return cols[0]


def _color_apilado(ctx: Ctx, cols: Sequence[str], op: Mapping[str, float]) -> str:
    return cols[int(_piso(ctx.i / _maximo(1, op["grosor"]))) % len(cols)]


def _color_espiral(ctx: Ctx, cols: Sequence[str], op: Mapping[str, float]) -> str:
    u = ctx.q - 0.5 * ctx.i * op["inclinacion"]
    nc = int(_minimo(len(cols), ctx.n))
    return cols[_banda(u, ctx.n, nc * op["vueltas"]) % nc]


def _color_rayas(ctx: Ctx, cols: Sequence[str], op: Mapping[str, float]) -> str:
    nc = int(_minimo(len(cols), ctx.n))
    return cols[_banda(ctx.q, ctx.n, nc * op["vueltas"]) % nc]


def _color_zigzag(ctx: Ctx, cols: Sequence[str], op: Mapping[str, float]) -> str:
    p = _maximo(2, _redondear(op["periodo"]))
    tri = abs(_mod(ctx.i, p) - p / 2)
    nc = int(_minimo(len(cols), ctx.n))
    return cols[_banda(ctx.q + 0.5 * op["amplitud"] * tri, ctx.n, nc * op["vueltas"]) % nc]


def _color_diamante(ctx: Ctx, cols: Sequence[str], op: Mapping[str, float]) -> str:
    ancho = ctx.n / op["repet"]
    alto = op["alto"]
    dx = abs(_mod(ctx.q, ancho) - ancho / 2) / (ancho / 2)
    dy = abs(_mod(ctx.i + 0.5, alto) - alto / 2) / (alto / 2)
    d = dx + dy
    radio = op["grueso"] * 2
    if d < radio:
        return cols[1]
    if len(cols) >= 3 and d < radio + 0.32:
        return cols[2]
    return cols[0]


def _color_punteado(ctx: Ctx, cols: Sequence[str], op: Mapping[str, float]) -> str:
    sep = _maximo(2, _redondear(op["sepCapas"]))
    if _mod(ctx.i, sep) != 0:
        return cols[0]
    salto = _maximo(1, _redondear(ctx.n / op["puntos"]))
    desfase = (_piso(ctx.i / sep) % 2) * _piso(salto / 2)
    return cols[1] if _mod(ctx.k - desfase, salto) == 0 else cols[0]


def _color_ombre(ctx: Ctx, cols: Sequence[str], op: Mapping[str, float]) -> str:
    k = len(cols)
    t = ctx.i / _maximo(1, ctx.capas - 1)
    if op["invertir"]:
        t = 1 - t
    t = _minimo(0.9999, _maximo(0, t))
    pos = t * k
    idx = int(_piso(pos))
    frac = pos - idx
    dist_borde = _minimo(frac, 1 - frac)
    # El `&&` de JavaScript corta antes: sin suavidad no se consume un número del generador.
    if op["suavidad"] > 0 and ctx.rnd() < op["suavidad"] * 0.5 * (1 - 2 * dist_borde):
        idx += -1 if frac < 0.5 else 1
    return cols[int(_minimo(k - 1, _maximo(0, idx)))]


def _color_aleatorio(ctx: Ctx, cols: Sequence[str], op: Mapping[str, float]) -> str:
    crudos = [
        ctx.vecino(ctx.i, int(_mod(ctx.k - 1, ctx.n))),
        ctx.vecino(ctx.i, 0) if ctx.k == ctx.n - 1 else None,
        ctx.vecino(ctx.i - 1, ctx.k),
        ctx.vecino(ctx.i - 1, int(_mod(ctx.k - 1, ctx.n))),
    ]
    vecinos = [v for v in crudos if v is not None]
    mejor = cols[0]
    mejor_puntaje = math.inf
    for color in cols:
        puntaje = len([v for v in vecinos if v == color]) + ctx.rnd() * 0.5
        if puntaje < mejor_puntaje:
            mejor_puntaje = puntaje
            mejor = color
    return mejor


@dataclass
class Patron:
    id: str
    nombre: str
    min_colores: int
    controles: tuple[Control, ...]
    color: Callable[[Ctx, Sequence[str], Mapping[str, float]], str]


PATRONES: Mapping[str, Patron] = {
    "solido": Patron("solido", "Sólido", 1, (), _color_solido),
    "apilado": Patron("apilado", "Apilado", 2, (Control("grosor", 1, 8, 2),), _color_apilado),
    "espiral": Patron(
        "espiral",
        "Espiral",
        2,
        (_vueltas(2), Control("inclinacion", -2, 2, 1)),
        _color_espiral,
    ),
    "rayas": Patron("rayas", "Rayas", 2, (_vueltas(2),), _color_rayas),
    "zigzag": Patron(
        "zigzag",
        "Zigzag",
        2,
        (_vueltas(2, 2), Control("periodo", 2, 12, 4), Control("amplitud", 0.5, 2, 1)),
        _color_zigzag,
    ),
    "diamante": Patron(
        "diamante",
        "Diamante",
        2,
        (Control("repet", 1, 3, 1), Control("alto", 4, 16, 8), Control("grueso", 0.3, 0.9, 0.55)),
        _color_diamante,
    ),
    "punteado": Patron(
        "punteado",
        "Punteado",
        2,
        (Control("sepCapas", 2, 8, 3), Control("puntos", 1, 3, 2)),
        _color_punteado,
    ),
    "ombre": Patron(
        "ombre",
        "Ombré",
        3,
        (Control("suavidad", 0, 1, 0.6), Control("invertir", 0, 1, 0)),
        _color_ombre,
    ),
    "aleatorio": Patron("aleatorio", "Al azar", 2, (), _color_aleatorio),
}


def opciones_iniciales() -> dict[str, dict[str, float]]:
    """Las opciones por defecto de cada patrón."""
    return {pid: {c.clave: c.defecto for c in PATRONES[pid].controles} for pid in PATRON_IDS}
