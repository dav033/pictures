"""El motor del bouquet: dónde queda cada globo y cómo se dibuja el ramo.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/bouquet/motor.ts``.

La separación entre ``crear_disposicion`` (dónde va cada globo) y ``pintar`` (de qué color y cómo se ve) es la
que hace que cambiar un color repinte sin volver a acomodar nada, igual que en los demás motores.

Del motor compartido (``app.organico``) solo se reusan dos cosas: el reparto de colores (``colorear``, sobre una
línea guía vertical imaginaria) y la regla con la persona de 1,70 m (``referencias``). La colocación, las
medidas y el SVG son propios del ramo.

Los números del SVG se escriben con ``_f``/``_numero`` de ``app.motores.js``: el dibujo tiene que salir con el
mismo sha256 que el original.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass, fields
from typing import Any, TypedDict, cast

from app.bouquet.tipos import ConfigRamo, Especial
from app.motores import mate
from app.motores.canonico import resolver_colores
from app.motores.js import (
    _maximo,
    _minimo,
    _numero,
    _piso,
    _redondear,
    crear_rng,
    mezclar,
)
from app.organico.dibujo import Marco, degradado, referencias
from app.organico.espina import Espina, PuntoEspina
from app.organico.motor import B, colorear
from app.organico.tipos import TAMANOS_GLOBO, diametro_m

__all__ = [
    "LIENZO_RAMO",
    "MAX_POR_NIVEL",
    "PESO_ALTO",
    "PESO_ESCALA_SUELO",
    "Disposicion",
    "GloboRamo",
    "ItemRamo",
    "OpcionesRamo",
    "ResultadoRamo",
    "crear_disposicion",
    "generar",
    "peso_alto_de",
    "pintar",
    "svg_documento",
]

#: Lienzo vertical en el que se dibuja el ramo.
LIENZO_RAMO: dict[str, float] = {"w": 600, "h": 720}

#: Globos por nivel de cinta: más que esto es una hilera, no un ramo.
MAX_POR_NIVEL = 7

#: Alto del peso (m) donde se atan las cintas.
PESO_ALTO: dict[str, float] = {"regalo": 0.13, "bolsa": 0.15, "ninguno": 0.02}

#: A ras del suelo el peso es más grande: sujeta globos gigantes y suele ser una caja o un pedestal decorado.
PESO_ESCALA_SUELO = 1.8

_SOMBRA = "#0a1a16"


def peso_alto_de(cfg: ConfigRamo) -> float:
    """Alto (m) del peso donde se atan las cintas, según el tipo de ramo."""
    alto = PESO_ALTO.get(cfg["peso"]["tipo"])
    base = 0.13 if alto is None else alto
    return float(base * (PESO_ESCALA_SUELO if cfg["forma"]["modo"] == "suelo" else 1))


def _f(valor: float) -> str:
    """Un número del SVG: a dos decimales y escrito como lo escribe JavaScript."""
    return str(_numero(_redondear(valor * 100) / 100))


def _acotar(valor: float, minimo: float, maximo: float) -> float:
    return float(_minimo(maximo, _maximo(minimo, valor)))


def _suma(valores: Iterable[float]) -> float:
    """El ``reduce((s, v) => s + v, 0)`` del original, de izquierda a derecha y sin compensar.

    No se usa ``sum``: desde Python 3.12 suma en coma flotante con compensación de Neumaier, y JavaScript
    no. La diferencia es de un bit y se arrastra hasta mover un globo de sitio.
    """
    total = 0.0
    for v in valores:
        total += v
    return total


@dataclass(eq=False)
class ItemRamo:
    """Un globo del ramo: su forma, dónde queda y a qué altura de cinta."""

    clase: str
    #: Ancho y alto visibles (m).
    ancho: float
    alto: float
    #: Radio con el que se empaqueta (m).
    r: float
    #: Centro (m): x hacia la derecha, y hacia arriba desde el piso.
    x: float
    y: float
    #: Cuánto se desciende del centro al nudo (m), sobre el eje del globo.
    nudoDesde: float
    capa: int
    #: Giro (grados, en sentido horario en pantalla) para que el nudo apunte al punto de unión.
    rot: float
    nivel: int
    #: Largo de la cinta (m) desde el peso hasta el nudo.
    cuerda: float
    nominal: int | None = None
    especial: Especial | None = None
    #: Índice del especial en la lista de la configuración.
    idxEspecial: int | None = None


@dataclass(eq=False)
class GloboRamo(ItemRamo):
    """Un globo del ramo ya coloreado."""

    color: str = "#ffffff"
    acabado: str = "mate"
    indice: int = -1


def _globo_de(it: ItemRamo) -> GloboRamo:
    """El ``{...it}`` del original: copia superficial que comparte el ``especial`` con la disposición."""
    return GloboRamo(**{f.name: getattr(it, f.name) for f in fields(ItemRamo)})


@dataclass(eq=False)
class Disposicion:
    """Dónde queda cada globo (no depende de los colores)."""

    items: list[ItemRamo]
    #: Punto donde se juntan las cintas, sobre el peso (m).
    punto: dict[str, float]
    pesoAlto: float
    niveles: int


class ConteoRamo(TypedDict):
    color: str
    acabado: str
    indice: int
    nominal: int
    cantidad: int


class EspecialResumen(TypedDict):
    tipo: str
    cm: float
    color: str
    numero: float
    cantidad: float


@dataclass(eq=False)
class ResultadoRamo:
    globos: list[GloboRamo]
    #: Medidas reales del ramo (m).
    altoM: float
    anchoM: float
    #: Cuánto miden los globos de arriba a abajo, sin las cintas (m).
    altoGlobosM: float
    escala: float
    cintasM: float
    conteo: list[ConteoRamo]
    porTamano: dict[int, int]
    especiales: list[EspecialResumen]
    #: Interior del SVG, sin la etiqueta ``<svg>``.
    svg: str


class OpcionesRamo(TypedDict, total=False):
    """Opciones de encuadre.

    ``prefijo`` va delante de los ids del SVG: cuando hay varios dibujos en la misma página (miniaturas) los
    ids no deben repetirse.
    """

    referencia: bool
    ajustar: bool
    prefijo: str


class _Dimensiones(TypedDict):
    ancho: float
    alto: float
    r: float
    nudoDesde: float


def _dimensiones_especial(e: Especial) -> _Dimensiones:
    """Forma y tamaño de un globo especial."""
    h = e["cm"] / 100
    tipo = e["tipo"]
    if tipo == "burbuja":
        return {"ancho": h, "alto": h * 1.08, "r": h / 2, "nudoDesde": h * 0.52}
    if tipo == "estrella":
        return {"ancho": h * 1.02, "alto": h, "r": h * 0.44, "nudoDesde": h * 0.4}
    if tipo == "corazon":
        return {"ancho": h * 1.08, "alto": h, "r": h * 0.46, "nudoDesde": h * 0.46}
    if tipo == "redondo":
        return {"ancho": h, "alto": h, "r": h * 0.46, "nudoDesde": h * 0.5}
    if tipo == "numero":
        return {"ancho": h * 0.64, "alto": h, "r": h * 0.36, "nudoDesde": h * 0.5}
    # El original es un `switch` sin `default`: un tipo que no existe devuelve `undefined` y de ahí para abajo
    # todo es NaN. `sanear` nunca lo deja pasar; aquí se dice en voz alta en vez de dibujar un ramo de NaN.
    raise ValueError(f"tipo de globo especial desconocido: {tipo!r}")


def _reparto_por_nivel(n: int, t: int) -> list[int]:
    """Reparte ``n`` elementos en ``t`` niveles, más al centro que a los extremos (de abajo hacia arriba)."""
    if t <= 1:
        return [n]
    pesos = [mate.pow(mate.sin((mate.pi * (k + 0.5)) / t), 0.9) for k in range(t)]
    suma = _suma(pesos)
    brutos = [(n * p) / suma for p in pesos]
    cuentas = [int(_maximo(1, _piso(b))) for b in brutos]
    resto = n - sum(cuentas)
    orden = sorted(
        [(i, b - _piso(b)) for i, b in enumerate(brutos)],
        key=lambda o: -o[1],
    )
    k = 0
    while resto > 0:
        cuentas[orden[k % len(orden)][0]] += 1
        k += 1
        resto -= 1
    while resto < 0:
        i = cuentas.index(max(cuentas))
        if cuentas[i] > 1:
            cuentas[i] -= 1
        resto += 1
    # Ningún nivel pasa de MAX_POR_NIVEL: lo que sobra se pasa a los niveles con lugar.
    for _vuelta in range(50):
        i = next((idx for idx, c in enumerate(cuentas) if c > MAX_POR_NIVEL), -1)
        if i < 0:
            break
        j = cuentas.index(min(cuentas))
        if cuentas[j] >= MAX_POR_NIVEL:
            break
        cuentas[i] -= 1
        cuentas[j] += 1
    return cuentas


def _crear_items(cfg: ConfigRamo, rnd: Callable[[], float]) -> list[ItemRamo]:
    """Lista de globos del ramo: los de látex según la mezcla de tamaños y los especiales."""
    items: list[ItemRamo] = []
    tam = cfg["tamanos"]
    usados = [t for t in TAMANOS_GLOBO if tam["mezcla"][t] > 0]
    # Las sumas van con un acumulador explícito, no con `sum`: desde 3.12 `sum` compensa el error de
    # redondeo (Neumaier) y `reduce` de JavaScript no, y la diferencia se ve en el último bit.
    total = _suma(tam["mezcla"][t] for t in usados) or 1
    # Reparto de tamaños por cuantiles: las proporciones salen exactas aunque haya pocos globos.
    tamanos_latex: list[int] = []
    i = 0.0
    while i < cfg["latex"]:
        u = (i + 0.5) / _maximo(1, cfg["latex"])
        acu = 0.0
        # Con la mezcla vacía el original deja `elegido` en `undefined` y todo el ramo sale NaN; `sanear` nunca
        # la deja vacía, así que aquí se cae a R12 en vez de dibujar NaN.
        elegido = usados[-1] if usados else 12
        for t in usados:
            acu += tam["mezcla"][t] / total
            if u <= acu:
                elegido = t
                break
        tamanos_latex.append(elegido)
        i += 1
    for nominal in tamanos_latex:
        d = diametro_m(nominal, tam["inflado"]) * (1 - tam["variacion"] * rnd())
        items.append(
            ItemRamo(
                clase="latex",
                nominal=nominal,
                ancho=d,
                alto=d * 1.16,
                r=(d / 2) * 1.02,
                x=0,
                y=0,
                nudoDesde=d * 0.59,
                capa=0,
                rot=0,
                nivel=0,
                cuerda=0,
            )
        )
    for idx, e in enumerate(cfg["especiales"]):
        k = 0.0
        while k < e["cantidad"]:
            dim = _dimensiones_especial(e)
            items.append(
                ItemRamo(
                    clase="especial",
                    especial=e,
                    idxEspecial=idx,
                    ancho=dim["ancho"],
                    alto=dim["alto"],
                    r=dim["r"],
                    nudoDesde=dim["nudoDesde"],
                    x=0,
                    y=0,
                    capa=0,
                    rot=0,
                    nivel=0,
                    cuerda=0,
                )
            )
            k += 1
    return items


def _es_corona(it: ItemRamo) -> bool:
    """Un número de foil: corona el montón a ras del suelo."""
    return it.clase == "especial" and it.especial is not None and it.especial["tipo"] == "numero"


def _es_foil(it: ItemRamo) -> bool:
    """Un especial que no es burbuja: plano y opaco, no se puede montar tanto."""
    return it.clase == "especial" and it.especial is not None and it.especial["tipo"] != "burbuja"


def _disponer_suelo(
    cfg: ConfigRamo, items: list[ItemRamo], rnd: Callable[[], float]
) -> Disposicion:
    """Acomodo «a ras del suelo»: globos grandes con la cinta corta, apilados alrededor del peso.

    Cada globo se coloca, de a uno, en el lugar libre más bajo y más cercano al eje que le permite su cinta
    (entre ``cintaM`` y ``cintaM`` más lo que sube el montón); así el ramo crece como una pila desde el peso.
    Los grandes van atrás y los chicos al frente, y los vecinos de capas distintas pueden montarse. Todos los
    nudos apuntan al peso.
    """
    forma = cfg["forma"]
    n = len(items)
    peso_alto = peso_alto_de(cfg)
    P = {"x": 0.0, "y": peso_alto}
    d_medio = _suma(it.alto for it in items) / n

    # Capas de profundidad según el tamaño: los más grandes atrás, los pequeños al frente.
    por_tamano = sorted(items, key=lambda it: -it.r)
    capas = 3 if n >= 7 else (2 if n >= 3 else 1)
    for k, it in enumerate(por_tamano):
        it.capa = int(_minimo(capas - 1, _piso(((k + 0.5) / n) * capas)))
        it.nivel = it.capa

    # Los números de foil coronan el montón: van adelante y se colocan al final, en lo más alto que les deje
    # su cinta.
    for it in items:
        if not _es_corona(it):
            continue
        it.capa = capas - 1
        it.nivel = capas - 1
    # Los primeros en colocarse quedan más cerca del peso y del piso.
    resto = [it for it in por_tamano if not _es_corona(it)]
    if forma["grandes"] == "arriba":
        resto.reverse()
    orden = [*resto, *[it for it in por_tamano if _es_corona(it)]]

    cinta_min = _maximo(0.05, forma["cintaM"])
    cinta_max = cinta_min + forma["escalon"] * d_medio * 1.6
    kx = 1.3 / forma["ancho"]
    x0 = forma["inclinacion"] * 0.45 * d_medio * mate.sqrt(n)
    yc = peso_alto + 0.35 * d_medio
    ruido = forma["desorden"] * 0.3 * d_medio
    apret = _minimo(1, forma["apretado"] + 0.1)
    paso = _maximo(0.03, min(it.r for it in items) / 4)

    def penetracion(a: ItemRamo, b: ItemRamo) -> float:
        dc = abs(a.capa - b.capa)
        base = 0.1 if dc == 0 else (0.42 if dc == 1 else 0.58)
        return base * (0.6 if (_es_foil(a) or _es_foil(b)) else 1)

    colocados: list[ItemRamo] = []
    for it in orden:
        rho_min = it.nudoDesde + cinta_min
        rho_max = it.nudoDesde + cinta_max
        mejor: dict[str, float] | None = None
        apenas: dict[str, float] | None = None
        # Si no hay lugar con esa cinta, se alarga de a poco (después el saneado revisa el alto del ramo).
        ampliacion = 0
        while ampliacion < 8 and mejor is None:
            rho = rho_min
            while rho <= rho_max + 1e-9:
                d_theta = paso / rho
                th = -1.53
                while th <= 1.53:
                    x = P["x"] + rho * mate.sin(th)
                    y = P["y"] + rho * mate.cos(th)
                    if y - it.alto * 0.48 < 0:
                        th += d_theta
                        continue
                    if _es_corona(it):
                        coste = abs(x - x0) * 0.6 - y + (rnd() - 0.5) * ruido
                    else:
                        coste = mate.hypot(kx * (x - x0), y - yc) + (rnd() - 0.5) * ruido
                    # Si ya hay un lugar libre mejor, no hace falta revisar los traslapes de este.
                    if mejor is not None and coste >= mejor["coste"]:
                        th += d_theta
                        continue
                    viol = 0.0
                    for o in colocados:
                        minimo = (it.r + o.r) * (1 - penetracion(it, o)) * apret
                        d = mate.hypot(x - o.x, y - o.y)
                        if d < minimo:
                            viol += minimo - d
                    if viol > 0:
                        if mejor is None and (apenas is None or viol < apenas["viol"]):
                            apenas = {"x": x, "y": y, "viol": viol}
                        th += d_theta
                        continue
                    mejor = {"x": x, "y": y, "coste": coste}
                    th += d_theta
                rho += paso
            rho_max += 0.3
            ampliacion += 1
        if mejor is not None:
            sitio = mejor
        elif apenas is not None:
            sitio = apenas
        else:
            sitio = {"x": P["x"], "y": P["y"] + rho_min}
        it.x = sitio["x"]
        it.y = sitio["y"]
        colocados.append(it)

    # Giro: el nudo apunta al peso (hasta 62°) y la cinta es lo que queda entre el nudo y el peso.
    for it in items:
        vx = P["x"] - it.x
        vy = P["y"] - it.y
        alfa = (
            _acotar((mate.atan2(-vx, -vy) * 180) / mate.pi, -62, 62)
            + (rnd() - 0.5) * forma["desorden"] * 12
        )
        it.rot = alfa
        it.cuerda = float(_maximo(0.05, mate.hypot(vx, vy) - it.nudoDesde))
    return Disposicion(items=items, punto=P, pesoAlto=peso_alto, niveles=capas)


def crear_disposicion(cfg: ConfigRamo) -> Disposicion:
    """Acomoda el ramo en niveles de cinta (los más grandes arriba) y lo relaja.

    Cada nivel se abre en horizontal y se relaja hasta que los vecinos se montan solo un poco (por capas de
    profundidad). Luego cada globo se gira para que su nudo apunte al punto donde se juntan las cintas. A ras
    del suelo se acomoda como un montón (``_disponer_suelo``).
    """
    rnd = crear_rng(cfg["aspecto"]["semilla"] * 7919 + 101)
    forma = cfg["forma"]
    items = _crear_items(cfg, rnd)
    n = len(items)
    peso_alto = peso_alto_de(cfg)
    if n == 0:
        return Disposicion(
            items=items, punto={"x": 0.0, "y": peso_alto}, pesoAlto=peso_alto, niveles=0
        )
    if forma["modo"] == "suelo":
        return _disponer_suelo(cfg, items, rnd)

    # Los más grandes arriba.
    items.sort(key=lambda it: -it.r)
    T = int(_maximo(1, _minimo(_redondear(forma["niveles"]), mate.ceil(n / 1.5))))
    cuentas = _reparto_por_nivel(n, T)  # de abajo hacia arriba
    d_medio = _suma(it.alto for it in items) / n
    ancho = _acotar(forma["ancho"], 0.5, 1.6)
    sx = mate.pow(ancho, 0.6)
    sy = mate.pow(ancho, -0.6)
    escalon = forma["escalon"] * d_medio * sy

    # Asignación de niveles: el nivel más alto recibe los primeros (más grandes).
    cursor = 0
    por_nivel: list[list[ItemRamo]] = [[] for _ in range(T)]
    for t in range(T - 1, -1, -1):
        for _k in range(cuentas[t]):
            it = items[cursor]
            cursor += 1
            it.nivel = t
            por_nivel[t].append(it)

    desorden = forma["desorden"]
    for t in range(T):
        fila = por_nivel[t]
        # Orden horizontal al azar dentro del nivel.
        for i in range(len(fila) - 1, 0, -1):
            j = int(_piso(rnd() * (i + 1)))
            fila[i], fila[j] = fila[j], fila[i]
        cuerda_nivel = forma["cintaM"] + t * escalon
        anchos = [2 * it.r * forma["apretado"] * 0.88 * sx for it in fila]
        total = _suma(anchos)
        x = -total / 2
        # Los niveles altos se corren hacia el lado de la inclinación.
        corrimiento = forma["inclinacion"] * ((t / (T - 1) - 0.4) if T > 1 else 0) * 0.5 * total
        for j, it in enumerate(fila):
            it.x = x + anchos[j] / 2 + corrimiento + (rnd() - 0.5) * desorden * 0.1
            x += anchos[j]
            it.cuerda = cuerda_nivel + (rnd() - 0.5) * desorden * 0.1
            it.y = peso_alto + it.cuerda + it.nudoDesde
            # Capas de profundidad: vecinos en capas distintas, los grandes al frente.
            it.capa = 0 if (j + t) % 2 == 0 else 1
    capas = 2 if n >= 4 else 1
    if capas == 1:
        for it in items:
            it.capa = 0

    # Relajación: los vecinos de la misma capa no se tocan más de la cuenta y los de capas distintas pueden
    # montarse.
    objetivo_y = [it.y for it in items]
    for _iter in range(60):
        for i in range(n):
            for j in range(i + 1, n):
                a = items[i]
                b = items[j]
                dx = b.x - a.x
                dy = b.y - a.y
                dist = mate.hypot(dx, dy) or 1e-6
                pen = 0.08 if a.capa == b.capa else 0.42
                minimo = (a.r + b.r) * (1 - pen) * _minimo(1, forma["apretado"] + 0.1)
                if dist >= minimo:
                    continue
                empuje = (minimo - dist) * 0.5
                ux = dx / dist
                uy = dy / dist
                # Se separan sobre todo en horizontal: la altura la manda la cinta.
                a.x -= ux * empuje * 0.9
                b.x += ux * empuje * 0.9
                a.y -= uy * empuje * 0.25
                b.y += uy * empuje * 0.25
        # La cinta fija la altura; cohesión suave hacia el centro.
        for i in range(n):
            it = items[i]
            it.y += (objetivo_y[i] - it.y) * 0.35
            it.x -= it.x * 0.012
    # Centrar el ramo en x (con su inclinación) y recalcular la cinta según la altura final del nudo.
    x_medio = _suma(it.x for it in items) / n
    for it in items:
        it.x -= x_medio
    punto = {"x": 0.0, "y": peso_alto}

    # Giro: el nudo apunta al punto de unión. El eje va del centro al nudo.
    for it in items:
        vx = punto["x"] - it.x
        vy = punto["y"] - it.y
        alfa = (mate.atan2(-vx, -vy) * 180) / mate.pi
        alfa = _acotar(alfa, -38, 38) + (rnd() - 0.5) * desorden * 14
        it.rot = alfa
        largo_eje = mate.hypot(vx, vy)
        it.cuerda = float(_maximo(0.15, largo_eje - it.nudoDesde))
    return Disposicion(items=items, punto=punto, pesoAlto=peso_alto, niveles=T)


def _nudo(it: ItemRamo) -> dict[str, float]:
    """Punto (en metros) del nudo de un globo, ya girado."""
    a = (it.rot * mate.pi) / 180
    return {
        "x": it.x - mate.sin(a) * it.nudoDesde,
        "y": it.y - mate.cos(a) * it.nudoDesde,
    }


# ------------------------------------------------------------------------------------------------------------
# Formas (en coordenadas locales: el origen es el centro del globo y r es el radio del cuerpo)
# ------------------------------------------------------------------------------------------------------------


def _path_gota(r: float) -> str:
    """Gota de látex: redondeada arriba, se cierra hacia el nudo."""

    def p(v: float) -> str:
        return _f(v * r)

    return (
        f"M0 {p(-1)}C{p(0.62)} {p(-1)} {p(1)} {p(-0.6)} {p(1)} {p(-0.06)}"
        f"C{p(1)} {p(0.52)} {p(0.52)} {p(0.98)} {p(0.09)} {p(1.1)}"
        f"L{p(0.1)} {p(1.17)}L{p(-0.1)} {p(1.17)}L{p(-0.09)} {p(1.1)}"
        f"C{p(-0.52)} {p(0.98)} {p(-1)} {p(0.52)} {p(-1)} {p(-0.06)}"
        f"C{p(-1)} {p(-0.6)} {p(-0.62)} {p(-1)} 0 {p(-1)}Z"
    )


def _path_estrella(alto: float) -> str:
    """Estrella de cinco puntas de un foil, centrada en el origen."""
    R = alto * 0.5
    pts: list[str] = []
    for k in range(10):
        ang = -mate.pi / 2 + (k * mate.pi) / 5
        rr = R if k % 2 == 0 else R * 0.44
        pts.append(f"{_f(mate.cos(ang) * rr)} {_f(mate.sin(ang) * rr + alto * 0.04)}")
    return f"M{'L'.join(pts)}Z"


def _path_corazon(ancho: float, alto: float) -> str:
    """Corazón de un foil, centrado en el origen."""
    sx = ancho / 2
    sy = alto / 2

    def p(a: float, b: float) -> str:
        return f"{_f(a * sx)} {_f(b * sy)}"

    return (
        f"M{p(0, 0.98)}C{p(-1.35, 0.1)} {p(-1, -1)} {p(0, -0.42)}"
        f"C{p(1, -1)} {p(1.35, 0.1)} {p(0, 0.98)}Z"
    )


def _dibujar_item(
    it: GloboRamo,
    escala: float,
    cfg: ConfigRamo,
    grad: Callable[[str, str], str],
    idx: int,
    capa_max: int,
    pre: str,
) -> str:
    """SVG de un globo especial o de látex dibujado alrededor del origen."""
    a = cfg["aspecto"]
    rnd = crear_rng(idx * 2654435761 + cfg["aspecto"]["semilla"])
    R = (it.ancho / 2) * escala
    H = it.alto * escala
    s = ""

    def trazo(color: str) -> str:
        if a["contorno"] > 0:
            return (
                f' stroke="{mezclar(color, "#000000", 0.45)}" stroke-opacity="0.6"'
                f' stroke-width="{_numero(a["contorno"])}"'
            )
        return ""

    # Los de atrás se oscurecen más que los del frente (con dos capas: solo los de atrás; con tres: atrás y
    # medio).
    tope = _maximo(1, capa_max)
    oscuridad = (
        f'<use href="#{pre}forma{idx}" fill="{_SOMBRA}"'
        f' fill-opacity="{_f(0.22 * a["profundidad"] * (1 - it.capa / tope))}"/>'
        if a["profundidad"] > 0 and it.capa < tope
        else ""
    )

    if it.clase == "latex":
        gota = _path_gota(R)
        claro = it.acabado in ("confeti", "transparente")
        relleno = (
            mezclar(it.color, "#ffffff", 0.78) if claro else f"url(#{grad(it.color, it.acabado)})"
        )
        opacidad = (
            f' fill-opacity="{_numero(0.32 if it.acabado == "confeti" else 0.18)}"' if claro else ""
        )
        s += f'<path id="{pre}forma{idx}" d="{gota}" fill="{relleno}"{opacidad}{trazo(it.color)}/>'
        if it.acabado == "confeti":
            tonos = [it.color, "#ffffff", "#d4af37", mezclar(it.color, "#ffffff", 0.5)]
            puntos = int(_maximo(8, _redondear(R / 2.2)))
            for k in range(puntos):
                ang = rnd() * mate.pi * 2
                rad = mate.sqrt(rnd()) * R * 0.78
                s += (
                    f'<circle cx="{_f(mate.cos(ang) * rad)}"'
                    f' cy="{_f(mate.sin(ang) * rad * 1.05)}"'
                    f' r="{_f(R * (0.05 + rnd() * 0.05))}" fill="{tonos[k % len(tonos)]}"'
                    f' fill-opacity="0.92"/>'
                )
        # nudo
        s += (
            f'<path d="M{_f(-0.11 * R)} {_f(1.15 * R)}L{_f(0)} {_f(1.3 * R)}'
            f'L{_f(0.11 * R)} {_f(1.15 * R)}Z" fill="{mezclar(it.color, "#000000", 0.25)}"'
            f' stroke="{mezclar(it.color, "#000000", 0.5)}" stroke-width="0.6"/>'
        )
        s += oscuridad
        if a["brillo"] > 0:
            b = _minimo(1, a["brillo"] * 1.3) if it.acabado == "cromado" else a["brillo"]
            s += (
                f'<ellipse cx="{_f(-0.36 * R)}" cy="{_f(-0.42 * R)}" rx="{_f(0.17 * R)}"'
                f' ry="{_f(0.3 * R)}" transform="rotate(28 {_f(-0.36 * R)} {_f(-0.42 * R)})"'
                f' fill="#fff" fill-opacity="{_f(b * 0.9)}"/>'
            )
            s += (
                f'<path d="M{_f(0.62 * R)} {_f(0.5 * R)}A{_f(0.86 * R)} {_f(0.9 * R)} 0 0 1'
                f' {_f(0.1 * R)} {_f(0.92 * R)}" fill="none" stroke="#fff"'
                f' stroke-opacity="{_f(0.26 * b)}" stroke-width="{_f(0.05 * R)}"'
                f' stroke-linecap="round"/>'
            )
        return s

    e = cast(Especial, it.especial)
    # Diferencia deliberada con el original: la disposición guarda el `especial` **sin resolver**, así que
    # `pintar` resuelve los colores de `cfg` pero dibujaba el globo especial con lo que trajera la config. Una
    # referencia del catálogo (`sx:041`) salía `#NaNNaNNaN` allá y aquí reventaría al leer el hexadecimal: se
    # resuelve. Con un `#rrggbb` —todo el oráculo— el dibujo es idéntico.
    color = cast(str, resolver_colores(e["color"]))
    if e["tipo"] == "burbuja":
        s += (
            f'<circle id="{pre}forma{idx}" r="{_f(R)}" fill="#ffffff" fill-opacity="0.1"'
            f' stroke="#ffffff" stroke-opacity="0.5" stroke-width="1.6"/>'
        )
        s += (
            f'<circle r="{_f(R * 0.93)}" fill="none" stroke="#ffffff" stroke-opacity="0.18"'
            f' stroke-width="{_f(R * 0.05)}"/>'
        )
        if e["contenido"] == "confeti":
            tonos = [color, "#d4af37", "#ffffff", mezclar(color, "#ffffff", 0.5)]
            for k in range(34):
                ang = rnd() * mate.pi * 2
                rad = mate.sqrt(rnd()) * R * 0.85
                s += (
                    f'<circle cx="{_f(mate.cos(ang) * rad)}" cy="{_f(mate.sin(ang) * rad)}"'
                    f' r="{_f(R * (0.025 + rnd() * 0.03))}" fill="{tonos[k % len(tonos)]}"'
                    f' fill-opacity="0.9"/>'
                )
        elif e["contenido"] == "plumas":
            for k in range(9):
                ang = mate.pi * (0.55 + rnd() * 0.9)
                rad = R * (0.35 + rnd() * 0.45)
                px = mate.cos(ang) * rad
                py = abs(mate.sin(ang)) * rad * 0.9 + R * 0.05
                giro = (rnd() - 0.5) * 120
                col = (
                    mezclar(color, "#ffffff", 0.35)
                    if k % 3 == 0
                    else mezclar(color, "#fff7f0", 0.6)
                )
                s += (
                    f'<ellipse cx="{_f(px)}" cy="{_f(py)}" rx="{_f(R * 0.05)}"'
                    f' ry="{_f(R * 0.2)}" transform="rotate({_f(giro)} {_f(px)} {_f(py)})"'
                    f' fill="{col}" fill-opacity="0.8"/>'
                )
        # cuello y moño
        s += (
            f'<path d="M{_f(-0.09 * R)} {_f(R * 0.98)}L{_f(-0.05 * R)} {_f(R * 1.1)}'
            f'L{_f(0.05 * R)} {_f(R * 1.1)}L{_f(0.09 * R)} {_f(R * 0.98)}Z" fill="#ffffff"'
            f' fill-opacity="0.45"/>'
        )
        s += (
            f'<path d="M0 {_f(R * 1.07)}C{_f(-0.32 * R)} {_f(R * 0.92)} {_f(-0.34 * R)}'
            f" {_f(R * 1.2)} 0 {_f(R * 1.1)}C{_f(0.34 * R)} {_f(R * 1.2)} {_f(0.32 * R)}"
            f' {_f(R * 0.92)} 0 {_f(R * 1.07)}Z" fill="{cfg["cinta"]["color"]}"'
            f' stroke="{mezclar(cfg["cinta"]["color"], "#000000", 0.3)}" stroke-width="0.6"/>'
        )
        s += (
            f'<ellipse cx="{_f(-0.5 * R)}" cy="{_f(-0.55 * R)}" rx="{_f(0.16 * R)}"'
            f' ry="{_f(0.3 * R)}" transform="rotate(35 {_f(-0.5 * R)} {_f(-0.55 * R)})"'
            f' fill="#fff" fill-opacity="{_f(0.55 * (a["brillo"] or 0.3))}"/>'
        )
        # El original hace aquí `oscuridad.replace("fill-opacity", "fill-opacity")`, que no cambia nada.
        s += oscuridad
        return s

    # Foil: degradado metálico y costuras.
    id_f = f"{pre}foil{idx}"
    grad_f = (
        f'<linearGradient id="{id_f}" x1="0.1" y1="0" x2="0.9" y2="1">'
        f'<stop offset="0" stop-color="{mezclar(color, "#ffffff", 0.7)}"/>'
        f'<stop offset="0.3" stop-color="{color}"/>'
        f'<stop offset="0.62" stop-color="{mezclar(color, "#000000", 0.38)}"/>'
        f'<stop offset="1" stop-color="{mezclar(color, "#ffffff", 0.4)}"/></linearGradient>'
    )
    s += f"<defs>{grad_f}</defs>"
    borde = mezclar(color, "#000000", 0.4)
    if e["tipo"] == "estrella":
        s += (
            f'<path id="{pre}forma{idx}" d="{_path_estrella(H)}" fill="url(#{id_f})"'
            f' stroke="{borde}" stroke-width="1" stroke-linejoin="round"/>'
        )
        s += (
            f'<path d="{_path_estrella(H * 0.72)}" fill="none" stroke="#fff"'
            f' stroke-opacity="0.25" stroke-width="1"/>'
        )
    elif e["tipo"] == "corazon":
        s += (
            f'<path id="{pre}forma{idx}" d="{_path_corazon(it.ancho * escala, H)}"'
            f' fill="url(#{id_f})" stroke="{borde}" stroke-width="1" stroke-linejoin="round"/>'
        )
        s += (
            f'<path d="{_path_corazon(it.ancho * escala * 0.82, H * 0.82)}" fill="none"'
            f' stroke="#fff" stroke-opacity="0.25" stroke-width="1"/>'
        )
    elif e["tipo"] == "redondo":
        s += (
            f'<circle id="{pre}forma{idx}" r="{_f(H / 2)}" fill="url(#{id_f})"'
            f' stroke="{borde}" stroke-width="1"/>'
        )
        s += (
            f'<circle r="{_f(H * 0.4)}" fill="none" stroke="#fff" stroke-opacity="0.28"'
            f' stroke-width="1"/>'
        )
    else:
        # número: la cifra con un contorno grueso, para que parezca inflada
        s += (
            f'<text id="{pre}forma{idx}" x="0" y="{_f(H * 0.05)}" text-anchor="middle"'
            f' dominant-baseline="central" font-family="Arial Black, Inter, Arial, sans-serif"'
            f' font-weight="900" font-size="{_f(H * 1.08)}" fill="url(#{id_f})"'
            f' stroke="{"" if id_f == "" else borde}" stroke-width="{_f(H * 0.06)}"'
            f' stroke-linejoin="round" paint-order="stroke">{_numero(e["numero"])}</text>'
        )
    if a["brillo"] > 0 and e["tipo"] != "numero":
        s += (
            f'<ellipse cx="{_f(-0.2 * it.ancho * escala)}" cy="{_f(-0.22 * H)}"'
            f' rx="{_f(0.08 * it.ancho * escala)}" ry="{_f(0.18 * H)}"'
            f' transform="rotate(28 {_f(-0.2 * it.ancho * escala)} {_f(-0.22 * H)})"'
            f' fill="#fff" fill-opacity="{_f(0.55 * a["brillo"])}"/>'
        )
    s += oscuridad
    return s


def _path_cinta(k: dict[str, float], p: dict[str, float], sway: float) -> str:
    """Camino de una cinta desde el nudo hasta el punto de unión, con un poco de curva."""
    qx = (k["x"] + p["x"]) / 2 + sway
    qy = (k["y"] + p["y"]) / 2
    return f"M{_f(k['x'])} {_f(k['y'])}Q{_f(qx)} {_f(qy)} {_f(p['x'])} {_f(p['y'])}"


def _colas(
    cfg: ConfigRamo,
    px: float,
    py: float,
    piso_px: float,
    escala: float,
    rnd: Callable[[], float],
) -> str:
    """Colas de cinta que caen desde el punto de unión hasta el piso (rizadas o lisas)."""
    n = 5 if cfg["peso"]["tipo"] == "ninguno" else 7
    s = ""
    for k in range(n):
        lado = (k / (n - 1) - 0.5) * 2
        largo = (0.22 + rnd() * 0.3) * escala
        d = f"M{_f(px)} {_f(py)}"
        if cfg["cinta"]["tipo"] == "rizada":
            # Espiral que se abre: curl clásico de la cinta rizada.
            vueltas = 2 + rnd() * 1.5
            pasos = 22
            deriva = lado * (10 + rnd() * 14)
            for i in range(1, pasos + 1):
                t = i / pasos
                ang = t * vueltas * mate.pi * 2
                ra = (1 - t * 0.35) * 5
                d += (
                    f"L{_f(px + deriva * t + mate.cos(ang) * ra)}"
                    f" {_f(_minimo(piso_px, py + t * largo + mate.sin(ang) * ra))}"
                )
        else:
            d += (
                f"Q{_f(px + lado * 18)} {_f(py + largo * 0.5)} {_f(px + lado * 26)}"
                f" {_f(_minimo(piso_px, py + largo))}"
            )
        s += (
            f'<path d="{d}" fill="none" stroke="{cfg["cinta"]["color"]}" stroke-width="1.5"'
            f' stroke-linecap="round" stroke-opacity="0.92"/>'
        )
    return s


def _dibujar_peso(cfg: ConfigRamo, cx: float, piso_px: float, escala: float) -> str:
    """Peso donde se atan las cintas."""
    c = cfg["peso"]["color"]
    k = PESO_ESCALA_SUELO if cfg["forma"]["modo"] == "suelo" else 1
    h = PESO_ALTO.get(cfg["peso"]["tipo"], 0) * k * escala
    if cfg["peso"]["tipo"] == "ninguno":
        return ""
    if cfg["peso"]["tipo"] == "regalo":
        w = 0.17 * k * escala
        cinta = mezclar(cfg["cinta"]["color"], c, 0.15)
        return (
            f'<rect x="{_f(cx - w / 2)}" y="{_f(piso_px - h)}" width="{_f(w)}"'
            f' height="{_f(h)}" rx="2" fill="{c}" stroke="{mezclar(c, "#000000", 0.4)}"'
            f' stroke-width="1"/>'
            f'<rect x="{_f(cx - w / 2)}" y="{_f(piso_px - h)}" width="{_f(w)}"'
            f' height="{_f(h * 0.2)}" rx="2" fill="{mezclar(c, "#000000", 0.12)}"/>'
            f'<rect x="{_f(cx - w * 0.07)}" y="{_f(piso_px - h)}" width="{_f(w * 0.14)}"'
            f' height="{_f(h)}" fill="{cinta}"/>'
        )
    w = 0.14 * k * escala
    return (
        f'<path d="M{_f(cx - w * 0.5)} {_f(piso_px)}C{_f(cx - w * 0.62)}'
        f" {_f(piso_px - h * 0.5)} {_f(cx - w * 0.3)} {_f(piso_px - h * 0.78)}"
        f" {_f(cx - w * 0.16)} {_f(piso_px - h)}L{_f(cx + w * 0.16)} {_f(piso_px - h)}"
        f"C{_f(cx + w * 0.3)} {_f(piso_px - h * 0.78)} {_f(cx + w * 0.62)}"
        f' {_f(piso_px - h * 0.5)} {_f(cx + w * 0.5)} {_f(piso_px)}Z" fill="{c}"'
        f' stroke="{mezclar(c, "#000000", 0.4)}" stroke-width="1"/>'
        f'<path d="M{_f(cx - w * 0.2)} {_f(piso_px - h * 0.9)}L{_f(cx + w * 0.2)}'
        f' {_f(piso_px - h * 0.9)}" stroke="{cfg["cinta"]["color"]}" stroke-width="2"/>'
    )


def _sombra_de(g: GloboRamo, escala: float, cfg: ConfigRamo) -> str:
    """Sombra suave del globo sobre los que están detrás."""
    # Los globos casi transparentes (confeti, transparente) casi no dan sombra: se vería un disco oscuro a
    # través del globo.
    if g.clase == "latex":
        translucido = g.acabado in ("confeti", "transparente")
    else:
        translucido = g.especial is not None and g.especial["tipo"] == "burbuja"
    s = cfg["aspecto"]["sombra"] * (0.1 if translucido else 1)
    if s <= 0:
        return ""
    R = (g.ancho / 2) * escala
    if g.clase == "latex":
        return (
            f'<ellipse cx="{_f(R * 0.07)}" cy="{_f(R * 0.1)}" rx="{_f(R * 1.01)}"'
            f' ry="{_f(R * 1.1)}" fill="{_SOMBRA}" fill-opacity="{_numero(s)}"/>'
        )
    return (
        f'<ellipse cx="{_f(R * 0.05)}" cy="{_f(R * 0.08)}" rx="{_f(R * 0.98)}"'
        f' ry="{_f((g.alto / 2) * escala * 0.98)}" fill="{_SOMBRA}"'
        f' fill-opacity="{_f(s * 0.7)}"/>'
    )


def _linea_guia(y_min: float, y_max: float) -> Espina:
    """Línea guía vertical imaginaria: solo existe para reusar el reparto de colores de los orgánicos."""
    pts = [
        PuntoEspina(
            x=0,
            y=y_min + ((y_max - y_min) * i) / 59,
            tx=0,
            ty=1,
            nx=-1,
            ny=0,
            s=((y_max - y_min) * i) / 59,
        )
        for i in range(60)
    ]
    return Espina(
        puntos=pts,
        largo=float(_maximo(1e-6, y_max - y_min)),
        largoCompleto=y_max - y_min,
        grosor=lambda _fr: 0.4,
        pie=lambda fr: fr * 0.5,
        indiceEn=lambda fr: int(_minimo(59, _maximo(0, _redondear(fr * 59)))),
    )


def pintar(entrada: ConfigRamo, disp: Disposicion, op: OpcionesRamo | None = None) -> ResultadoRamo:
    """Pinta el ramo: colores de los globos de látex, cintas, peso y dibujo."""
    op = {} if op is None else op
    # Los colores canónicos (`sx:041`) se cambian por su hexadecimal aquí: de esta línea para abajo el motor
    # solo ve `#rrggbb`, igual que siempre (ver `app/motores/canonico.py`).
    cfg = cast(ConfigRamo, resolver_colores(entrada))
    items = disp.items
    punto = disp.punto
    peso_alto = disp.pesoAlto
    latex_idx = [i for i, it in enumerate(items) if it.clase == "latex"]

    # Colores de los globos de látex: se reutiliza el reparto de los orgánicos con una línea guía vertical
    # imaginaria.
    ys = [it.y for it in items]
    y_min = 0.0
    y_max = 1.0
    for v in ys:
        y_min = _minimo(y_min, v)
        y_max = _maximo(y_max, v)
    linea_guia = _linea_guia(y_min, y_max)
    bs: list[B] = []
    for i in latex_idx:
        it = items[i]
        si = linea_guia.indiceEn((it.y - y_min) / linea_guia.largo)
        bs.append(
            B(
                x=it.x,
                y=it.y,
                r=it.r,
                capa=it.capa,
                nominal=it.nominal if it.nominal is not None else 12,
                salta=False,
                si=si,
                racimo=it.nivel,
            )
        )
    orden = colorear(cast(dict[str, Any], cfg), bs, linea_guia) if bs else []
    globos = [_globo_de(it) for it in items]
    lista = cfg["colores"]["lista"]
    for k, gi in enumerate(latex_idx):
        c = lista[orden[k]] if 0 <= orden[k] < len(lista) else lista[0]
        globos[gi].color = c["hex"]
        globos[gi].acabado = c["acabado"]
        globos[gi].indice = orden[k]

    # Conteo para los materiales.
    cuenta: dict[str, ConteoRamo] = {}
    por_tamano: dict[int, int] = {5: 0, 9: 0, 12: 0, 18: 0, 24: 0, 36: 0}
    for g in globos:
        if g.clase != "latex" or not g.nominal:
            continue
        clave = f"{g.indice}|{g.nominal}"
        e = cuenta.get(clave)
        if e is not None:
            e["cantidad"] += 1
        else:
            cuenta[clave] = {
                "color": g.color,
                "acabado": g.acabado,
                "indice": g.indice,
                "nominal": g.nominal,
                "cantidad": 1,
            }
        por_tamano[g.nominal] += 1
    especiales: list[EspecialResumen] = [
        {
            "tipo": e["tipo"],
            "cm": e["cm"],
            "color": e["color"],
            "numero": e["numero"],
            "cantidad": e["cantidad"],
        }
        for e in cfg["especiales"]
        if e["cantidad"] > 0
    ]

    # Medidas reales.
    topes = [g.y + g.alto / 2 for g in globos]
    fondos = [g.y - g.alto / 2 for g in globos]
    alto_m = float(max(topes)) if globos else peso_alto
    izq = min(g.x - g.ancho / 2 for g in globos) if globos else -0.2
    der = max(g.x + g.ancho / 2 for g in globos) if globos else 0.2
    ancho_m = float(_maximo(0.3, der - izq))
    alto_globos_m = float(max(topes) - min(fondos)) if globos else 0.0
    cintas_m = _suma(g.cuerda * 1.08 for g in globos) + 7 * 0.35

    # Encuadre.
    lienzo = LIENZO_RAMO
    persona = bool(
        cfg["forma"]["persona"] and op.get("referencia") is not False and not op.get("ajustar")
    )
    if op.get("ajustar"):
        escala = float(_minimo((lienzo["w"] - 60) / ancho_m, (lienzo["h"] - 60) / alto_m))
        piso = lienzo["h"] - 30 - _maximo(0, (lienzo["h"] - 60 - alto_m * escala) / 2)
        centro = lienzo["w"] / 2
        marco = Marco(
            escala=escala,
            piso=piso,
            cx=centro,
            centro=centro,
            anchoPx=ancho_m * escala,
            w=lienzo["w"],
            h=lienzo["h"],
        )
    else:
        alto_ref = _maximo(alto_m + 0.05, 1.7 if persona else 0)
        centro = 400 if persona else 320
        piso = lienzo["h"] - 52
        escala = float(
            _minimo((piso - 34) / alto_ref, (170 if persona else 260) / (ancho_m / 2 + 0.05))
        )
        marco = Marco(
            escala=escala,
            piso=piso,
            cx=centro,
            centro=centro,
            anchoPx=ancho_m * escala,
            w=lienzo["w"],
            h=lienzo["h"],
            referencia=None
            if op.get("referencia") is False
            else {"persona": persona, "altoRef": alto_ref, "personaX": 112, "reglaX": 44},
        )

    def X(x: float) -> float:
        return float(centro + (x - (izq + der) / 2) * escala)

    def Y(y: float) -> float:
        return float(piso - y * escala)

    # Dibujo.
    crudo = op.get("prefijo")
    prefijo = "" if crudo is None else crudo
    grad: dict[str, str] = {}

    def id_grad(color: str, acabado: str) -> str:
        ident = f"{prefijo}r{color[1:]}{acabado[0]}"
        if ident not in grad:
            grad[ident] = degradado(ident, color, acabado)
        return ident

    rnd_cintas = crear_rng(cfg["aspecto"]["semilla"] * 31 + 7)
    P = {"x": X(punto["x"]), "y": Y(punto["y"])}
    partes: list[str] = []
    if marco.referencia:
        partes.append(referencias(marco))
    if cfg["forma"]["suelo"] and not op.get("ajustar"):
        partes.append(
            f'<line x1="20" y1="{_f(piso + 8)}" x2="{_numero(lienzo["w"] - 20)}"'
            f' y2="{_f(piso + 8)}" stroke="#8fa39a" stroke-width="3" stroke-linecap="round"'
            f' stroke-opacity="0.55"/>'
        )
    elif cfg["forma"]["suelo"]:
        partes.append("")

    # De atrás hacia adelante: para cada capa, primero las cintas y luego los globos.
    capas_usadas = sorted(dict.fromkeys(g.capa for g in globos))
    capa_max = capas_usadas[-1] if capas_usadas else 0
    idx = 0
    indices = {id(g): i for i, g in enumerate(globos)}
    for capa in capas_usadas:
        grupo = sorted((g for g in globos if g.capa == capa), key=lambda g: -g.y)
        for g in grupo:
            nd = _nudo(g)
            kp = {"x": X(nd["x"]), "y": Y(nd["y"])}
            sway = (rnd_cintas() - 0.5) * 22 * _minimo(1, g.cuerda)
            partes.append(
                f'<path d="{_path_cinta(kp, P, sway)}" fill="none"'
                f' stroke="{cfg["cinta"]["color"]}" stroke-width="1.3" stroke-opacity="0.9"'
                f' stroke-linecap="round"/>'
            )
        for g in grupo:
            gi = indices.get(id(g), idx)
            partes.append(
                f'<g transform="translate({_f(X(g.x))} {_f(Y(g.y))}) rotate({_f(g.rot)})">'
                f"{_sombra_de(g, escala, cfg)}"
                f"{_dibujar_item(g, escala, cfg, id_grad, gi, capa_max, prefijo)}</g>"
            )
            idx += 1
    # Colas de cinta y peso, delante de todo.
    partes.append(_colas(cfg, P["x"], P["y"], piso + 4, escala, rnd_cintas))
    partes.append(_dibujar_peso(cfg, P["x"], piso, escala))

    return ResultadoRamo(
        globos=globos,
        altoM=alto_m,
        anchoM=ancho_m,
        altoGlobosM=alto_globos_m,
        escala=escala,
        cintasM=cintas_m,
        conteo=sorted(cuenta.values(), key=lambda c: (c["indice"], c["nominal"])),
        porTamano=por_tamano,
        especiales=especiales,
        svg=f"<defs>{''.join(grad.values())}</defs>{''.join(partes)}",
    )


def svg_documento(interior: str, titulo: str = "Bouquet de globos") -> str:
    """Documento SVG completo, listo para descargar."""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {_numero(LIENZO_RAMO["w"])}'
        f' {_numero(LIENZO_RAMO["h"])}" width="{_numero(LIENZO_RAMO["w"])}"'
        f' height="{_numero(LIENZO_RAMO["h"])}" role="img" aria-label="{titulo}">{interior}</svg>\n'
    )


def generar(cfg: ConfigRamo) -> ResultadoRamo:
    """Acomoda y pinta un ramo de una sola vez."""
    return pintar(cfg, crear_disposicion(cfg))
