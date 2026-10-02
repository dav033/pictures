"""El motor del arco: dónde va cada globo, de qué color, y el SVG con el que se ve.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/arco/motor.ts``.

**Aquí sí se migra el dibujo.** En la columna el SVG se dejó fuera porque era pantalla; en el arco no se puede:
lo que el cliente aprueba es el dibujo, y el único que sabe dibujarlo como el diseñador es el diseñador. El SVG
que sale de aquí tiene el mismo sha256 que el del original, y los vectores de oro lo comprueban caso por caso.

Dos cosas desvían el resultado sin que nada falle, y por eso están aisladas:

- **El orden en que se consume el azar.** Por cada globo: el patrón (solo algunos lo usan y solo en algunas
  ramas), dos tiradas para la variación de tono *si* está encendida, una para el desorden en x, otra para el de
  y, otra para el tamaño y otra para el giro. Siempre ese orden, siempre esa cantidad.
- **Cómo se escribe un número dentro del SVG.** Lo resuelve ``_numero`` en ``app.motores.js``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, cast

from app.arco.patrones import PATRONES, Ctx, config_inicial
from app.arco.tipos import INFLADO_PULG, MAX_SECUENCIA_ARCO, SECCION_M, Config, Forma
from app.motores import mate
from app.motores.canonico import hexes_translucidos, resolver_colores
from app.motores.js import _coma, _maximo, _minimo, _numero, _piso, _redondear, crear_rng, mezclar

#: Lienzo cuadrado en el que se dibuja el arco.
LIENZO = 600

MARGEN_LADO = 30
MARGEN_ARRIBA = 30
#: Deja sitio a la línea de suelo y mantiene el arco centrado.
MARGEN_ABAJO = 38
PULGADA_M = 0.0254

PASO_ROT = 15

_SOMBRA = "#0a1a16"
_SUELO = "#8fa39a"


@dataclass
class Muestra:
    x: float
    y: float
    tx: float
    ty: float
    s: float


@dataclass
class Espina:
    """Puntos a lo largo de la línea guía, con su tangente y longitud acumulada."""

    puntos: list[Muestra]
    largo: float
    #: Y del suelo (el arco queda centrado en el lienzo).
    piso: float


@dataclass
class GloboPos:
    x: float
    y: float
    rx: float
    ry: float
    #: Giro en grados, ya cuantizado a pasos de 15° (para poder compartir degradados).
    rot: int
    #: Color con la variación de tono ya aplicada.
    color: str
    #: Color del patrón, sin variación de tono (para contar materiales).
    base: str
    #: -1 (atrás, se oscurece) .. 1 (delante).
    prof: float
    z: float
    #: Fila a lo largo del arco (0 = una pata), su espejo y la capa, contada desde afuera.
    fila: int
    filaEsp: int
    carril: int
    #: Sección por altura (0 = la del piso) a la que pertenece la fila.
    banda: int
    #: El lugar en la lista de colores del patrón que le dio el color; -1 si el patrón ya no manda en él.
    elemento: int


@dataclass
class Resultado:
    globos: list[GloboPos]
    filas: int
    columnas: int
    piso: float
    anchoM: float
    altoM: float
    grosorM: float
    largoM: float
    diametroM: float
    #: Cuántos píxeles del lienzo mide un metro.
    escala: float
    #: Cosas que no son posibles tal como se pidieron y cómo se resolvieron.
    avisos: list[str]
    #: Cuántas secciones por altura tiene el arco.
    secciones: int
    #: Cantidad de globos por color (para la lista de materiales).
    conteo: list[dict[str, Any]]
    svg: str


def _crear_espina(forma: Forma, ancho: float, alto: float, grosor: float) -> Espina:
    """Línea guía del arco según su forma."""
    cx = LIENZO / 2
    radio = _maximo(10, (ancho - grosor) / 2)
    ry_alto = _maximo(10, alto - grosor / 2)
    # Largo de las patas de la herradura.
    patas = _maximo(0, alto - radio - grosor / 2)
    forma_real: Forma = "semi" if forma == "herradura" and patas <= 0 else forma

    if forma_real == "semi":
        altura_px = radio + grosor / 2
    elif forma_real == "alto":
        altura_px = alto
    else:
        altura_px = patas + radio + grosor / 2
    disponible = LIENZO - MARGEN_ARRIBA - MARGEN_ABAJO
    piso = MARGEN_ARRIBA + (disponible - altura_px) / 2 + altura_px

    if forma_real == "semi":

        def fn(t: float) -> tuple[float, float]:
            return cx + radio * mate.cos(math.pi * (1 - t)), piso - radio * mate.sin(math.pi * t)

    elif forma_real == "alto":

        def fn(t: float) -> tuple[float, float]:
            return cx + radio * mate.cos(math.pi * (1 - t)), piso - ry_alto * mate.sin(math.pi * t)

    else:
        total = 2 * patas + math.pi * radio

        def fn(t: float) -> tuple[float, float]:
            s = t * total
            if s < patas:
                return cx - radio, piso - s
            if s < patas + math.pi * radio:
                fi = (s - patas) / radio
                return cx - radio * mate.cos(fi), piso - patas - radio * mate.sin(fi)
            return cx + radio, piso - patas + (s - patas - math.pi * radio)

    n_muestras = 1200
    puntos: list[Muestra] = []
    s_total = 0.0
    previo: tuple[float, float] | None = None
    for i in range(n_muestras + 1):
        qx, qy = fn(i / n_muestras)
        if previo is not None:
            s_total += mate.hypot(qx - previo[0], qy - previo[1])
        puntos.append(Muestra(x=qx, y=qy, tx=0, ty=0, s=s_total))
        previo = (qx, qy)
    for i in range(n_muestras + 1):
        a = puntos[int(_maximo(0, i - 1))]
        b = puntos[int(_minimo(n_muestras, i + 1))]
        dx = b.x - a.x
        dy = b.y - a.y
        m = mate.hypot(dx, dy) or 1
        puntos[i].tx = dx / m
        puntos[i].ty = dy / m
    return Espina(puntos=puntos, largo=s_total, piso=piso)


def _en_longitud(e: Espina, s: float) -> Muestra:
    lo = 0
    hi = len(e.puntos) - 1
    while hi - lo > 1:
        mitad = (lo + hi) >> 1
        if e.puntos[mitad].s <= s:
            lo = mitad
        else:
            hi = mitad
    a = e.puntos[lo]
    b = e.puntos[hi]
    u = (s - a.s) / (b.s - a.s) if b.s - a.s else 0
    return Muestra(x=a.x + (b.x - a.x) * u, y=a.y + (b.y - a.y) * u, tx=a.tx, ty=a.ty, s=s)


def carril_de(c: float, n: int) -> int:
    """La capa (hebra) de un globo según su columna ``c`` de ``n``.

    Un globo justo en el borde entre dos capas (en las filas desfasadas) va a la más externa en la mitad de
    fuera y a la más interna en la mitad de dentro: bordes estables, sin motas sueltas.
    """
    borde = _redondear(c)
    if abs(c - borde) < 1e-6 and borde >= 1 and borde <= n - 1:
        return int(borde - 1 if borde <= n / 2 else borde)
    return int(_minimo(n - 1, _maximo(0, _piso(c))))


def generar(entrada: Config, datos: bool = False) -> Resultado:
    """Coloca todos los globos del arco y los colorea según el patrón elegido.

    ``datos``: cada globo del dibujo va en un ``<g data-…>`` con su sección por altura, su capa a lo ancho, su
    fila, su color y, si el patrón aún manda en él, su elemento del patrón, para trabajar sobre el dibujo.
    """
    # Los colores canónicos (`sx:041`) se cambian por su hexadecimal aquí: de esta línea para abajo el motor
    # solo ve `#rrggbb`.
    cfg: Config = resolver_colores(entrada)
    # Qué colores de este diseño son de la familia Cristal. Se mira en la entrada **sin resolver**, porque al
    # resolver solo quedan hexadecimales y se pierde de qué familia venía cada uno.
    translucidos = hexes_translucidos(entrada)
    g = cfg["geometria"]
    gl = cfg["globo"]
    patron = PATRONES[cfg["patron"]]
    cols = cfg["colores"][cfg["patron"]]
    op = cfg["opciones"][cfg["patron"]]
    rnd = crear_rng(gl["semilla"])
    avisos: list[str] = []

    # --- Tamaños reales: el globo fija la separación de columnas y, con los globos a lo ancho, el grosor. ---
    marcas = [str(i) for i in range(len(cols))]
    n = int(_maximo(2, _redondear(g["globosAncho"])))
    diametro_m = INFLADO_PULG[gl["nominal"]] * gl["inflado"] * PULGADA_M
    paso_m = diametro_m / gl["tamano"]
    grosor_m = n * paso_m

    ancho_m = g["anchoM"]
    ancho_minimo = grosor_m + 0.3
    if ancho_m < ancho_minimo:
        avisos.append(
            f"Con globos R{gl['nominal']} y {n} a lo ancho, la banda mide {_coma(grosor_m)} m: "
            f"el arco no puede ser más angosto que {_coma(ancho_minimo)} m. Se ajustó el ancho."
        )
        ancho_m = ancho_minimo
    radio_m = (ancho_m - grosor_m) / 2

    forma: Forma = g["forma"]
    alto_m = ancho_m / 2 if forma == "semi" else g["altoM"]
    if forma == "herradura" and alto_m < radio_m + grosor_m / 2:
        avisos.append("El alto pedido es menor que el de un semicírculo, así que se dibuja como semicírculo.")
        forma = "semi"
        alto_m = ancho_m / 2
    elif forma == "alto" and alto_m < grosor_m / 2 + 0.2:
        alto_m = grosor_m / 2 + 0.2
        avisos.append(f"El alto era demasiado bajo para esa banda: se subió a {_coma(alto_m)} m.")

    # --- Escala del dibujo: el arco entero cabe siempre en el lienzo. ---
    escala = _minimo(
        (LIENZO - 2 * MARGEN_LADO) / ancho_m,
        (LIENZO - MARGEN_ARRIBA - MARGEN_ABAJO) / (ancho_m / 2 if forma == "semi" else alto_m),
    )
    e = _crear_espina(forma, ancho_m * escala, alto_m * escala, grosor_m * escala)

    grosor = grosor_m * escala
    # Separación entre columnas (px) y diámetro del globo (px).
    paso = grosor / n
    diametro = paso * gl["tamano"]
    espejo = op.get("espejo") == 1

    filas = int(_maximo(6, _redondear(e.largo / (paso * 0.866 * gl["separacion"]))))
    if espejo and filas % 2 == 0:
        # Con espejo, la fila central es única.
        filas += 1
    d_fila = e.largo / filas
    filas_esp = (filas + 1) / 2 if espejo else filas

    globos: list[GloboPos] = []
    for i in range(filas):
        p = _en_longitud(e, (i + 0.5) * d_fila)
        # Sección por altura: a qué altura del piso (m) está esta fila, en tramos de SECCION_M.
        banda = int(_maximo(0, _piso((e.piso - p.y) / escala / SECCION_M + 1e-9)))
        i_esp = int(_minimo(i, filas - 1 - i)) if espejo else i
        par = i_esp % 2 == 0
        # Filas alternas escalonadas.
        en_fila = n if par else n - 1
        nx = -p.ty
        ny = p.tx
        rot_base = mate.atan2(-p.tx, p.ty) * 180 / math.pi

        # Curvatura del arco en esta fila (1/px): en las curvas el borde de afuera es más largo que el de adentro.
        s = (i + 0.5) * d_fila
        antes = _en_longitud(e, _maximo(0, s - d_fila))
        despues = _en_longitud(e, _minimo(e.largo, s + d_fila))
        giro = mate.atan2(despues.ty, despues.tx) - mate.atan2(antes.ty, antes.tx)
        if giro > math.pi:
            giro -= 2 * math.pi
        if giro < -math.pi:
            giro += 2 * math.pi
        curvatura = abs(giro) / _maximo(1e-6, despues.s - antes.s)

        for k in range(en_fila):
            c = k + 0.5 if par else k + 1
            # Hacia adentro del arco es positivo.
            v = (c - n / 2) * paso
            # Compensación de la curva: los globos de afuera crecen y los de adentro se achican, para que todos
            # se toquen parejo. Los de adentro se achican poco: el borde interior solo se apila más.
            estiramiento = mate.pow(_minimo(1.35, _maximo(0.92, 1 - curvatura * v)), gl["compensacion"])
            ctx = Ctx(
                i=i,
                iEsp=i_esp,
                filas=filas,
                filasEsp=filas_esp,
                c=c,
                n=n,
                u=(i + 0.5) / filas,
                x=c,
                y=i_esp * 0.866,
                rnd=rnd,
            )
            carril = carril_de(c, n)
            # El patrón decide el color, salvo en una capa personalizada: ahí manda su secuencia.
            propia = cfg["capas"][carril] if carril < len(cfg["capas"]) else None
            seccion = cfg["secciones"][banda] if banda < len(cfg["secciones"]) else None
            # El patrón se consulta siempre (aunque la capa sea propia) para que el azar de los patrones que lo
            # usan no cambie en las demás capas. Se le pasan marcas en vez de colores: como solo elige entre
            # ellas, lo que devuelve dice a qué elemento de la lista pertenece el globo.
            marca = patron.color(ctx, marcas, op)
            elemento = _a_numero(marca.color)
            del_patron_color = _indice(cols, elemento)
            if del_patron_color is None:
                del_patron_color = cols[0] if cols else "#9ca3af"
            # Manda, de más a menos: la sección por altura, la capa a lo ancho, el patrón.
            propio_de_seccion = bool(seccion and len(seccion["colores"]))
            propio_de_capa = not propio_de_seccion and bool(propia and len(propia["colores"]))
            if propio_de_seccion and seccion:
                res_color = seccion["colores"][carril % len(seccion["colores"])]
                res_escala: float | None = None
            elif propio_de_capa and propia:
                res_color = propia["colores"][(i_esp if espejo else i) % len(propia["colores"])]
                res_escala = None
            else:
                res_color = del_patron_color
                res_escala = marca.escala

            color = res_color
            if gl["variacionTono"] > 0:
                claro = "#ffffff" if rnd() < 0.5 else "#000000"
                color = mezclar(color, claro, rnd() * gl["variacionTono"])

            # 1 en el centro de la banda, menos hacia los bordes.
            d = mate.cos((c / n - 0.5) * math.pi * 0.9)
            desx = (rnd() - 0.5) * gl["desorden"] * paso
            desy = (rnd() - 0.5) * gl["desorden"] * paso
            radio = (
                (diametro / 2)
                * (0.92 + 0.08 * d)
                * estiramiento
                * (1 + (rnd() - 0.5) * 2 * gl["variacionTam"])
                * (res_escala if res_escala is not None else 1)
            )
            rot = _redondear((rot_base + (rnd() - 0.5) * 400 * gl["desorden"]) / PASO_ROT) * PASO_ROT

            globos.append(
                GloboPos(
                    x=p.x + nx * v + desx,
                    y=p.y + ny * v + desy,
                    rx=radio,
                    ry=radio * gl["ovalo"],
                    rot=int(math.fmod(math.fmod(rot, 360) + 360, 360)),
                    color=color,
                    base=res_color,
                    prof=(d - 0.6) / 0.6,
                    z=d * 10 + ((res_escala - 1) * 4 if res_escala else 0) + i * 1e-4,
                    fila=i,
                    filaEsp=i_esp,
                    carril=carril,
                    banda=banda,
                    elemento=(
                        int(elemento) if not propio_de_seccion and not propio_de_capa and _es_entero(elemento) else -1
                    ),
                )
            )

    globos.sort(key=lambda b: b.z)

    cuenta: dict[str, int] = {}
    for b in globos:
        cuenta[b.base] = cuenta.get(b.base, 0) + 1
    conteo = sorted(
        [{"color": color, "cantidad": cantidad} for color, cantidad in cuenta.items()],
        key=lambda x: -int(cast(int, x["cantidad"])),
    )

    return Resultado(
        globos=globos,
        filas=filas,
        columnas=n,
        piso=e.piso,
        anchoM=ancho_m,
        altoM=ancho_m / 2 if forma == "semi" else alto_m,
        grosorM=grosor_m,
        largoM=e.largo / escala,
        diametroM=diametro_m,
        escala=escala,
        avisos=avisos,
        secciones=int(max([b.banda + 1 for b in globos] + [1])),
        conteo=conteo,
        svg=_dibujar(globos, cfg, e.piso, ancho_m * escala, datos, translucidos),
    )


def _a_numero(valor: str | None) -> float:
    """``Number(valor)`` de JavaScript: ``undefined`` es ``NaN``, no un error."""
    if valor is None:
        return math.nan
    try:
        return float(valor)
    except ValueError:
        return math.nan


def _es_entero(valor: float) -> bool:
    """``Number.isInteger``."""
    return not math.isnan(valor) and not math.isinf(valor) and float(valor).is_integer()


def _indice(cols: list[str], indice: float) -> str | None:
    if math.isnan(indice) or math.isinf(indice) or not float(indice).is_integer():
        return None
    i = int(indice)
    return cols[i] if 0 <= i < len(cols) else None


# ---------------------------------------------------------------------------
# Dibujo
# ---------------------------------------------------------------------------


def _f(valor: float) -> str:
    """Dos decimales, escritos como los escribe JavaScript."""
    return str(_numero(_redondear(valor * 100) / 100))


def _dibujar(
    globos: list[GloboPos],
    cfg: Config,
    piso: float,
    ancho_px: float,
    datos: bool,
    translucidos: set[str],
) -> str:
    """SVG completo (sin envoltorio ``<svg>``) de un conjunto de globos."""
    gl = cfg["globo"]
    g = cfg["geometria"]

    # Un degradado por color y por giro: el reflejo siempre queda arriba a la izquierda.
    grad: dict[str, str] = {}

    def id_grad(color: str, rot: int) -> str:
        identificador = f"g{color[1:]}_{_numero(rot / PASO_ROT)}"
        if identificador not in grad:
            grad[identificador] = (
                f'<radialGradient id="{identificador}" cx="0.36" cy="0.3" r="0.85" fx="0.32" fy="0.24"'
                f' gradientTransform="rotate({_numero(-rot)} 0.5 0.5)">'
                f'<stop offset="0" stop-color="{mezclar(color, "#ffffff", 0.42)}"/>'
                f'<stop offset="0.5" stop-color="{color}"/>'
                f'<stop offset="1" stop-color="{mezclar(color, "#000000", 0.34)}"/></radialGradient>'
            )
        return identificador

    partes: list[str] = []
    if g["suelo"]:
        x1 = LIENZO / 2 - ancho_px / 2 - 10
        x2 = LIENZO / 2 + ancho_px / 2 + 10
        partes.append(
            f'<line x1="{_f(x1)}" y1="{_f(piso + 8)}" x2="{_f(x2)}" y2="{_f(piso + 8)}" stroke="{_SUELO}"'
            f' stroke-width="3" stroke-linecap="round" stroke-opacity="0.55"/>'
        )

    for b in globos:
        identificador = id_grad(b.color, b.rot)
        rot = f' transform="rotate({_numero(b.rot)} {_f(b.x)} {_f(b.y)})"' if b.rot else ""
        s = ""
        if gl["sombra"] > 0:
            s += (
                f'<ellipse cx="{_f(b.x + b.rx * 0.07)}" cy="{_f(b.y + b.rx * 0.11)}" rx="{_f(b.rx * 1.01)}"'
                f' ry="{_f(b.ry * 1.01)}"{rot} fill="{_SOMBRA}" fill-opacity="{_numero(gl["sombra"])}"/>'
            )
        trazo = (
            f' stroke="{mezclar(b.color, "#000000", 0.45)}" stroke-opacity="0.6"'
            f' stroke-width="{_numero(gl["contorno"])}"'
            if gl["contorno"] > 0
            else ""
        )
        if b.color in translucidos:
            # Cristal: casi todo el color se va, queda un velo teñido y el aro de luz del borde. Es el mismo
            # trato que les dan las estructuras orgánicas a los acabados «transparente».
            s += (
                f'<ellipse cx="{_f(b.x)}" cy="{_f(b.y)}" rx="{_f(b.rx)}" ry="{_f(b.ry)}"{rot}'
                f' fill="{mezclar(b.color, "#ffffff", 0.78)}" fill-opacity="0.22"{trazo}/>'
            )
            s += (
                f'<ellipse cx="{_f(b.x)}" cy="{_f(b.y)}" rx="{_f(b.rx * 0.9)}" ry="{_f(b.ry * 0.9)}"{rot}'
                f' fill="none" stroke="#fff" stroke-opacity="0.22"'
                f' stroke-width="{_f(_maximo(0.8, b.rx * 0.05))}"/>'
            )
        else:
            s += (
                f'<ellipse cx="{_f(b.x)}" cy="{_f(b.y)}" rx="{_f(b.rx)}" ry="{_f(b.ry)}"{rot}'
                f' fill="url(#{identificador})"{trazo}/>'
            )
        if b.prof < 0 and gl["profundidad"] > 0:
            s += (
                f'<ellipse cx="{_f(b.x)}" cy="{_f(b.y)}" rx="{_f(b.rx)}" ry="{_f(b.ry)}"{rot}'
                f' fill="{_SOMBRA}" fill-opacity="{_f(0.34 * -b.prof * gl["profundidad"])}"/>'
            )
        if gl["brillo"] > 0:
            hx = b.x - 0.38 * b.rx
            hy = b.y - 0.46 * b.rx
            s += (
                f'<ellipse cx="{_f(hx)}" cy="{_f(hy)}" rx="{_f(0.17 * b.rx)}" ry="{_f(0.27 * b.rx)}"'
                f' transform="rotate(30 {_f(hx)} {_f(hy)})" fill="#fff"'
                f' fill-opacity="{_numero(gl["brillo"])}"/>'
            )
            s += (
                f'<path d="M{_f(b.x + 0.64 * b.rx)} {_f(b.y + 0.62 * b.rx)}A{_f(0.9 * b.rx)} {_f(0.9 * b.rx)}'
                f' 0 0 1 {_f(b.x - 0.18 * b.rx)} {_f(b.y + 0.9 * b.rx)}" fill="none" stroke="#fff"'
                f' stroke-opacity="{_f(0.28 * gl["brillo"])}" stroke-width="{_f(0.06 * b.rx)}"'
                f' stroke-linecap="round"/>'
            )
        if datos:
            elemento = f' data-e="{b.elemento}"' if b.elemento >= 0 else ""
            partes.append(f'<g data-b="{b.banda}" data-c="{b.carril}" data-f="{b.fila}" data-k="{b.base}"{elemento}>{s}</g>')
        else:
            partes.append(s)
    return f"<defs>{''.join(grad.values())}</defs>{''.join(partes)}"


def svg_documento(interior: str, titulo: str = "Arco de globos") -> str:
    """Documento SVG completo, listo para descargar."""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {LIENZO} {LIENZO}" width="{LIENZO}"'
        f' height="{LIENZO}" role="img" aria-label="{titulo}">{interior}</svg>\n'
    )


def secuencias_del_patron(entrada: Config) -> tuple[list[list[str]], list[bool]]:
    """Los colores que el patrón le da a cada capa, como la secuencia más corta que se repite.

    Sirve para mostrar cada capa y para personalizarla partiendo de lo que ya tenía. El segundo valor dice,
    capa por capa, si el patrón se repite exactamente con esa secuencia; si no (un ombré, el azar, unos bloques
    grandes), la secuencia es la que más se le parece.
    """
    cfg: Config = {**entrada, "capas": []}
    res = generar(cfg)
    espejo = cfg["opciones"][cfg["patron"]].get("espejo") == 1
    n = res.columnas
    largo = int(max([(b.filaEsp if espejo else b.fila) + 1 for b in res.globos], default=1))
    por_capa: list[list[str | None]] = [[None] * largo for _ in range(n)]
    for b in res.globos:
        fila = b.filaEsp if espejo else b.fila
        if por_capa[b.carril][fila] is None:
            por_capa[b.carril][fila] = b.base

    respaldo = cfg["colores"][cfg["patron"]][0] if cfg["colores"][cfg["patron"]] else "#9ca3af"
    exactas: list[bool] = []
    secuencias: list[list[str]] = []
    for seq in por_capa:
        mejor: tuple[list[str], int] | None = None
        periodo = 1
        while periodo <= MAX_SECUENCIA_ARCO and (mejor is None or mejor[1] > 0):
            colores: list[str] = []
            fallos = 0
            for r in range(periodo):
                cuenta: dict[str, int] = {}
                for i in range(r, largo, periodo):
                    if seq[i] is not None:
                        clave = str(seq[i])
                        cuenta[clave] = cuenta.get(clave, 0) + 1
                mas = ""
                cant = -1
                total = 0
                for color, k in cuenta.items():
                    total += k
                    if k > cant:
                        cant = k
                        mas = color
                colores.append(mas or respaldo)
                fallos += total - int(_maximo(0, cant))
            if mejor is None or fallos < mejor[1]:
                mejor = (colores, fallos)
            periodo += 1
        exactas.append(mejor is None or mejor[1] == 0)
        secuencias.append(mejor[0] if mejor else [respaldo])
    return secuencias, exactas


__all__ = [
    "LIENZO",
    "Espina",
    "GloboPos",
    "Resultado",
    "carril_de",
    "config_inicial",
    "generar",
    "secuencias_del_patron",
    "svg_documento",
]
