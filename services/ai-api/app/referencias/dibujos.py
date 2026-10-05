"""Dibujos propios de la vista previa, para lo que ningún diseñador dibuja.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/referencias/dibujos.ts``.

Son la **pared**, el **círculo**, el **techo** y el **centro de mesa** (que no tienen diseñador) y dos formas
del arco que su motor no hace (el **perlado**, aquí, y el **túnel**, que vive en la vista previa de allá).
Existen porque elegir «Pared de globos → En rombos» no cambiaba nada en pantalla (David, 2026-09-27: «se
debería ver la actualización del tipo directamente en la UI, pero no pasa»). La regla desde entonces: **cada
forma y cada patrón que se puede elegir cambia el dibujo**.

Son esquemáticos a propósito: colocan globos en metros (``x`` a lo ancho, ``y`` hacia arriba desde el piso)
según la forma elegida, les ponen color según el patrón, y los pinta ``dibujar`` del motor orgánico, así que
se ven con la misma luz, sombra y brillo que los demás. **No calculan cantidades**: la medida es la típica de
cada estructura, no la del trabajo, y nada de aquí entra en el conteo, en el precio ni en el ``plan_hash``.
Deterministas: la misma ficha da siempre el mismo dibujo.

Dos cosas desvían el resultado sin que nada falle, y por eso están aisladas:

- **La aritmética.** Todo pasa por ``app.motores.mate`` y ``app.motores.js``, no por ``math``: V8 no usa la
  libm del sistema para ``sin``, ``cos``, ``atan2`` ni ``hypot``, y ``Math.round`` de JavaScript manda el
  medio hacia arriba mientras el de Python lo manda al par. Un bit de diferencia en un seno mueve un globo
  medio píxel y el sha256 del SVG —que es lo que el cliente aprueba— deja de cuadrar.
- **El orden en que se consume el azar.** Un solo generador por dibujo (31 la pared, 17 el círculo, 23 el
  techo, 41 el centro) reparte el tamaño, el radio, el ángulo, la posición y, cuando el patrón es «mezclado»
  o «degradado», también el color. Por eso cada expresión se evalúa aquí en el mismo orden que allá, incluso
  cuando el resultado parece no depender de él.

Lo que no se migró es la interfaz: estas funciones son puras y devuelven el interior del ``<svg>``, sin la
etiqueta, igual que el original.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from contextvars import ContextVar
from typing import Any, Literal, NamedTuple, NotRequired, TypedDict

from app.arco.tipos import INFLADO_PULG
from app.motores import mate
from app.motores.js import (
    _acotar,
    _maximo,
    _minimo,
    _numero,
    _piso,
    _redondear,
    _resto,
    crear_rng,
    mezclar,
)
from app.organico.dibujo import Marco, degradado, dibujar
from app.organico.motor import GloboOrg
from app.organico.tipos import Acabado, config_inicial

__all__ = [
    "GLOBOS_POR_AREA",
    "ArcoDibujo",
    "ColorDibujo",
    "DatosDibujo",
    "DensidadDibujo",
    "Dibujo",
    "ElementoDibujo",
    "ElipseDibujo",
    "LineaDibujo",
    "PoligonoDibujo",
    "con_globos",
    "con_globos_y_estructura",
    "con_numero",
    "dibujar_arco_perlado",
    "dibujar_centro",
    "dibujar_circulo",
    "dibujar_pared",
    "dibujar_techo",
]


class ColorDibujo(TypedDict):
    """Un color de la ficha, ya en hexadecimal, con su acabado y cuántos globos lleva."""

    hex: str
    acabado: Acabado
    peso: float


DensidadDibujo = Literal["sencilla", "media", "lujosa"]


class DatosDibujo(TypedDict):
    """Lo que el dibujo necesita de la ficha. ``colores`` va del que más globos lleva al que menos."""

    colores: list[ColorDibujo]
    #: Globos por tamaño redondo.
    mezcla: dict[int, float]
    dominante: int
    #: Globos redondos en total.
    redondos: int
    #: Qué tan llena va la pieza (``GLOBOS_POR_AREA``). Sin ella, ``media``: el dibujo de siempre.
    densidad: NotRequired[DensidadDibujo]


#: **La densidad de una pieza sin diseñador** (pared, techo y centro de mesa), en globos por unidad de área
#: cubierta. Criterio del dueño, escrito allá el 2026-10-04 (``GLOBOS_POR_AREA`` de ``dibujos.ts``, con su
#: explicación entera): las tres densidades son los estilos ligero / estándar / lleno del motor orgánico, y el
#: dibujo crece en la misma proporción con la que se cotiza la pieza (``plan._DENSITY_LAMBDA``, que tiene que
#: coincidir con esta tabla y lo comprueba ``tests/test_dibujo_estructura.py``).
#:
#: Con ``c = GLOBOS_POR_AREA[d] / GLOBOS_POR_AREA["media"]``: lo que se reparte por superficie separa sus
#: nodos ``1/√c`` (nunca más juntos que tocándose: una rejilla que ya se toca lleva entonces un R-5 de relleno
#: por hueco), lo que se cuenta por piezas lleva ``round(n · c)``, y lo que ya es una cuenta (el bouquet de
#: helio del centro, que coloca ``redondos``) o una pieza fija (la burbuja) no cambia. ``media`` da ``c = 1``
#: exacto y deja cada dibujo idéntico byte a byte.
GLOBOS_POR_AREA: dict[str, float] = {"sencilla": 2.8, "media": 3.6, "lujosa": 4.5}


def _factor_densidad(d: DatosDibujo) -> float:
    """El factor ``c`` de la densidad de la ficha: 1 en ``media`` (o sin densidad, o con una desconocida)."""
    densidad = d.get("densidad")
    por_area = (
        GLOBOS_POR_AREA.get(densidad, GLOBOS_POR_AREA["media"])
        if isinstance(densidad, str)
        else GLOBOS_POR_AREA["media"]
    )
    return por_area / GLOBOS_POR_AREA["media"]


def _con_densidad(n: int, c: float) -> int:
    """``n`` piezas con la densidad de la ficha, nunca menos de una (``Math.max(1, Math.round(n * c))``)."""
    return int(_maximo(1, _redondear(n * c)))


class Dibujo(TypedDict):
    """El interior del ``<svg>`` y el lienzo en el que va."""

    svg: str
    ancho: float
    alto: float


_TAMANOS: tuple[int, ...] = (5, 9, 12, 18, 24, 36)

_G = mate.pi / 180
_MARCO_METAL = "#c9d1cc"


def _f(valor: float) -> str:
    """Un número del SVG: a un decimal y escrito como lo escribe JavaScript.

    Es el ``f`` del original, y redondea a **décimas**, no a centésimas como el de ``app.organico.dibujo``:
    estos dibujos son esquemáticos y su SVG se escribe más corto a propósito.
    """
    return str(_numero(_redondear(valor * 10) / 10))


def _radio(t: int) -> float:
    """Radio en metros de un globo inflado."""
    return float((INFLADO_PULG[t] * 0.0254) / 2)


def _claridad(hexa: str) -> float:
    """Luminancia relativa de un ``#rrggbb`` (0 negro, 1 blanco), para ordenar un degradado."""
    r, g, b = (int(hexa[i : i + 2], 16) / 255 for i in (1, 3, 5))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _elem(lista: Sequence[ColorDibujo], indice: int) -> ColorDibujo:
    """Un color del arreglo con la semántica de JavaScript: fuera de rango **no existe**.

    JavaScript devuelve ``undefined`` y el dibujo se rompe al leerle el ``hex``; Python, con un índice
    negativo, devolvería el último color y pintaría otra cosa sin avisar. El 1 a 1 incluye el fallo, así que
    aquí se lanza en vez de envolver.
    """
    if indice < 0 or indice >= len(lista):
        raise IndexError(f"color {indice} de {len(lista)}: en JavaScript sería undefined")
    return lista[indice]


# ---------------------------------------------------------------------------
# Tamaños y colores
# ---------------------------------------------------------------------------


def _selector_tamano(
    mezcla: dict[int, float], rnd: Callable[[], float], tope: int = 36
) -> Callable[[], int]:
    """Elige tamaños en la proporción de la ficha; ``tope`` limita el más grande.

    Un centro de mesa no lleva R-36, y el mini aro no pasa de R-9.
    """
    tams = [t for t in _TAMANOS if t <= tope and mezcla[t] > 0]
    if len(tams) == 0:
        return lambda: tope if tope < 12 else 12
    total = 0.0
    for t in tams:
        total += mezcla[t]

    def elegir() -> int:
        x = rnd() * total
        for t in tams:
            x -= mezcla[t]
            if x <= 0:
                return t
        return tams[len(tams) - 1]

    return elegir


class _Punto(TypedDict, total=False):
    """Dónde está un globo, para decidir su color.

    ``t`` es su posición a lo largo del patrón (0–1): de claro a oscuro en un degradado, en orden en un
    arcoíris. ``grupo`` es el racimo o el paso a lo largo de la estructura, ``k`` la posición dentro del
    racimo y ``figura`` si cae dentro de la silueta de un mural.
    """

    t: float
    fila: int
    col: int
    grupo: int
    k: int
    figura: bool


_Pintor = Callable[[_Punto], ColorDibujo]


def _pintor(patron: str | None, paleta: Sequence[ColorDibujo], rnd: Callable[[], float]) -> _Pintor:
    """El color de cada globo según el patrón elegido.

    Sin patrón, los colores van mezclados en proporción a sus cantidades; con uno solo, todo va liso. Pide
    al menos un color: con la paleta vacía lanza, igual que el original (la vista previa de allá no llama a
    ningún dibujo cuando la ficha no tiene globos reconocibles).
    """
    n = len(paleta)
    claro_oscuro = sorted(paleta, key=lambda c: -_claridad(c["hex"]))
    total = 0.0
    for c in paleta:
        total += c["peso"]

    def al_azar(_p: _Punto) -> ColorDibujo:
        x = rnd() * total
        for c in paleta:
            x -= c["peso"]
            if x <= 0:
                return c
        return paleta[n - 1]

    # El dibujo de un mural: la figura en el segundo color (o en uno que contraste) sobre el primero.
    figura: ColorDibujo = (
        paleta[1]
        if n > 1
        else {
            "hex": "#1f2a55" if _claridad(paleta[0]["hex"]) > 0.6 else "#ffffff",
            "acabado": "mate",
            "peso": 1,
        }
    )
    elegido = patron if patron is not None else ("mezclado" if n > 1 else "liso")

    if elegido == "liso":
        return lambda _p: paleta[0]
    if elegido == "franjas":

        def franjas(p: _Punto) -> ColorDibujo:
            crudo = p["fila"] / 2 if "fila" in p else p["t"] * n * 2
            return _elem(paleta, int(_resto(_piso(crudo), n)))

        return franjas
    if elegido == "ajedrez":

        def ajedrez(p: _Punto) -> ColorDibujo:
            suma = _piso(p.get("col", 0) / 2) + _piso(p.get("fila", 0) / 2)
            return _elem(paleta, int(_resto(_resto(suma, 2), n)))

        return ajedrez
    if elegido == "degradado":

        def gradiente(p: _Punto) -> ColorDibujo:
            sitio = _acotar(p["t"] + (rnd() - 0.5) * 0.14, 0, 0.9999)
            return _elem(claro_oscuro, int(_piso(sitio * n)))

        return gradiente
    if elegido in ("arcoiris", "por-zonas"):
        return lambda p: _elem(paleta, int(_piso(_acotar(p["t"], 0, 0.9999) * n)))
    if elegido == "espiral":
        return lambda p: _elem(paleta, int(_resto(p.get("grupo", 0) + p.get("k", 0), n)))
    if elegido == "mural":
        return lambda p: figura if p.get("figura") else paleta[0]
    return al_azar


def _en_corazon(u: float, v: float) -> bool:
    """Un corazón, para el mural: coordenadas 0–1 de la pared, y hacia arriba.

    Dos lóbulos y una punta, y no la curva algebraica del corazón: con globos como píxeles, la muesca de
    arriba tiene que medir casi dos globos para que se lea, y en la curva medía menos de uno.
    """
    x = (u - 0.5) * 2.4
    y = (v - 0.5) * 2.4

    def lobulo(cx: float) -> bool:
        return bool(mate.pow(x - cx, 2) + mate.pow(y - 0.3, 2) <= 0.25)

    punta = y <= 0.3 and y >= -1 and mate.fabs(x) <= (y + 1) / 1.3
    return lobulo(-0.48) or lobulo(0.48) or punta


# ---------------------------------------------------------------------------
# Encuadre y pintado
# ---------------------------------------------------------------------------


def _encuadre(
    w: float, h: float, x0: float, x1: float, y0: float, y1: float, margen: float = 26
) -> Marco:
    """El marco que encaja el rectángulo ``[x0,x1]×[y0,y1]`` (metros) en el lienzo, centrado."""
    escala = _minimo((w - 2 * margen) / (x1 - x0), (h - 2 * margen) / (y1 - y0))
    sobra = (h - 2 * margen - (y1 - y0) * escala) / 2
    return Marco(
        escala=escala,
        piso=h - margen - sobra + y0 * escala,
        cx=w / 2 - ((x0 + x1) / 2) * escala,
        centro=w / 2,
        anchoPx=(x1 - x0) * escala,
        w=w,
        h=h,
    )


# Los `float(...)`, `str(...)` y `bool(...)` de aquí abajo no convierten nada: `mypy` corre con
# `follow_imports = "skip"`, así que lo que viene de `app.motores` y de `app.organico` le llega como
# `Any` y `warn_return_any` lo rechaza. Es la misma envoltura que usa `app/organico/dibujo.py`.
def _X(m: Marco, x: float) -> float:
    return float(m.cx + x * m.escala)


def _Y(m: Marco, y: float) -> float:
    return float(m.piso - y * m.escala)


def _globo(x: float, y: float, r: float, capa: int, t: int, c: ColorDibujo) -> GloboOrg:
    return GloboOrg(
        x=x, y=y, r=r, capa=capa, nominal=t, color=c["hex"], acabado=c["acabado"], indice=0
    )


def _pintar_todo(
    globos: list[GloboOrg], m: Marco, suelo: bool, antes: str = "", despues: str = ""
) -> str:
    """Los globos, con la luz y la sombra del motor orgánico.

    ``antes`` va detrás de todo (el techo, la mesa, el aro de metal); ``despues``, encima (la red).
    """
    base = config_inicial()
    entrada: dict[str, Any] = dict(base)
    entrada["forma"] = {**base["forma"], "suelo": suelo}
    entrada["aspecto"] = {**base["aspecto"], "semilla": 5}
    capas = 1.0
    for g in globos:
        capas = _maximo(capas, g.capa + 1)
    _capturar(globos)
    return antes + str(dibujar(globos, [], [], entrada, m, int(capas))) + despues


def _capturar(globos: Sequence[GloboOrg]) -> None:
    """Anota ``globos`` en la captura de ``con_globos``, si hay una abierta. Fuera de ella no hace nada."""
    captura = _CAPTURA.get()
    if captura is not None:
        captura.extend(globos)


#: Los globos que pinta ``_pintar_todo`` mientras corre ``con_globos``. Un ``ContextVar`` y no un parámetro: así
#: los seis dibujos siguen siendo el puerto 1 a 1 del original (misma firma, mismo orden de azar, mismo SVG) y la
#: captura no cruza hilos ni peticiones.
_CAPTURA: ContextVar[list[GloboOrg] | None] = ContextVar("captura_globos_dibujo", default=None)


def con_globos(dibujo: Callable[[], Dibujo]) -> tuple[Dibujo, list[GloboOrg]]:
    """El dibujo y **los globos que colocó**, en metros (``x`` a lo ancho, ``y`` hacia arriba) y en su orden.

    Para quien necesita los globos y no el SVG (la guía de escena de la imagen, ``app/guia_escena.py``): se leen
    de la misma lista que se pinta, sin volver a parsear el SVG ni repetir la colocación. No cambia el dibujo.

    Los **globos link** de la pared en malla también vienen: el dibujo los pinta como elipses, no como globos,
    y sin ellos la malla se leía como una rejilla de puntos sueltos. Cada uno llega como una hilera de discos
    solapados a lo largo de su eje (``_discos_de_enlace``), en el color del enlace y antes que los nodos, que
    van encima. Los hilos, las varillas, el marco del aro y la red del techo no son globos y no vienen.
    """
    captura: list[GloboOrg] = []
    marca = _CAPTURA.set(captura)
    try:
        resultado = dibujo()
    finally:
        _CAPTURA.reset(marca)
    return resultado, captura


# ---------------------------------------------------------------------------
# Lo que no es globo y se ve: el marco del aro, su poste, su forro (para la guía de escena)
# ---------------------------------------------------------------------------


class LineaDibujo(NamedTuple):
    """Un tramo recto que no es globo (un poste, una cinta), en metros con ``y`` hacia arriba."""

    x1: float
    y1: float
    x2: float
    y2: float
    grosor: float
    hex: str


class ArcoDibujo(NamedTuple):
    """Un arco de circunferencia que no es globo (el marco de un aro). Grados, 0 = derecha, antihorario."""

    cx: float
    cy: float
    r: float
    desde: float
    hasta: float
    grosor: float
    hex: str


class ElipseDibujo(NamedTuple):
    """Una superficie elíptica plana (el forro de un aro, la base de su poste)."""

    cx: float
    cy: float
    rx: float
    ry: float
    hex: str


class PoligonoDibujo(NamedTuple):
    """Una superficie plana (la tela de una media luna, la pesa de un bouquet)."""

    puntos: tuple[tuple[float, float], ...]
    hex: str


ElementoDibujo = LineaDibujo | ArcoDibujo | ElipseDibujo | PoligonoDibujo

#: Lo que ``_estructura`` anota mientras corre ``con_globos_y_estructura``. Igual que ``_CAPTURA``: fuera de una
#: captura no hace nada, así que el SVG y el orden del azar son los mismos con y sin ella.
_CAPTURA_ESTRUCTURA: ContextVar[list[ElementoDibujo] | None] = ContextVar(
    "captura_estructura_dibujo", default=None
)


def _estructura(*elementos: ElementoDibujo) -> None:
    """Anota elementos que no son globo en la captura abierta, si la hay."""
    captura = _CAPTURA_ESTRUCTURA.get()
    if captura is not None:
        captura.extend(elementos)


def con_globos_y_estructura(
    dibujo: Callable[[], Dibujo],
) -> tuple[Dibujo, list[GloboOrg], list[ElementoDibujo]]:
    """Como ``con_globos``, y además **lo que no es globo y se construye de verdad**, en metros y en su orden.

    Hoy lo anotan el círculo (el anillo de metal de cada aro, su poste y su base, el forro del aro «con fondo»
    y la tela de la media luna) y el mini aro del centro de mesa (su anillo y su poste): sin ellos la guía de
    escena dibujaba un aro parcial igual que uno con fondo y un aro doble como dos medias guirnaldas sueltas.
    Son los mismos números con que el dibujo escribe su SVG, antes de pasarlos a píxeles; el SVG no cambia.
    La mesa, los hilos decorativos y la red del techo no se anotan: no son parte de lo que se construye.
    """
    elementos: list[ElementoDibujo] = []
    marca = _CAPTURA_ESTRUCTURA.set(elementos)
    try:
        resultado, globos = con_globos(dibujo)
    finally:
        _CAPTURA_ESTRUCTURA.reset(marca)
    return resultado, globos, elementos


#: Tramos del arco exterior (220°) y del interior (180°) de la media luna capturada como polígono: 37 + 17
#: vértices, dentro del tope de 64 del contrato de la guía.
_TRAMOS_LUNA_EXTERIOR = 36
_TRAMOS_LUNA_INTERIOR = 18


def _media_luna(cx: float, cy: float, radio: float) -> PoligonoDibujo:
    """La tela de la media luna en metros: el ``path`` del dibujo (arco exterior grande, arco interior de vuelta).

    El arco interior pide un radio de ``0,8 R`` entre dos puntos a ``2 R sen 70°`` uno de otro, más de lo que ese
    radio alcanza; SVG lo agranda entonces a la mitad de la cuerda, así que es un semicírculo de radio
    ``R sen 70°`` centrado en la cuerda, que se abre hacia la izquierda (``sweep`` 1 con ``y`` hacia abajo).
    """
    exterior = [
        (cx + radio * mate.cos(a * _G), cy + radio * mate.sin(a * _G))
        for a in (70 + 220 * k / _TRAMOS_LUNA_EXTERIOR for k in range(_TRAMOS_LUNA_EXTERIOR + 1))
    ]
    centro_x = cx + radio * mate.cos(70 * _G)
    radio_int = radio * mate.sin(70 * _G)
    interior = [
        (centro_x + radio_int * mate.cos(a * _G), cy + radio_int * mate.sin(a * _G))
        for a in (270 - 180 * k / _TRAMOS_LUNA_INTERIOR for k in range(1, _TRAMOS_LUNA_INTERIOR))
    ]
    return PoligonoDibujo(tuple(exterior + interior), _TELA)


#: La tela del forro y de la media luna (``#efe9e1`` del original).
_TELA = "#efe9e1"


class _PuntoCurva(NamedTuple):
    """Un punto de una curva guía y su normal (hacia afuera)."""

    x: float
    y: float
    nx: float
    ny: float


def _racimos_en_curva(
    punto: Callable[[float], _PuntoCurva],
    largo: float,
    grosor: float,
    afinar: bool,
    tam: Callable[[], int],
    color: _Pintor,
    rnd: Callable[[], float],
    escala_tam: float = 1,
) -> list[GloboOrg]:
    """Racimos de tamaños mezclados a lo largo de una curva: la manera orgánica de cubrir un aro o una línea."""
    salida: list[GloboOrg] = []
    pasos = int(_maximo(6, _redondear(largo / 0.12)))
    for s in range(pasos + 1):
        q = s / pasos
        perfil = _maximo(0.25, mate.pow(mate.sin(mate.pi * q), 0.55)) if afinar else 1
        p = punto(q)
        n = 2 + int(_redondear(rnd() * 2 * perfil))
        for k in range(n):
            t = tam()
            r = _radio(t) * escala_tam * (0.9 + rnd() * 0.18) * (0.7 + 0.3 * perfil)
            off = (rnd() - 0.5) * grosor * perfil
            x = p.x + p.nx * off + (rnd() - 0.5) * 0.04
            y = p.y + p.ny * off + (rnd() - 0.5) * 0.04
            salida.append(
                _globo(
                    x,
                    y,
                    r,
                    0 if t >= 18 else (1 if t >= 9 else 2),
                    t,
                    color({"t": q, "grupo": s, "k": k}),
                )
            )
    return salida


def _en_aro(
    cx: float, cy: float, ra: float, a0: float, a1: float
) -> Callable[[float], _PuntoCurva]:
    """Un arco de circunferencia como curva para ``_racimos_en_curva``.

    Ángulos en radianes, 0 = derecha, ``y`` hacia arriba.
    """

    def en(q: float) -> _PuntoCurva:
        a = a0 + (a1 - a0) * q
        return _PuntoCurva(cx + mate.cos(a) * ra, cy + mate.sin(a) * ra, mate.cos(a), mate.sin(a))

    return en


# ---------------------------------------------------------------------------
# Pared de globos
# ---------------------------------------------------------------------------


class _Enlace(NamedTuple):
    """Un globo link de la malla: va de ``(x1,y1)`` a ``(x2,y2)`` en metros."""

    x1: float
    y1: float
    x2: float
    y2: float
    c: ColorDibujo


def dibujar_pared(forma: str | None, patron: str | None, d: DatosDibujo) -> Dibujo:
    """La pared de globos: cuadriculada, en rombos, de malla de links u orgánica."""
    W = 2.4
    H = 2.2
    rnd = crear_rng(31)
    # Sin forma, la pared se arma como pide el patrón: un mural, un ajedrez o unas franjas necesitan filas
    # rectas.
    de_filas = (patron if patron is not None else "") in ("mural", "ajedrez", "franjas", "liso")
    tipo = forma if forma is not None else ("cuadriculada" if de_filas else "organica")
    color = _pintor(patron, d["colores"], rnd)
    globos: list[GloboOrg] = []
    ancho = W
    alto = H
    enlaces: list[_Enlace] = []
    # La densidad (``GLOBOS_POR_AREA``): separa los nodos ``1/√c``; en media, ``sep`` es 1 y nada se mueve.
    fd = _factor_densidad(d)
    sep = 1 / mate.sqrt(fd)

    if tipo == "cuadriculada" or tipo == "rombos":
        # Un mural es un dibujo hecho de puntos: con globos grandes la figura no se lee, así que va en R-9
        # como mucho.
        t = (9 if d["dominante"] > 9 else d["dominante"]) if patron == "mural" else d["dominante"]
        r = _radio(t)
        # Estos globos ya se tocan: lo ligero los separa, pero lo lleno no los aprieta más (va en relleno).
        paso = 2 * r * 0.96 * _maximo(1, sep)
        salto = paso * 0.87 if tipo == "rombos" else paso
        cols = int(_maximo(4, _redondear(W / paso)))
        filas = int(_maximo(4, _redondear(H / salto)))
        ancho = cols * paso
        alto = (filas - 1) * salto + 2 * r
        for fi in range(filas):
            corrida = tipo == "rombos" and fi % 2 == 1
            for c in range(cols - (1 if corrida else 0)):
                x = r + c * paso + (paso / 2 if corrida else 0)
                y = r + fi * salto
                u = x / ancho
                v = y / alto
                globos.append(
                    _globo(
                        x,
                        y,
                        r,
                        1,
                        t,
                        color(
                            {
                                "t": 1 - v,
                                "fila": fi,
                                "col": c,
                                "figura": _en_corazon(u, v),
                            }
                        ),
                    )
                )
        if fd > 1:
            # Lujosa: un R-5 de relleno en cada hueco de la rejilla, delante. En la cuadriculada el hueco es el
            # centro de cada cuadro de cuatro globos; en rombos, el centro de cada triángulo que dos vecinos de
            # una fila forman con el de la fila de arriba.
            rr = _radio(5)
            for fi in range(filas - 1):
                corrida = tipo == "rombos" and fi % 2 == 1
                for col in range(cols - 1 - (1 if corrida else 0)):
                    x = r + col * paso + (paso / 2 if corrida else 0) + paso / 2
                    y = r + fi * salto + (salto / 3 if tipo == "rombos" else salto / 2)
                    u = x / ancho
                    v = y / alto
                    globos.append(
                        _globo(
                            x,
                            y,
                            rr,
                            2,
                            5,
                            color(
                                {"t": 1 - v, "fila": fi, "col": col, "figura": _en_corazon(u, v)}
                            ),
                        )
                    )
    elif tipo == "malla-links":
        # Una retícula en diagonal: cada enlace es un globo link; en cada cruce, un globo pequeño.
        s = 0.3 * sep
        cols = int(_redondear(W / s))
        filas = int(_redondear(H / s))
        ancho = cols * s
        alto = filas * s
        nodo: ColorDibujo = (
            d["colores"][1]
            if len(d["colores"]) > 1
            else {
                "hex": mezclar(d["colores"][0]["hex"], "#ffffff", 0.55),
                "acabado": "mate",
                "peso": 1,
            }
        )
        for j in range(filas + 1):
            for i in range(cols + 1):
                if (i + j) % 2 != 0:
                    continue
                x = i * s
                y = j * s
                for di, dj in ((1, 1), (1, -1)):
                    if i + di > cols or j + dj < 0 or j + dj > filas:
                        continue
                    mx = (x + (i + di) * s) / 2
                    my = (y + (j + dj) * s) / 2
                    enlaces.append(
                        _Enlace(
                            x,
                            y,
                            (i + di) * s,
                            (j + dj) * s,
                            color(
                                {
                                    "t": 1 - my / alto,
                                    "fila": j,
                                    "col": i,
                                    "figura": _en_corazon(mx / ancho, my / alto),
                                }
                            ),
                        )
                    )
                globos.append(_globo(x, y, _radio(5), 2, 5, nodo))
    else:
        # Orgánica: racimos de tamaños mezclados, con relieve.
        #
        # Los racimos van en una retícula suelta, así que **sí** tienen fila y columna, y se le pasan al
        # pintor por racimo (no por globo: un racimo partido en dos colores se lee como ruido, no como un
        # cuadro). Sin ellas, `ajedrez` caía en `paleta[(0+0) % 2 % n]` y pintaba toda la pared del primer
        # color, idéntica a `liso` — y las dos se pueden elegir juntas en `variantes.ts`, que ofrece
        # «Orgánica» y «Ajedrez» para la pared. De paso quita un fallo latente de `franjas`, que sin `fila`
        # indexa con `t = 1 - gy / H`, y el recorte admite `gy` hasta 0,08 m por encima de `H`.
        #
        # El cambio es del dueño (`src/lib/referencias/dibujos.ts`) y aquí se replica tal cual.
        tam = _selector_tamano(d["mezcla"], rnd)
        # Los racimos sí se pueden juntar o separar: la densidad mueve su retícula en las dos direcciones.
        paso = 0.33 * sep
        paso_y = paso * 0.8
        y = 0.16
        while y < H - 0.04:
            x = 0.15
            while x < W - 0.04:
                cx0 = x + (rnd() - 0.5) * 0.14
                cy0 = y + (rnd() - 0.5) * 0.12
                n = 3 + int(_piso(rnd() * 3))
                for k in range(n):
                    t = tam()
                    r = _radio(t) * (0.94 + rnd() * 0.12)
                    ang = rnd() * mate.pi * 2
                    dist = 0 if k == 0 else r * (0.7 + rnd() * 0.5)
                    gx = cx0 + mate.cos(ang) * dist
                    gy = cy0 + mate.sin(ang) * dist
                    if gx - r < -0.06 or gx + r > W + 0.06 or gy - r < -0.01 or gy + r > H + 0.08:
                        continue
                    globos.append(
                        _globo(
                            gx,
                            gy,
                            r,
                            0 if t >= 18 else (1 if t >= 9 else 2),
                            t,
                            color(
                                {
                                    "t": 1 - gy / H,
                                    "grupo": int(_redondear(x / paso)),
                                    "col": int(_redondear(x / paso)),
                                    "fila": int(_redondear(y / paso_y)),
                                    "k": k,
                                    "figura": _en_corazon(gx / W, gy / H),
                                }
                            ),
                        )
                    )
                x += paso
            y += paso * 0.8

    w = 600
    h = 560
    m = _encuadre(w, h, -0.12, ancho + 0.12, 0, alto + 0.12)
    # Los enlaces van detrás de los globos de los cruces.
    grad: dict[str, str] = {}
    lineas = ""
    for e in enlaces:
        ident = f"vpl{e.c['hex'][1:]}"
        if ident not in grad:
            grad[ident] = degradado(ident, e.c["hex"], e.c["acabado"])
        cx = _X(m, (e.x1 + e.x2) / 2)
        cy = _Y(m, (e.y1 + e.y2) / 2)
        largo = mate.hypot(e.x2 - e.x1, e.y2 - e.y1) * m.escala
        ang = (-mate.atan2(e.y2 - e.y1, e.x2 - e.x1) * 180) / mate.pi
        lineas += (
            f'<ellipse cx="{_f(cx)}" cy="{_f(cy)}" rx="{_f(largo * 0.47)}"'
            f' ry="{_f(largo * 0.15)}" transform="rotate({_f(ang)} {_f(cx)} {_f(cy)})"'
            f' fill="url(#{ident})" stroke="{mezclar(e.c["hex"], "#000000", 0.45)}"'
            f' stroke-opacity="0.5" stroke-width="0.8"/>'
        )
    defs = f"<defs>{''.join(grad.values())}</defs>" if len(grad) > 0 else ""
    if _CAPTURA.get() is not None:
        # Solo para la captura: el SVG de arriba no cambia y no se consume azar.
        _capturar([disco for e in enlaces for disco in _discos_de_enlace(e)])
    return {"svg": _pintar_todo(globos, m, True, defs + lineas), "ancho": w, "alto": h}


#: Semiejes de la elipse con que se pinta un enlace, en fracción de su largo (los ``0.47`` y ``0.15`` de arriba).
_ENLACE_LARGO = 0.47
_ENLACE_ANCHO = 0.15
#: Distancia máxima entre centros de dos discos seguidos de un enlace, en radios: por debajo de 2 se solapan,
#: y con 1,5 la hilera se lee como un cuerpo continuo y no como cuentas.
_ENLACE_PASO = 1.5
#: Capa de los discos de un enlace: detrás de los nodos (capa 2), como en el dibujo.
_ENLACE_CAPA = 1


def _discos_de_enlace(e: _Enlace) -> list[GloboOrg]:
    """Un globo link como una hilera de discos solapados que cubre su elipse, en metros.

    El radio es el semieje corto de la elipse; los discos de las puntas tocan las puntas de la elipse. ``nominal``
    va en 0 porque un link no es un redondo del catálogo y estos discos no se cuentan en ninguna parte.
    """
    largo = mate.hypot(e.x2 - e.x1, e.y2 - e.y1)
    r = largo * _ENLACE_ANCHO
    tramo = 2 * (largo * _ENLACE_LARGO - r)
    n = 1 + int(mate.ceil(tramo / (r * _ENLACE_PASO))) if tramo > 0 and r > 0 else 1
    cx = (e.x1 + e.x2) / 2
    cy = (e.y1 + e.y2) / 2
    ux = (e.x2 - e.x1) / largo if largo > 0 else 0.0
    uy = (e.y2 - e.y1) / largo if largo > 0 else 0.0
    discos: list[GloboOrg] = []
    for k in range(n):
        o = (k / (n - 1) - 0.5) * tramo if n > 1 else 0.0
        discos.append(
            GloboOrg(
                x=cx + ux * o,
                y=cy + uy * o,
                r=r,
                capa=_ENLACE_CAPA,
                nominal=0,
                color=e.c["hex"],
                acabado=e.c["acabado"],
                indice=0,
            )
        )
    return discos


# ---------------------------------------------------------------------------
# Círculo (aro)
# ---------------------------------------------------------------------------


class _Aro(NamedTuple):
    """Un aro del dibujo: centro y radio en metros."""

    cx: float
    cy: float
    ra: float


def dibujar_circulo(forma: str | None, patron: str | None, d: DatosDibujo) -> Dibujo:
    """El círculo (aro): orgánico, parcial, con fondo, clásico de cuartetos, doble o media luna."""
    rnd = crear_rng(17)
    tam = _selector_tamano(d["mezcla"], rnd)
    color = _pintor(patron, d["colores"], rnd)
    tipo = forma if forma is not None else "organico"
    globos: list[GloboOrg] = []
    # La densidad (``GLOBOS_POR_AREA``): la guirnalda del aro lleva ``c`` veces más racimos a lo largo de su
    # curva (el largo que se le pasa a ``_racimos_en_curva``) y el aro clásico ``round(n · c)`` cuartetos. La
    # curva y el marco no se mueven; en media, ``c`` es 1 y el dibujo es el de siempre.
    fd = _factor_densidad(d)
    # Los aros del dibujo: centro, radio, y si lleva forro.
    aros: list[_Aro] = []
    luna = False

    if tipo == "doble":
        aros.append(_Aro(-0.62, 1.02, 0.72))
        aros.append(_Aro(0.62, 1.02, 0.72))
        globos.extend(
            _racimos_en_curva(
                _en_aro(-0.62, 1.02, 0.72, 140 * _G, 320 * _G),
                0.72 * mate.pi * fd,
                0.3,
                True,
                tam,
                color,
                rnd,
            )
        )
        globos.extend(
            _racimos_en_curva(
                _en_aro(0.62, 1.02, 0.72, -40 * _G, 140 * _G),
                0.72 * mate.pi * fd,
                0.3,
                True,
                tam,
                color,
                rnd,
            )
        )
    elif tipo == "media-luna":
        luna = True
        globos.extend(
            _racimos_en_curva(
                _en_aro(0, 1.25, 1, 70 * _G, 290 * _G),
                (220 * _G) * 1 * fd,
                0.36,
                True,
                tam,
                color,
                rnd,
            )
        )
    elif tipo == "clasico":
        # Aro de cuartetos: un tubo parejo de globos iguales; en espiral, los colores giran alrededor del aro.
        aros.append(_Aro(0, 1.25, 1))
        t = d["dominante"]
        r = _radio(t)
        pasos = _con_densidad(int(_redondear((2 * mate.pi * 1) / (r * 1.5))), fd)
        for s in range(pasos):
            a = (2 * mate.pi * s) / pasos
            desplazados: tuple[float, ...] = (-0.62, 0.62) if s % 2 == 0 else (-1, 0, 1)
            for k, o in enumerate(desplazados):
                ra = 1 + o * r * 0.95
                globos.append(
                    _globo(
                        mate.cos(a) * ra,
                        1.25 + mate.sin(a) * ra,
                        r,
                        2 if o == 0 else 1,
                        t,
                        color({"t": s / pasos, "grupo": s, "k": k}),
                    )
                )
    else:
        aros.append(_Aro(0, 1.25, 1))
        if tipo == "parcial" or tipo == "con-fondo":
            globos.extend(
                _racimos_en_curva(
                    _en_aro(0, 1.25, 1, 150 * _G, 330 * _G),
                    mate.pi * fd,
                    0.34,
                    True,
                    tam,
                    color,
                    rnd,
                )
            )
        else:
            globos.extend(
                _racimos_en_curva(
                    _en_aro(0, 1.25, 1, 0, 2 * mate.pi),
                    2 * mate.pi * fd,
                    0.32,
                    False,
                    tam,
                    color,
                    rnd,
                )
            )

    w = 600
    h = 600
    m = _encuadre(w, h, -1.45, 1.45, 0, 2.45)
    fondo = ""
    trazo = _f(_maximo(2.5, m.escala * 0.03))
    # El grosor del marco en metros, para la guía de escena: el mismo trazo antes de pasarlo a píxeles.
    grosor_m = float(_maximo(2.5, m.escala * 0.03) / m.escala)
    for aro in aros:
        cx = _X(m, aro.cx)
        cy = _Y(m, aro.cy)
        rp = aro.ra * m.escala
        if tipo == "con-fondo":
            _estructura(ElipseDibujo(aro.cx, aro.cy, aro.ra, aro.ra, _TELA))
        _estructura(
            ArcoDibujo(aro.cx, aro.cy, aro.ra, 0, 360, grosor_m, _MARCO_METAL),
            LineaDibujo(aro.cx, aro.cy - aro.ra, aro.cx, 0, grosor_m, _MARCO_METAL),
            ElipseDibujo(aro.cx, 0, 0.28, 0.05, _MARCO_METAL),
        )
        if tipo == "con-fondo":
            fondo += (
                f'<circle cx="{_f(cx)}" cy="{_f(cy)}" r="{_f(rp)}" fill="#efe9e1"'
                f' fill-opacity="0.92"/>'
            )
        fondo += (
            f'<circle cx="{_f(cx)}" cy="{_f(cy)}" r="{_f(rp)}" fill="none"'
            f' stroke="{_MARCO_METAL}" stroke-width="{trazo}" stroke-opacity="0.8"/>'
        )
        # El soporte: un poste del aro al piso y una base.
        fondo += (
            f'<line x1="{_f(cx)}" y1="{_f(cy + rp)}" x2="{_f(cx)}" y2="{_f(m.piso)}"'
            f' stroke="{_MARCO_METAL}" stroke-width="{trazo}" stroke-opacity="0.8"/>'
        )
        fondo += (
            f'<ellipse cx="{_f(cx)}" cy="{_f(m.piso)}" rx="{_f(0.28 * m.escala)}"'
            f' ry="{_f(0.05 * m.escala)}" fill="{_MARCO_METAL}" fill-opacity="0.55"/>'
        )
    if luna:
        # Una luna creciente: el marco de medio aro relleno de tela, abierta hacia la derecha.
        cx = _X(m, 0)
        cy = _Y(m, 1.25)
        R = 1 * m.escala
        r2 = 0.8 * m.escala
        desp = 0.42 * m.escala
        tela = _media_luna(0, 1.25, 1)
        _estructura(
            tela,
            ArcoDibujo(0, 1.25, 1, 70, 290, grosor_m, _MARCO_METAL),
            ArcoDibujo(
                float(mate.cos(70 * _G)),
                1.25,
                float(mate.sin(70 * _G)),
                90,
                270,
                grosor_m,
                _MARCO_METAL,
            ),
            LineaDibujo(-0.35, 1.25 - 0.85, -0.35, 0, grosor_m, _MARCO_METAL),
        )
        fondo += (
            f'<path d="M{_f(cx + R * mate.cos(70 * _G))} {_f(cy - R * mate.sin(70 * _G))}'
            f"A{_f(R)} {_f(R)} 0 1 0 {_f(cx + R * mate.cos(70 * _G))}"
            f" {_f(cy + R * mate.sin(70 * _G))}A{_f(r2)} {_f(r2)} 0 1 1"
            f' {_f(cx + R * mate.cos(70 * _G))} {_f(cy - R * mate.sin(70 * _G))}Z"'
            f' fill="#efe9e1" fill-opacity="0.9" stroke="{_MARCO_METAL}" stroke-width="{trazo}"'
            f' transform="translate({_f(-desp * 0.05)} 0)"/>'
        )
        fondo += (
            f'<line x1="{_f(cx - R * 0.35)}" y1="{_f(cy + R * 0.85)}" x2="{_f(cx - R * 0.35)}"'
            f' y2="{_f(m.piso)}" stroke="{_MARCO_METAL}" stroke-width="{trazo}"/>'
        )
    return {"svg": _pintar_todo(globos, m, True, fondo), "ancho": w, "alto": h}


# ---------------------------------------------------------------------------
# Techo de globos
# ---------------------------------------------------------------------------


class _Hilo(NamedTuple):
    """Un hilo o una cinta del techo. ``rizo`` la hace ondular al bajar."""

    x1: float
    y1: float
    x2: float
    y2: float
    rizo: bool
    c: str


class _Piso(NamedTuple):
    """Un piso del candelabro: su altura, su radio, cuántos globos y de qué tamaño."""

    y: float
    rx: float
    n: int
    t: int


def dibujar_techo(forma: str | None, patron: str | None, d: DatosDibujo) -> Dibujo:
    """El techo de globos: helio con cintas, colgantes, nube, malla, candelabro o cortina."""
    ANCHO = 4
    TECHO = 2.6
    rnd = crear_rng(23)
    tam = _selector_tamano(d["mezcla"], rnd)
    color = _pintor(patron, d["colores"], rnd)
    tipo = forma if forma is not None else "helio"
    globos: list[GloboOrg] = []
    hilos: list[_Hilo] = []
    red = False
    # La densidad (``GLOBOS_POR_AREA``): cada forma del techo se cuenta por piezas y lleva ``round(n · c)``.
    fd = _factor_densidad(d)

    if tipo == "colgantes":
        n = _con_densidad(13, fd)
        for i in range(n):
            x = 0.2 + (i * 3.6) / _maximo(1, n - 1) + (rnd() - 0.5) * 0.1
            t = tam()
            r = _radio(t)
            y = 1.45 + rnd() * 0.9
            c = color({"t": x / ANCHO, "grupo": i})
            hilos.append(_Hilo(x, y + r, x, TECHO, False, "#aab4af"))
            globos.append(_globo(x, y, r, 0 if rnd() < 0.5 else 1, t, c))
    elif tipo == "nube":
        por_nube = _con_densidad(14, fd)
        for i, cx0 in enumerate((0.75, 2.0, 3.25)):
            for k in range(por_nube):
                t = tam()
                r = _radio(t)
                a = rnd() * mate.pi * 2
                q = mate.sqrt(rnd())
                x = cx0 + (rnd() - 0.5) * 0.12 + mate.cos(a) * q * 0.5
                y = _minimo(TECHO - r * 0.85, TECHO - 0.24 + mate.sin(a) * q * 0.2)
                globos.append(
                    _globo(
                        x,
                        y,
                        r,
                        0 if t >= 18 else (1 if t >= 9 else 2),
                        t,
                        color({"t": x / ANCHO, "grupo": i, "k": k}),
                    )
                )
    elif tipo == "malla":
        red = True
        t = d["dominante"]
        r = _radio(t)
        paso = 2 * r * 0.96
        for fi in range(_con_densidad(3, fd)):
            x = r + (paso / 2 if fi % 2 else 0)
            while x < ANCHO - r * 0.5:
                globos.append(
                    _globo(
                        x,
                        TECHO - r - fi * paso * 0.87,
                        r,
                        2 - fi,
                        t,
                        color({"t": x / ANCHO, "fila": fi, "col": int(_redondear(x / paso))}),
                    )
                )
                x += paso
    elif tipo == "candelabro":
        cx = 2
        hilos.append(_Hilo(cx, 1.3, cx, TECHO, False, "#aab4af"))
        pisos = (
            _Piso(2.25, 0.62, _con_densidad(14, fd), 12),
            _Piso(1.95, 0.45, _con_densidad(11, fd), 12),
            _Piso(1.68, 0.28, _con_densidad(8, fd), 9),
        )
        for i, p in enumerate(pisos):
            for k in range(p.n):
                a = (2 * mate.pi * k) / p.n
                x = cx + mate.cos(a) * p.rx
                y = p.y + mate.sin(a) * 0.09
                globos.append(
                    _globo(
                        x,
                        y,
                        _radio(p.t),
                        0 if mate.sin(a) > 0 else 2,
                        p.t,
                        color({"t": i / 3, "grupo": i, "k": k}),
                    )
                )
        for k in range(3):
            globos.append(
                _globo(cx, 1.5 - k * 0.12, _radio(9), 2, 9, color({"t": 0.9, "grupo": 3, "k": k}))
            )
    elif tipo == "cortina":
        tiras = int(_maximo(2, _con_densidad(12, fd)))
        for i in range(tiras):
            x = 0.22 + (i * 3.56) / (tiras - 1)
            largo = 0.9 + rnd() * 0.75
            hilos.append(_Hilo(x, TECHO - largo, x, TECHO, False, "#aab4af"))
            y = float(TECHO)
            k = 0
            while y > TECHO - largo:
                t = 9 if rnd() < 0.6 else 5
                r = _radio(t)
                y -= r
                globos.append(
                    _globo(
                        x + (rnd() - 0.5) * 0.03,
                        y,
                        r,
                        1,
                        t,
                        color({"t": i / (tiras - 1), "grupo": i, "k": k}),
                    )
                )
                k += 1
                y -= r * 0.9
    else:
        # Helio con cintas: los globos contra el techo y las cintas rizadas colgando.
        n = _con_densidad(16, fd)
        for i in range(n):
            x = 0.15 + (i * 3.7) / _maximo(1, n - 1) + (rnd() - 0.5) * 0.12
            t = tam()
            r = _radio(t)
            y = TECHO - r - rnd() * 0.04
            c = color({"t": x / ANCHO, "grupo": i})
            hilos.append(
                _Hilo(
                    x,
                    y - r,
                    x + (rnd() - 0.5) * 0.2,
                    1.05 + rnd() * 0.5,
                    True,
                    mezclar(c["hex"], "#ffffff", 0.35),
                )
            )
            globos.append(_globo(x, y, r, 0 if rnd() < 0.5 else 1, t, c))

    w = 640
    h = 420
    m = _encuadre(w, h, -0.1, ANCHO + 0.1, 0.95, TECHO + 0.16, 18)
    grosor = _f(_maximo(1, m.escala * 0.006))
    # El techo: una franja arriba, para que se lea que cuelgan de algo.
    antes = (
        f'<rect x="0" y="0" width="{_numero(w)}" height="{_f(_Y(m, TECHO))}" fill="#2a312e"/>'
        f'<line x1="0" y1="{_f(_Y(m, TECHO))}" x2="{_numero(w)}" y2="{_f(_Y(m, TECHO))}"'
        f' stroke="#6b7a73" stroke-width="2"/>'
    )
    for hl in hilos:
        if not hl.rizo:
            antes += (
                f'<line x1="{_f(_X(m, hl.x1))}" y1="{_f(_Y(m, hl.y1))}"'
                f' x2="{_f(_X(m, hl.x2))}" y2="{_f(_Y(m, hl.y2))}" stroke="{hl.c}"'
                f' stroke-opacity="0.55" stroke-width="{grosor}"/>'
            )
            continue
        # Cinta rizada: una línea que ondula al bajar.
        pasos = 18
        d0 = ""
        for s in range(pasos + 1):
            q = s / pasos
            x = hl.x1 + (hl.x2 - hl.x1) * q + mate.sin(q * 14) * 0.025
            y = hl.y1 + (hl.y2 - hl.y1) * q
            d0 += f"{'M' if s == 0 else 'L'}{_f(_X(m, x))} {_f(_Y(m, y))}"
        antes += (
            f'<path d="{d0}" fill="none" stroke="{hl.c}" stroke-opacity="0.8"'
            f' stroke-width="{grosor}"/>'
        )
    despues = ""
    if red:
        # La red por encima de la capa de globos.
        y0 = _Y(m, TECHO)
        y1 = _Y(m, TECHO - 0.75)
        x = -0.8
        while x < ANCHO + 0.8:
            despues += (
                f'<line x1="{_f(_X(m, x))}" y1="{_f(y0)}" x2="{_f(_X(m, x + 0.75))}"'
                f' y2="{_f(y1)}" stroke="#e6ece8" stroke-opacity="0.28" stroke-width="1"/>'
            )
            despues += (
                f'<line x1="{_f(_X(m, x + 0.75))}" y1="{_f(y0)}" x2="{_f(_X(m, x))}"'
                f' y2="{_f(y1)}" stroke="#e6ece8" stroke-opacity="0.28" stroke-width="1"/>'
            )
            x += 0.28
    return {"svg": _pintar_todo(globos, m, False, antes, despues), "ancho": w, "alto": h}


# ---------------------------------------------------------------------------
# Centro de mesa
# ---------------------------------------------------------------------------


class _Linea(NamedTuple):
    """Un hilo, una varilla o un palito del centro de mesa. ``curva`` lo dibuja como una cinta."""

    x1: float
    y1: float
    x2: float
    y2: float
    c: str
    ancho: float
    curva: bool = False


def dibujar_centro(forma: str | None, patron: str | None, d: DatosDibujo) -> Dibujo:
    """El centro de mesa: bouquet de helio, base baja, burbuja, figura, topiario, varillas o mini aro."""
    MESA = 0.75
    rnd = crear_rng(41)
    tam = _selector_tamano(d["mezcla"], rnd, 12)
    color = _pintor(patron, d["colores"], rnd)
    tipo = forma if forma is not None else "helio"
    globos: list[GloboOrg] = []
    lineas: list[_Linea] = []
    piezas = ""
    w = 600
    h = 600
    m = _encuadre(w, h, -0.78, 0.78, 0.3, 1.95)

    def px(x: float) -> str:
        return _f(_X(m, x))

    def py(y: float) -> str:
        return _f(_Y(m, y))

    # La densidad (``GLOBOS_POR_AREA``): lo que el centro cuenta por piezas lleva ``round(n · c)``. El bouquet
    # de helio ya coloca ``redondos``, que es el total de la pieza, y la burbuja es un globo: esos no cambian.
    fd = _factor_densidad(d)

    if tipo == "base":
        for k in range(_con_densidad(16, fd)):
            t = tam()
            r = _radio(t)
            a = mate.pi * rnd()
            q = mate.sqrt(rnd())
            x = mate.cos(a) * q * 0.32
            y = MESA + r + mate.sin(a) * q * 0.16
            globos.append(
                _globo(
                    x,
                    y,
                    r,
                    2 if y < MESA + 0.12 else 1,
                    t,
                    color({"t": (x + 0.32) / 0.64, "grupo": k}),
                )
            )
    elif tipo == "burbuja":
        piezas += (
            f'<rect x="{px(-0.07)}" y="{py(MESA + 0.06)}" width="{_f(0.14 * m.escala)}"'
            f' height="{_f(0.06 * m.escala)}" rx="3" fill="#d9d4cc"/>'
        )
        lineas.append(_Linea(0, MESA + 0.06, 0, MESA + 0.18, "#d9d4cc", 3))
        c = d["colores"][0]
        globos.append(
            GloboOrg(
                x=0,
                y=MESA + 0.18 + 0.3,
                r=0.3,
                capa=1,
                nominal=24,
                color=c["hex"],
                acabado="confeti",
                indice=0,
            )
        )
        for k in range(3):
            globos.append(
                _globo(
                    -0.12 + k * 0.12,
                    MESA + _radio(5),
                    _radio(5),
                    2,
                    5,
                    color({"t": k / 3, "grupo": k}),
                )
            )
    elif tipo == "figura":
        # Un corazón de globos pequeños sobre un palito.
        s = 0.021
        pasos = _con_densidad(30, fd)
        for k in range(pasos):
            u = (2 * mate.pi * k) / pasos
            hx = 16 * mate.pow(mate.sin(u), 3)
            hy = 13 * mate.cos(u) - 5 * mate.cos(2 * u) - 2 * mate.cos(3 * u) - mate.cos(4 * u)
            globos.append(
                _globo(hx * s, 1.32 + hy * s, _radio(5), 1, 5, color({"t": k / pasos, "grupo": k}))
            )
            globos.append(
                _globo(
                    hx * s * 0.6,
                    1.32 + hy * s * 0.6,
                    _radio(5),
                    2,
                    5,
                    color({"t": k / pasos, "grupo": k, "k": 1}),
                )
            )
        lineas.append(_Linea(0, MESA + 0.04, 0, 1.32 - 17 * s, "#cfc6b8", 3))
        piezas += (
            f'<rect x="{px(-0.08)}" y="{py(MESA + 0.04)}" width="{_f(0.16 * m.escala)}"'
            f' height="{_f(0.04 * m.escala)}" rx="3" fill="#d9d4cc"/>'
        )
    elif tipo == "topiario":
        piezas += (
            f'<path d="M{px(-0.1)} {py(MESA + 0.16)}L{px(0.1)} {py(MESA + 0.16)}L{px(0.07)}'
            f' {py(MESA)}L{px(-0.07)} {py(MESA)}Z" fill="#b0643f"/>'
        )
        lineas.append(_Linea(0, MESA + 0.16, 0, 1.22, "#8a6a48", 4))
        # La bola: globos pequeños repartidos en espiral de girasol; los del centro quedan al frente.
        bola = _con_densidad(34, fd)
        for k in range(bola):
            q = mate.sqrt((k + 0.5) / bola)
            a = k * 2.39996
            x = mate.cos(a) * q * 0.2
            y = 1.4 + mate.sin(a) * q * 0.2
            globos.append(
                _globo(
                    x,
                    y,
                    _radio(5) * 1.1,
                    2 if q < 0.55 else (1 if q < 0.85 else 0),
                    5,
                    color({"t": (y - 1.2) / 0.4, "grupo": k}),
                )
            )
    elif tipo == "varillas":
        piezas += (
            f'<path d="M{px(-0.06)} {py(MESA)}L{px(0.06)} {py(MESA)}L{px(0.02)}'
            f' {py(MESA + 0.1)}L{px(-0.02)} {py(MESA + 0.1)}Z" fill="#d9d4cc"/>'
        )
        varillas = int(_maximo(2, _con_densidad(7, fd)))
        for k in range(varillas):
            a = (-50 + (k * 100) / (varillas - 1)) * _G
            largo = 0.55 + rnd() * 0.22
            x = mate.sin(a) * largo
            y = MESA + 0.1 + mate.cos(a) * largo
            lineas.append(_Linea(0, MESA + 0.1, x, y, "#d9d4cc", 2))
            t = tam()
            globos.append(
                _globo(
                    x,
                    y + _radio(t) * 0.9,
                    _radio(t),
                    k % 2,
                    t,
                    color({"t": k / (varillas - 1), "grupo": k}),
                )
            )
    elif tipo == "mini-aro":
        cy = MESA + 0.08 + 0.3
        piezas += (
            f'<circle cx="{px(0)}" cy="{py(cy)}" r="{_f(0.3 * m.escala)}" fill="none"'
            f' stroke="{_MARCO_METAL}" stroke-width="3"/>'
        )
        lineas.append(_Linea(0, MESA, 0, cy - 0.3, _MARCO_METAL, 3))
        # Para la guía de escena: el anillo y el poste del mini aro (3 px de trazo, en metros).
        _estructura(
            ArcoDibujo(0, cy, 0.3, 0, 360, float(3 / m.escala), _MARCO_METAL),
            LineaDibujo(0, MESA, 0, cy - 0.3, float(3 / m.escala), _MARCO_METAL),
        )
        globos.extend(
            _racimos_en_curva(
                _en_aro(0, cy, 0.3, 160 * _G, 330 * _G),
                0.3 * mate.pi * fd,
                0.12,
                True,
                _selector_tamano(d["mezcla"], rnd, 9),
                color,
                rnd,
                0.8,
            )
        )
    else:
        # Bouquet de helio: de tres a siete globos flotando, atados a una pesa sobre la mesa.
        n = int(_maximo(3, _minimo(7, d["redondos"] if d["redondos"] else 5)))
        for k in range(n):
            t = tam()
            r = _radio(t) * 1.15
            x = (k - (n - 1) / 2) * 0.17 + (rnd() - 0.5) * 0.05
            y = 1.45 + ((k * 7) % 3) * 0.12 + rnd() * 0.08
            lineas.append(_Linea(x, y - r, 0, MESA + 0.07, "#d8d2c8", 1.2, True))
            globos.append(_globo(x, y, r, k % 2, t, color({"t": k / n, "grupo": k})))
        piezas += (
            f'<rect x="{px(-0.05)}" y="{py(MESA + 0.08)}" width="{_f(0.1 * m.escala)}"'
            f' height="{_f(0.08 * m.escala)}" rx="4" fill="#d4af37"/>'
        )

    # La mesa: tablero y mantel, detrás de todo.
    antes = (
        f'<rect x="{px(-0.72)}" y="{py(MESA)}" width="{_f(1.44 * m.escala)}"'
        f' height="{_f((MESA - 0.33) * m.escala)}" rx="6" fill="#dcd6cc" fill-opacity="0.9"/>'
    )
    antes += (
        f'<rect x="{px(-0.74)}" y="{_f(_Y(m, MESA) - 4)}" width="{_f(1.48 * m.escala)}"'
        f' height="6" rx="3" fill="#f3efe8"/>'
    )
    for ln in lineas:
        antes += (
            (
                f'<path d="M{px(ln.x1)} {py(ln.y1)}Q{px((ln.x1 + ln.x2) / 2 + 0.04)}'
                f' {py((ln.y1 + ln.y2) / 2)} {px(ln.x2)} {py(ln.y2)}" fill="none"'
                f' stroke="{ln.c}" stroke-width="{_numero(ln.ancho)}"/>'
            )
            if ln.curva
            else (
                f'<line x1="{px(ln.x1)}" y1="{py(ln.y1)}" x2="{px(ln.x2)}" y2="{py(ln.y2)}"'
                f' stroke="{ln.c}" stroke-width="{_numero(ln.ancho)}"/>'
            )
        )
    return {"svg": _pintar_todo(globos, m, False, antes + piezas), "ancho": w, "alto": h}


# ---------------------------------------------------------------------------
# Arco perlado
# ---------------------------------------------------------------------------


class _Muestra(NamedTuple):
    """Un punto de la herradura del arco perlado, en metros."""

    x: float
    y: float


def _color_perla(patron: str | None, paleta: Sequence[ColorDibujo], i: int, n: int) -> ColorDibujo:
    """El reparto de colores de una sarta de globos sueltos, con los patrones del arco clásico."""
    k = len(paleta)
    claro_oscuro = sorted(paleta, key=lambda c: -_claridad(c["hex"]))
    if patron == "liso":
        return paleta[0]
    if patron == "zigzag":
        return _elem(paleta, int(_resto(_piso(i / 2), k)))
    if patron == "franjas":
        return _elem(paleta, int(_resto(_piso(i / 4), k)))
    if patron == "degradado":
        return _elem(claro_oscuro, int(_minimo(k - 1, _piso((i / n) * k))))
    if patron == "arcoiris":
        return _elem(paleta, int(_minimo(k - 1, _piso((i / n) * k))))
    if patron == "punteado":
        return _elem(paleta, int(_resto(1, k))) if i % 4 == 2 else paleta[0]
    return _elem(paleta, int(_resto(i, k)))


def dibujar_arco_perlado(patron: str | None, d: DatosDibujo) -> Dibujo:
    """El arco perlado: una sarta de globos sueltos, separados como perlas en un hilo."""
    W = 4
    H = 2.5
    patas = 0.8
    t = d["dominante"]
    r = _radio(t)
    # La curva: dos patas rectas y una media elipse arriba, como la herradura del diseñador.
    muestras: list[_Muestra] = []
    y = 0.0
    while y <= patas:
        muestras.append(_Muestra(-W / 2 + r, y))
        y += 0.02
    for s in range(201):
        a = mate.pi - (mate.pi * s) / 200
        muestras.append(_Muestra(mate.cos(a) * (W / 2 - r), patas + mate.sin(a) * (H - patas - r)))
    y = patas
    while y >= 0:
        muestras.append(_Muestra(W / 2 - r, y))
        y -= 0.02
    # Un globo cada diámetro y un poco: separados, como perlas en un hilo.
    puntos: list[_Muestra] = []
    acumulado = 0.0
    paso = 2 * r + 0.07
    for i in range(1, len(muestras)):
        acumulado += mate.hypot(
            muestras[i].x - muestras[i - 1].x, muestras[i].y - muestras[i - 1].y
        )
        if len(puntos) == 0 or acumulado >= paso:
            puntos.append(muestras[i])
            acumulado = 0
    globos = [
        _globo(p.x, p.y + r * 0.4, r, 1, t, _color_perla(patron, d["colores"], i, len(puntos)))
        for i, p in enumerate(puntos)
    ]
    w = 600
    h = 600
    m = _encuadre(w, h, -W / 2 - 0.1, W / 2 + 0.1, 0, H + 0.1)
    hilo = "".join(
        f"{'M' if i == 0 else 'L'}{_f(_X(m, p.x))} {_f(_Y(m, p.y + r * 0.4))}"
        for i, p in enumerate(muestras)
    )
    return {
        "svg": _pintar_todo(
            globos,
            m,
            True,
            f'<path d="{hilo}" fill="none" stroke="#cfd6d2" stroke-opacity="0.6"'
            f' stroke-width="1.5"/>',
        ),
        "ancho": w,
        "alto": h,
    }


def con_numero(svg: str, w: float, h: float, paleta: Sequence[ColorDibujo]) -> str:
    """Un número metalizado encima de una columna: el motor de la columna no los dibuja.

    Se achica el dibujo para hacerle sitio arriba y se pone la cifra con un degradado de foil (dorado, o el
    metal de la ficha si lo tiene).
    """
    metal = next((c["hex"] for c in paleta if c["acabado"] == "cromado"), "#d4af37")
    s = 0.8
    tx = (w * (1 - s)) / 2
    ty = h * (1 - s)
    alto = h * 0.2
    return (
        f'<defs><linearGradient id="vpnum" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{mezclar(metal, "#ffffff", 0.6)}"/>'
        f'<stop offset="0.5" stop-color="{metal}"/>'
        f'<stop offset="1" stop-color="{mezclar(metal, "#000000", 0.35)}"/>'
        f"</linearGradient></defs>"
        f'<g transform="translate({_f(tx)} {_f(ty)}) scale({_numero(s)})">{svg}</g>'
        f'<text x="{_f(w / 2)}" y="{_f(ty + h * 0.05)}" text-anchor="middle"'
        f' font-family="Arial Black, Arial, sans-serif" font-weight="900"'
        f' font-size="{_f(alto)}" fill="url(#vpnum)"'
        f' stroke="{mezclar(metal, "#000000", 0.45)}" stroke-width="2">1</text>'
    )
