"""La guirnalda sin armado del motor y el arco clásico sin armado, para la guía de escena.

Son piezas de motor que llegan aquí **sin el armado del motor guardado** (``plan.pieza_del_motor_resuelta``
devuelve ``None``) y se quedarían fuera de la guía con ``sin_dibujo``. Sin armado guardado las cuenta y las cotiza
la fórmula (``plan._armado_del_motor``, decisión del dueño del 2026-10-05, que deshizo la cuenta por la receta
del motor del 2026-10-04).

- **La guirnalda**, clásica u orgánica: una ``guirnalda`` sin ``armado_guirnalda_organica``, de mezcla
  ``clasica``, orgánica o con su armado por partes (``armado_guirnalda``, ADR-0032). «Racimos de cuatro globos
  iguales en línea» (clasificador, ``referencias/variantes.ts``). Se dibuja con **exactamente lo que el plan
  compra** (abajo).
- **El arco clásico** (mezcla clásica o sin mezcla, ni orgánico ni asimétrico), con o sin ``patron_color``: se
  dibuja como lo arma el motor del arco clásico con la receta que la confirmación le escribiría
  (``plan.armado_arco_de_receta``: con su patrón como pista si lo trae, ``plan.armado_arco_de_patron``, y si no
  por número de colores), la misma con la que arranca su editor. Es la forma y el orden de colores del arco,
  **no su cuenta**: la cotización es la de la fórmula y la rejilla de su patrón, y en un arco angosto el motor
  coloca menos globos (58 en 2,5 × 2,2 m, donde se cotizan 118). Vivió aquí hasta el 2026-10-04, cuando la
  resolución pasó a contarlo con esa receta y la guía a leerlo por ``pieza_del_motor_resuelta``; vuelve con la
  reversión, para que la imagen no pierda el arco.

Un medio arco, una columna o un arco orgánico sin armado **no son de este módulo** y se devuelven con ``None``.

**Aquí no se inventa ninguna pieza.** La guirnalda sale de la misma resolución que su hoja de armado (``plan.vista_previa_de_armado_guirnalda``): el
armado por partes que trae, o la receta si no trae ninguno. Eso da **exactamente lo que el plan compra** —cada
globo en un racimo, en el relleno, en un remate o suelto— y el color de cada globo de cada racimo ya puesto por
el patrón (``filas_de_racimos``). El arco sale del motor del arco clásico, por la misma puerta que lo cuenta
cuando trae su armado (``plan.pieza_del_motor_resuelta``). Lo que se coloca aquí es solo dónde va cada globo de
la guirnalda:

- La **línea** es la de la guirnalda del motor (``guirnalda.espina.altura_guirnalda``): recta, con el
  ``desnivel_m``, la ``caida_m`` de cada festón (``arco_caido`` entre sus puntos de anclaje, la U invertida
  hacia abajo), el ``arqueo_m`` de la ``curva`` y la onda de la forma lista ``ondulada`` del motor. Con la
  misma lectura de cada campo que ``plan._garland_cord`` usa para contar la cuerda.
- Cada **racimo** es una capa de la columna clásica (``columna.motor.generar`` en ``modo="capas"``): el
  anillo de ``k`` globos que se tocan, escalonado media posición en las capas impares, que es como se encajan
  los racimos uno tras otro. Se acuesta sobre la línea: el eje de la columna es la línea, su ``x`` va por la
  normal y su ``z`` es la profundidad, que decide el orden de pintura. Los racimos se reparten parejo a lo
  largo de la línea, porque el largo lo dice el plan y no el paso de la columna.
- El **relleno** y los **sueltos** van en los huecos entre racimos, repartidos parejo («pega los globos chicos
  en los huecos entre racimos, repartidos parejo», pasos de ``armado_guirnalda``), y los **remates** delante
  del racimo que su resolución nombra.

**Las cuentas.** La guirnalda tiene exactamente los globos de su resolución por instancia. El arco, los que
coloca el motor con esa receta.

Derivado y puro: sin catálogo, sin E/S, sin reloj; determinista. No entra en el plan ni en ``plan_hash``.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import replace
from functools import lru_cache
from typing import cast

from app.arco.tipos import INFLADO_PULG
from app.armado_columna import config_inicial as config_inicial_columna
from app.armado_guirnalda import linea_del_motor
from app.columna.motor import generar as generar_columna
from app.columna.tipos import CapaColumna
from app.guirnalda.espina import altura_guirnalda
from app.guia_piezas import ContextoPieza
from app.plan import (
    OFICIALES_SIN_MOTOR,
    PlanResolutionError,
    armado_arco_de_receta,
    pieza_del_motor_resuelta,
    vista_previa_de_armado_guirnalda,
)

Globo = tuple[float, float, float, str]

#: El motivo con el que la vista previa dice que ni la receta reparte lo que se compra.
_SIN_ARMADO = "sin_armado_posible"
#: El motivo con el que dice que la pieza no se arma por racimos (``plan._is_garland``: la del techo).
_NO_ES_GUIRNALDA = "no_es_guirnalda"
#: Puntos de la línea de la guirnalda: sobra para repartir un centenar de racimos.
_PUNTOS_LINEA = 480
_GLOBOS_POR_UNIDAD: Mapping[str, int] = {"trio": 3, "cuarteto": 4, "quinteto": 5}
#: El sobre de un plan con una sola pieza: lo que la vista previa del armado valida además de la estructura.
_SOBRE: Mapping[str, object] = {
    "plan_version": "1.0",
    "plan_id": "00000000-0000-0000-0000-000000000000",
    "concepto": {"titulo": "Guía de escena", "descripcion": "Guía de escena.", "paleta": []},
    "espacio": {"tipo": "guia", "fuente": "supuesto"},
    "supuestos": [],
    "referencia_omitida": [],
}


def _texto(valor: object) -> str | None:
    return valor.strip() or None if isinstance(valor, str) else None


def _numero(valor: object) -> float | None:
    if isinstance(valor, bool) or not isinstance(valor, (int, float)) or not math.isfinite(valor):
        return None
    return float(valor)


def _radio_m(pulgadas: float) -> float:
    """Radio inflado en metros de un globo de ``pulgadas`` (``INFLADO_PULG``, como ``guia_escena``)."""
    inflado = cast(Mapping[int, float], INFLADO_PULG).get(int(pulgadas))
    return float(inflado if inflado is not None else pulgadas) * 0.0254 / 2


# --- Qué pieza es ----------------------------------------------------------------------------------------


def _sin_motor(estructura: Mapping[str, object]) -> bool:
    return (_texto(estructura.get("estructura_oficial")) or "") in OFICIALES_SIN_MOTOR


def es_guirnalda_por_racimos(estructura: Mapping[str, object]) -> bool:
    """Una guirnalda sin armado del motor, clásica u orgánica: la que se dibuja con su armado por partes."""
    return (
        estructura.get("tipo") == "guirnalda"
        and not _sin_motor(estructura)
        and not isinstance(estructura.get("armado_guirnalda_organica"), Mapping)
    )


def es_guirnalda_clasica(estructura: Mapping[str, object]) -> bool:
    """Una guirnalda de racimos sin armado del motor: mezcla ``clasica`` o armado por partes."""
    return (
        estructura.get("tipo") == "guirnalda"
        and not _sin_motor(estructura)
        and not isinstance(estructura.get("armado_guirnalda_organica"), Mapping)
        and (
            isinstance(estructura.get("armado_guirnalda"), Mapping)
            or estructura.get("mezcla") == "clasica"
        )
    )


# --- La guirnalda ----------------------------------------------------------------------------------------


@lru_cache(maxsize=8)
def _anillo(k: int) -> tuple[tuple[tuple[float, float], ...], tuple[tuple[float, float], ...]]:
    """El racimo de ``k`` globos de la columna clásica, en diámetros: ``(x, z)`` de cada globo por paridad.

    Dos capas de la columna por capas (la par y la impar, que va escalonada) con el globo ``j`` en el color
    ``j``: así cada globo se reconoce por su color testigo. El motor es determinista (sin desorden ni variación
    de tamaño) y el anillo es lineal en el diámetro, así que se calcula una vez por ``k``.
    """
    base = config_inicial_columna()
    tamano = 12
    cfg = replace(
        base,
        modo="capas",
        capas=[CapaColumna(tamano=tamano, colores=list(range(k))) for _ in range(2)],
        colores=[f"#{j + 1:06x}" for j in range(k)],
        columna=replace(base.columna, globos_capa=k, base=False, persona=False),
        globo=replace(base.globo, variacion_tono=0, desorden=0, variacion_tam=0),
    )
    resultado = generar_columna(cfg, simple=True)
    diametro = 2 * _radio_m(tamano)
    capas: list[list[tuple[float, float]]] = [[(0.0, 0.0)] * k for _ in range(2)]
    for globo in resultado.globos:
        capas[int(globo.capa)][int(globo.k)] = (
            float(globo.x) / diametro,
            float(globo.z) / diametro,
        )
    return tuple(capas[0]), tuple(capas[1])


def _forma_de_la_linea(armado: Mapping[str, object]) -> dict[str, float]:
    """La línea de la guirnalda del motor para la forma del armado por partes.

    La traducción de la forma es de ``armado_guirnalda.linea_del_motor``, la misma con la que la receta de la
    guirnalda orgánica arma su línea; aquí solo se pone en cero lo que la forma no decide: la clásica es una
    línea limpia, sin la onda de partida del motor.
    """
    return {
        "alturaM": 0.0,
        "pendienteM": 0.0,
        "ondaM": 0.0,
        "ondas": 1.0,
        "colgadoM": 0.0,
        "festones": 1.0,
        **linea_del_motor(armado),
    }


def _linea(
    largo: float, forma: Mapping[str, float]
) -> tuple[list[tuple[float, float]], list[float]]:
    """Los puntos de la línea de izquierda a derecha y su largo acumulado."""
    puntos = [
        (largo * i / _PUNTOS_LINEA, float(altura_guirnalda(dict(forma), i / _PUNTOS_LINEA)))
        for i in range(_PUNTOS_LINEA + 1)
    ]
    acumulado = [0.0]
    for (x0, y0), (x1, y1) in zip(puntos, puntos[1:], strict=False):
        acumulado.append(acumulado[-1] + math.hypot(x1 - x0, y1 - y0))
    return puntos, acumulado


def _en(
    puntos: Sequence[tuple[float, float]], acumulado: Sequence[float], s: float
) -> tuple[float, float, float, float]:
    """El punto de la línea a ``s`` metros del extremo izquierdo y su normal (hacia arriba)."""
    s = min(max(s, 0.0), acumulado[-1])
    i = 1
    while i < len(acumulado) - 1 and acumulado[i] < s:
        i += 1
    (x0, y0), (x1, y1) = puntos[i - 1], puntos[i]
    tramo = acumulado[i] - acumulado[i - 1]
    f = (s - acumulado[i - 1]) / tramo if tramo > 0 else 0.0
    tx, ty = (x1 - x0) / tramo if tramo > 0 else 1.0, (y1 - y0) / tramo if tramo > 0 else 0.0
    return x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, -ty, tx


def _guirnalda(estructura: Mapping[str, object], colores: Sequence[str]) -> list[Globo] | None:
    estructura_id = _texto(estructura.get("estructura_id")) or ""
    propio = estructura.get("armado_guirnalda")
    try:
        vista = vista_previa_de_armado_guirnalda(
            {**_SOBRE, "estructuras": [dict(estructura)]},
            estructura_id,
            cast(Mapping[str, object], propio) if isinstance(propio, Mapping) else None,
        )
    except PlanResolutionError as error:
        detalles = cast(Mapping[str, object] | None, getattr(error, "details", None))
        if detalles is not None and detalles.get("motivo") in (_SIN_ARMADO, _NO_ES_GUIRNALDA):
            # Ni la receta reparte lo que se compra, o la pieza no se arma por racimos (una guirnalda colgada
            # del techo es una instalación de techo): no hay racimos que dibujar.
            return None
        raise
    resuelto = cast(Mapping[str, object], vista.armado)
    armado = cast(Mapping[str, object], resuelto["armado"])
    leyenda = {
        int(cast(int, entrada["codigo"])): entrada
        for entrada in cast(Sequence[Mapping[str, object]], resuelto["leyenda"])
    }
    racimos = [
        [int(c) for c in cast(Sequence[int], racimo["codigos"])]
        for racimo in cast(Sequence[Mapping[str, object]], resuelto["racimos"])
    ]
    if not racimos:
        return None

    def tono(codigo: int) -> str:
        material = leyenda[codigo].get("material")
        indice = material if isinstance(material, int) and 0 <= material < len(colores) else 0
        return colores[indice]

    def radio(codigo: int) -> float:
        return _radio_m(float(cast(float, leyenda[codigo]["tamano_pulg"])))

    racimo = cast(Mapping[str, object], armado["racimo"])
    diametro = 2 * _radio_m(float(cast(float, racimo["tamano_pulg_base"])))
    k = _GLOBOS_POR_UNIDAD.get(str(racimo.get("unidad")), 4)
    pares, impares = _anillo(k)
    profundo = max(abs(z) for _x, z in (*pares, *impares)) * diametro

    largo = _numero(resuelto.get("largo_m")) or 0.0
    puntos, acumulado = _linea(largo, _forma_de_la_linea(armado))
    paso = acumulado[-1] / len(racimos)

    # (z, orden, x, y, r, hex): de atrás hacia adelante, y a igual profundidad en el orden en que se colocan.
    colocados: list[tuple[float, int, float, float, float, str]] = []

    def poner(z: float, x: float, y: float, r: float, hex_: str) -> None:
        colocados.append((z, len(colocados), x, y, r, hex_))

    for i, codigos in enumerate(racimos):
        cx, cy, nx, ny = _en(puntos, acumulado, (i + 0.5) * paso)
        anillo = impares if i % 2 else pares
        for j, codigo in enumerate(codigos):
            ax, az = anillo[j % k]
            poner(
                az * diametro,
                cx + nx * ax * diametro,
                cy + ny * ax * diametro,
                radio(codigo),
                tono(codigo),
            )

    def entre_racimos(codigos: Sequence[int], lado: float, z: float) -> None:
        """Repartidos parejo en los huecos entre racimos, alternando a un lado y otro de la línea."""
        huecos = max(1, len(racimos) - 1)
        for j, codigo in enumerate(codigos):
            hueco = (j * huecos) // len(codigos)
            s = (hueco + 1) * paso if len(racimos) > 1 else paso / 2
            cx, cy, nx, ny = _en(puntos, acumulado, s)
            desvio = lado * diametro * (1 if j % 2 == 0 else -1)
            poner(z, cx + nx * desvio, cy + ny * desvio, radio(codigo), tono(codigo))

    def expandir(entradas: object) -> list[int]:
        return [
            int(cast(int, entrada["codigo"]))
            for entrada in cast(Sequence[Mapping[str, object]], entradas or ())
            for _ in range(int(cast(int, entrada["cantidad"])))
        ]

    relleno = resuelto.get("relleno")
    if isinstance(relleno, Mapping):
        entre_racimos(expandir(relleno.get("codigos")), 0.45, profundo)
    entre_racimos(expandir(resuelto.get("sueltos")), 0.2, profundo)
    for remate in cast(Sequence[Mapping[str, object]], resuelto.get("remates") or ()):
        codigo = int(cast(int, remate["codigo"]))
        for numero in cast(Sequence[int], remate["racimos"]):
            cx, cy, _nx, _ny = _en(puntos, acumulado, (int(numero) - 0.5) * paso)
            poner(profundo + diametro, cx, cy, radio(codigo), tono(codigo))

    return [(x, y, r, hex_) for _z, _orden, x, y, r, hex_ in sorted(colocados)]


# --- El arco clásico -------------------------------------------------------------------------------------


def _arco(estructura: Mapping[str, object], colores: Sequence[str]) -> list[Globo] | None:
    """El arco clásico sin armado guardado, como lo arma el motor con la receta de la confirmación.

    ``None`` si la receta no le toca (``plan.armado_arco_de_receta``: un arco orgánico o asimétrico, un aro, una
    pieza que ya trae su armado). El motor publica sus globos en píxeles de su lienzo con ``y`` hacia abajo; se
    pasan a metros con la escala de su propio ``ancho_m`` sobre la anchura que ocupan, como ``guia_escena``
    hace con el arco que sí trae su armado.
    """
    armado = armado_arco_de_receta(estructura)
    del_motor = (
        None if armado is None else pieza_del_motor_resuelta({**estructura, "armado_arco": armado})
    )
    if del_motor is None or del_motor[0] != "arco":
        return None
    pieza = del_motor[1]

    def tono(indice: object) -> str:
        """El color del material ``indice``; el primero si no apunta a ninguno, como ``guia_escena``."""
        if isinstance(indice, int) and not isinstance(indice, bool) and 0 <= indice < len(colores):
            return colores[indice]
        return colores[0]

    en_pixeles = [
        (
            float(cast(float, globo["x"])),
            -float(cast(float, globo["y"])),
            (float(cast(float, globo["rx"])) + float(cast(float, globo["ry"]))) / 2,
            tono(globo.get("material")),
        )
        for globo in cast(Sequence[Mapping[str, object]], pieza["globos"])
    ]
    if not en_pixeles:
        return None
    anchura = max(x + r for x, _y, r, _t in en_pixeles) - min(x - r for x, _y, r, _t in en_pixeles)
    escala = (_numero(pieza.get("ancho_m")) or 0.0) / anchura if anchura > 0 else 0.0
    if escala <= 0:
        return None
    return [(x * escala, y * escala, r * escala, hex_) for x, y, r, hex_ in en_pixeles]


def globos_de(
    estructura: Mapping[str, object],
    colores: Sequence[str],
    contexto: ContextoPieza | None = None,
) -> list[Globo] | None:
    """Los globos de una guirnalda o un arco clásico sin armado del motor; ``None`` para lo demás.

    ``contexto`` se acepta y no hace falta: el tamaño y el material de cada globo de la guirnalda ya vienen de
    la leyenda de su propia resolución (``vista_previa_de_armado_guirnalda``), la misma que el contexto
    resumiría, y los del arco, del motor.
    """
    del contexto
    if not colores:
        return None
    if es_guirnalda_por_racimos(estructura):
        return _guirnalda(estructura, colores)
    if estructura.get("tipo") == "arco":
        return _arco(estructura, colores)
    return None


__all__ = ["es_guirnalda_clasica", "es_guirnalda_por_racimos", "globos_de"]
