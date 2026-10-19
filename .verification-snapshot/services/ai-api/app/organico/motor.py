"""El motor orgánico: dónde va cada globo, de qué color, y el SVG con el que se ve.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/organico/motor.ts``.

**Aquí se migra el dibujo**: lo que el cliente aprueba es cómo se ve, y el único que sabe dibujarlo como el
diseñador es el diseñador. El SVG que sale de aquí tiene el mismo sha256 que el del original.

Tres cosas desvían el resultado sin que nada falle, y por eso están aisladas:

- **La exponencial.** El peso de cada tamaño pasa por ``mate.exp``, el puerto del ``exp`` de V8, no por
  ``math.exp``: sobre el rango que el motor pide de verdad las dos se desvían un ulp en el 7 % de los casos,
  y ese ulp entra en una comparación acumulada contra un número al azar, así que no cambia una medida —
  cambia **qué globo sale**.
- **El orden en que se consume el azar.** Un solo generador (``semilla * 7919 + 13``) reparte las 8 fases de la
  línea guía, el desfase de los racimos y, por cada racimo, dos tiradas; por cada globo del racimo, seis, en
  este orden: clase, ángulo, radio, capa, inflado, saliente. El relleno de huecos y la relajación **no**
  consumen azar. Los colores llevan su propio generador y el follaje y las flores el suyo.
- **El orden del recorrido de vecinos en la relajación.** La rejilla son listas enlazadas en arreglos, que se
  construyen con el índice ascendente y se recorren, por tanto, descendente. Una búsqueda de vecinos
  «equivalente» resuelve los solapes en otro orden y mueve los globos a otro sitio.
- **Cómo se escribe un número dentro del SVG.** Lo resuelve ``_numero`` en ``app.motores.js``.

Lo que no se migró: ``op.corona`` (el globo de remate de las columnas) y el modo por capas sí están, pero
ninguna guirnalda los activa, así que en los vectores de oro no hay ``indice: -1`` ni ``remate: true``.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

from app.motores import mate
from app.motores.canonico import resolver_colores
from app.motores.js import _maximo, _minimo, _piso, _redondear, _resto, crear_rng
from app.organico.capas import efectiva
from app.organico.dibujo import Marco, dibujar
from app.organico.espina import Espina, crear_espina
from app.organico.tipos import TAMANOS_GLOBO, ConfigOrg, diametro_m

#: Lienzo cuadrado en el que se dibuja el arco.
LIENZO = 600

MARGEN_LADO = 30
MARGEN_ARRIBA = 30
MARGEN_ABAJO = 38

#: Tope de globos: más que esto vuelve lenta la vista previa y no es realista.
MAX_GLOBOS = 900

#: Cuánto pueden meterse dos globos uno en el otro según su distancia en profundidad.
PENETRACION = [0.06, 0.34, 0.5, 0.6]

#: Cuánto tira cada tamaño hacia abajo (grandes) o hacia arriba (chicos) con «grandes abajo».
RANGO: dict[int, float] = {5: -1, 9: -0.5, 12: 0, 18: 0.6, 24: 1, 36: 1.4}

#: Calibra la cantidad de globos con las referencias del oficio (8–12 por pie en uno ligero, 14–16 estándar).
DENSIDAD = 1.4

#: Altura de la persona de referencia (m).
PERSONA_M = 1.7


def _acotar(valor: float, minimo: float, maximo: float) -> float:
    return float(_minimo(maximo, _maximo(minimo, valor)))


@dataclass(slots=True)
class GloboOrg:
    """Un globo ya colocado y coloreado. ``capa`` es el z-order: 0 = el fondo."""

    x: float
    y: float
    r: float
    capa: int
    nominal: int
    color: str
    acabado: str
    #: Posición del color en ``colores.lista``; -1 = el globo de remate.
    indice: int


@dataclass(slots=True)
class FlorOrg:
    x: float
    y: float
    r: float
    #: 0–1: elige el tono dentro de la paleta de flores.
    tono: float


@dataclass(slots=True)
class Hoja:
    #: Dónde va sobre el tallo (0 = base, 1 = punta).
    t: float
    lado: int
    largo: float
    tono: float


@dataclass(slots=True)
class RamaOrg:
    """Un tallo de follaje. ``capa`` es un número real: queda *entre* dos capas de globos."""

    x: float
    y: float
    #: Radianes, 0 = derecha, π/2 = arriba.
    ang: float
    largo: float
    capa: float
    hojas: list[Hoja]


@dataclass(slots=True)
class B:
    """Un globo mientras se coloca, todavía sin color."""

    x: float
    y: float
    r: float
    capa: int
    nominal: int
    #: Saliente: puede salirse de la banda.
    salta: bool
    #: Índice del punto de la línea guía más cercano.
    si: int
    #: Id del racimo que lo generó (manda en el reparto «racimos»).
    racimo: int


@dataclass(slots=True)
class Disposicion:
    """Dónde queda cada globo: depende de la forma, el volumen, los tamaños y la semilla, pero NO de los colores.

    Por eso cambiar un color solo repinta y no vuelve a acomodar los globos.
    """

    bs: list[B]
    esp: Espina
    capas: int
    sueltos: int


@dataclass(slots=True)
class ResultadoOrg:
    globos: list[GloboOrg]
    ramas: list[RamaOrg]
    flores: list[FlorOrg]
    capas: int
    #: Medidas reales de la estructura (m), sin contar el follaje que asoma.
    anchoM: float
    altoM: float
    largoM: float
    grosorPatasM: float
    grosorCimaM: float
    #: Píxeles por metro.
    escala: float
    #: Globos que quedaron sin tocar a ningún otro (debería ser 0).
    sueltos: int
    conteo: list[dict[str, Any]]
    porTamano: dict[int, int]
    #: Interior del SVG, sin la etiqueta `<svg>`.
    svg: str


@dataclass(slots=True)
class OpcionesPintado:
    """Cómo se enmarca el dibujo. Por defecto, un lienzo cuadrado centrado en la estructura (arcos)."""

    lienzo: dict[str, float] | None = None
    #: Regla y persona de 1,70 m al lado (columnas y guirnaldas).
    referencia: dict[str, Any] | None = None
    #: Encuadra sobre lo que ocupa, sin el suelo: para estructuras que cuelgan de una pared.
    ajustar: bool = False
    #: Un globo grande sobre la punta (columnas).
    corona: dict[str, Any] | None = None


def resumen_mezcla(entrada: dict[str, Any]) -> dict[str, Any]:
    """La mezcla de tamaños ya normalizada, con su diámetro medio y su área media (m, m²)."""
    cfg = efectiva(entrada)
    mezcla = cfg["tamanos"]["mezcla"]
    inflado = cfg["tamanos"]["inflado"]
    usados = [t for t in TAMANOS_GLOBO if mezcla[t] > 0]
    total = sum(mezcla[t] for t in usados) or 1
    d_medio = 0.0
    area_media = 0.0
    for t in usados:
        p = mezcla[t] / total
        d = diametro_m(t, inflado)
        d_medio += p * d
        area_media += p * mate.pi * mate.pow(d / 2, 2)
    return {"usados": usados, "total": total, "dMedio": d_medio, "areaMedia": area_media}


def area_banda(esp: Espina) -> float:
    """Área que cubre la banda (m²): el grosor integrado a lo largo de la línea guía.

    Se pide hasta cinco veces por diseño (la estimación, el grosor medio y el presupuesto) sobre la misma
    línea, y la integral no depende de nada más, así que se guarda en la propia espina.
    """
    if esp.areaCache is not None:
        return float(esp.areaCache)
    a = 0.0
    puntos = esp.puntos
    for i in range(1, len(puntos)):
        ds = puntos[i].s - puntos[i - 1].s
        a += esp.grosor(puntos[i].s / esp.largo) * ds
    esp.areaCache = a
    return a


def _contar_capas(grosor_medio: float, d_medio: float) -> int:
    """Cuántas capas de globos caben en el grosor: más grueso, más profundidad."""
    return int(_acotar(_redondear((grosor_medio / d_medio) * 0.9), 2, 4))


def estimar_globos(cfg: ConfigOrg) -> float:
    """Cantidad de globos que pide un arco (sirve para avisar antes de calcularlo todo)."""
    return estimar_globos_en(cfg, crear_espina(cfg, [0.5] * 8))


def estimar_globos_en(cfg: dict[str, Any], esp: Espina) -> float:
    """Como ``estimar_globos``, sobre cualquier línea guía.

    El grosor que entra en ``_contar_capas`` es la **media de los dos grosores pedidos**, no el integrado:
    es una estimación, y así no depende de la ondulación.
    """
    resumen = resumen_mezcla(cfg)
    vol = cfg["volumen"]
    capas = _contar_capas((vol["grosorPatasM"] + vol["grosorCimaM"]) / 2, resumen["dMedio"])
    return float(
        _redondear((DENSIDAD * capas * vol["relleno"] * area_banda(esp)) / resumen["areaMedia"])
    )


def crear_disposicion(cfg: ConfigOrg) -> Disposicion:
    """Acomoda los globos de un arco orgánico: racimos, relajación, sueltos y huecos."""
    return crear_disposicion_en(cfg, lambda fase: crear_espina(cfg, fase))


def crear_disposicion_en(
    entrada: dict[str, Any], hacer_espina: Callable[[list[float]], Espina]
) -> Disposicion:
    """Como ``crear_disposicion``, sobre la línea guía que devuelva ``hacer_espina``.

    Recibe las 8 fases ya sorteadas: así la forma de la línea no depende de ningún otro ajuste.
    """
    cfg = efectiva(entrada)
    forma = cfg["forma"]
    vol = cfg["volumen"]
    tam = cfg["tamanos"]
    rng = crear_rng(cfg["aspecto"]["semilla"] * 7919 + 13)
    fase = [rng() for _ in range(8)]
    esp = hacer_espina(fase)
    P = esp.puntos
    resumen = resumen_mezcla(cfg)
    usados: list[int] = resumen["usados"]
    d_medio: float = resumen["dMedio"]
    area_media: float = resumen["areaMedia"]
    mezcla = cfg["tamanos"]["mezcla"]
    grosor = esp.grosor
    inflado = tam["inflado"]
    variacion = tam["variacion"]
    grandes_abajo = tam["grandesAbajo"]
    carga_forma = forma["carga"]

    grosor_medio = area_banda(esp) / esp.largo
    capas = _contar_capas(grosor_medio, d_medio)
    presupuesto = _minimo(
        MAX_GLOBOS, (DENSIDAD * capas * vol["relleno"] * area_banda(esp)) / area_media
    )

    # Medida acumulada del grosor: los racimos se siembran más donde la banda es más gruesa.
    acum = [0.0]
    for i in range(1, len(P)):
        acum.append(acum[i - 1] + grosor(P[i].s / esp.largo) * (P[i].s - P[i - 1].s))
    total_medida = acum[-1]

    def indice_medida(u: float) -> int:
        objetivo = u * total_medida
        lo = 0
        hi = len(acum) - 1
        while hi - lo > 1:
            m = (lo + hi) >> 1
            if acum[m] <= objetivo:
                lo = m
            else:
                hi = m
        return lo

    x_min = esp.xMin
    x_max = esp.xMax
    y_max = esp.yMax
    tope_x = mate.inf if x_max is None else x_max
    suelo_x = -mate.inf if x_min is None else x_min
    tope_y = mate.inf if y_max is None else y_max

    # --- 1. Racimos: se siembran a lo largo de la línea y cada uno reparte sus globos alrededor. ---
    bs: list[B] = []
    area = 0.0
    desfase = rng()
    c = 0
    while area < presupuesto * area_media and len(bs) < MAX_GLOBOS:
        # La posición del racimo es una secuencia dorada desde `desfase`: no consume azar.
        u_pos = _resto(desfase + c * 0.6180339887, 1)
        u_v = rng()
        u_n = rng()
        si = indice_medida(u_pos)
        fr = P[si].s / esp.largo
        T = grosor(fr)
        cx = P[si].x + P[si].nx * (u_v - 0.5) * T * 0.5
        cy = P[si].y + P[si].ny * (u_v - 0.5) * T * 0.5
        miembros = _maximo(2, _redondear(vol["racimo"] + (u_n - 0.5) * 2))
        # 1 en los extremos de la guirnalda (la pata del arco), 0 en el centro (la cima).
        baseza = 1 - mate.pow(mate.sin(mate.pi * _minimo(1, esp.pie(fr))), 0.6)
        carga = -carga_forma * (1 - 2 * fr)

        m = 0
        while m < miembros and len(bs) < MAX_GLOBOS:
            u_clase = rng()
            u_ang = rng()
            u_rad = rng()
            u_capa = rng()
            u_infl = rng()
            u_sal = rng()
            # Elección de tamaño por peso, sesgada por la posición.
            suma = 0.0
            pesos: list[float] = []
            for t in usados:
                # Donde la banda es delgada no caben globos mucho más grandes que el grosor.
                cabe = 1 if (t == usados[0] or diametro_m(t, inflado) <= T * 1.2) else 0.06
                p = (
                    mezcla[t]
                    * cabe
                    * mate.exp(
                        grandes_abajo * 2.2 * RANGO[t] * (baseza - 0.4) + 0.6 * carga * RANGO[t]
                    )
                )
                suma += p
                pesos.append(p)
            acu = 0.0
            nominal = usados[-1]
            for k in range(len(usados)):
                acu += pesos[k] / suma
                if u_clase <= acu:
                    nominal = usados[k]
                    break
            d = diametro_m(nominal, inflado) * (1 - variacion * u_infl)
            r = d / 2
            # Los grandes van más al frente.
            tam_norm = _acotar((RANGO[nominal] + 1) / 2.4, 0, 1)
            capa = int(_minimo(capas - 1, _piso(mate.pow(u_capa, 1.6 - 1.1 * tam_norm) * capas)))
            ang = u_ang * mate.pi * 2
            rad = d_medio * 0.62 * mate.sqrt(u_rad)
            bs.append(
                B(
                    x=_minimo(tope_x - r, _maximo(suelo_x + r, cx + mate.cos(ang) * rad)),
                    y=_minimo(tope_y, _maximo(r, cy + mate.sin(ang) * rad) + r) - r,
                    r=r,
                    capa=capa,
                    nominal=nominal,
                    salta=u_sal < vol["salientes"] * 0.3,
                    si=si,
                    racimo=c,
                )
            )
            area += mate.pi * r * r
            m += 1
        c += 1

    # --- 2. Relajación: los globos se empujan hasta quedar apretados y dentro de la banda. ---
    n = len(bs)
    r_max = 0.05
    for b in bs:
        r_max = _maximo(r_max, b.r)
    celda = r_max * 2
    grosores = [grosor(p.s / esp.largo) for p in P]

    def limite_banda(b: B) -> float:
        return float(
            _maximo(0.04, grosores[b.si] / 2 - b.r * 0.85) + (b.r * 0.95 if b.salta else 0)
        )

    # Rejilla de vecinos: listas enlazadas en arreglos (sin crear objetos en cada vuelta).
    min_gx = mate.inf
    min_gy = mate.inf
    max_gx = -mate.inf
    max_gy = -mate.inf
    for b in bs:
        min_gx = _minimo(min_gx, b.x - 2 * r_max)
        min_gy = _minimo(min_gy, 0)
        max_gx = _maximo(max_gx, b.x + 2 * r_max)
        max_gy = _maximo(max_gy, b.y + 2 * r_max)
    # Durante la relajación los globos se mueven poco: basta con dejar margen alrededor de donde empiezan.
    margen = 4 * r_max + esp.largo * 0.02
    gx0 = min_gx - margen
    # A `gy0` NO se le resta el margen (y `min_gy` siempre acaba en 0 por el `min(.., 0)` de arriba): la
    # asimetría es del original y mueve los globos de la fila de abajo a otra celda.
    gy0 = min_gy
    gw = int(_maximo(1, mate.ceil((max_gx + margen - gx0) / celda)))
    gh = int(_maximo(1, mate.ceil((max_gy + margen - gy0) / celda)))
    cabeza = [-1] * (gw * gh)
    sigue = [-1] * n

    iteraciones = 80
    calmas = 0
    for it in range(iteraciones):
        # El empuje es más suave en el último cuarto de las vueltas, para que no se pase de largo.
        k_empuje = 0.5 if it < iteraciones * 0.75 else 0.35
        for i in range(gw * gh):
            cabeza[i] = -1
        for i in range(n):
            b = bs[i]
            cx_i = int(_minimo(gw - 1, _maximo(0, _piso((b.x - gx0) / celda))))
            cy_i = int(_minimo(gh - 1, _maximo(0, _piso((b.y - gy0) / celda))))
            celda_i = cy_i * gw + cx_i
            sigue[i] = cabeza[celda_i]
            cabeza[celda_i] = i
        mayor = 0.0
        for i in range(n):
            a = bs[i]
            # La celda se recalcula con la posición ACTUAL de `a`, que los empujes anteriores pueden haber movido.
            cx_i = int(_minimo(gw - 1, _maximo(0, _piso((a.x - gx0) / celda))))
            cy_i = int(_minimo(gh - 1, _maximo(0, _piso((a.y - gy0) / celda))))
            for gy in range(max(0, cy_i - 1), min(gh - 1, cy_i + 1) + 1):
                for gxx in range(max(0, cx_i - 1), min(gw - 1, cx_i + 1) + 1):
                    j = cabeza[gy * gw + gxx]
                    while j >= 0:
                        if j > i:
                            b = bs[j]
                            dx = b.x - a.x
                            dy = b.y - a.y
                            dist = mate.sqrt(dx * dx + dy * dy) or 1e-6
                            minimo = (a.r + b.r) * (1 - PENETRACION[min(3, abs(a.capa - b.capa))])
                            if dist < minimo:
                                empuje = (minimo - dist) * k_empuje
                                if empuje > mayor:
                                    mayor = empuje
                                # El chico se mueve más.
                                wa = (b.r * b.r) / (a.r * a.r + b.r * b.r)
                                ux = dx / dist
                                uy = dy / dist
                                a.x -= ux * empuje * wa
                                a.y -= uy * empuje * wa
                                b.x += ux * empuje * (1 - wa)
                                b.y += uy * empuje * (1 - wa)
                        j = sigue[j]
        # Paredes de la banda y suelo.
        for b in bs:
            mejor = b.si
            d_mejor = mate.inf
            for q in range(max(0, b.si - 14), min(len(P) - 1, b.si + 14) + 1):
                p = P[q]
                d2 = (p.x - b.x) ** 2 + (p.y - b.y) ** 2
                if d2 < d_mejor:
                    d_mejor = d2
                    mejor = q
            b.si = mejor
            p = P[mejor]
            v = (b.x - p.x) * p.nx + (b.y - p.y) * p.ny
            lim = limite_banda(b)
            if mate.fabs(v) > lim:
                corr = (mate.fabs(v) - lim) * 0.65 * (0.0 if v == 0 else mate.copysign(1, v))
                b.x -= p.nx * corr
                b.y -= p.ny * corr
                if mate.fabs(corr) > mayor:
                    mayor = mate.fabs(corr)
            # Cohesión suave hacia la línea guía, con el `v` de ANTES de la corrección.
            b.x -= p.nx * v * 0.012
            b.y -= p.ny * v * 0.012
            if b.y < b.r:
                b.y = b.r
            if y_max is not None and b.y + b.r > y_max:
                b.y = _maximo(b.r, y_max - b.r)
            if x_min is not None and b.x - b.r < x_min:
                b.x = x_min + b.r
            if x_max is not None and b.x + b.r > x_max:
                b.x = x_max - b.r
        # Si ya casi nada se mueve, no hace falta seguir.
        calmas = calmas + 1 if mayor < 0.0015 else 0
        if it > 24 and calmas >= 3:
            break

    # --- 3. Sueltos: cualquier globo que quedó sin tocar a otro se acerca al más cercano. ---
    def pegar() -> int:
        sueltos = 0
        for i in range(n):
            a = bs[i]
            mejor_j = -1
            hueco = mate.inf
            for j in range(n):
                if j == i:
                    continue
                b = bs[j]
                h = mate.hypot(b.x - a.x, b.y - a.y) - (a.r + b.r)
                if h < hueco:
                    hueco = h
                    mejor_j = j
            if mejor_j >= 0 and hueco > 0.08 * a.r:
                sueltos += 1
                b = bs[mejor_j]
                dist = mate.hypot(b.x - a.x, b.y - a.y) or 1e-6
                objetivo = (a.r + b.r) * 0.86
                # `Infinity - r` sigue siendo infinito: los límites sin definir no recortan nada.
                a.x = _minimo(
                    tope_x - a.r, _maximo(suelo_x + a.r, b.x - ((b.x - a.x) / dist) * objetivo)
                )
                a.y = _minimo(tope_y - a.r, _maximo(a.r, b.y - ((b.y - a.y) / dist) * objetivo))
        return sueltos

    pegar()
    pegar()
    sueltos = pegar()

    # --- 3b. Huecos: los globos chicos tapan los vacíos entre racimos (el tamaño lo decide el hueco). ---
    # Este paso no consume azar: es determinista dada la disposición. Los globos de relleno van siempre en la
    # capa 0 y no pasan por la relajación, pero heredan el racimo del globo en el que se apoyan, así que sí
    # entran en el reparto «racimos».
    radios = sorted(
        ({"t": t, "r": (diametro_m(t, inflado) / 2) * (1 - variacion * 0.4)} for t in usados),
        key=lambda k: k["r"],
    )
    rf: float = radios[0]["r"]
    umbral = rf * (2.4 - 1.7 * vol["relleno"])
    cand: list[dict[str, Any]] = []
    paso = _maximo(0.045, rf * 0.9)
    q = 0
    while q < len(P):
        p = P[q]
        T = grosor(p.s / esp.largo)
        lim = _maximo(0.03, T / 2 - rf * 0.85)
        # Acumulación en coma flotante, como el `for (v = -lim; v <= lim + 1e-9; v += paso)` del original.
        v = -lim
        while v <= lim + 1e-9:
            y = p.y + p.ny * v
            if y >= rf * 0.9:
                cand.append({"x": p.x + p.nx * v, "y": y, "si": q, "claro": mate.inf})
            v += paso
        meta = p.s + paso
        while q < len(P) and P[q].s < meta:
            q += 1
    for o in cand:
        claro = o["claro"]
        ox = o["x"]
        oy = o["y"]
        for b in bs:
            d = mate.hypot(b.x - ox, b.y - oy) - b.r
            if d < claro:
                claro = d
        o["claro"] = claro
    colocados = 0
    while len(bs) < MAX_GLOBOS and colocados < 260:
        # El candidato con MÁS espacio libre, si supera el umbral (primer máximo estricto).
        mejor_i = -1
        claro_mejor = umbral
        for i in range(len(cand)):
            if cand[i]["claro"] > claro_mejor:
                claro_mejor = cand[i]["claro"]
                mejor_i = i
        if mejor_i < 0:
            break
        o = cand[mejor_i]
        # El tamaño más grande de la mezcla que cabe en el hueco.
        clase = radios[0]
        for radio in radios:
            if radio["r"] <= o["claro"] * 1.15 + rf * 0.3:
                clase = radio
        r = clase["r"]
        # Se apoya en el globo más cercano, para no quedar flotando.
        cercano = bs[0]
        d_cercano = mate.inf
        for b in bs:
            d = mate.hypot(b.x - o["x"], b.y - o["y"]) - b.r
            if d < d_cercano:
                d_cercano = d
                cercano = b
        dist = mate.hypot(cercano.x - o["x"], cercano.y - o["y"]) or 1e-6
        objetivo = (r + cercano.r) * 0.88
        px = _minimo(
            tope_x - r, _maximo(suelo_x + r, cercano.x - ((cercano.x - o["x"]) / dist) * objetivo)
        )
        py = _minimo(tope_y - r, _maximo(r, cercano.y - ((cercano.y - o["y"]) / dist) * objetivo))
        bs.append(
            B(
                x=px,
                y=py,
                r=r,
                capa=0,
                nominal=clase["t"],
                salta=False,
                si=o["si"],
                racimo=cercano.racimo,
            )
        )
        for otro in cand:
            d = mate.hypot(otro["x"] - px, otro["y"] - py) - r
            if d < otro["claro"]:
                otro["claro"] = d
        # Si los límites movieron el globo, este hueco no vuelve a intentarse.
        o["claro"] = -1
        colocados += 1

    return Disposicion(bs=bs, esp=esp, capas=capas, sueltos=sueltos)


def pintar(
    entrada: dict[str, Any], disp: Disposicion, op: OpcionesPintado | None = None
) -> ResultadoOrg:
    """Coloca colores, follaje y flores sobre una disposición y arma el dibujo."""
    opciones = OpcionesPintado() if op is None else op
    bs, esp, capas, sueltos = disp.bs, disp.esp, disp.capas, disp.sueltos
    # Los colores canónicos (`sx:041`) se cambian por su hexadecimal aquí: de esta línea para abajo el motor
    # solo ve `#rrggbb`.
    cfg = resolver_colores(efectiva(entrada))
    col = cfg["colores"]
    aspecto = cfg["aspecto"]
    lienzo = opciones.lienzo if opciones.lienzo is not None else {"w": LIENZO, "h": LIENZO}

    # --- 4. Colores ---
    orden = colorear(cfg, bs, esp)
    globos = [
        GloboOrg(
            x=b.x,
            y=b.y,
            r=b.r,
            capa=b.capa,
            nominal=b.nominal,
            color=col["lista"][orden[i]]["hex"],
            acabado=col["lista"][orden[i]]["acabado"],
            indice=orden[i],
        )
        for i, b in enumerate(bs)
    ]
    if opciones.corona is not None:
        # Globo grande sobre la punta (columnas): queda delante de todo y montado sobre los de abajo.
        r = diametro_m(opciones.corona["tamano"], cfg["tamanos"]["inflado"]) / 2
        tope = 0.0
        for g in globos:
            tope = _maximo(tope, g.y + g.r)
        punta = esp.puntos[-1]
        globos.append(
            GloboOrg(
                x=punta.x,
                y=tope + r * 0.55,
                r=r,
                capa=capas,
                nominal=opciones.corona["tamano"],
                color=opciones.corona["color"],
                acabado="mate",
                indice=-1,
            )
        )
    # Del fondo al frente; dentro de cada capa, de arriba a abajo para que se monten de forma natural.
    globos_ordenados = sorted(globos, key=lambda g: (g.capa, -g.y))

    # --- 5. Follaje y flores ---
    ramas = _crear_ramas(cfg, esp, capas, aspecto["semilla"])
    flores = _crear_flores(cfg, esp, aspecto["semilla"])

    # --- Conteo y medidas (sobre `globos` SIN ordenar; el conteo se ordena después) ---
    cuenta: dict[str, dict[str, Any]] = {}
    por_tamano: dict[int, int] = {5: 0, 9: 0, 12: 0, 18: 0, 24: 0, 36: 0}
    for g in globos:
        clave = f"{g.indice}|{g.nominal}"
        entrada_cuenta = cuenta.get(clave)
        if entrada_cuenta is not None:
            entrada_cuenta["cantidad"] += 1
        else:
            nueva: dict[str, Any] = {
                "color": g.color,
                "acabado": g.acabado,
                "indice": g.indice,
                "nominal": g.nominal,
                "cantidad": 1,
            }
            if g.indice < 0:
                nueva["remate"] = True
            cuenta[clave] = nueva
        por_tamano[g.nominal] += 1

    min_x = mate.inf
    max_x = -mate.inf
    max_y = 0.0
    min_y = mate.inf
    for g in globos:
        min_x = _minimo(min_x, g.x - g.r)
        max_x = _maximo(max_x, g.x + g.r)
        max_y = _maximo(max_y, g.y + g.r)
        min_y = _minimo(min_y, g.y - g.r)
    # Medidas de la estructura en sí: el follaje solo asoma.
    ancho_arco_m = max_x - min_x
    alto_arco_m = max_y
    for rama in ramas:
        px = rama.x + mate.cos(rama.ang) * rama.largo
        py = rama.y + mate.sin(rama.ang) * rama.largo
        min_x = _minimo(min_x, px - 0.08)
        max_x = _maximo(max_x, px + 0.08)
        max_y = _maximo(max_y, py + 0.08)
    ancho_m = _maximo(0.5, max_x - min_x)
    y_base = _maximo(0, min_y - 0.05) if opciones.ajustar else 0
    alto_m = _maximo(0.5, max_y - y_base)

    referencia: dict[str, Any] | None = None
    if opciones.referencia is not None:
        # El suelo va abajo, la persona a la izquierda y la estructura a la derecha, todo a la misma escala.
        ref = opciones.referencia
        persona = bool(ref["persona"])
        alto_ref = _maximo(alto_m, PERSONA_M if persona else 0)
        centro = ref.get("centro", 392 if persona else 330)
        piso = lienzo["h"] - ref.get("margenAbajo", 52)
        escala = _minimo(
            (piso - 34) / alto_ref, ref.get("mitad", 165 if persona else 250) / (ancho_m / 2)
        )
        referencia = {
            "persona": persona,
            "altoRef": alto_ref,
            "personaX": ref.get("personaX"),
            "reglaX": ref.get("reglaX"),
        }
    else:
        escala = _minimo(
            (lienzo["w"] - 2 * MARGEN_LADO) / ancho_m,
            (lienzo["h"] - MARGEN_ARRIBA - MARGEN_ABAJO) / alto_m,
        )
        piso = (
            MARGEN_ARRIBA
            + (lienzo["h"] - MARGEN_ARRIBA - MARGEN_ABAJO - alto_m * escala) / 2
            + alto_m * escala
            + y_base * escala
        )
        centro = lienzo["w"] / 2
    marco = Marco(
        escala=escala,
        piso=piso,
        cx=centro - ((min_x + max_x) / 2) * escala,
        centro=centro,
        anchoPx=ancho_m * escala,
        w=lienzo["w"],
        h=lienzo["h"],
        referencia=referencia,
    )

    fra_cima = _minimo(1, (0.5 * esp.largoCompleto) / esp.largo)
    espejo = cfg["forma"]["espejo"]
    cima = esp.fraCima if esp.fraCima is not None else ((1 - fra_cima) if espejo else fra_cima)
    return ResultadoOrg(
        globos=globos_ordenados,
        ramas=ramas,
        flores=flores,
        capas=capas,
        anchoM=ancho_arco_m,
        altoM=alto_arco_m,
        largoM=esp.largo,
        grosorPatasM=esp.grosor(0.98 if espejo else 0.02),
        grosorCimaM=esp.grosor(cima),
        escala=escala,
        sueltos=sueltos,
        conteo=sorted(cuenta.values(), key=lambda c: (c["indice"], c["nominal"])),
        porTamano=por_tamano,
        svg=dibujar(globos_ordenados, ramas, flores, cfg, marco, capas),
    )


def generar(cfg: ConfigOrg) -> ResultadoOrg:
    """Acomoda y pinta un arco orgánico de una sola vez."""
    return pintar(cfg, crear_disposicion(cfg))


@dataclass(slots=True)
class BColor:
    """Lo que el reparto de colores necesita de un globo."""

    x: float
    y: float
    r: float
    capa: int
    si: int
    racimo: int
    nominal: int | None = None


def colorear(cfg: dict[str, Any], bs: list[B], esp: Espina) -> list[int]:
    """El índice del color de cada globo.

    Primero se reparten los acentos (globos sueltos que no se tocan entre sí) y el resto se colorea con los
    colores base según el reparto elegido.

    Con ``colores.cuotas`` (opcional), cuántos globos lleva cada color se fija antes, con ``cuotas_por_peso``, y
    el reparto solo decide dónde va cada uno. Sin ella todo sigue exactamente como antes, globo por globo.
    """
    col = cfg["colores"]
    lista = col["lista"]
    tamano_de = col.get("tamanoDe")
    cuotas = col.get("cuotas") is True
    semilla = cfg["aspecto"]["semilla"] * 104729 + 7
    if not tamano_de:
        return _colorear_lista(lista, col["reparto"], col["mezcla"], semilla, bs, esp, cuotas)
    # Por capas: cada tamaño se colorea, con el mismo reparto, solo con los colores de las capas de ese tamaño.
    salida = [0] * len(bs)
    tamanos = list(dict.fromkeys((b.nominal if b.nominal is not None else 12) for b in bs))
    for t in tamanos:
        indices = [i for i, b in enumerate(bs) if (b.nominal if b.nominal is not None else 12) == t]
        capas_t = [i for i in range(len(lista)) if tamano_de[i] == t]
        if not capas_t:
            # Ninguna capa de este tamaño (no debería pasar): se usan las del tamaño más parecido.
            parecido = tamano_de[0]
            for u in tamano_de:
                if abs(diametro_m(u, 1) - diametro_m(t, 1)) < abs(
                    diametro_m(parecido, 1) - diametro_m(t, 1)
                ):
                    parecido = u
            capas_t = [i for i in range(len(lista)) if tamano_de[i] == parecido]
        local = _colorear_lista(
            [lista[i] for i in capas_t],
            col["reparto"],
            col["mezcla"],
            semilla + t * 7919,
            [bs[i] for i in indices],
            esp,
            cuotas,
        )
        for k, ig in enumerate(indices):
            salida[ig] = capas_t[local[k]]
    return salida


def cuotas_por_peso(pesos: Sequence[float], n: int) -> list[int]:
    """Cuántos globos le tocan a cada color cuando la cantidad la manda el plan (``colores.cuotas``).

    La parte de cada peso sobre ``n``, redondeada por el mayor resto. Suman ``n`` exactos. Un resto empatado lo
    gana el color que va antes en la lista; un peso negativo cuenta como cero y, si ninguno pesa, se reparte por
    igual. Solo usa sumas, productos, cocientes y ``floor``, que IEEE-754 fija: da lo mismo que el original en
    cualquier plataforma. Las sumas van en un bucle y no con ``sum()``, que desde Python 3.12 compensa el
    redondeo y ya no suma como ``reduce`` de JavaScript.
    """
    positivos = [_maximo(0, p) for p in pesos]
    w = positivos if any(p > 0 for p in positivos) else [1.0 for _ in positivos]
    if n <= 0 or not w:
        return [0 for _ in w]
    total = 0.0
    for p in w:
        total += p
    exactas = [(n * p) / total for p in w]
    cuotas = [int(_piso(q)) for q in exactas]
    faltan = n
    for q in cuotas:
        faltan -= q
    por_resto = sorted(range(len(w)), key=lambda i: (-(exactas[i] - cuotas[i]), i))
    k = 0
    while faltan > 0:
        cuotas[por_resto[k]] += 1
        k = (k + 1) % len(por_resto)
        faltan -= 1
    return cuotas


#: Con cuotas, cuánto resta (en la escala de la proporción, 0–1) repetir el color del racimo anterior. Sin
#: cuotas está prohibido, y eso es lo que impedía que un color pasara de la mitad de los racimos: con uno del
#: 70 % la repetición no se puede evitar.
REPETIR_RACIMO = 0.15


def _colorear_lista(
    lista: list[dict[str, Any]],
    reparto: str,
    mezcla: float,
    semilla: float,
    bs: list[B],
    esp: Espina,
    cuotas: bool = False,
) -> list[int]:
    n = len(bs)
    rnd = crear_rng(semilla)
    todos = list(range(len(lista)))
    acentos_idx = [i for i in todos if lista[i]["rol"] == "acento"]
    base_idx = [i for i in todos if lista[i]["rol"] != "acento"]
    # Si todos son acentos, se tratan como colores base.
    base = base_idx if base_idx else todos
    acentos = acentos_idx if base_idx else []
    salida = [-1] * n
    fr = [esp.puntos[b.si].s / esp.largo for b in bs]

    def toca(i: int, j: int) -> bool:
        return bool(mate.hypot(bs[j].x - bs[i].x, bs[j].y - bs[i].y) < (bs[i].r + bs[j].r) * 1.02)

    # 1) Acentos: globos sueltos, sin tocarse entre sí.
    if acentos:
        peso_ac = sum(lista[i]["peso"] for i in acentos)
        peso_base = sum(lista[i]["peso"] for i in base)
        cuota = _redondear((n * peso_ac) / (peso_ac + peso_base))
        orden = [o[0] for o in sorted(((i, rnd()) for i in range(n)), key=lambda o: o[1])]
        cuenta: dict[int, int] = dict.fromkeys(acentos, 0)
        # Con cuotas, el presupuesto de los acentos se reparte entre ellos por el mayor resto y ninguno pasa
        # del suyo.
        tope = cuotas_por_peso([lista[i]["peso"] for i in acentos], int(cuota)) if cuotas else None
        puestos = 0

        def poner_acento(i: int) -> None:
            nonlocal puestos
            # El acento más atrasado respecto a su proporción.
            mejor = acentos[0]
            mejor_puntaje = -mate.inf
            for a, cc in enumerate(acentos):
                if tope is not None and cuenta[cc] >= tope[a]:
                    continue
                puntaje = lista[cc]["peso"] / peso_ac - cuenta[cc] / (puestos + 1) + rnd() * 0.15
                if puntaje > mejor_puntaje:
                    mejor_puntaje = puntaje
                    mejor = cc
            salida[i] = mejor
            cuenta[mejor] = cuenta[mejor] + 1
            puestos += 1

        for i in orden:
            if puestos >= cuota:
                break
            vecino = False
            for j in range(n):
                if vecino:
                    break
                if salida[j] >= 0 and lista[salida[j]]["rol"] == "acento" and toca(i, j):
                    vecino = True
            if vecino:
                continue
            poner_acento(i)
        # Con cuotas el presupuesto se cumple entero: si ya no queda un globo que no toque otro acento, los que
        # faltan van igual, en el mismo orden al azar. Devolvérselos a los colores base cambiaría lo que se compra.
        if tope is not None:
            for i in orden:
                if puestos >= cuota:
                    break
                if salida[i] < 0:
                    poner_acento(i)

    # 2) Colores base en lo que quedó.
    K = len(base)
    total_peso = sum(lista[i]["peso"] for i in base) or 1
    meta = [lista[i]["peso"] / total_peso for i in base]
    if K == 1:
        for i in range(n):
            if salida[i] < 0:
                salida[i] = base[0]
        return salida
    # Con cuotas, cuántos globos lleva cada color base se decide aquí, sobre los que quedaron libres; el reparto
    # solo dice dónde.
    objetivo = (
        cuotas_por_peso([lista[i]["peso"] for i in base], sum(1 for c in salida if c < 0))
        if cuotas
        else None
    )

    if reparto == "tramos" and objetivo is not None:
        # Con cuotas, los tramos se cortan por cantidad de globos y no por largo: los libres se ordenan a lo largo
        # de la pieza (con el mismo difuminado de siempre) y cada color se lleva los suyos, en el orden de la lista.
        posiciones: list[tuple[float, int]] = []
        for i in range(n):
            if salida[i] < 0:
                posiciones.append((_acotar(fr[i] + (rnd() - 0.5) * 0.5 * mezcla, 0, 0.9999), i))
        posiciones.sort()
        c = 0
        quedan = objetivo[0]
        for _f, i in posiciones:
            while quedan == 0:
                c += 1
                quedan = objetivo[c]
            salida[i] = base[c]
            quedan -= 1
        return salida

    if reparto == "tramos":
        # Cada color base ocupa un tramo proporcional a su peso; los bordes se difuminan con `mezcla`.
        cortes: list[float] = []
        acu = 0.0
        for m in meta:
            acu += m
            cortes.append(acu)
        for i in range(n):
            if salida[i] >= 0:
                continue
            f = _acotar(fr[i] + (rnd() - 0.5) * 0.5 * mezcla, 0, 0.9999)
            c = next((k for k, corte in enumerate(cortes) if f < corte), -1)
            if c < 0:
                c = K - 1
            salida[i] = base[c]
        return salida

    if reparto == "racimos":
        # Cada racimo es de un solo color: se ordenan a lo largo de la línea y se colorean con el color base
        # más atrasado respecto a su proporción, distinto del racimo anterior.
        grupos: dict[int, dict[str, Any]] = {}
        for i, b in enumerate(bs):
            g = grupos.get(b.racimo)
            if g is None:
                g = {"suma": 0.0, "cuantos": 0, "miembros": []}
                grupos[b.racimo] = g
            g["suma"] += fr[i]
            g["cuantos"] += 1
            g["miembros"].append(i)
        ordenados = sorted(grupos.values(), key=lambda g: g["suma"] / g["cuantos"])
        if objetivo is not None:
            return _racimos_con_cuotas(ordenados, objetivo, base, bs, salida, mezcla, rnd)
        usados_c = [0] * K
        colocados = 0
        previo = -1
        for g in ordenados:
            mejor = 0
            mejor_puntaje = -mate.inf
            for cc in range(K):
                if cc == previo:
                    continue
                puntaje = meta[cc] - usados_c[cc] / (colocados + g["cuantos"]) + rnd() * 0.08
                if puntaje > mejor_puntaje:
                    mejor_puntaje = puntaje
                    mejor = cc
            usados_c[mejor] += g["cuantos"]
            colocados += g["cuantos"]
            previo = mejor
            for i in g["miembros"]:
                if salida[i] >= 0:
                    continue
                salida[i] = base[int(_piso(rnd() * K)) if rnd() < mezcla * 0.3 else mejor]
        return salida

    # Al azar equilibrado: en orden aleatorio, prefiere el color más atrasado y evita el de los vecinos.
    indices = [i for i in range(n) if salida[i] < 0]
    for i in range(len(indices) - 1, 0, -1):
        j = int(_piso(rnd() * (i + 1)))
        indices[i], indices[j] = indices[j], indices[i]
    if objetivo is not None:
        # Con cuotas, el color sale de los que aún tienen globos por poner: pesa lo que le falta frente a lo que
        # queda por colorear y resta cada vecino que ya lo lleva. Evitar al vecino es una preferencia que nunca
        # rompe una cuota.
        resta = list(objetivo)
        quedan = len(indices)
        for i in indices:
            vecinos = [salida[j] for j in range(n) if j != i and salida[j] >= 0 and toca(i, j)]
            mejor = -1
            mejor_puntaje = -mate.inf
            for cc in range(K):
                if resta[cc] == 0:
                    continue
                repetidos = sum(1 for v in vecinos if v == base[cc])
                puntaje = (resta[cc] / quedan) * 4 - repetidos * 0.9 + rnd() * 0.25
                if puntaje > mejor_puntaje:
                    mejor_puntaje = puntaje
                    mejor = cc
            salida[i] = base[mejor]
            resta[mejor] -= 1
            quedan -= 1
        return salida
    cuenta_base = [0] * K
    colocados = 0
    for i in indices:
        vecinos = [salida[j] for j in range(n) if j != i and salida[j] >= 0 and toca(i, j)]
        mejor = 0
        mejor_puntaje = -mate.inf
        for cc in range(K):
            deficit = meta[cc] - cuenta_base[cc] / (colocados + 1)
            repetidos = sum(1 for v in vecinos if v == base[cc])
            puntaje = deficit * 4 - repetidos * 0.9 + rnd() * 0.25
            if puntaje > mejor_puntaje:
                mejor_puntaje = puntaje
                mejor = cc
        salida[i] = base[mejor]
        cuenta_base[mejor] += 1
        colocados += 1
    return salida


def _racimos_con_cuotas(
    ordenados: list[dict[str, Any]],
    objetivo: list[int],
    base: list[int],
    bs: list[B],
    salida: list[int],
    mezcla: float,
    rnd: Callable[[], float],
) -> list[int]:
    """El reparto en racimos con cuotas.

    Cada racimo, en orden a lo largo de la pieza, va al color base que más se atrasó respecto a su cuota, y
    repetir el color del racimo anterior resta ``REPETIR_RACIMO`` en vez de estar prohibido. Si al color no le
    alcanza para el racimo entero, el resto del racimo —lo más adelantado a lo largo de la pieza— pasa al
    siguiente color: los conteos salen exactos y como mucho K − 1 racimos quedan partidos en dos colores.
    """
    libres_todos = [i for i in range(len(bs)) if salida[i] < 0]
    total = len(libres_todos)
    resta = list(objetivo)
    colocados = 0
    previo = -1
    for g in ordenados:
        # Por el punto de la línea guía (``si``, entero y creciente a lo largo de la pieza) y no por ``fr``: el
        # orden no depende así del último bit de una división.
        miembros = sorted((i for i in g["miembros"] if salida[i] < 0), key=lambda i: (bs[i].si, i))
        k = 0
        while k < len(miembros):
            quedan = len(miembros) - k
            mejor = -1
            mejor_puntaje = -mate.inf
            for c in range(len(objetivo)):
                if resta[c] == 0:
                    continue
                puntaje = (
                    objetivo[c] / total
                    - (objetivo[c] - resta[c]) / (colocados + quedan)
                    - (REPETIR_RACIMO if c == previo else 0)
                    + rnd() * 0.08
                )
                if puntaje > mejor_puntaje:
                    mejor_puntaje = puntaje
                    mejor = c
            toma = min(quedan, resta[mejor])
            for q in range(k, k + toma):
                salida[miembros[q]] = base[mejor]
            k += toma
            resta[mejor] -= toma
            colocados += toma
            previo = mejor
    # La mezcla ensucia los racimos sin tocar los conteos: un globo cambia su color por el de otro libre al azar.
    # Cada cambio mancha dos globos, así que va con la mitad de la probabilidad con que antes se manchaba uno.
    for i in libres_todos:
        if rnd() < mezcla * 0.15:
            j = libres_todos[int(_piso(rnd() * total))]
            salida[i], salida[j] = salida[j], salida[i]
    return salida


def _crear_flores(cfg: dict[str, Any], esp: Espina, semilla: float) -> list[FlorOrg]:
    """Flores pequeñas repartidas por la estructura, sobre los globos."""
    cantidad = _redondear(cfg["adornos"]["flores"] * esp.largo)
    rnd = crear_rng(semilla * 7368787 + 11)
    flores: list[FlorOrg] = []
    i = 0
    while i < cantidad:
        f = 0.04 + ((i + rnd() * 0.85) / _maximo(1, cantidad)) * 0.92
        p = esp.puntos[esp.indiceEn(f)]
        T = esp.grosor(f)
        v = (rnd() - 0.5) * T * 0.9
        flores.append(
            FlorOrg(
                x=p.x + p.nx * v,
                y=_maximo(0.08, p.y + p.ny * v),
                r=0.032 + rnd() * 0.02,
                tono=rnd(),
            )
        )
        i += 1
    return flores


def _crear_ramas(cfg: dict[str, Any], esp: Espina, capas: int, semilla: float) -> list[RamaOrg]:
    """Ramas de follaje: tallos que salen de dentro de la banda y asoman por afuera."""
    cantidad = _redondear(cfg["adornos"]["follaje"] * esp.largo)
    rnd = crear_rng(semilla * 1299709 + 3)
    ramas: list[RamaOrg] = []
    i = 0
    while i < cantidad:
        f = _resto(0.06 + ((i + rnd() * 0.8) / _maximo(1, cantidad)) * 0.88, 1)
        p = esp.puntos[esp.indiceEn(f)]
        T = esp.grosor(f)
        lado = 1 if rnd() < (0.5 if esp.simetrica else 0.8) else -1
        base = lado * T * (0.05 + rnd() * 0.2)
        largo = 0.4 + rnd() * 0.4
        # Hacia afuera de la banda (o hacia adentro, si sale por el interior), con una inclinación al azar.
        rumbo = mate.atan2(p.ny * lado, p.nx * lado) + (rnd() - 0.5) * 1.3
        n_hojas = 6 + int(_piso(rnd() * 4))
        hojas = [
            Hoja(
                t=(k + 1.3) / (n_hojas + 0.6),
                lado=1 if k % 2 == 0 else -1,
                largo=0.12 + rnd() * 0.07,
                tono=rnd(),
            )
            for k in range(n_hojas)
        ]
        ramas.append(
            RamaOrg(
                x=p.x + p.nx * base,
                y=_maximo(0.05, p.y + p.ny * base),
                ang=rumbo,
                largo=largo,
                capa=_minimo(capas - 1, _piso(rnd() * _maximo(1, capas - 1))) - 0.5,
                hojas=hojas,
            )
        )
        i += 1
    return ramas
