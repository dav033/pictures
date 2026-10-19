"""Detección del patrón de color de cada estructura de globos en la foto de
referencia (ADR-0028 §11).

Python es el dueño completo de esta llamada: el prompt, el esquema de salida
estructurada y la validación de lo que devuelve el proveedor viven aquí. Next
solo manda la foto y los elementos `balloon_structure` que el análisis de
Amaterasu ya encontró, y guarda cada pista en su elemento del blueprint
(`appearance.patron_color`). El prompt del análisis de referencia sigue
congelado: esta es una llamada aparte, después de él.

Una pista no decide nada comercial. Al confirmar el plan viaja como
`pistas_patron` y `patron_color.py` decide si cubre los colores de la
estructura; si no, usa el preset (ADR-0028 §7). Por eso aquí la validación es
de forma: colores fuera de la paleta del catálogo, elementos que no se pidieron
y números fuera de rango se descartan o se acotan, nunca se inventan.

Mismo proveedor, modelo y cliente que el turno del análisis
(`app/amaterasu/turno.py`).
"""

from __future__ import annotations

import hashlib
import json
import math
import unicodedata
from collections.abc import Mapping
from typing import Annotated, Callable, Literal, cast

from pydantic import Field, StringConstraints, model_validator

from app.amaterasu.estructuras import frase_inicio_de_pieza
from app.amaterasu.vision_estructurada import DEFAULT_MODEL, LecturaFotoError, leer_foto
from app.armado_columna import TIPOS_REMATE
from app.generated_models import contract_schema
from app.operational_models import ContractModel, OperationalRequest
from app.patron_color import ANCLAS as ANCLAS_PATRON
from app.patron_color import CONFIANZA_MINIMA_PISTA, EXTENSION_ZONA_MAXIMA, ZONAS_MAXIMAS
from app.patron_color import DIRECCIONES as DIRECCIONES_PATRON
from app.patron_color import MODOS as MODOS_PATRON


PATRON_REFERENCIA_SCOPE = "ia.patron_referencia"
PATRON_REFERENCIA_SCHEMA_VERSION = "patron-referencia.v1"
PATRON_REFERENCIA_RESULT_VERSION = "patron-referencia-result.v1"
MAX_ELEMENTOS = 12
MAX_COLORES = 12
# Una sola foto: el techo real es el cuerpo de 11MB de la ruta (el mismo que el
# análisis de referencia); esto solo rechaza lo absurdo antes de decodificar.
MAX_IMAGE_BASE64_CHARS = 15_000_000
MAX_OUTPUT_TOKENS = 2_048

# Los modos los define el contrato (`patron-color.v1`); un solo dueño.
MODOS: tuple[str, ...] = MODOS_PATRON
MODO_NINGUNO = "ninguno"
#: La pieza entera de un solo color. No es un modo de `patron-color.v1` —un color no tiene disposición— pero
#: tampoco es «no se distingue»: es una lectura, y la que decide que el plan compre UN material en vez de
#: tres. Antes caía en `ninguno` junto con «está tapada» y el color se perdía: una columna de dorado cromado
#: acababa comprando dorado, café y oro rosa, que son sus reflejos (2026-10-03).
MODO_MONOCROMO = "monocromo"
# Los sitios de una mancha, también del contrato (modo `zonas`, ADR-0036).
ANCLAS: tuple[str, ...] = ANCLAS_PATRON
#: Topes de una mancha, del contrato; se reexportan para el prompt y la validación.
EXTENSION_MAXIMA = EXTENSION_ZONA_MAXIMA
MAX_ZONAS = ZONAS_MAXIMAS

#: El eje por el que recorre el patrón y la simetría de la pieza (ADR-0039). Las direcciones las define el
#: contrato (``patron-color.v1``, reexportadas por ``patron_color.DIRECCIONES``); la longitudinal es el valor
#: de partida y no viaja en la pista.
#: Colores salpicados que se admiten por pieza; el mismo tope que el contrato (`PistaPatronSchema.motas`).
MAX_MOTAS = 4

DIRECCIONES: tuple[str, ...] = DIRECCIONES_PATRON
DIRECCION_POR_DEFECTO = "longitudinal"
SIMETRIA_ESPEJO = "espejo"


#: Los cuatro tamaños que la foto sabe distinguir (`TAMANOS_LEIDOS` de `patron-color.v1`). Se leen del
#: contrato exportado, igual que `PALETA`, para que el vocabulario tenga un solo dueño: añadir uno en el Zod
#: lo pone en el prompt y en el esquema de salida sin tocar este archivo.
def _tamanos_del_contrato() -> tuple[str, ...]:
    """Los cuatro tamaños que la foto sabe distinguir, leídos del contrato exportado.

    Igual que ``PALETA``, para que el vocabulario tenga un solo dueño: añadir uno en el Zod lo pone en el
    prompt y en el esquema de salida sin tocar este archivo.
    """
    peticion = contract_schema("PlanResolutionRequest")
    propiedades = cast(Mapping[str, Mapping[str, object]], peticion["properties"])
    items = cast(Mapping[str, object], propiedades["pistas_tamanos"]["items"])
    campos = cast(Mapping[str, Mapping[str, object]], items["properties"])
    return tuple(str(tamano) for tamano in cast(list[object], campos["tamanos"]["enum"]))


TAMANOS: tuple[str, ...] = _tamanos_del_contrato()

#: Lo que corona una columna (``armado-columna.v1``, ADR-0039). El dueño del vocabulario es la puerta del
#: motor (``app/armado_columna.py``, reexportado de ``columna/tipos.py``): añadir un remate allá se ve aquí.
#: Solo se lee de las columnas; el arco del motor no tiene remate y el bouquet tiene el suyo (ADR-0030).
REMATES = TIPOS_REMATE
TIPO_COLUMNA = "columna"

#: Los modos que la columna clásica arma con anillos de un solo tamaño (``patron_de_la_foto``: espiral,
#: apilado). El motor orgánico no arma una espiral, y unos anillos o unos bloques bajo un globo gigante son
#: la columna clásica de siempre.
MODOS_DE_ANILLOS = frozenset({"espiral", "anillos", "bloques"})

# Vocabulario de color del catálogo: `x-paleta-colores` del contrato
# `plan-decoracion.v1` (exportada desde PALETA_COLORES_V2 en TypeScript).
# "multicolor" es un producto surtido, no el color de una posición del patrón.
PALETA: tuple[str, ...] = tuple(
    color
    for color in cast(list[str], contract_schema("PlanDecoracion")["x-paleta-colores"])
    if color != "multicolor"
)


class PatronReferenciaError(LecturaFotoError):
    """Stable domain error translated by the HTTP boundary. `provider_detail`
    carries the provider's finish/block reason when the answer was empty."""


TextoCorto = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class ImagenReferencia(ContractModel):
    mime_type: Literal["image/png", "image/jpeg", "image/webp"]
    data_base64: str = Field(min_length=1, max_length=MAX_IMAGE_BASE64_CHARS)


class CajaElemento(ContractModel):
    """`reference_bbox` del blueprint: fracciones de la imagen, origen arriba a la izquierda."""

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)


class ElementoReferencia(ContractModel):
    element_id: TextoCorto
    # Tipo de estructura del plan (`visual_semantics.structure_type`) o
    # "desconocido": solo es contexto para el modelo, no filtra modos. Los modos
    # admitidos por tipo son una regla de `patron_color.py`, no de aquí.
    tipo: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
    bbox: CajaElemento | None = None
    colores_observados: list[TextoCorto] = Field(default_factory=list, max_length=MAX_COLORES)


class PatronReferenciaRequest(OperationalRequest):
    """Authenticated operation body: one reference photo and the balloon
    structures the reference analysis found in it (1..12)."""

    schema_version: Literal["patron-referencia.v1"]
    imagen: ImagenReferencia
    elementos: list[ElementoReferencia] = Field(min_length=1, max_length=MAX_ELEMENTOS)

    @model_validator(mode="after")
    def reject_duplicate_element_ids(self) -> "PatronReferenciaRequest":
        ids = [elemento.element_id for elemento in self.elementos]
        if len(ids) != len(set(ids)):
            raise ValueError("element ids must be unique")
        return self


SYSTEM_INSTRUCTION = f"""You are an expert balloon decorator trained in the Sempertex method. You read how the colors are ARRANGED in the balloon structures of a customer's reference photo, the way a decorator reads a numbered color chart to rebuild a piece cluster by cluster. You do not count balloons, price anything or judge quality.

For each element listed in the message (element_id, its structure type and, when given, its bounding box as fractions of the image with the origin at the top-left corner), look only at that piece and name the color pattern a decorator would use to build it.

What you are naming is HOW THE COLORS ARE LAID OUT on that piece, never how it was built. An organic garland or an organic column -- balloons of several sizes, packed in clusters, no visible grid -- can be laid out in any of these ways: if its colors sit in stretches, one color owning the left, another the middle and another the right, that is "bloques", not "aleatorio". Reach for "aleatorio" only when every color really is spread over the whole piece from one end to the other.

- "espiral" (spiral, zigzag or straight stripes): the piece is made of identical clusters, usually quartets of 4 balloons, with the same colors in the same positions in every cluster. Rotated one eighth of a turn per layer the colors form continuous diagonal spiral stripes; turned left for two layers and right for the next two they form zigzag chevrons; stacked without rotation each color runs as a straight vertical stripe. All three are "espiral". colores = the colors of ONE cluster in position order, repeating a color when it takes two positions (for example blanco, negro, blanco, azul). globos_por_racimo = balloons per cluster.
- "anillos" (rings, "salvavidas"): every cluster is a single color and the colors follow each other along the piece (for example a blanco ring, a dorado ring, a blanco ring...). colores = the ring colors in order from the start of the piece, one per ring of the repeating sequence.
- "bloques" (color-blocked sections): long sections of mostly one color each, following each other along the piece. The transitions can be clean or they can blend, and a section may carry a few balloons of the neighbouring colors: what makes it "bloques" is that each color OWNS a stretch of the piece instead of running along the whole of it. colores = the sections in order from the start of the piece. pesos = the relative length of each section as integers from 1 to 100, one per color.
- "degradado" (degradé, ombré): the colors blend gradually from one into the next along the piece. colores = the stops in order from the start of the piece, 2 to 6 colors.
- "aleatorio" (confetti, organic mix): the colors are mixed with no regular order, every color appearing all over the piece from one end to the other. colores = the colors present, the most used first. pesos = the approximate share of each color as integers from 1 to 100, one per color.
- "flor" (daisy motif): runs of background clusters, then a flower made of petal clusters around one center balloon, repeating. colores = exactly three colors: background, petal, center.
- "damero" (checkerboard, only on flat balloon walls): a checkerboard of 2 colors, or diagonal rainbow bands of 3 or 4 colors. colores = the colors in order.
- "zonas" (color gathered in patches, only on flat balloon walls): one color covers most of the wall as a base and one or more OTHER colors sit GATHERED in compact patches at particular places on it, touching each other, instead of being spread over the whole wall. This is the usual organic wall: a pearl base with a metallic color clustered in a few spots. colores = the base color FIRST, then the patch colors in the order you list the patches. zonas = one entry per patch you can see, with the patch's color, where on the wall its middle sits (ancla) and roughly what percentage of the whole wall it covers (extension). Use several entries with the SAME color when one color is gathered in several separate spots — four patches of dorado is four entries. Do not use "zonas" when a color is sprinkled all over the piece: that is "aleatorio".
- "monocromo": the WHOLE piece is one single color, with no second color anywhere on it. colores = that one color, alone. A chrome or metallic piece is still monocromo: a mirror balloon reflects the wall, the floor and the furniture around it, so you will see browns, pinks and greens ON it that are not balloon colors. Name only the color the balloons ARE.
- "ninguno": you cannot tell the arrangement -- the piece is hidden, cut off or too blurry. colores = []. Do NOT use "ninguno" for a one-color piece: that is "monocromo".

The nine places a patch can sit (ancla), reading the piece as thirds: {", ".join(ANCLAS)}.

{frase_inicio_de_pieza()}

Colors: use ONLY these catalog color names, spelled exactly as written: {", ".join(PALETA)}. Map what you see to the closest of these names (light pink is rosado, chrome or metallic gold is dorado, clear is transparente). Never write any other color name, and never write "multicolor". The colors the first analysis observed are given as a hint; trust the photo when they disagree.

motas: the colors that are SPRINKLED over the piece instead of owning a stretch of it -- clear bubble balloons scattered along an organic arch, a few loose chrome or metallic balloons, a gold that shows up every so often. Name a color here, not in colores, when it never forms a section of its own and you would describe it as "here and there". A color belongs either in colores or in motas, never in both, and leave motas out when every color sits in a run of its own.

tamanos: what SIZES of balloon the piece is made of, which decides how it is built and bought. Read it from the balloons themselves, comparing them to each other -- never from the size of the piece:

- "casi_todos_gigantes": nearly every balloon is one of the big ones, and the small ones are rare or absent. A piece of a dozen large balloons with two little ones tucked between them is this.
- "grandes_con_pocos_chicos": big balloons carry the piece and smaller ones fill the gaps between them, roughly one small for every two big.
- "chicos_con_pocos_grandes": small and medium balloons make up most of the piece and a few big ones stand out as accents. This is the usual organic look.
- "un_solo_tamano": every balloon is the same size, with no mix at all.

Leave tamanos out when the balloons are too far, too blurry or too cut off to compare their sizes. Do not guess it from the kind of piece.

For every element, also read two things about the whole arrangement:

- direccion: the axis the pattern runs along. "longitudinal" is along the piece, which is the usual one: up a column, from one foot of an arch over the top to the other, along a garland, down a wall from the top. "transversal" is the pattern running ACROSS the piece instead: on a wall, bands that go from the left edge to the right one; on an arch or a column, colors that change across the width of the band rather than along it. "diagonal" is only for a degradado that runs corner to corner. Say "longitudinal" when in doubt.
- simetria: "espejo" when the two halves of the piece are the same, mirrored: an arch whose left leg repeats the right one reading from each foot up to the top, or an upside-down-U garland that repeats from each end to the middle. Leave it out when the piece runs straight through from one end to the other, which is the usual one, and whenever you cannot see both halves.

For an element whose structure type is "columna" (and ONLY for those), also read what crowns it, which a decorator builds separately from the body: remate.tipo is "globo" for one single big balloon sitting on the top, "racimo" for a small cluster of 3 to 5 balloons on the top, "estrella" or "corazon" for a foil star or heart, and "ninguno" when the column ends flush with its last ring, which is just as common. Say "ninguno" when you can see the top of the column and there is nothing on it; leave remate out entirely when the top is cut off by the frame, hidden behind something or too blurry to tell. remate.color is the catalog color of that topper when you can see it. Never read a remate for any other structure type.

confianza: a number from 0 to 1 for how sure you are of the pattern (not of the exact colors). Below 0.5 means a decorator would not rely on it; prefer "ninguno" to a guess. It does not judge the remate: a column whose arrangement you cannot tell can still have a plain big balloon on top.

Return exactly one entry per listed element_id and never an element that is not listed."""

# Sin `maxItems`: Gemini (gemini-3.6-flash) responde 400 INVALID_ARGUMENT a un
# response_schema que lo lleva (medido 2026-09-24; `minimum`/`maximum` sí los
# acepta). Los topes de elementos y colores los aplica `validar_pistas` sobre
# la salida, que es donde se validan de todos modos.
RESPONSE_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {
        "pistas": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "element_id": {"type": "string"},
                    "modo": {"type": "string", "enum": [*MODOS, MODO_MONOCROMO, MODO_NINGUNO]},
                    "colores": {
                        "type": "array",
                        "items": {"type": "string", "enum": list(PALETA)},
                    },
                    "globos_por_racimo": {"type": "integer", "minimum": 1, "maximum": 8},
                    "pesos": {
                        "type": "array",
                        "items": {"type": "integer", "minimum": 1, "maximum": 100},
                    },
                    "zonas": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "color": {"type": "string", "enum": list(PALETA)},
                                "ancla": {"type": "string", "enum": list(ANCLAS)},
                                "extension": {
                                    "type": "integer",
                                    "minimum": 1,
                                    "maximum": EXTENSION_MAXIMA,
                                },
                            },
                            "required": ["color", "ancla", "extension"],
                        },
                    },
                    "motas": {
                        "type": "array",
                        "items": {"type": "string", "enum": list(PALETA)},
                    },
                    "tamanos": {"type": "string", "enum": list(TAMANOS)},
                    "direccion": {"type": "string", "enum": list(DIRECCIONES)},
                    "simetria": {"type": "string", "enum": ["espejo"]},
                    "remate": {
                        "type": "object",
                        "properties": {
                            "tipo": {"type": "string", "enum": list(REMATES)},
                            "color": {"type": "string", "enum": list(PALETA)},
                        },
                        "required": ["tipo"],
                    },
                    "confianza": {"type": "number", "minimum": 0, "maximum": 1},
                },
                "required": ["element_id", "modo", "colores", "confianza"],
            },
        },
    },
    "required": ["pistas"],
}

# Versión del prompt que viaja en el resultado y en la telemetría de Next: cambia
# con cualquier cambio del texto, de la paleta o del esquema de salida.
PROMPT_VERSION = (
    "patron-referencia.v1:"
    + hashlib.sha256(
        (SYSTEM_INSTRUCTION + json.dumps(RESPONSE_SCHEMA, sort_keys=True)).encode("utf-8")
    ).hexdigest()[:16]
)


def _mensaje(elementos: list[ElementoReferencia]) -> str:
    datos = [
        {
            "element_id": elemento.element_id,
            "tipo": elemento.tipo,
            **({"bbox": elemento.bbox.model_dump()} if elemento.bbox else {}),
            "colores_observados": elemento.colores_observados,
        }
        for elemento in elementos
    ]
    return (
        "Read the color pattern of each of these balloon structures in the photo.\n"
        f"<ELEMENTS>{json.dumps(datos, ensure_ascii=False)}</ELEMENTS>"
    )


def _normalizar(texto: str) -> str:
    sin_tildes = unicodedata.normalize("NFD", texto)
    return "".join(c for c in sin_tildes if unicodedata.category(c) != "Mn").strip().lower()


_PALETA_NORMALIZADA = {_normalizar(color): color for color in PALETA}


def _entero(valor: object, minimo: int, maximo: int) -> int | None:
    """Número del proveedor a entero acotado; `None` si no es un número finito."""
    if isinstance(valor, bool) or not isinstance(valor, (int, float)):
        return None
    if not math.isfinite(valor):
        return None
    return min(maximo, max(minimo, int(round(valor))))


def _remate(valor: object) -> dict[str, object] | None:
    """Lo que corona una columna, validado; `None` si el proveedor no lo dijo o dijo algo que no existe.

    `None` y `{"tipo": "ninguno"}` **no** son lo mismo y no se confunden: el primero es «no se ve la punta»
    y deja que el motor ponga su remate, y el segundo es «la punta no lleva nada», que es una lectura. Esa
    diferencia es el motivo de este campo (ADR-0039).
    """
    if not isinstance(valor, dict):
        return None
    tipo = valor.get("tipo")
    tipo = tipo.strip().lower() if isinstance(tipo, str) else None
    if tipo not in REMATES:
        return None
    leido: dict[str, object] = {"tipo": tipo}
    color = valor.get("color")
    nombre = _PALETA_NORMALIZADA.get(_normalizar(color)) if isinstance(color, str) else None
    # Sin remate no hay color que leer: un «ninguno» con color sería una contradicción que viajaría al plan.
    if nombre is not None and tipo != "ninguno":
        leido["color"] = nombre
    return leido


def _motas_validas(crudas: object, excluir: list[str]) -> list[str]:
    """Las motas (colores salpicados sobre la pieza) que valen, como mucho ``MAX_MOTAS``.

    Se validan igual que ``colores`` —solo los de la paleta, sin repetir— y se quita cualquiera de
    ``excluir``: un color es un tramo o es una mota, no las dos cosas, y si viniera en las dos el motor lo
    pintaría dos veces. En una monocroma, ``excluir`` es su color: «rosado con motas rosado» sigue siendo
    rosado.
    """
    motas: list[str] = []
    if isinstance(crudas, list):
        for color in cast(list[object], crudas):
            nombre = _PALETA_NORMALIZADA.get(_normalizar(color)) if isinstance(color, str) else None
            if nombre is not None and nombre not in excluir and nombre not in motas:
                motas.append(nombre)
    return motas[:MAX_MOTAS]


def _tamanos_del_cuerpo(tamanos: str, remate: object, modo: str | None, confianza: float) -> str:
    """Los tamaños del cuerpo de la pieza, sin contar el globo que la corona.

    El remate se lee y se arma aparte, pero el lector lo cuenta en los tamaños: unas columnas clásicas en
    espiral de globos iguales con un globo gigante encima salían «chicos con pocos grandes», que es la mezcla
    orgánica fina, y se armaban, dibujaban y compraban como columnas orgánicas (pruebas del 2026-10-05). Con
    una corona de un globo y un patrón de anillos leído con confianza, el globo grande es la corona y el
    cuerpo es de un solo tamaño. Sin corona, o con un patrón que también arma el orgánico, la lectura se queda.
    """
    corona = remate.get("tipo") if isinstance(remate, Mapping) else None
    if (
        tamanos == "chicos_con_pocos_grandes"
        and corona == "globo"
        and modo in MODOS_DE_ANILLOS
        and confianza >= CONFIANZA_MINIMA_PISTA
    ):
        return "un_solo_tamano"
    return tamanos


def _pista(
    item: object, pendientes: set[str], tipos: Mapping[str, str]
) -> dict[str, object] | None:
    """Una pista del proveedor, validada; `None` si no se puede usar."""
    if not isinstance(item, dict):
        return None
    element_id = item.get("element_id")
    if not isinstance(element_id, str) or element_id.strip() not in pendientes:
        return None
    element_id = element_id.strip()
    modo = item.get("modo")
    modo = modo.strip().lower() if isinstance(modo, str) else None
    if modo not in (*MODOS, MODO_MONOCROMO, MODO_NINGUNO):
        return None
    confianza = item.get("confianza")
    if isinstance(confianza, bool) or not isinstance(confianza, (int, float)):
        return None
    if not math.isfinite(confianza):
        return None
    pendientes.discard(element_id)
    pista: dict[str, object] = {
        "element_id": element_id,
        "modo": MODO_NINGUNO,
        "colores": [],
        "confianza": min(1.0, max(0.0, float(confianza))),
    }
    # El remate es de la pieza, no de su disposicion de color: se lee aunque el modo sea "ninguno", y solo
    # en una columna (el arco del motor no tiene remate y el bouquet tiene el suyo, ADR-0030).
    if tipos.get(element_id) == TIPO_COLUMNA:
        remate = _remate(item.get("remate"))
        if remate is not None:
            pista["remate"] = remate
    # Los tamaños tampoco son de la disposición de color: son de la pieza, como el remate. Van ANTES de los
    # dos retornos de abajo a propósito — una pieza de un solo color sale por `monocromo` y una tapada por
    # `ninguno`, y las dos tienen tamaños que se ven. Puesto después, la columna dorada cromada del
    # 2026-10-03 —monocroma— nunca habría llegado a decirlos, que es justo el caso que lo motivó.
    tamanos = item.get("tamanos")
    if isinstance(tamanos, str) and tamanos.strip().lower() in TAMANOS:
        pista["tamanos"] = _tamanos_del_cuerpo(
            tamanos.strip().lower(), pista.get("remate"), modo, float(confianza)
        )
    if modo == MODO_NINGUNO:
        return pista
    if modo == MODO_MONOCROMO:
        # Un solo color, y tiene que ser uno: con cero no se sabe cuál y con dos no es monocroma. En los dos
        # casos la lectura vale menos que admitir que no se distingue, así que cae a "ninguno".
        #
        # Y con la confianza de cualquier otra lectura de la foto (``CONFIANZA_MINIMA_PISTA``): la monocroma no
        # es una pista que ``patron_color`` pueda descartar después, sino el ``color_unico`` del blueprint, que
        # en Next manda sobre las etiquetas y sobre la medida. Dicha con 0,2 dejaba una columna dorada, blanca y
        # negra comprada solo en dorado (2026-10-05). Por debajo del corte también cae a "ninguno"; el remate y
        # los tamaños, leídos arriba, se quedan.
        if float(confianza) < CONFIANZA_MINIMA_PISTA:
            return pista
        crudos = item.get("colores")
        nombres = [
            nombre
            for nombre in (
                _PALETA_NORMALIZADA.get(_normalizar(c)) if isinstance(c, str) else None
                for c in (crudos if isinstance(crudos, list) else [])
            )
            if nombre is not None
        ]
        # Una monocroma con motas de OTRO color no es de un solo color: es un color de base con otro
        # salpicado. Con la foto de ejemplo 08 (columnas rosa perlado con globos dorados sueltos) la lectura
        # dijo «monocromo rosado, motas dorado» y, como el ``color_unico`` manda sobre las etiquetas, el dorado
        # se perdía entero (2026-10-05). Cae a "ninguno" y deciden las etiquetas («pearl pink, chrome gold»).
        if len(set(nombres)) == 1 and not _motas_validas(item.get("motas"), excluir=nombres):
            pista["modo"] = MODO_MONOCROMO
            pista["colores"] = nombres[:1]
        return pista

    colores_crudos = item.get("colores")
    colores_crudos = colores_crudos if isinstance(colores_crudos, list) else []
    pesos_crudos = item.get("pesos")
    # Los pesos van alineados con los colores: si no tienen el mismo largo no se
    # sabe de qué color es cada uno, así que no se usan.
    pesos_alineados = isinstance(pesos_crudos, list) and len(pesos_crudos) == len(colores_crudos)
    colores: list[str] = []
    pesos: list[int] = []
    for indice, color in enumerate(colores_crudos):
        nombre = _PALETA_NORMALIZADA.get(_normalizar(color)) if isinstance(color, str) else None
        if nombre is None:
            continue
        if pesos_alineados:
            peso = _entero(cast(list[object], pesos_crudos)[indice], 1, 100)
            if peso is None:
                pesos_alineados = False
            else:
                pesos.append(peso)
        colores.append(nombre)
    colores = colores[:MAX_COLORES]
    if not colores:
        return pista
    pista["modo"] = modo
    pista["colores"] = colores
    globos = _entero(item.get("globos_por_racimo"), 1, 8)
    if globos is not None:
        pista["globos_por_racimo"] = globos
    motas = _motas_validas(item.get("motas"), excluir=colores)
    if motas:
        pista["motas"] = motas
    # El eje y la simetría del patrón (ADR-0039). Aquí la validación es de forma: qué direcciones admite la
    # pieza y si lleva espejo lo decide `patron_color` con la tabla de `modos_admitidos`, que es su dueña, y
    # el motor con los mandos que publica. Una dirección longitudinal no viaja: es el valor de partida de
    # los dos, y mandarla solo engordaría la pista.
    direccion = item.get("direccion")
    if isinstance(direccion, str) and direccion.strip().lower() in DIRECCIONES:
        direccion = direccion.strip().lower()
        if direccion != DIRECCION_POR_DEFECTO:
            pista["direccion"] = direccion
    simetria = item.get("simetria")
    if isinstance(simetria, str) and simetria.strip().lower() == SIMETRIA_ESPEJO:
        pista["simetria"] = SIMETRIA_ESPEJO
    if pesos_alineados and pesos:
        pista["pesos"] = pesos[:MAX_COLORES]
    manchas = _zonas(item.get("zonas"))
    if manchas:
        pista["zonas"] = manchas
    elif modo == "zonas":
        # Un patrón en zonas SIN manchas no dice dónde va nada, y su base la
        # armaría `_base_de_zonas_de_pista` con la lista de colores, que no
        # lleva sitios: se degrada a "ninguno" y la pieza cae al preset.
        pista["modo"] = MODO_NINGUNO
        pista["colores"] = []
    return pista


def _zonas(valor: object) -> list[dict[str, object]]:
    """Manchas del proveedor, validadas una a una (ADR-0036).

    Forma, no criterio: una mancha sin color de la paleta, sin un ancla conocida
    o sin extensión se descarta; el resto se acota al rango del contrato. Lo que
    queda lo decide `patron_color.patron_desde_pista`, que resuelve cada color
    contra los materiales de la pieza y cae al preset si no encaja.
    """
    if not isinstance(valor, list):
        return []
    manchas: list[dict[str, object]] = []
    for item in cast(list[object], valor):
        if not isinstance(item, dict) or len(manchas) >= MAX_ZONAS:
            continue
        color = item.get("color")
        nombre = _PALETA_NORMALIZADA.get(_normalizar(color)) if isinstance(color, str) else None
        ancla = item.get("ancla")
        extension = _entero(item.get("extension"), 1, EXTENSION_MAXIMA)
        if nombre is None or not isinstance(ancla, str) or ancla not in ANCLAS:
            continue
        if extension is None:
            continue
        manchas.append({"color": nombre, "ancla": ancla, "extension": extension})
    return manchas


def validar_pistas(raw: object, elementos: list[ElementoReferencia]) -> list[dict[str, object]]:
    """Valida la salida del proveedor contra lo que se pidió.

    La forma de nivel superior es obligatoria (sin ella no hay respuesta que
    leer). Cada pista se valida por separado: una que nombra un elemento que no
    se pidió, repite uno o trae un modo desconocido se descarta; los colores
    fuera de la paleta se quitan y los números se acotan a su rango. Una pista
    que se queda sin colores pasa a "ninguno", y también una "monocromo" por debajo de
    ``CONFIANZA_MINIMA_PISTA``: en Next es el ``color_unico`` de la pieza, que manda sobre sus etiquetas. El
    remate solo se conserva en una columna, y solo si su tipo existe en el motor.
    """

    if not isinstance(raw, dict) or not isinstance(raw.get("pistas"), list):
        raise PatronReferenciaError("patron_referencia_invalid_output", 502)
    pendientes = {elemento.element_id for elemento in elementos}
    tipos = {elemento.element_id: elemento.tipo.strip().lower() for elemento in elementos}
    pistas: list[dict[str, object]] = []
    for item in cast(list[object], raw["pistas"]):
        pista = _pista(item, pendientes, tipos)
        if pista is not None:
            pistas.append(pista)
    return pistas


async def detectar_patrones_referencia(
    payload: PatronReferenciaRequest,
    client_factory: Callable[[str], object] | None = None,
) -> dict[str, object]:
    """Una llamada de visión a Gemini con salida estructurada. Nunca reintenta:
    la detección es opcional y Next sigue sin pistas ante cualquier fallo.

    `client_factory` is dependency injection for tests, same pattern as
    `ejecutar_turno_gemini`.
    """

    raw, usage = await leer_foto(
        mime_type=payload.imagen.mime_type,
        data_base64=payload.imagen.data_base64,
        mensaje=_mensaje(payload.elementos),
        system_instruction=SYSTEM_INSTRUCTION,
        response_schema=RESPONSE_SCHEMA,
        max_output_tokens=MAX_OUTPUT_TOKENS,
        prefijo="patron_referencia",
        error=PatronReferenciaError,
        client_factory=client_factory,
    )
    return {
        "operation_schema_version": PATRON_REFERENCIA_RESULT_VERSION,
        "pistas": validar_pistas(raw, payload.elementos),
        "modelo": DEFAULT_MODEL,
        "prompt_version": PROMPT_VERSION,
        "usage": usage,
    }


__all__ = [
    "MODOS",
    "PALETA",
    "PATRON_REFERENCIA_RESULT_VERSION",
    "PATRON_REFERENCIA_SCHEMA_VERSION",
    "PATRON_REFERENCIA_SCOPE",
    "PROMPT_VERSION",
    "PatronReferenciaError",
    "PatronReferenciaRequest",
    "detectar_patrones_referencia",
    "validar_pistas",
]
