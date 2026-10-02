"""Los catorce patrones de color del arco.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/arco/patrones.ts``.

Cada patrón es una función que decide el color de un globo a partir de su posición en la banda (fila a lo largo
del arco, columna a lo ancho). La geometría del arco no cambia con el patrón.

**El contrato de ``color`` es elegir, nunca mezclar**: solo devuelve uno de los valores que recibe en
``cols``. Gracias a eso el motor le pasa marcas (``"0"``, ``"1"``…) en lugar de colores y sabe, por lo que
devuelve, a qué elemento del patrón pertenece cada globo — que es lo que luego deja pintar racimo por racimo.

El azar se consume **dentro** de estas funciones y solo en las ramas en las que el original lo consume: en
``bloques`` y en ``ombre`` la llamada a ``rnd`` va detrás de un ``and`` que puede cortar antes. Cambiar ese
orden no rompe nada visible y desvía el dibujo entero.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable, cast

from app.motores import mate
from app.motores.js import _es_finito, _maximo, _minimo, _mod, _piso, _redondear
from app.arco.color import normalizar_color
from app.arco.tipos import (
    GEOMETRIA_INICIAL,
    Forma,
    Geometria,
    Globo,
    Real,
    GLOBO_INICIAL,
    PATRON_IDS,
    REAL_INICIAL,
    TAMANOS_GLOBO,
    CapaArco,
    Config,
    Control,
    Distribucion,
    Lista,
)


@dataclass(frozen=True)
class Ctx:
    """Lo que un patrón sabe de un globo para decidir su color."""

    #: Fila (a lo largo del arco) y fila espejada si el patrón lo pide.
    i: int
    iEsp: int
    filas: int
    filasEsp: int
    #: Columna real: filas pares en .5, impares en enteros (empaquetado escalonado).
    c: float
    #: Globos por fila.
    n: int
    #: Progreso 0..1 a lo largo del arco.
    u: float
    #: Posición en unidades de globo (columna, fila·0.866): para medir distancias reales.
    x: float
    y: float
    rnd: Callable[[], float]


@dataclass(frozen=True)
class ResultadoColor:
    color: str | None
    escala: float | None = None


@dataclass(frozen=True)
class Patron:
    id: str
    nombre: str
    descripcion: str
    colores: list[str]
    controles: list[Control]
    color: Callable[[Ctx, list[str], dict[str, float]], ResultadoColor]
    #: Colores con función fija (Centro, Anillo, Fondo…).
    roles: list[str] | None = None
    #: Lista de colores de longitud variable.
    lista: Lista | None = None


def _en(cols: list[str], indice: float) -> str | None:
    """``cols[i]`` con la semántica de un array de JavaScript: fuera de rango es ``undefined``, no un error."""
    if isinstance(indice, float) and (math.isnan(indice) or not float(indice).is_integer()):
        return None
    i = int(indice)
    return cols[i] if 0 <= i < len(cols) else None


def _tri(x: float) -> float:
    """Onda triangular de periodo 2 en el rango [-1, 1]."""
    return 2 * abs(float(_mod(x, 2)) - 1) - 1


def _espejo(defecto: float) -> Control:
    return {
        "clave": "espejo",
        "etiqueta": "Simetría (espejo)",
        "min": 0,
        "max": 1,
        "paso": 1,
        "def_": defecto,
        "interruptor": True,
        "ayuda": "Las dos patas del arco quedan iguales, como reflejadas.",
    }


def _ancho_franja(defecto: float) -> Control:
    return {
        "clave": "ancho",
        "etiqueta": "Ancho de franja",
        "min": 0.5,
        "max": 6,
        "paso": 0.5,
        "def_": defecto,
        "ayuda": "En filas de globos.",
    }


def _inclinacion(defecto: float, minimo: float = -3, maximo: float = 3) -> Control:
    return {
        "clave": "inclinacion",
        "etiqueta": "Inclinación",
        "min": minimo,
        "max": maximo,
        "paso": 0.5,
        "def_": defecto,
        "ayuda": (
            "2 sigue exactamente la diagonal de los globos (franjas limpias). 0 = franjas rectas a lo ancho. "
            "Negativo las gira al otro lado; los valores intermedios quiebran las franjas."
        ),
    }


# ---------------------------------------------------------------------------
# Un `color` por patrón
# ---------------------------------------------------------------------------


def _solido(_ctx: Ctx, cols: list[str], _op: dict[str, float]) -> ResultadoColor:
    return ResultadoColor(_en(cols, 0))


def _bloques(ctx: Ctx, cols: list[str], op: dict[str, float]) -> ResultadoColor:
    k = len(cols)
    largo = op["largo"] if op["largo"] > 0 else ctx.filasEsp / k
    pos = ctx.iEsp / largo
    base = _piso(pos)
    frac = pos - base
    idx = base
    dist_borde = _minimo(frac, 1 - frac) * largo
    if op["mezcla"] > 0 and dist_borde < op["mezcla"] and ctx.rnd() < 0.5 * (1 - dist_borde / op["mezcla"]):
        idx += -1 if frac < 0.5 else 1
    return ResultadoColor(_en(cols, _mod(idx, k)))


def _apilado(ctx: Ctx, cols: list[str], op: dict[str, float]) -> ResultadoColor:
    k = len(cols)
    # 0 = borde, 1 = centro.
    e = _minimo(ctx.c, ctx.n - ctx.c) / (ctx.n / 2)
    idx = _minimo(k - 1, _piso(e * k))
    if op["invertir"]:
        idx = k - 1 - idx
    return ResultadoColor(_en(cols, idx))


def _espiral(ctx: Ctx, cols: list[str], op: dict[str, float]) -> ResultadoColor:
    # Con inversión, la fila avanza y retrocede en triángulo: el giro cambia de sentido cada P filas.
    periodo = op["inversion"]
    fila = periodo - abs(_mod(ctx.iEsp, 2 * periodo) - periodo) if periodo > 0 else ctx.iEsp
    return ResultadoColor(_en(cols, _mod(_piso((fila + op["inclinacion"] * ctx.c) / op["ancho"]), len(cols))))


def _espiral_punteada(ctx: Ctx, cols: list[str], op: dict[str, float]) -> ResultadoColor:
    col = _piso(ctx.c)
    if _mod(col + ctx.iEsp, 2) == 0:
        return ResultadoColor(_en(cols, 0))
    k = _piso((ctx.iEsp + col) / 2)
    return ResultadoColor(_en(cols, 2) if _mod(k, op["cadaN"]) == 0 else _en(cols, 1))


def _zigzag(ctx: Ctx, cols: list[str], op: dict[str, float]) -> ResultadoColor:
    off = op["amplitud"] * _tri(ctx.c / op["periodo"])
    return ResultadoColor(_en(cols, _mod(_piso((ctx.iEsp + off) / op["ancho"]), len(cols))))


def _chevron(ctx: Ctx, cols: list[str], op: dict[str, float]) -> ResultadoColor:
    off = (-1 if op["invertir"] else 1) * op["inclinacion"] * abs(ctx.c - ctx.n / 2)
    return ResultadoColor(_en(cols, _mod(_piso((ctx.iEsp + off) / op["ancho"]), len(cols))))


def _diamante(ctx: Ctx, cols: list[str], op: dict[str, float]) -> ResultadoColor:
    periodo = op["periodo"]
    radio = op["radio"]
    dmin = math.inf
    k0 = _redondear((ctx.iEsp - periodo / 2) / periodo)
    k = k0 - 1
    while k <= k0 + 1:
        yc = k * periodo + periodo / 2
        dmin = _minimo(dmin, abs((ctx.iEsp - yc) * 0.866 * op["aspecto"]) + abs(ctx.c - ctx.n / 2))
        # Medios rombos en los bordes, a media distancia entre los del centro.
        yb = yc + periodo / 2
        dy = abs((ctx.iEsp - yb) * 0.866 * op["aspecto"])
        dmin = _minimo(_minimo(dmin, dy + abs(ctx.c)), dy + abs(ctx.c - ctx.n))
        k += 1
    if dmin < radio * 0.45:
        return ResultadoColor(_en(cols, 0))
    if dmin < radio:
        return ResultadoColor(_en(cols, 1))
    return ResultadoColor(_en(cols, 2))


def _punteado(ctx: Ctx, cols: list[str], op: dict[str, float]) -> ResultadoColor:
    sep = op["sepFilas"]
    offs = sep / 2
    if _mod(ctx.iEsp + offs, sep) != 0:
        return ResultadoColor(_en(cols, 0))
    n_fila = _piso((ctx.iEsp + offs) / sep)
    escalonado = 1 if op["escalonar"] and _resto_js(n_fila, 2) == 1 else 0
    fase = 0.5 if _resto_js(ctx.iEsp, 2) == 0 else 0
    dentro = _mod(ctx.c - fase - escalonado, op["sepAncho"]) < 0.26
    if dentro:
        return ResultadoColor(_en(cols, 1), op["tamanoPunto"])
    return ResultadoColor(_en(cols, 0))


def _franjas(ctx: Ctx, cols: list[str], op: dict[str, float]) -> ResultadoColor:
    return ResultadoColor(_en(cols, _mod(_piso((ctx.iEsp + op["inclinacion"] * ctx.c) / op["ancho"]), len(cols))))


def _floral(ctx: Ctx, cols: list[str], op: dict[str, float]) -> ResultadoColor:
    sep = op["sepFilas"]
    k0 = _redondear((ctx.iEsp - sep / 2) / sep)
    dmin = math.inf
    k = k0 - 1
    while k <= k0 + 1:
        i0 = _redondear(k * sep + sep / 2)
        desplazamiento = (0.8 if _mod(k, 2) == 1 else -0.8) if op["alternar"] else 0
        # El centro de la flor se ajusta a una columna real de esa fila (pares en .5, impares en enteros).
        if _resto_js(i0, 2) == 0:
            c0 = _minimo(ctx.n - 0.5, _maximo(0.5, _redondear(ctx.n / 2 + desplazamiento - 0.5) + 0.5))
        else:
            c0 = _minimo(ctx.n - 1, _maximo(1, _redondear(ctx.n / 2 + desplazamiento)))
        dmin = _minimo(dmin, mate.hypot(ctx.x - c0, ctx.y - i0 * 0.866))
        k += 1
    if dmin < 0.55:
        return ResultadoColor(_en(cols, 2), 0.92)
    if dmin < op["radio"]:
        return ResultadoColor(_en(cols, 1), op["escalaPetalo"])
    # Fondo: hojas en dos tonos alternados si hay segundo verde.
    hoja2 = _en(cols, 3)
    if hoja2 and _mod(ctx.iEsp + _piso(ctx.c), 2) == 1:
        return ResultadoColor(hoja2)
    return ResultadoColor(_en(cols, 0))


def _ombre(ctx: Ctx, cols: list[str], op: dict[str, float]) -> ResultadoColor:
    k = len(cols)
    s = ctx.i / _maximo(1, ctx.filas - 1)
    if op["modo"] == 1:
        t = 1 - abs(2 * s - 1)
    elif op["modo"] == 2:
        t = ctx.c / ctx.n
    else:
        t = s
    if op["invertir"]:
        t = 1 - t
    t = _minimo(0.9999, _maximo(0, t))
    pos = t * k
    idx = _piso(pos)
    frac = pos - idx
    # 0 en la frontera, 0.5 en el centro del tono.
    dist_borde = _minimo(frac, 1 - frac)
    if op["suavidad"] > 0 and ctx.rnd() < op["suavidad"] * 0.5 * (1 - 2 * dist_borde):
        idx += -1 if frac < 0.5 else 1
    return ResultadoColor(_en(cols, _minimo(k - 1, _maximo(0, idx))))


def _arcoiris(ctx: Ctx, cols: list[str], op: dict[str, float]) -> ResultadoColor:
    k = len(cols)
    # Una banda por color (si el arco es tan angosto que no caben todas, se reparten las que quepan).
    bandas = _maximo(1, _minimo(k, _piso(ctx.n)))
    q = (ctx.c / ctx.n) * bandas
    banda = _piso(q + 1e-9)
    # Un globo justo en el borde entre dos bandas va siempre al lado más externo en la mitad de fuera y al
    # interno en la mitad de dentro: bordes estables, sin motas sueltas.
    borde = _redondear(q)
    if borde >= 1 and borde <= bandas - 1 and abs(q - borde) < 1e-6:
        banda = borde - 1 if borde <= bandas / 2 else borde
    banda = _minimo(bandas - 1, _maximo(0, banda))
    if op["invertir"]:
        banda = bandas - 1 - banda
    idx = banda if bandas == k or bandas == 1 else _redondear((banda * (k - 1)) / (bandas - 1))
    return ResultadoColor(_en(cols, _minimo(k - 1, idx)))


def _doslados(ctx: Ctx, cols: list[str], op: dict[str, float]) -> ResultadoColor:
    lado = 0 if ctx.c / ctx.n < op["corte"] else 1
    cambio = 1 if op["alternar"] and ctx.i >= ctx.filas / 2 else 0
    return ResultadoColor(_en(cols, lado ^ cambio))


def _resto_js(a: float, n: float) -> float:
    """El ``%`` de JavaScript, que toma el signo del dividendo (``n % 2 === 1`` no se cumple con negativos)."""
    return math.fmod(a, n)


PATRONES: dict[str, Patron] = {
    "solido": Patron(
        id="solido",
        nombre="Sólido",
        descripcion="Un solo color en todo el arco.",
        colores=["#d62839"],
        roles=["Color"],
        controles=[],
        color=_solido,
    ),
    "bloques": Patron(
        id="bloques",
        nombre="Bloques de color",
        descripcion="Tramos de un mismo color, uno detrás de otro a lo largo del arco.",
        colores=["#e84393", "#fdcb2e", "#22b8cf"],
        lista={"min": 2, "max": 8, "etiqueta": "Bloque"},
        controles=[
            {
                "clave": "largo",
                "etiqueta": "Largo del bloque",
                "min": 0,
                "max": 20,
                "paso": 1,
                "def_": 0,
                "ayuda": "En filas. 0 reparte el arco en partes iguales.",
            },
            {
                "clave": "mezcla",
                "etiqueta": "Mezcla en los bordes",
                "min": 0,
                "max": 4,
                "paso": 0.5,
                "def_": 0,
                "ayuda": "Globos que se cuelan de un bloque al vecino.",
            },
            _espejo(0),
        ],
        color=_bloques,
    ),
    "apilado": Patron(
        id="apilado",
        nombre="Apilado",
        descripcion="Capas de color a lo ancho de la banda: del borde al centro.",
        colores=["#ffffff", "#8ec5ff", "#1d4ed8"],
        lista={"min": 2, "max": 5, "etiqueta": "Capa (borde → centro)"},
        controles=[
            {"clave": "invertir", "etiqueta": "Invertir capas", "min": 0, "max": 1, "paso": 1, "def_": 0, "interruptor": True},
        ],
        color=_apilado,
    ),
    "espiral": Patron(
        id="espiral",
        nombre="Espiral",
        descripcion="Franjas diagonales que dan la vuelta al arco como una cuerda trenzada.",
        colores=["#1d4ed8", "#ffffff"],
        lista={"min": 2, "max": 4, "etiqueta": "Franja"},
        controles=[
            _ancho_franja(2),
            _inclinacion(2),
            {
                "clave": "inversion",
                "etiqueta": "Invertir el giro cada",
                "min": 0,
                "max": 20,
                "paso": 1,
                "def_": 0,
                "ayuda": "En filas; 0 = nunca. Con valores bajos se vuelve chevron, con altos, una espiral que cambia de sentido.",
            },
            _espejo(0),
        ],
        color=_espiral,
    ),
    "espiralPunteada": Patron(
        id="espiralPunteada",
        nombre="Espiral punteada",
        descripcion="Espiral de dos colores con globos de un tercer color como acento.",
        colores=["#1d4ed8", "#ffffff", "#fbbf24"],
        roles=["Color A", "Color B", "Punto"],
        controles=[
            {
                "clave": "cadaN",
                "etiqueta": "Un punto cada",
                "min": 1,
                "max": 6,
                "paso": 1,
                "def_": 3,
                "ayuda": "Cada cuántos globos del color B aparece el punto.",
            },
            _espejo(0),
        ],
        color=_espiral_punteada,
    ),
    "zigzag": Patron(
        id="zigzag",
        nombre="Zigzag",
        descripcion="Franjas que quiebran de un lado a otro de la banda, como un rayo.",
        colores=["#111827", "#fdd835", "#ffffff"],
        lista={"min": 2, "max": 4, "etiqueta": "Franja"},
        controles=[
            _ancho_franja(1.5),
            {
                "clave": "amplitud",
                "etiqueta": "Altura del zigzag",
                "min": 0,
                "max": 8,
                "paso": 0.5,
                "def_": 2.5,
                "ayuda": "Cuánto sube y baja cada quiebre (filas).",
            },
            {
                "clave": "periodo",
                "etiqueta": "Largo del zigzag",
                "min": 1,
                "max": 8,
                "paso": 0.5,
                "def_": 3,
                "ayuda": "Globos que tarda en cambiar de dirección.",
            },
            _espejo(0),
        ],
        color=_zigzag,
    ),
    "chevron": Patron(
        id="chevron",
        nombre="Flecha / Chevron",
        descripcion="Franjas en V que apuntan a lo largo del arco.",
        colores=["#15803d", "#ffffff", "#d4af37"],
        lista={"min": 2, "max": 4, "etiqueta": "Franja"},
        controles=[
            _ancho_franja(2),
            _inclinacion(2, 0, 4),
            {"clave": "invertir", "etiqueta": "Invertir dirección", "min": 0, "max": 1, "paso": 1, "def_": 0, "interruptor": True},
            _espejo(1),
        ],
        color=_chevron,
    ),
    "diamante": Patron(
        id="diamante",
        nombre="Diamante",
        descripcion="Rombos que se repiten a lo largo del arco, con anillos de color.",
        colores=["#d4af37", "#ffffff", "#7c3aed"],
        roles=["Centro", "Anillo", "Fondo"],
        controles=[
            {"clave": "periodo", "etiqueta": "Separación entre rombos", "min": 4, "max": 16, "paso": 1, "def_": 8, "ayuda": "En filas."},
            {"clave": "radio", "etiqueta": "Tamaño del rombo", "min": 0.8, "max": 5, "paso": 0.1, "def_": 1.8},
            {
                "clave": "aspecto",
                "etiqueta": "Alargado del rombo",
                "min": 0.5,
                "max": 1.8,
                "paso": 0.1,
                "def_": 0.9,
                "ayuda": "Mayor = más aplastado a lo largo del arco.",
            },
            _espejo(1),
        ],
        color=_diamante,
    ),
    "punteado": Patron(
        id="punteado",
        nombre="Punteado",
        descripcion="Un color de fondo con globos de otro color repartidos como lunares.",
        colores=["#ec4899", "#ffffff"],
        roles=["Fondo", "Punto"],
        controles=[
            {"clave": "sepFilas", "etiqueta": "Separación entre lunares", "min": 2, "max": 12, "paso": 2, "def_": 4, "ayuda": "En filas."},
            {
                "clave": "sepAncho",
                "etiqueta": "Lunares a lo ancho",
                "min": 1,
                "max": 4,
                "paso": 1,
                "def_": 2,
                "ayuda": "Cada cuántos globos hay un lunar en la fila.",
            },
            {
                "clave": "tamanoPunto",
                "etiqueta": "Tamaño del lunar",
                "min": 0.8,
                "max": 1.8,
                "paso": 0.05,
                "def_": 1.2,
                "ayuda": "Respecto a los globos del fondo.",
            },
            {"clave": "escalonar", "etiqueta": "Escalonar lunares", "min": 0, "max": 1, "paso": 1, "def_": 1, "interruptor": True},
            _espejo(1),
        ],
        color=_punteado,
    ),
    "franjas": Patron(
        id="franjas",
        nombre="Franjas",
        descripcion="Rayas diagonales gruesas de varios colores, como un bastón de caramelo.",
        colores=["#dc2626", "#ffffff", "#1d4ed8"],
        lista={"min": 2, "max": 5, "etiqueta": "Franja"},
        controles=[_ancho_franja(4), _inclinacion(2), _espejo(0)],
        color=_franjas,
    ),
    "floral": Patron(
        id="floral",
        nombre="Floral",
        descripcion="Flores de globos (centro y pétalos) sobre un fondo de hojas.",
        colores=["#4d7c0f", "#f472b6", "#fde047", "#65a30d"],
        roles=["Hojas", "Pétalos", "Centro", "Hojas 2"],
        controles=[
            {"clave": "sepFilas", "etiqueta": "Separación entre flores", "min": 4, "max": 16, "paso": 1, "def_": 7, "ayuda": "En filas."},
            {
                "clave": "radio",
                "etiqueta": "Tamaño de la flor",
                "min": 1.1,
                "max": 2.1,
                "paso": 0.1,
                "def_": 1.2,
                "ayuda": "1.2 = seis pétalos; 1.8 o más = dos vueltas de pétalos.",
            },
            {
                "clave": "escalaPetalo",
                "etiqueta": "Tamaño de los pétalos",
                "min": 1,
                "max": 1.8,
                "paso": 0.05,
                "def_": 1.25,
                "ayuda": "Respecto a los globos de las hojas.",
            },
            {"clave": "alternar", "etiqueta": "Alternar lados", "min": 0, "max": 1, "paso": 1, "def_": 1, "interruptor": True},
            _espejo(1),
        ],
        color=_floral,
    ),
    "ombre": Patron(
        id="ombre",
        nombre="Ombré",
        descripcion="Degradado ordenado de tonos: a lo largo del arco, simétrico o a lo ancho.",
        colores=["#dbeafe", "#93c5fd", "#3b82f6", "#1e40af"],
        lista={"min": 3, "max": 7, "etiqueta": "Tono"},
        controles=[
            {
                "clave": "modo",
                "etiqueta": "Dirección",
                "min": 0,
                "max": 2,
                "paso": 1,
                "def_": 0,
                "seleccion": ["A lo largo", "Simétrico", "A lo ancho"],
            },
            {
                "clave": "suavidad",
                "etiqueta": "Mezcla entre tonos",
                "min": 0,
                "max": 1,
                "paso": 0.05,
                "def_": 0.6,
                "ayuda": "Globos que se cuelan en la frontera entre dos tonos. 0 = bandas duras.",
            },
            {"clave": "invertir", "etiqueta": "Invertir degradado", "min": 0, "max": 1, "paso": 1, "def_": 0, "interruptor": True},
        ],
        color=_ombre,
    ),
    "arcoiris": Patron(
        id="arcoiris",
        nombre="Arcoíris",
        descripcion="Bandas de color paralelas al arco, como un arcoíris de verdad: el primer color queda por fuera.",
        colores=["#ef4444", "#f59e0b", "#fde047", "#22c55e", "#3b82f6", "#8b5cf6"],
        lista={"min": 3, "max": 8, "etiqueta": "Banda"},
        controles=[
            {
                "clave": "invertir",
                "etiqueta": "Invertir orden",
                "min": 0,
                "max": 1,
                "paso": 1,
                "def_": 0,
                "interruptor": True,
                "ayuda": "Por defecto el primer color va por fuera y el último por dentro.",
            },
        ],
        color=_arcoiris,
    ),
    "doslados": Patron(
        id="doslados",
        nombre="Dos lados",
        descripcion="El exterior y el interior del arco en colores distintos.",
        colores=["#fde047", "#7c3aed"],
        roles=["Exterior", "Interior"],
        controles=[
            {
                "clave": "corte",
                "etiqueta": "Posición del corte",
                "min": 0.2,
                "max": 0.8,
                "paso": 0.05,
                "def_": 0.5,
                "ayuda": "Dónde cambia de color a lo ancho de la banda.",
            },
            {
                "clave": "alternar",
                "etiqueta": "Intercambiar en la clave",
                "min": 0,
                "max": 1,
                "paso": 1,
                "def_": 0,
                "interruptor": True,
                "ayuda": "Los colores cambian de lado al pasar la mitad del arco.",
            },
        ],
        color=_doslados,
    ),
}


def globos_ancho_por_defecto(id_patron: str, cfg: Config) -> int:
    """Los globos a lo ancho con los que arranca cada patrón; el arcoíris, uno por banda de color."""
    if id_patron == "arcoiris":
        return int(_maximo(2, _minimo(8, len(cfg["colores"]["arcoiris"]))))
    return int(GEOMETRIA_INICIAL["globosAncho"])


def config_inicial() -> Config:
    """Configuración inicial: patrones con los colores y opciones de la imagen de referencia."""
    colores: dict[str, list[str]] = {}
    opciones: dict[str, dict[str, float]] = {}
    for id_patron in PATRON_IDS:
        patron = PATRONES[id_patron]
        colores[id_patron] = list(patron.colores)
        opciones[id_patron] = {c["clave"]: c["def_"] for c in patron.controles}
    return {
        "capas": [],
        "secciones": [],
        "patron": "espiral",
        "geometria": Geometria(**GEOMETRIA_INICIAL),
        "globo": Globo(**GLOBO_INICIAL),
        "real": Real(**REAL_INICIAL),
        "colores": colores,
        "opciones": opciones,
    }


# ---------------------------------------------------------------------------
# Cambio de patrón y normalización de un diseño que llega de fuera
# ---------------------------------------------------------------------------


def cambiar_patron(cfg: Config, id_patron: str) -> Config:
    """Cambia de patrón con su propia distribución.

    Guarda la del patrón que se deja y pone la del nuevo (la última que tuvo, o la que trae por defecto). Así
    lo que un patrón pide —el arcoíris sube los globos a lo ancho y a veces el ancho y el alto del arco— no se
    queda en los demás. Devuelve un diseño **sin sanear**.
    """
    if id_patron == cfg["patron"]:
        return cfg
    g = cfg["geometria"]
    recuerdo: dict[str, Distribucion] = dict(cfg.get("recuerdo") or {})
    recuerdo[cfg["patron"]] = {"globosAncho": g["globosAncho"], "anchoM": g["anchoM"], "altoM": g["altoM"]}
    visitado = recuerdo.get(id_patron)
    entra_arcoiris = id_patron == "arcoiris" and cfg["patron"] != "arcoiris"
    sale_arcoiris = cfg["patron"] == "arcoiris" and id_patron != "arcoiris"

    geometria = dict(g)
    if visitado:
        geometria.update(visitado)
    else:
        # Un patrón que no se había usado: los globos a lo ancho que trae, y el tamaño del arco de antes (si se
        # sale del arcoíris, el de antes de entrar).
        anterior = cfg.get("ultimoNormal")
        tamano = anterior if sale_arcoiris and anterior else {"anchoM": g["anchoM"], "altoM": g["altoM"]}
        geometria.update(tamano)
        geometria["globosAncho"] = globos_ancho_por_defecto(id_patron, cfg)

    salida: Config = {**cfg, "patron": id_patron, "geometria": cast(Geometria, geometria), "recuerdo": recuerdo}
    if entra_arcoiris:
        salida["ultimoNormal"] = {"anchoM": g["anchoM"], "altoM": g["altoM"]}
    return salida


def _acotar_crudo(valor: object, minimo: float, maximo: float, respaldo: float) -> float:
    """``acotar`` del original: lo que no sea un número finito cae al respaldo (un booleano no es un número)."""
    if not _es_finito(valor):
        return respaldo
    return float(_minimo(maximo, _maximo(minimo, float(cast(float, valor)))))


def _lista_cruda(crudo: object) -> list[object]:
    return list(crudo) if isinstance(crudo, list) else []


def _secuencia_cruda(k: object) -> CapaArco:
    colores = k.get("colores") if isinstance(k, dict) else None
    if isinstance(colores, list) and len(colores) > 0:
        return {"colores": [normalizar_color(h, "#9ca3af") for h in colores[:16]]}
    return None


def normalizar_config(entrada: object) -> Config:
    """Recibe algo parcial o dudoso (un enlace, el almacenamiento, la IA) y devuelve un ``Config`` válido."""
    return normalizar_config_con_cambios(entrada)[0]


def normalizar_config_con_cambios(entrada: object) -> tuple[Config, list[str]]:
    """Lo mismo, **y lo que hubo que corregir** para que el diseño fuera posible.

    Existe porque el saneado es la última línea de ``normalizar_config`` y sus avisos se perdían ahí dentro:
    quien llamaba después a ``sanear`` sobre el resultado ya normalizado recibía una lista vacía —el diseño ya
    estaba corregido— y le decía al cliente que no se había tocado nada. Un arco al que se le subió el alto
    medio metro tiene que decirlo.
    """
    from app.arco.limites import sanear

    base = config_inicial()
    if not isinstance(entrada, dict):
        return base, []
    e: dict[str, object] = entrada

    patron = e.get("patron")
    if isinstance(patron, str) and patron in PATRON_IDS:
        base["patron"] = patron

    g_crudo = e.get("geometria")
    g: dict[str, object] = g_crudo if isinstance(g_crudo, dict) else {}
    forma = g.get("forma")
    base["geometria"] = {
        "forma": cast(Forma, forma) if forma in ("alto", "semi", "herradura") else base["geometria"]["forma"],
        "anchoM": _acotar_crudo(g.get("anchoM"), 0.8, 12, base["geometria"]["anchoM"]),
        "altoM": _acotar_crudo(g.get("altoM"), 0.8, 8, base["geometria"]["altoM"]),
        "globosAncho": int(_redondear(_acotar_crudo(g.get("globosAncho"), 2, 16, base["geometria"]["globosAncho"]))),
        "suelo": cast(bool, g["suelo"]) if isinstance(g.get("suelo"), bool) else base["geometria"]["suelo"],
    }

    # Capas: `None` sigue el patrón; o una secuencia de colores propia. Un diseño guardado con el modo por
    # capas anterior (paleta + secuencias por índice) se convierte: cada capa pasa a ser personalizada y las
    # capas son los globos a lo ancho.
    crudas = _lista_cruda(e.get("capas"))[:16]
    paleta_cruda = e.get("paleta")
    if e.get("modo") == "capas" and isinstance(paleta_cruda, list) and len(crudas) >= 2:
        paleta = [normalizar_color(h, "#9ca3af") for h in paleta_cruda[:8]]
        capas: list[CapaArco] = []
        for k in crudas:
            crudo_indices = k.get("colores") if isinstance(k, dict) else None
            indices = crudo_indices if isinstance(crudo_indices, list) else [0]
            colores: list[str] = []
            for v in indices[:16]:
                numero = float(cast(float, v)) if _es_finito(v) else 0.0
                colores.append(paleta[int(_mod(_redondear(numero), len(paleta)))] if paleta else "#9ca3af")
            capas.append({"colores": colores})
        base["capas"] = capas
        base["geometria"]["globosAncho"] = len(crudas)
    else:
        base["capas"] = [_secuencia_cruda(k) for k in crudas]

    base["secciones"] = [_secuencia_cruda(k) for k in _lista_cruda(e.get("secciones"))[:40]]

    b_crudo = e.get("globo")
    b: dict[str, object] = b_crudo if isinstance(b_crudo, dict) else {}
    gi = base["globo"]
    nominal_crudo = b.get("nominal")
    nominal = next((t for t in TAMANOS_GLOBO if t == nominal_crudo), gi["nominal"])
    base["globo"] = {
        "nominal": nominal,
        "inflado": _acotar_crudo(b.get("inflado"), 0.8, 1.1, gi["inflado"]),
        "tamano": _acotar_crudo(b.get("tamano"), 0.9, 1.5, gi["tamano"]),
        "ovalo": _acotar_crudo(b.get("ovalo"), 1, 1.4, gi["ovalo"]),
        "separacion": _acotar_crudo(b.get("separacion"), 0.7, 1.4, gi["separacion"]),
        "compensacion": _acotar_crudo(b.get("compensacion"), 0, 1, gi["compensacion"]),
        "variacionTam": _acotar_crudo(b.get("variacionTam"), 0, 0.3, gi["variacionTam"]),
        "variacionTono": _acotar_crudo(b.get("variacionTono"), 0, 0.25, gi["variacionTono"]),
        "desorden": _acotar_crudo(b.get("desorden"), 0, 0.4, gi["desorden"]),
        "brillo": _acotar_crudo(b.get("brillo"), 0, 1, gi["brillo"]),
        "sombra": _acotar_crudo(b.get("sombra"), 0, 0.5, gi["sombra"]),
        "contorno": _acotar_crudo(b.get("contorno"), 0, 3, gi["contorno"]),
        "profundidad": _acotar_crudo(b.get("profundidad"), 0, 1, gi["profundidad"]),
        "semilla": int(_redondear(_acotar_crudo(b.get("semilla"), 1, 99999, gi["semilla"]))),
    }

    r_crudo = e.get("real")
    r: dict[str, object] = r_crudo if isinstance(r_crudo, dict) else {}
    base["real"] = {
        "desperdicio": _acotar_crudo(r.get("desperdicio"), 0, 0.4, base["real"]["desperdicio"]),
        "precio": _acotar_crudo(r.get("precio"), 0, 1_000_000, base["real"]["precio"]),
    }

    cols_crudo = e.get("colores")
    ops_crudo = e.get("opciones")
    cols: dict[str, object] = cols_crudo if isinstance(cols_crudo, dict) else {}
    ops: dict[str, object] = ops_crudo if isinstance(ops_crudo, dict) else {}
    for id_patron in PATRON_IDS:
        p = PATRONES[id_patron]
        crudos = _lista_cruda(cols.get(id_patron))
        validos = [
            normalizar_color(c, p.colores[i] if i < len(p.colores) else p.colores[0]) for i, c in enumerate(crudos)
        ]
        minimo = p.lista["min"] if p.lista else len(p.colores)
        maximo = p.lista["max"] if p.lista else len(p.colores)
        if len(validos) >= minimo:
            base["colores"][id_patron] = validos[:maximo]

        crudo_op_valor = ops.get(id_patron)
        crudo_op: dict[str, object] = crudo_op_valor if isinstance(crudo_op_valor, dict) else {}
        for control in p.controles:
            base["opciones"][id_patron][control["clave"]] = _acotar_crudo(
                crudo_op.get(control["clave"]), control["min"], control["max"], control["def_"]
            )

    # Migración de diseños guardados: los valores que siguen en el antiguo por defecto pasan al nuevo (más
    # ordenado); los que el usuario cambió no se tocan. Se puede quitar cuando ya no queden enlaces viejos.
    def migrar(actual: float, viejo: float, nuevo: float) -> float:
        return nuevo if abs(actual - viejo) < 1e-9 else actual

    o = base["opciones"]
    o["espiral"]["inclinacion"] = migrar(o["espiral"]["inclinacion"], 1.2, 2)
    o["franjas"]["ancho"] = migrar(o["franjas"]["ancho"], 2.5, 4)
    o["franjas"]["inclinacion"] = migrar(o["franjas"]["inclinacion"], 1.6, 2)
    o["chevron"]["ancho"] = migrar(o["chevron"]["ancho"], 1.5, 2)
    o["chevron"]["inclinacion"] = migrar(o["chevron"]["inclinacion"], 1.4, 2)
    base["globo"]["variacionTam"] = migrar(base["globo"]["variacionTam"], 0.04, 0)
    base["globo"]["desorden"] = migrar(base["globo"]["desorden"], 0.04, 0)
    base["globo"]["variacionTono"] = migrar(base["globo"]["variacionTono"], 0.05, 0.03)

    # Distribución que recuerda cada patrón.
    rec_crudo = e.get("recuerdo")
    rec: dict[str, object] = rec_crudo if isinstance(rec_crudo, dict) else {}
    recuerdo: dict[str, Distribucion] = {}
    for id_patron in PATRON_IDS:
        guardado = rec.get(id_patron)
        if isinstance(guardado, dict):
            recuerdo[id_patron] = {
                "globosAncho": int(_redondear(_acotar_crudo(guardado.get("globosAncho"), 2, 16, 4))),
                "anchoM": _acotar_crudo(guardado.get("anchoM"), 0.8, 12, base["geometria"]["anchoM"]),
                "altoM": _acotar_crudo(guardado.get("altoM"), 0.8, 8, base["geometria"]["altoM"]),
            }
    if recuerdo:
        base["recuerdo"] = recuerdo
    un = e.get("ultimoNormal")
    if isinstance(un, dict):
        base["ultimoNormal"] = {
            "anchoM": _acotar_crudo(un.get("anchoM"), 0.8, 12, base["geometria"]["anchoM"]),
            "altoM": _acotar_crudo(un.get("altoM"), 0.8, 8, base["geometria"]["altoM"]),
        }

    # Ningún diseño que llegue de fuera (enlace, almacenamiento, IA) puede ser una combinación imposible.
    saneado, cambios = sanear(base)
    return saneado, list(cambios)


__all__ = [
    "Ctx",
    "PATRONES",
    "Patron",
    "ResultadoColor",
    "cambiar_patron",
    "config_inicial",
    "globos_ancho_por_defecto",
    "normalizar_config",
    "normalizar_config_con_cambios",
]
