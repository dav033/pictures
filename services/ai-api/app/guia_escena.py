"""Los globos de cada estructura del plan como discos planos en metros, para la guía de escena de la imagen.

``POST /internal/v1/plan/guia-escena`` devuelve, por cada pieza de globos del plan aprobado, **cada globo** como
``{x_m, y_m, r_m, hex}`` en el marco local de la pieza (metros, origen abajo al centro, ``y`` hacia arriba) y el
ancho y el alto de la pieza. TypeScript compone con eso una sola imagen de la escena entera
(``src/lib/ia/kagutsuchi/guia-escena.ts``), colocando cada pieza donde la foto de referencia tiene la suya, y se
la manda a FLUX por ``/edit`` en lugar de la foto, que nunca sale hacia el proveedor.

**Aquí no se coloca ningún globo.** Python ya los colocó y esto solo los lee:

- Una pieza que arma un motor con su armado guardado (arco, columna, arco/columna/guirnalda orgánica) sale de la
  **misma puerta que la resolución** (``plan.pieza_del_motor_resuelta``, con su caché): son exactamente los
  globos que se contaron y se cotizaron, uno por disco. La columna clásica suma su remate, que el motor no coloca
  en ``globos``.
- Una pieza sin motor (la pared, el aro, el techo, el centro de mesa) sale de su dibujo esquemático
  (``dibujo_estructura.globos_de``), leído de la lista que se pinta, no del SVG.
- Una pieza sin motor ni dibujo (el bouquet, la figura, la guirnalda sin armado del motor, el arco clásico sin
  armado, con o sin patrón de color) sale de su módulo en ``app/guia_piezas`` (``globos_de_pieza``), que se
  descubre solo. El arco clásico sin armado lo cobra la fórmula y se dibuja con la receta del motor: su forma y
  sus colores, no su cuenta (``guia_piezas/clasica.py``).
- Lo que no reconoce nadie (o una pieza sin materiales) se devuelve en ``omitidas`` con su motivo: no se inventa
  una forma.

**Lo que se ve sin ser globo** sale, si la pieza lo tiene, en ``trazos`` (líneas y arcos con grosor) y
``rellenos`` (elipses y polígonos planos), en el mismo marco que los discos: el anillo de metal, el poste, la base
y el forro de un aro y el anillo y el poste del mini aro (capturados de su dibujo,
``dibujo_estructura.globos_y_estructura_de``, sin tocar el SVG de la UI) y las cintas y la pesa o la caja de un
bouquet sin armado (su módulo los publica en ``elementos``). Entran en la caja de la pieza salvo en una pieza
flotante, donde cuelgan por debajo del origen hasta el piso (``_pieza``). No cuentan ni se cotizan.

**Lo que la resolución ya sabe de cada pieza** viaja en ``mezclas[]`` de la petición, todo derivado y opcional
salvo ``mezcla_real``; sin ello cada pieza se dibuja como antes:

- ``mezcla_real``: los tamaños que se compran. El dibujo esquemático la reparte; la figura y el bouquet toman de
  ella los tamaños de su látex (``ContextoPieza.tamanos_latex``).
- ``lineas`` (el catálogo de cada línea resuelta) y ``leyenda`` (la de ``armados_bouquet``, que manda): qué globo
  es cada material —látex, metalizado, burbuja o número—, de cuántas pulgadas y con qué silueta
  (``contexto_de_pieza``, con la regla de la hoja de armado: ``plan.contexto_bouquet_de_globos``). Llega a los
  módulos de ``app/guia_piezas`` como ``ContextoPieza``. Un corazón metalizado de 18" se dibuja foil de 18".
- ``aspecto_caja``: alto sobre ancho de la caja de la foto donde va la pieza. La figura sin silueta conocida
  dibuja su óvalo con esa proporción.
- La pared no densa sin forma elegida cuyas líneas compran globos link se dibuja en ``malla-links``
  (``_forma_por_lo_comprado``); sin links, cuadriculada como siempre.

**Cómo se sostiene.** Si el módulo de la pieza lo sabe, la pieza sale con ``anclaje`` (``piso``, ``techo``,
``flotante``, ``pared``) y, si flota, ``elevacion_m``: la altura de su globo más bajo sobre el piso. El bouquet de
helio flota a la altura de las cintas de su diseñador en el clasificador; TypeScript lo compone separado de la
franja de piso. Sin ``anclaje``, la composición decide por la ubicación del plan.

**El color** es el del globo inflado de la referencia Sempertex que se compra (``referencia_de(...)["hexGlobo"]``):
la guía le dice al modelo de imagen cómo se ve el globo, no cómo se dibuja un esquema. Si el color no está en la
lámina, el de la paleta del plan (``x-hex-colores``, dueño ``taxonomy/v2.ts``), y si tampoco, ``hex_de`` (un
``#rrggbb`` o una referencia ``sx:``; el gris neutro del motor para lo demás).

**Las unidades.** Los motores orgánicos, la columna y los dibujos ya trabajan en metros. El arco clásico publica
sus globos en píxeles de su lienzo, con ``y`` hacia abajo: aquí se pasan a metros con la escala que da su propio
``ancho_m`` sobre la anchura que ocupan sus globos. La escala es la misma en los dos ejes, así que la proporción
de la pieza es la del motor; la composición encaja cada pieza en su caja, de modo que lo único que importa del
metro es esa proporción.

Derivado y puro: sin catálogo, sin E/S, sin reloj. No entra en el plan, el snapshot ni ``plan_hash``.

Errores de dominio, como ``PlanResolutionError``:

| Código | HTTP |
| --- | ---: |
| ``invalid_plan`` | 422 |
| ``armado_invalido`` (lo lanza la puerta del motor) | 422 |
| ``guia_demasiados_globos`` (``total``, ``maximo``) | 422 |
"""

from __future__ import annotations

import math
import re
import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal, cast

from jsonschema import Draft7Validator
from pydantic import model_validator

from app.arco.tipos import INFLADO_PULG
from app.armado_bouquet import MaterialBouquet
from app.color_catalogo import referencia_de, referencia_del_titulo
from app.dibujo_estructura import FORMAS_POR_OFICIAL, forma_de, globos_y_estructura_de
from app.generated_models import contract_schema
from app.guia_piezas import (
    Anclaje,
    ContextoPieza,
    MaterialGuia,
    Silueta,
    TipoGlobo,
    pieza_de_plugin,
)
from app.motores.canonico import color_de, hex_de
from app.operational_models import OperationalRequest
from app.plan import PlanResolutionError, contexto_bouquet_de_globos, pieza_del_motor_resuelta
from app.plan_armado_comun import materiales_de, sub_esquema, tope, validar_plan
from app.referencias.dibujos import (
    ArcoDibujo,
    ElementoDibujo,
    ElipseDibujo,
    LineaDibujo,
    PoligonoDibujo,
)

PLAN_GUIA_ESCENA_SCOPE = "plan.guia_escena"
PLAN_GUIA_ESCENA_REQUEST_VERSION = "plan-guia-escena.v1"
PLAN_GUIA_ESCENA_RESULT_VERSION = "plan-guia-escena-result.v1"

_ESQUEMA_PETICION = contract_schema("PlanGuiaEscenaRequest")
_ESQUEMA_RESULTADO = contract_schema("PlanGuiaEscenaResult")
_VALIDADOR_PETICION = Draft7Validator(_ESQUEMA_PETICION)
_VALIDADOR_RESULTADO = Draft7Validator(_ESQUEMA_RESULTADO)

#: Tope de discos de la escena entera: el ``maxItems`` de ``discos`` del contrato (dueño: ``guia-escena.ts``).
MAX_DISCOS: int = tope(
    sub_esquema(_ESQUEMA_RESULTADO, "properties", "piezas", "items", "properties", "discos"),
    "maxItems",
)

#: Los tonos de la paleta del plan, para el color que no está en la lámina Sempertex (dueño: ``taxonomy/v2.ts``).
HEX_PALETA: Mapping[str, str] = {
    str(nombre): str(tono)
    for nombre, tono in cast(
        Mapping[str, object], _ESQUEMA_PETICION.get("x-hex-colores", {})
    ).items()
}

Fuente = Literal["motor", "dibujo"]
#: Decimales de los metros publicados: una décima de milímetro sobra para una guía de 1024 px.
_DECIMALES = 4
#: Tope de ``elevacion_m`` del contrato (dueño: ``guia-escena.ts``).
_MAX_ELEVACION_M: float = float(
    tope(
        sub_esquema(
            _ESQUEMA_RESULTADO, "properties", "piezas", "items", "properties", "elevacion_m"
        ),
        "maximum",
    )
)


class PlanGuiaEscenaRequest(OperationalRequest):
    """``plan-guia-escena.v1``: la forma la valida el contrato exportado, no una copia de sus topes."""

    schema_version: Literal["plan-guia-escena.v1"]
    plan: dict[str, object]
    mezclas: list[dict[str, object]] | None = None

    @model_validator(mode="before")
    @classmethod
    def cumple_el_contrato(cls, valor: object) -> object:
        if isinstance(valor, Mapping):
            cuerpo = {clave: item for clave, item in valor.items() if clave != "context"}
            error = next(
                iter(sorted(_VALIDADOR_PETICION.iter_errors(cuerpo), key=lambda e: list(e.path))),
                None,
            )
            if error is not None:
                ruta = ".".join(str(parte) for parte in error.path) or "<raíz>"
                raise ValueError(f"plan-guia-escena.v1 no cumple el contrato en {ruta}")
        return valor


@dataclass(frozen=True, slots=True)
class _Globo:
    """Un globo en las unidades de su fuente, con ``y`` hacia arriba, en orden de pintura."""

    x: float
    y: float
    r: float
    hex: str


def _texto(valor: object) -> str | None:
    return valor.strip() or None if isinstance(valor, str) else None


def _plegar(texto: str) -> str:
    plano = unicodedata.normalize("NFD", texto)
    return " ".join(
        "".join(c for c in plano if unicodedata.category(c) != "Mn").strip().lower().split()
    )


def hex_del_material(
    material: Mapping[str, object], lineas: Sequence[Mapping[str, object]] = ()
) -> str:
    """El color del globo inflado de lo que se compra para este material, en ``#rrggbb`` minúsculas.

    Con las ``lineas`` resueltas de la pieza manda el título del producto que se compra: el material dice la
    familia («azul») y el producto el tono («Fashion Azul Rey», el 041, no el celeste 040).
    """
    color = _texto(material.get("color"))
    acabado = _texto(material.get("acabado"))
    producto = _texto(material.get("product_id"))
    comprada = next(
        (
            linea
            for linea in lineas
            if producto is not None and _texto(linea.get("product_id")) == producto
        ),
        None,
    )
    # Sin acabado en el material, el de la línea comprada: un «Metal Vinotinto» es un rojo de la familia
    # Metal (515), no el Rojo Fashion 015 que la familia sola daría. La lámina no tiene «Vinotinto».
    acabado = acabado or (_texto(comprada.get("acabado")) if comprada is not None else None)
    referencia = (
        referencia_del_titulo(_texto(comprada.get("titulo")), acabado)
        if comprada is not None
        else None
    ) or referencia_de(color, acabado)
    if referencia is None:
        referencia = color_de(color)
    if referencia is not None and isinstance(referencia.get("hexGlobo"), str):
        return str(referencia["hexGlobo"]).lower()
    if color is not None and _plegar(color) in HEX_PALETA:
        return HEX_PALETA[_plegar(color)].lower()
    return str(hex_de(color)).lower()


def _numero(valor: object) -> float:
    if isinstance(valor, bool) or not isinstance(valor, (int, float)) or not math.isfinite(valor):
        raise RuntimeError("la pieza del motor trae una coordenada que no es un número finito")
    return float(valor)


def _color_por_indice(colores: Sequence[str], indice: object) -> str:
    """El color del material ``indice`` de la pieza; el primero si el índice no apunta a ninguno (el remate)."""
    if isinstance(indice, int) and not isinstance(indice, bool) and 0 <= indice < len(colores):
        return colores[indice]
    return colores[0]


def _globos_de_lista(
    crudos: Sequence[Mapping[str, object]], colores: Sequence[str]
) -> list[_Globo]:
    """Globos ``{x, y, r, capa?, material}`` en metros con ``y`` hacia arriba, ordenados por capa (0 = fondo)."""
    ordenados = sorted(
        crudos,
        key=lambda g: _numero(g["capa"]) if isinstance(g.get("capa"), (int, float)) else 0.0,
    )
    return [
        _Globo(
            _numero(g["x"]),
            _numero(g["y"]),
            _numero(g["r"]),
            _color_por_indice(colores, g.get("material")),
        )
        for g in ordenados
    ]


def _globos_del_arco(
    pieza: Mapping[str, object], colores: Sequence[str]
) -> tuple[list[_Globo], float]:
    """El arco clásico: píxeles de su lienzo con ``y`` hacia abajo. Devuelve los globos y los metros por píxel."""
    crudos = cast(Sequence[Mapping[str, object]], pieza["globos"])
    globos = [
        _Globo(
            _numero(g["x"]),
            -_numero(g["y"]),
            (_numero(g["rx"]) + _numero(g["ry"])) / 2,
            _color_por_indice(colores, g.get("material")),
        )
        for g in crudos
    ]
    anchura = max(g.x + g.r for g in globos) - min(g.x - g.r for g in globos)
    ancho_m = _numero(pieza["ancho_m"])
    return globos, (ancho_m / anchura if anchura > 0 else 1.0)


def _radio_m(nominal: object) -> float:
    """Radio en metros de un globo inflado de ``nominal`` pulgadas (``INFLADO_PULG``, el dueño de las cifras)."""
    pulgadas = INFLADO_PULG.get(int(_numero(nominal)))
    return float(pulgadas if pulgadas is not None else _numero(nominal)) * 0.0254 / 2


def _globos_de_columna(pieza: Mapping[str, object], colores: Sequence[str]) -> list[_Globo]:
    """La columna clásica de frente (``x`` e ``y``; ``z`` es la profundidad) y encima su remate de globos."""
    globos = [
        _Globo(
            _numero(g["x"]),
            _numero(g["y"]),
            _numero(g["r"]),
            _color_por_indice(colores, g.get("material")),
        )
        for g in cast(Sequence[Mapping[str, object]], pieza["globos"])
    ]
    remate = pieza.get("remate")
    lineas = (
        cast(Sequence[Mapping[str, object]], remate.get("globos", ()))
        if isinstance(remate, Mapping)
        else ()
    )
    # El motor no coloca el remate en `globos`: va sobre el cuerpo, en una fila centrada.
    unidades = [
        (_radio_m(linea["tamano"]), _color_por_indice(colores, linea.get("material")))
        for linea in lineas
        for _ in range(int(_numero(linea.get("cantidad", 1))))
    ]
    if unidades:
        cima = max(g.y + g.r for g in globos) if globos else 0.0
        ancho = sum(2 * r for r, _hex in unidades)
        x = -ancho / 2
        for r, tono in unidades:
            globos.append(_Globo(x + r, cima + r * 0.9, r, tono))
            x += 2 * r
    return globos


def _pieza(
    estructura_id: str,
    fuente: Fuente,
    globos: Sequence[_Globo],
    escala: float = 1.0,
    *,
    anclaje: Anclaje | None = None,
    elevacion_m: float | None = None,
    elementos: Sequence[ElementoDibujo] = (),
) -> dict[str, object]:
    """La pieza en su marco local: metros, origen abajo al centro, ``y`` hacia arriba.

    ``anclaje`` y ``elevacion_m`` solo salen si el módulo de la pieza los sabe; la elevación, solo si flota.

    ``elementos`` es lo que se ve sin ser globo (``_estructura_publicada``). Entra en la caja de la pieza —un
    aro parcial mide lo que su marco, no lo que su guirnalda— salvo en una pieza **flotante**: lo que cuelga de
    ella (cintas, pesa) ya lo cuenta ``elevacion_m`` y queda por debajo del origen, hasta el piso.
    """
    extensiones = [(g.x - g.r, g.x + g.r, g.y - g.r, g.y + g.r) for g in globos]
    if anclaje != "flotante":
        extensiones.extend(_extension(elemento) for elemento in elementos)
    izquierda = min(e[0] for e in extensiones)
    derecha = max(e[1] for e in extensiones)
    abajo = min(e[2] for e in extensiones)
    arriba = max(e[3] for e in extensiones)
    centro = (izquierda + derecha) / 2
    sosten: dict[str, object] = {}
    if anclaje is not None:
        sosten["anclaje"] = anclaje
        if anclaje == "flotante" and elevacion_m is not None:
            sosten["elevacion_m"] = round(min(max(elevacion_m, 0.0), _MAX_ELEVACION_M), _DECIMALES)
    return {
        "estructura_id": estructura_id,
        "fuente": fuente,
        "ancho_m": round((derecha - izquierda) * escala, _DECIMALES),
        "alto_m": round((arriba - abajo) * escala, _DECIMALES),
        **sosten,
        "discos": [
            {
                "x_m": round((g.x - centro) * escala, _DECIMALES),
                "y_m": round((g.y - abajo) * escala, _DECIMALES),
                "r_m": round(g.r * escala, _DECIMALES),
                "hex": g.hex,
            }
            for g in globos
        ],
        **_estructura_publicada(elementos, centro, abajo, escala),
    }


# --------------------------------------------------------------------------------------------------------
# Lo que se ve sin ser globo: el marco de un aro, las cintas y la pesa de un bouquet
# --------------------------------------------------------------------------------------------------------

#: Muestras de un arco para medir su caja: sobra para un anillo de una guía de 1024 px.
_MUESTRAS_ARCO = 72


def _puntos_del_arco(arco: ArcoDibujo) -> list[tuple[float, float]]:
    pasos = max(1, round(_MUESTRAS_ARCO * min(1.0, abs(arco.hasta - arco.desde) / 360)))
    return [
        (
            arco.cx + arco.r * math.cos(math.radians(a)),
            arco.cy + arco.r * math.sin(math.radians(a)),
        )
        for a in (arco.desde + (arco.hasta - arco.desde) * k / pasos for k in range(pasos + 1))
    ]


def _extension(elemento: ElementoDibujo) -> tuple[float, float, float, float]:
    """La caja ``(izquierda, derecha, abajo, arriba)`` de un elemento, con medio grosor a cada lado del trazo."""
    if isinstance(elemento, ElipseDibujo):
        return (
            elemento.cx - elemento.rx,
            elemento.cx + elemento.rx,
            elemento.cy - elemento.ry,
            elemento.cy + elemento.ry,
        )
    if isinstance(elemento, PoligonoDibujo):
        puntos, medio = list(elemento.puntos), 0.0
    elif isinstance(elemento, ArcoDibujo):
        puntos, medio = _puntos_del_arco(elemento), elemento.grosor / 2
    else:
        puntos = [(elemento.x1, elemento.y1), (elemento.x2, elemento.y2)]
        medio = elemento.grosor / 2
    xs = [x for x, _y in puntos]
    ys = [y for _x, y in puntos]
    return min(xs) - medio, max(xs) + medio, min(ys) - medio, max(ys) + medio


def _estructura_publicada(
    elementos: Sequence[ElementoDibujo], centro: float, abajo: float, escala: float
) -> dict[str, object]:
    """``trazos`` y ``rellenos`` de la pieza en su marco local; nada si la pieza no trae ninguno."""

    def x(valor: float) -> float:
        return round((valor - centro) * escala, _DECIMALES)

    def y(valor: float) -> float:
        return round((valor - abajo) * escala, _DECIMALES)

    def m(valor: float) -> float:
        return round(valor * escala, _DECIMALES)

    trazos: list[dict[str, object]] = []
    rellenos: list[dict[str, object]] = []
    for e in elementos:
        tono = e.hex.lower()
        if isinstance(e, LineaDibujo):
            trazos.append(
                {
                    "forma": "linea",
                    "x1_m": x(e.x1),
                    "y1_m": y(e.y1),
                    "x2_m": x(e.x2),
                    "y2_m": y(e.y2),
                    "grosor_m": m(e.grosor),
                    "hex": tono,
                }
            )
        elif isinstance(e, ArcoDibujo):
            trazos.append(
                {
                    "forma": "arco",
                    "cx_m": x(e.cx),
                    "cy_m": y(e.cy),
                    "r_m": m(e.r),
                    "desde_grados": round(e.desde, 3),
                    "hasta_grados": round(e.hasta, 3),
                    "grosor_m": m(e.grosor),
                    "hex": tono,
                }
            )
        elif isinstance(e, ElipseDibujo):
            rellenos.append(
                {
                    "forma": "elipse",
                    "cx_m": x(e.cx),
                    "cy_m": y(e.cy),
                    "rx_m": m(e.rx),
                    "ry_m": m(e.ry),
                    "hex": tono,
                }
            )
        else:
            rellenos.append(
                {
                    "forma": "poligono",
                    "puntos": [{"x_m": x(px), "y_m": y(py)} for px, py in e.puntos],
                    "hex": tono,
                }
            )
    salida: dict[str, object] = {}
    if trazos:
        salida["trazos"] = trazos
    if rellenos:
        salida["rellenos"] = rellenos
    return salida


# --------------------------------------------------------------------------------------------------------
# Lo que la resolución ya sabe de cada material: el contexto de las piezas sin motor
# --------------------------------------------------------------------------------------------------------

_TIPOS_GLOBO: frozenset[str] = frozenset({"latex", "metalizado", "burbuja", "numero"})
_CORAZON = re.compile(r"\b(?:corazon|corazones|heart)")
_ESTRELLA = re.compile(r"\b(?:estrella|estrellas|star)")
#: Las oficiales cuya forma por defecto cambia si lo que se compra son globos link (``_forma_por_lo_comprado``).
_PAREDES_DE_LINKS: frozenset[str] = frozenset({"pared_no_densa"})
_FORMA_LINKS = "malla-links"


def _silueta(forma: str | None, titulo: str) -> Silueta | None:
    """La silueta de un globo con forma: la ``forma`` del catálogo y, si no la dice, su título."""
    for texto in (forma or "", titulo):
        plegado = _plegar(texto)
        if _CORAZON.search(plegado):
            return "corazon"
        if _ESTRELLA.search(plegado):
            return "estrella"
    return None


def _mapeos(valor: object) -> list[Mapping[str, object]]:
    if not isinstance(valor, Sequence) or isinstance(valor, str):
        return []
    return [item for item in cast(Sequence[object], valor) if isinstance(item, Mapping)]


def _positivo(valor: object) -> float | None:
    if isinstance(valor, bool) or not isinstance(valor, (int, float)) or not math.isfinite(valor):
        return None
    return float(valor) if valor > 0 else None


def _material_de_leyenda(
    entrada: Mapping[str, object], clasificado: MaterialBouquet | None, silueta: Silueta | None
) -> MaterialGuia:
    digito = entrada.get("digito")
    return MaterialGuia(
        tipo=cast(TipoGlobo, entrada["tipo_globo"]),
        tamano_pulg=_positivo(entrada.get("tamano_pulg"))
        or (clasificado.tamano_pulg if clasificado else None),
        silueta=silueta,
        digito=digito if isinstance(digito, str) else None,
    )


def contexto_de_pieza(
    estructura: Mapping[str, object], datos: Mapping[str, object] | None
) -> ContextoPieza:
    """Lo que la resolución ya sabe de la pieza (``mezclas[]`` de la petición), por material.

    Qué globo es cada material: la ``leyenda`` del armado resuelto si la trae (la resolución la escribió con
    el catálogo delante) y si no, la clasificación de sus ``lineas`` (``plan.contexto_bouquet_de_globos``, la
    misma que usa la hoja de armado del navegador; dueño de la regla: ``armado_bouquet.clasificar``). Lo que
    ninguna de las dos sabe queda en ``None`` y el módulo de la pieza hace lo de siempre.
    """
    datos = datos or {}
    lineas = _mapeos(datos.get("lineas"))
    materiales = materiales_de(estructura)
    clasificados = contexto_bouquet_de_globos(estructura, lineas).materiales if lineas else ()
    leyenda = {
        int(cast(int, entrada["material"])): entrada
        for entrada in _mapeos(datos.get("leyenda"))
        if isinstance(entrada.get("material"), int) and entrada.get("tipo_globo") in _TIPOS_GLOBO
    }
    por_material: list[MaterialGuia | None] = []
    for indice in range(len(materiales)):
        clasificado = clasificados[indice] if indice < len(clasificados) else None
        silueta = (
            _silueta(clasificado.globo.forma, clasificado.globo.titulo) if clasificado else None
        )
        entrada = leyenda.get(indice)
        if entrada is not None:
            por_material.append(_material_de_leyenda(entrada, clasificado, silueta))
        elif clasificado is not None:
            por_material.append(
                MaterialGuia(
                    tipo=cast(TipoGlobo, clasificado.tipo),
                    tamano_pulg=clasificado.tamano_pulg,
                    silueta=silueta,
                    digito=clasificado.digito,
                )
            )
        else:
            por_material.append(None)
    return ContextoPieza(
        mezcla_real=tuple(_mapeos(datos.get("mezcla_real"))),
        materiales=tuple(por_material),
        aspecto_caja=_positivo(datos.get("aspecto_caja")),
    )


def _forma_por_lo_comprado(
    estructura: Mapping[str, object], datos: Mapping[str, object] | None
) -> Mapping[str, object]:
    """La pared no densa que no eligió forma y compra globos link se dibuja en malla de links.

    ``dibujo_estructura`` la dibuja cuadriculada por defecto porque ``malla-links`` pinta globos link, un
    producto que el plan puede no llevar. Si las líneas resueltas de la pieza **sí** compran links (la
    ``forma`` del catálogo es ``link``), esa razón desaparece: la malla es lo que se compra. Ni la lectura de
    la foto ni el plan dicen hoy otra forma de pared, así que nada más la cambia; una forma elegida manda.
    """
    oficial = _texto(estructura.get("estructura_oficial"))
    if oficial not in _PAREDES_DE_LINKS or _FORMA_LINKS not in FORMAS_POR_OFICIAL.get(oficial, ()):
        return estructura
    elegida = _texto(estructura.get("forma"))
    if elegida is not None and elegida in FORMAS_POR_OFICIAL.get(oficial, ()):
        return estructura
    compra_links = any(
        _plegar(str(linea.get("forma") or "")) == "link"
        for linea in _mapeos((datos or {}).get("lineas"))
    )
    if not compra_links or forma_de(estructura) == _FORMA_LINKS:
        return estructura
    return {**estructura, "forma": _FORMA_LINKS}


def pieza_de_guia(
    estructura: Mapping[str, object],
    mezcla_real: Sequence[Mapping[str, object]],
    datos: Mapping[str, object] | None = None,
) -> dict[str, object] | str:
    """Los discos de una estructura del plan, o el motivo por el que no tiene (``sin_materiales``, ``sin_dibujo``).

    ``datos`` es la entrada de ``mezclas[]`` de la petición para esta pieza (``lineas``, ``leyenda``,
    ``aspecto_caja``); sin ella, cada pieza se dibuja con lo que dice el plan, como antes.
    """
    estructura_id = _texto(estructura.get("estructura_id")) or ""
    materiales = materiales_de(estructura)
    if not materiales:
        return "sin_materiales"
    lineas = _mapeos((datos or {}).get("lineas"))
    colores = [hex_del_material(material, lineas) for material in materiales]
    del_motor = pieza_del_motor_resuelta(estructura)
    if del_motor is not None:
        clase, pieza = del_motor
        if clase == "arco":
            globos, escala = _globos_del_arco(pieza, colores)
            return _pieza(estructura_id, "motor", globos, escala)
        if clase == "columna":
            return _pieza(estructura_id, "motor", _globos_de_columna(pieza, colores))
        crudos = cast(Sequence[Mapping[str, object]], pieza["globos"])
        return _pieza(estructura_id, "motor", _globos_de_lista(crudos, colores))
    estructura = _forma_por_lo_comprado(estructura, datos)
    dibujado = globos_y_estructura_de(estructura, mezcla_real)
    del_dibujo, estructura_visible = dibujado if dibujado is not None else ([], [])
    if not del_dibujo:
        contexto = contexto_de_pieza(estructura, {**(datos or {}), "mezcla_real": mezcla_real})
        de_pieza = pieza_de_plugin(estructura, colores, contexto)
        if de_pieza is None:
            return "sin_dibujo"
        return _pieza(
            estructura_id,
            "dibujo",
            [_Globo(x, y, r, tono) for x, y, r, tono in de_pieza.globos],
            anclaje=de_pieza.anclaje,
            elevacion_m=de_pieza.elevacion_m,
            # Lo que se ve sin ser globo, si el módulo lo publica (el bouquet: cintas y pesa).
            elementos=cast(Sequence[ElementoDibujo], getattr(de_pieza, "elementos", ())),
        )
    # El esquema pinta con la tinta de cada material; la guía, con el globo inflado del mismo material.
    tinta_a_globo: dict[str, str] = {}
    for material, tono in zip(materiales, colores, strict=True):
        referencia = referencia_de(_texto(material.get("color")), _texto(material.get("acabado")))
        tinta = str(referencia["hexTinta"]).lower() if referencia is not None else str(hex_de(None))
        tinta_a_globo.setdefault(tinta.lower(), tono)
    globos = [
        _Globo(g.x, g.y, g.r, tinta_a_globo.get(str(g.color).lower(), str(g.color).lower()))
        for g in sorted(del_dibujo, key=lambda g: g.capa)
    ]
    return _pieza(estructura_id, "dibujo", globos, elementos=estructura_visible)


def guia_escena(request: PlanGuiaEscenaRequest) -> dict[str, object]:
    """``plan-guia-escena-result.v1``: los discos de cada pieza con globos del plan y las que no tienen."""
    validar_plan(request.plan)
    datos_por_pieza = {str(item["estructura_id"]): item for item in (request.mezclas or [])}
    piezas: list[dict[str, object]] = []
    omitidas: list[dict[str, object]] = []
    crudas = request.plan.get("estructuras")
    estructuras = (
        [e for e in cast(Sequence[object], crudas) if isinstance(e, Mapping)]
        if isinstance(crudas, Sequence)
        else []
    )
    for estructura in estructuras:
        estructura_id = _texto(estructura.get("estructura_id")) or ""
        datos = datos_por_pieza.get(estructura_id)
        mezcla_real = cast(Sequence[Mapping[str, object]], (datos or {}).get("mezcla_real", ()))
        resultado = pieza_de_guia(estructura, mezcla_real, datos)
        if isinstance(resultado, str):
            omitidas.append({"estructura_id": estructura_id, "motivo": resultado})
        else:
            piezas.append(resultado)
    total = sum(len(cast(Sequence[object], pieza["discos"])) for pieza in piezas)
    if total > MAX_DISCOS:
        raise PlanResolutionError(
            "guia_demasiados_globos", 422, {"total": total, "maximo": MAX_DISCOS}
        )
    resultado_final: dict[str, object] = {
        "operation_schema_version": PLAN_GUIA_ESCENA_RESULT_VERSION,
        "piezas": piezas,
        "omitidas": omitidas,
        "total_discos": total,
    }
    if next(_VALIDADOR_RESULTADO.iter_errors(resultado_final), None) is not None:
        raise RuntimeError("la guía de escena no cumple plan-guia-escena-result.v1")
    return resultado_final


__all__ = [
    "HEX_PALETA",
    "MAX_DISCOS",
    "PLAN_GUIA_ESCENA_REQUEST_VERSION",
    "PLAN_GUIA_ESCENA_RESULT_VERSION",
    "PLAN_GUIA_ESCENA_SCOPE",
    "PlanGuiaEscenaRequest",
    "contexto_de_pieza",
    "guia_escena",
    "hex_del_material",
    "pieza_de_guia",
]
