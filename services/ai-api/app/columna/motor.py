"""Dónde va cada globo de la columna, de qué color y qué lleva.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/columna/motor.ts``. El criterio se define allá;
aquí solo se replica. Ver ``app/armado_columna.py`` y ``docs/architecture/decisions/0033-motor-de-columna-migrado.md``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import cast

from app.columna.js import (
    _canal,
    _maximo,
    _minimo,
    _mod,
    _numero,
    _piso,
    _redondear,
    _techo,
    crear_rng,
    mezclar,
)
from app.columna.patrones import PATRONES, Ctx
from app.columna.tipos import (
    TAMANOS_GLOBO,
    CapaColumna,
    Config,
    TamanoGlobo,
    _copia,
    diametro_m,
)
from app.motores.canonico import hexes_translucidos, resolver_colores
from app.motores.mate import cos, inf, pi, sin

# ---------------------------------------------------------------------------
# Geometría (``motor.ts``)
# ---------------------------------------------------------------------------

#: Lienzo vertical en el que se dibuja la columna.
LIENZO_W = 600
LIENZO_H = 720

SUELO_Y = 668
MARGEN_ARRIBA = 34
PERSONA_M = 1.7
#: Alto del plato de base (m).
BASE_ALTO_M = 0.06

_SOMBRA = "#0a1a16"


@dataclass
class Capa:
    """Una capa ya calculada. ``n`` solo se usa en la columna por capas."""

    y: float
    d: float
    nominal: TamanoGlobo
    rho: float
    n: int | None = None


@dataclass
class GloboCol:
    x: float
    y: float
    z: float
    r: float
    #: Color con la variación de tono ya aplicada.
    color: str
    #: Color del patrón, sin variación: es el que cuenta para los materiales.
    base: str
    nominal: TamanoGlobo
    capa: int
    k: int
    prof: float


@dataclass
class RemateResumen:
    descripcion: str = ""
    globos: list[dict[str, object]] = field(default_factory=list)
    foil: str | None = None


@dataclass
class Resultado:
    globos: list[GloboCol]
    capas: int
    alto_cuerpo_m: float
    alto_total_m: float
    diametro_m: float
    remate_alto_m: float
    escala: float
    conteo: list[dict[str, object]]
    por_tamano: dict[TamanoGlobo, int]
    remate: RemateResumen
    avisos: list[str]
    svg: str


def tamanos_entre(abajo: TamanoGlobo, arriba: TamanoGlobo) -> list[TamanoGlobo]:
    """Los tamaños que se recorren de los globos de abajo a los de arriba."""
    ia = TAMANOS_GLOBO.index(abajo)
    ib = TAMANOS_GLOBO.index(arriba)
    paso = 1 if ia <= ib else -1
    lista: list[TamanoGlobo] = []
    i = ia
    while i != ib + paso:
        lista.append(TAMANOS_GLOBO[i])
        i += paso
    return lista


def radio_anillo(d: float, n: float, tamano: float) -> float:
    """Radio del anillo de centros: los globos vecinos quedan a la separación ``d / tamano``."""
    return float(d / tamano / 2 / sin(pi / _maximo(2, n)))


def diametro_columna(nominal: TamanoGlobo, n: float, inflado: float, tamano: float) -> float:
    """Diámetro exterior (m) de una capa de ese tamaño con ``n`` globos."""
    d = float(diametro_m(nominal, inflado))
    return 2 * radio_anillo(d, n, tamano) + d


def crear_capas(cfg: Config) -> list[Capa]:
    """Las capas de la columna por altura, con el tamaño que toca según la altura."""
    c = cfg.columna
    g = cfg.globo
    n = c.globos_capa
    lista = tamanos_entre(c.abajo, c.arriba)

    def elegir(centro: float) -> TamanoGlobo:
        cruda = _piso((centro / c.alto_m) * len(lista))
        return lista[int(_minimo(len(lista) - 1, _maximo(0, cruda)))]

    capas: list[Capa] = []
    nominal = lista[0]
    d = diametro_m(nominal, g.inflado)
    centro = d / 2
    for i in range(400):
        if i > 0:
            previa = capas[i - 1]
            # Se elige el tamaño según la altura a la que caería la capa y se recalcula con su diámetro.
            nominal = elegir(previa.y + g.compresion * previa.d)
            d = diametro_m(nominal, g.inflado)
            centro = previa.y + (g.compresion * (previa.d + d)) / 2
            nominal = elegir(centro)
            d = diametro_m(nominal, g.inflado)
            centro = previa.y + (g.compresion * (previa.d + d)) / 2
        capas.append(Capa(y=centro, d=d, nominal=nominal, rho=radio_anillo(d, n, g.tamano)))
        if i >= 2 and centro - d / 2 > c.alto_m:
            break
    # Se queda el número de capas cuyo alto real queda más cerca del pedido: con globos
    # grandes, una capa de más o de menos se nota.
    mejor = 3
    dif = inf
    for k in range(3, len(capas) + 1):
        tope = capas[k - 1].y + capas[k - 1].d / 2
        error = abs(tope - c.alto_m)
        if error < dif:
            dif = error
            mejor = k
    return capas[: int(_minimo(mejor, len(capas)))]


def crear_capas_manuales(cfg: Config) -> list[Capa]:
    """Las capas de la columna por capas, apiladas igual que en el modo por altura."""
    g = cfg.globo
    capas: list[Capa] = []
    for i, manual in enumerate(cfg.capas):
        d = diametro_m(manual.tamano, g.inflado)
        n = _maximo(2, len(manual.colores))
        y = d / 2 if i == 0 else capas[i - 1].y + (g.compresion * (capas[i - 1].d + d)) / 2
        capas.append(
            Capa(y=y, d=d, nominal=manual.tamano, rho=radio_anillo(d, n, g.tamano), n=int(n))
        )
    return capas


def es_por_capas(cfg: Config) -> bool:
    return cfg.modo == "capas" and len(cfg.capas) > 0


def capas_de(cfg: Config) -> list[Capa]:
    return crear_capas_manuales(cfg) if es_por_capas(cfg) else crear_capas(cfg)


def capas_desde_altura(entrada: Config) -> tuple[list[CapaColumna], list[str]]:
    """Pasa el diseño por altura (con su patrón) a una lista de capas, conservando el color de cada globo.

    Un color que no esté en la lista (un ombré, por ejemplo) se añade —hasta 8— o se usa el más parecido.
    """
    cfg = _copia(entrada)
    cfg.modo = "altura"
    res = generar(cfg, True)
    geom = crear_capas(cfg)
    colores = list(cfg.colores) if cfg.colores else ["#9ca3af"]

    def parecido(hexa: str) -> int:
        mejor = 0
        dif = inf
        for i, color in enumerate(colores):
            error = sum((_canal(color, k) - _canal(hexa, k)) ** 2 for k in (0, 1, 2))
            if error < dif:
                dif = error
                mejor = i
        return mejor

    def indice(hexa: str) -> int:
        if hexa in colores:
            return colores.index(hexa)
        if len(colores) < 8:
            colores.append(hexa)
            return len(colores) - 1
        return parecido(hexa)

    n = int(cfg.columna.globos_capa)
    capas = [CapaColumna(tamano=cg.nominal, colores=[0] * n) for cg in geom]
    for globo in sorted(res.globos, key=lambda b: (b.capa, b.k)):
        capas[globo.capa].colores[globo.k] = indice(globo.base)
    return capas, colores


def generar(entrada: Config, simple: bool = False) -> Resultado:
    """Coloca los globos de la columna, los colorea, cuenta lo que lleva y arma el dibujo.

    ``simple``: el dibujo sin la regla lateral ni la persona de referencia, centrado en el lienzo.
    """
    # Los colores canónicos (`sx:041`) se cambian por su hexadecimal aquí: de esta línea para abajo el
    # motor solo ve `#rrggbb`, igual que en el original.
    cfg = _resolver_colores(entrada)
    # Qué colores de este diseño son de la familia Cristal. Se mira en la entrada **sin resolver**,
    # porque al resolver solo quedan hexadecimales y se pierde de qué familia venía cada uno.
    translucidos = hexes_translucidos([*entrada.colores, entrada.remate.color])
    c = cfg.columna
    g = cfg.globo
    rem = cfg.remate
    patron = PATRONES[cfg.patron]
    cols = cfg.colores if cfg.colores else ["#9ca3af"]
    op = cfg.opciones[cfg.patron]
    rnd = crear_rng(g.semilla)
    manual = es_por_capas(cfg)
    avisos: list[str] = []

    capas = capas_de(cfg)

    def n_de(i: int) -> int:
        """Globos de una capa: por altura son todos iguales; por capas, cada una lleva los suyos."""
        return len(cfg.capas[i].colores) if manual else int(c.globos_capa)

    tabla: list[list[str | None]] = [[None] * n_de(i) for i in range(len(capas))]
    globos: list[GloboCol] = []
    rho_max = 0.01
    for capa in capas:
        rho_max = _maximo(rho_max, capa.rho)

    for i, capa in enumerate(capas):
        n = n_de(i)
        for k in range(n):
            q = k + (0.5 if (c.escalonado and i % 2 == 1) else 0)

            def vecino(ii: int, kk: int) -> str | None:
                if 0 <= ii < len(capas):
                    ancho = n_de(ii)
                    return tabla[ii][int(_mod(kk, ancho))]
                return None

            ctx = Ctx(i=i, capas=len(capas), k=k, q=q, n=n, rnd=rnd, vecino=vecino)
            if manual:
                pedido = cfg.capas[i].colores[k]
                base = cols[int(_mod(pedido, len(cols)))]
            else:
                base = patron.color(ctx, cols, op)
            tabla[i][k] = base
            color = base
            if g.variacion_tono > 0:
                claro = "#ffffff" if rnd() < 0.5 else "#000000"
                color = mezclar(color, claro, rnd() * g.variacion_tono)

            ang = (2 * pi * q) / n
            jit = g.desorden * capa.d * 0.18
            x = capa.rho * sin(ang) + (rnd() - 0.5) * jit
            z = capa.rho * cos(ang) + (rnd() - 0.5) * jit
            y = capa.y + (rnd() - 0.5) * jit
            r = (capa.d / 2) * (1 + (rnd() - 0.5) * 2 * g.variacion_tam)
            globos.append(
                GloboCol(
                    x=x,
                    y=y,
                    z=z,
                    r=r,
                    color=color,
                    base=base,
                    nominal=capa.nominal,
                    capa=i,
                    k=k,
                    prof=z / rho_max,
                )
            )

    # De atrás hacia adelante y, dentro de la misma profundidad, de arriba hacia abajo.
    globos.sort(key=lambda b: (b.z, -b.y))

    ultima = capas[-1] if capas else None
    alto_cuerpo_m = (ultima.y + ultima.d / 2) if ultima else 0.0
    diametro = 0.0
    for capa in capas:
        diametro = _maximo(diametro, 2 * capa.rho + capa.d)

    cuenta: dict[str, dict[str, object]] = {}
    por_tamano: dict[TamanoGlobo, int] = {5: 0, 9: 0, 12: 0, 18: 0, 24: 0, 36: 0}
    for globo in globos:
        clave = f"{globo.base}|{globo.nominal}"
        entrada_cuenta = cuenta.get(clave)
        if entrada_cuenta is not None:
            entrada_cuenta["cantidad"] = cast(int, entrada_cuenta["cantidad"]) + 1
        else:
            cuenta[clave] = {"color": globo.base, "nominal": globo.nominal, "cantidad": 1}
        por_tamano[globo.nominal] += 1
    # Un color repetido en la lista se queda con su última posición, como el `Map` del motor.
    orden = {color: i for i, color in enumerate(cols)}
    conteo = sorted(
        cuenta.values(),
        key=lambda e: (
            orden.get(cast(str, e["color"]), 99),
            cast(int, e["nominal"]),
        ),
    )

    # --- Remate ---
    base_alto = BASE_ALTO_M if c.base else 0
    cima_cuerpo = base_alto + alto_cuerpo_m
    resumen = RemateResumen()
    remate_alto_m = 0.0
    if rem.tipo == "globo":
        dr = diametro_m(rem.tamano, g.inflado)
        remate_alto_m = dr * 0.8
        resumen.descripcion = f"Globo de R{rem.tamano}"
        resumen.globos.append({"color": rem.color, "nominal": rem.tamano, "cantidad": 1})
    elif rem.tipo == "racimo":
        dr = diametro_m(rem.tamano, g.inflado)
        remate_alto_m = dr * 2.1
        cantidad = int(rem.cantidad)
        resumen.descripcion = f"Racimo de {_numero(rem.cantidad)} globos R{rem.tamano}"
        for k in range(cantidad):
            color = cols[k % len(cols)]
            existente = next((x for x in resumen.globos if x["color"] == color), None)
            if existente is not None:
                existente["cantidad"] = cast(int, existente["cantidad"]) + 1
            else:
                resumen.globos.append(
                    {"color": color, "nominal": rem.tamano, "cantidad": 1}
                )
    elif rem.tipo in ("estrella", "corazon"):
        remate_alto_m = rem.foil_m * 0.9
        pulg = int(_redondear(rem.foil_m / 0.0254))
        cm = int(_redondear(rem.foil_m * 100))
        nombre = "Estrella" if rem.tipo == "estrella" else "Corazón"
        resumen.descripcion = f"{nombre} de foil de unos {pulg} pulg ({cm} cm)"
        resumen.foil = resumen.descripcion

    alto_total_m = cima_cuerpo + remate_alto_m
    medidas = Medidas(
        alto_cuerpo_m=alto_cuerpo_m,
        diametro=diametro,
        alto_total_m=alto_total_m,
        cima_cuerpo=cima_cuerpo,
        base_alto=base_alto,
        rho_max=rho_max,
    )
    svg, escala = _dibujar(globos, cfg, medidas, simple, translucidos)

    return Resultado(
        globos=globos,
        capas=len(capas),
        alto_cuerpo_m=alto_cuerpo_m,
        alto_total_m=alto_total_m,
        diametro_m=diametro,
        remate_alto_m=remate_alto_m,
        escala=escala,
        conteo=list(conteo),
        por_tamano=por_tamano,
        remate=resumen,
        avisos=avisos,
        svg=svg,
    )


def _resolver_colores(entrada: Config) -> Config:
    """La config con toda referencia canónica (``sx:041``) cambiada por su hexadecimal.

    ``resolver_colores`` recorre diccionarios y listas; la ``Config`` de la columna es un ``dataclass``
    con nombres en snake_case, así que el recorrido genérico pasaría de largo sin tocar nada. Por eso
    aquí se resuelven los campos de color uno a uno: ``colores`` y ``remate.color`` son los dos únicos
    que llevan color (``capas[].colores`` son índices dentro de ``colores``, no colores).
    """
    cfg = _copia(entrada)
    cfg.colores = [cast(str, resolver_colores(color)) for color in cfg.colores]
    cfg.remate.color = cast(str, resolver_colores(cfg.remate.color))
    return cfg


# ---------------------------------------------------------------------------
# Dibujo (``motor.ts``)
# ---------------------------------------------------------------------------


@dataclass
class Medidas:
    """Lo que el dibujo necesita saber de las medidas ya calculadas."""

    alto_cuerpo_m: float
    diametro: float
    alto_total_m: float
    cima_cuerpo: float
    base_alto: float
    rho_max: float


def _f(valor: float) -> str:
    """Dos decimales, escritos como los escribe JavaScript."""
    return str(_numero(_redondear(valor * 100) / 100))


def ancho_dibujo(cfg: Config, diametro: float) -> float:
    """Ancho máximo (m) de lo que se dibuja: la columna o el remate, lo que sea más ancho."""
    r = cfg.remate
    d = diametro_m(r.tamano, cfg.globo.inflado)
    if r.tipo == "globo":
        remate_ancho = d
    elif r.tipo == "racimo":
        remate_ancho = d * 2.1
    elif r.tipo in ("estrella", "corazon"):
        remate_ancho = r.foil_m
    else:
        remate_ancho = 0.0
    return float(_maximo(diametro * (1.25 if cfg.columna.base else 1), remate_ancho))


def _dibujar(
    globos: list[GloboCol],
    cfg: Config,
    m: Medidas,
    simple: bool,
    translucidos: set[str],
) -> tuple[str, float]:
    """SVG (sin envoltorio) de la columna con su base, remate, persona y regla, y la escala usada."""
    c = cfg.columna
    g = cfg.globo
    rem = cfg.remate
    persona = c.persona and not simple
    cx = 300 if simple else (392 if persona else 330)
    espacio_ancho = 250 if simple else (165 if persona else 250)
    ancho_m = ancho_dibujo(cfg, m.diametro)
    alto_ref: float = _maximo(m.alto_total_m, PERSONA_M if persona else 0)
    escala: float = _minimo((SUELO_Y - MARGEN_ARRIBA) / alto_ref, espacio_ancho / (ancho_m / 2))

    def X(x: float) -> float:
        return cx + x * escala

    def Y(y: float) -> float:
        return SUELO_Y - y * escala

    grad: dict[str, str] = {}

    def id_grad(color: str) -> str:
        identificador = f"c{color[1:]}"
        if identificador not in grad:
            grad[identificador] = (
                f'<radialGradient id="{identificador}" cx="0.36" cy="0.3" r="0.85" fx="0.32" fy="0.24">'
                f'<stop offset="0" stop-color="{mezclar(color, "#ffffff", 0.42)}"/>'
                f'<stop offset="0.5" stop-color="{color}"/>'
                f'<stop offset="1" stop-color="{mezclar(color, "#000000", 0.34)}"/></radialGradient>'
            )
        return identificador

    def dibujar_globo(cx0: float, cy0: float, radio: float, color: str, prof: float) -> str:
        identificador = id_grad(color)
        s = ""
        if g.sombra > 0:
            s += (
                f'<ellipse cx="{_f(cx0 + radio * 0.07)}" cy="{_f(cy0 + radio * 0.11)}"'
                f' rx="{_f(radio * 1.01)}" ry="{_f(radio * 1.01)}" fill="{_SOMBRA}"'
                f' fill-opacity="{_numero(g.sombra)}"/>'
            )
        trazo = (
            f' stroke="{mezclar(color, "#000000", 0.45)}" stroke-opacity="0.6"'
            f' stroke-width="{_numero(g.contorno)}"'
            if g.contorno > 0
            else ""
        )
        if color in translucidos:
            # Cristal: velo teñido y aro de luz, igual que en el arco y en las orgánicas.
            s += (
                f'<circle cx="{_f(cx0)}" cy="{_f(cy0)}" r="{_f(radio)}"'
                f' fill="{mezclar(color, "#ffffff", 0.78)}" fill-opacity="0.22"{trazo}/>'
            )
            s += (
                f'<circle cx="{_f(cx0)}" cy="{_f(cy0)}" r="{_f(radio * 0.9)}" fill="none"'
                f' stroke="#fff" stroke-opacity="0.22"'
                f' stroke-width="{_f(_maximo(0.8, radio * 0.05))}"/>'
            )
        else:
            s += (
                f'<circle cx="{_f(cx0)}" cy="{_f(cy0)}" r="{_f(radio)}"'
                f' fill="url(#{identificador})"{trazo}/>'
            )
        if prof < 0 and g.profundidad > 0:
            s += (
                f'<circle cx="{_f(cx0)}" cy="{_f(cy0)}" r="{_f(radio)}" fill="{_SOMBRA}"'
                f' fill-opacity="{_f(0.4 * -prof * g.profundidad)}"/>'
            )
        if g.brillo > 0:
            hx = cx0 - 0.38 * radio
            hy = cy0 - 0.46 * radio
            s += (
                f'<ellipse cx="{_f(hx)}" cy="{_f(hy)}" rx="{_f(0.17 * radio)}"'
                f' ry="{_f(0.27 * radio)}" transform="rotate(30 {_f(hx)} {_f(hy)})" fill="#fff"'
                f' fill-opacity="{_numero(g.brillo)}"/>'
            )
            s += (
                f'<path d="M{_f(cx0 + 0.64 * radio)} {_f(cy0 + 0.62 * radio)}A{_f(0.9 * radio)}'
                f' {_f(0.9 * radio)} 0 0 1 {_f(cx0 - 0.18 * radio)} {_f(cy0 + 0.9 * radio)}"'
                f' fill="none" stroke="#fff" stroke-opacity="{_f(0.28 * g.brillo)}"'
                f' stroke-width="{_f(0.06 * radio)}" stroke-linecap="round"/>'
            )
        return s

    partes: list[str] = []

    # Regla lateral: marcas cada 0,5 m y número cada metro.
    regla_x = 44
    if not simple:
        tope = _techo(alto_ref * 2) / 2
        partes.append(
            f'<line x1="{regla_x}" y1="{_f(Y(0))}" x2="{regla_x}" y2="{_f(Y(tope))}"'
            f' stroke="#8fa39a" stroke-opacity="0.45" stroke-width="1.5"/>'
        )
        mtr = 0.0
        while mtr <= tope + 1e-9:
            entero = abs(mtr - _redondear(mtr)) < 1e-9
            partes.append(
                f'<line x1="{regla_x}" y1="{_f(Y(mtr))}" x2="{regla_x + (10 if entero else 6)}"'
                f' y2="{_f(Y(mtr))}" stroke="#8fa39a" stroke-opacity="0.55" stroke-width="1.5"/>'
            )
            if entero:
                etiqueta = "0" if mtr == 0 else f"{_numero(mtr)} m"
                partes.append(
                    f'<text x="{regla_x + 14}" y="{_f(Y(mtr) + 3.5)}"'
                    f' font-family="JetBrains Mono, monospace" font-size="10.5"'
                    f' fill="#9fb0a8">{etiqueta}</text>'
                )
            mtr += 0.5

    # Suelo.
    partes.append(
        f'<line x1="20" y1="{SUELO_Y + 1}" x2="580" y2="{SUELO_Y + 1}" stroke="#8fa39a"'
        f' stroke-width="3" stroke-linecap="round" stroke-opacity="0.55"/>'
    )

    # Persona de referencia.
    if persona:
        px = 128

        def P(metros: float) -> float:
            return Y(metros)

        def w(metros: float) -> float:
            return metros * escala

        piel = "#6b7c74"
        partes.append(
            f'<g fill="{piel}" fill-opacity="0.5">'
            f'<circle cx="{px}" cy="{_f(P(1.6))}" r="{_f(w(0.105))}"/>'
            f'<rect x="{_f(px - w(0.2))}" y="{_f(P(1.48))}" width="{_f(w(0.4))}"'
            f' height="{_f(w(0.62))}" rx="{_f(w(0.08))}"/>'
            f'<rect x="{_f(px - w(0.17))}" y="{_f(P(0.88))}" width="{_f(w(0.14))}"'
            f' height="{_f(w(0.88))}" rx="{_f(w(0.04))}"/>'
            f'<rect x="{_f(px + w(0.03))}" y="{_f(P(0.88))}" width="{_f(w(0.14))}"'
            f' height="{_f(w(0.88))}" rx="{_f(w(0.04))}"/>'
            f"</g>"
            f'<text x="{px}" y="{_f(P(1.74) - 4)}" text-anchor="middle"'
            f' font-family="JetBrains Mono, monospace" font-size="10.5" fill="#9fb0a8">1,70 m</text>'
        )

    # Base.
    if c.base:
        bw = m.diametro * 1.25 * escala
        partes.append(
            f'<rect x="{_f(cx - bw / 2)}" y="{_f(Y(BASE_ALTO_M))}" width="{_f(bw)}"'
            f' height="{_f(BASE_ALTO_M * escala)}" rx="3" fill="#59635f" stroke="#2b3330"'
            f' stroke-width="1"/>'
            f'<rect x="{_f(cx - bw / 2)}" y="{_f(Y(BASE_ALTO_M))}" width="{_f(bw)}"'
            f' height="{_f(_maximo(1.5, BASE_ALTO_M * escala * 0.3))}" rx="2" fill="#7a8681"/>'
        )

    # Globos de la columna (del fondo al frente).
    y0 = m.base_alto
    for b in globos:
        partes.append(dibujar_globo(X(b.x), Y(y0 + b.y), b.r * escala, b.color, b.prof))

    # Remate.
    cima = m.cima_cuerpo
    if rem.tipo == "globo":
        radio = (diametro_m(rem.tamano, g.inflado) / 2) * escala
        partes.append(dibujar_globo(cx, Y(cima) - radio * 0.62, radio, rem.color, 1))
    elif rem.tipo == "racimo":
        radio = (diametro_m(rem.tamano, g.inflado) / 2) * escala
        cols = cfg.colores if cfg.colores else [rem.color]
        if rem.cantidad >= 5:
            pos = [(-1.05, 0.98), (1.05, 0.98), (0.0, 1.02), (-0.55, 2.05), (0.55, 2.05)]
        elif rem.cantidad == 4:
            pos = [(-1.0, 0.98), (1.0, 0.98), (-0.5, 2.0), (0.5, 2.0)]
        else:
            pos = [(-1.0, 0.98), (1.0, 0.98), (0.0, 2.0)]
        for k, (dx, dy) in enumerate(pos[: int(rem.cantidad)]):
            partes.append(
                dibujar_globo(
                    cx + dx * radio * 0.86,
                    Y(cima) - dy * radio * 0.9,
                    radio * 0.9,
                    cols[k % len(cols)],
                    0.4,
                )
            )
    elif rem.tipo in ("estrella", "corazon"):
        alto = rem.foil_m * escala
        id_foil = f"foil{rem.color[1:]}"
        grad[id_foil] = (
            f'<linearGradient id="{id_foil}" x1="0" y1="0" x2="1" y2="1">'
            f'<stop offset="0" stop-color="{mezclar(rem.color, "#ffffff", 0.75)}"/>'
            f'<stop offset="0.35" stop-color="{rem.color}"/>'
            f'<stop offset="0.6" stop-color="{mezclar(rem.color, "#000000", 0.4)}"/>'
            f'<stop offset="1" stop-color="{mezclar(rem.color, "#ffffff", 0.35)}"/></linearGradient>'
        )
        fx = cx
        fy = Y(cima) - alto * 0.5 + alto * 0.06
        if rem.tipo == "estrella":
            pts: list[str] = []
            for k in range(10):
                ang = -pi / 2 + (k * pi) / 5
                rr = alto * 0.5 if k % 2 == 0 else alto * 0.21
                pts.append(f"{_f(fx + cos(ang) * rr)},{_f(fy + sin(ang) * rr + alto * 0.04)}")
            partes.append(
                f'<polygon points="{" ".join(pts)}" fill="url(#{id_foil})"'
                f' stroke="{mezclar(rem.color, "#000000", 0.4)}" stroke-width="1"'
                f' stroke-linejoin="round"/>'
            )
        else:
            s = alto / 2
            partes.append(
                f'<path d="M{_f(fx)} {_f(fy + s * 0.92)}C{_f(fx - s * 1.5)} {_f(fy + s * 0.05)}'
                f' {_f(fx - s * 0.95)} {_f(fy - s * 0.95)} {_f(fx)} {_f(fy - s * 0.3)}'
                f'C{_f(fx + s * 0.95)} {_f(fy - s * 0.95)} {_f(fx + s * 1.5)} {_f(fy + s * 0.05)}'
                f' {_f(fx)} {_f(fy + s * 0.92)}Z" fill="url(#{id_foil})"'
                f' stroke="{mezclar(rem.color, "#000000", 0.4)}" stroke-width="1"'
                f' stroke-linejoin="round"/>'
            )

    return f"<defs>{''.join(grad.values())}</defs>{''.join(partes)}", escala


def svg_documento(interior: str, titulo: str = "Columna de globos") -> str:
    """Documento SVG completo, listo para descargar."""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {LIENZO_W} {LIENZO_H}"'
        f' width="{LIENZO_W}" height="{LIENZO_H}" role="img"'
        f' aria-label="{titulo}">{interior}</svg>\n'
    )
