"""Guirnalda: recorrido orgánico a lo largo de una superficie o del piso.

Además de lo que las lecturas comunes necesitan (dónde empieza la pieza, cómo
se cuenta), aquí vive la lectura propia de la guirnalda (``lectura-guirnalda``,
ADR-0032, entrega E4): cómo está armada según la foto. Amaterasu solo describe;
``app/armado_guirnalda.py`` decide al confirmar el plan si la usa, y la
cantidad nunca sale de aquí (es del conteo, ADR-0031).

Criterios de detección (los del oficio que describe SEGUIMIENTO-guirnaldas §2.2):

- Soporte: pegada o colgada de ganchos sobre la pared (``pared``); colgada de
  dos o más puntos con la cuerda en el aire (``colgada``); apoyada en el piso
  (``piso``); sobre una mesa o su borde (``mesa``); abrazada a otra pieza de
  globos de la foto, como un arco o un fondo (``sobre_estructura``).
- Forma: recta, curva suave, ondulada (sube y baja a lo largo), U invertida
  (enmarca algo desde arriba, con los lados que bajan) o arco caído (cuelga
  entre anclajes y baja en el centro).
- Caída y desnivel (ADR-0032, decisión 26): cuánto baja el centro bajo la
  recta que une los extremos y cuánto más alto o más bajo está el extremo
  derecho que el izquierdo, los dos como fracción del largo horizontal. Nunca
  metros: una foto no los mide, y ``armado_guirnalda.py`` los pasa a metros
  con el largo del plan. ``null`` cuando el modelo no los distingue.
- Racimos: la unidad que se repite (trío, cuarteto o quinteto) y los colores de
  un racimo típico. Relleno: globos chicos entre racimos, con su color y la
  parte de la guirnalda que ocupan. Remates: globos más grandes que los del
  racimo (o metalizados, o burbujas) en un extremo, al centro o repartidos.
- Un arco de pie sobre dos bases, una columna o una pared de globos no es una
  guirnalda: confianza 0. La lectura se pide también para arcos y semiarcos
  (una guirnalda colgada puede salir como arco del reconocedor, SEGUIMIENTO §5).

``DEFINICION`` no cambia: su orden y sus frases fijan la versión del prompt del
patrón y del conteo.
"""

from __future__ import annotations

import json
import math
import unicodedata
from collections.abc import Mapping, Sequence
from typing import cast

from app.amaterasu.estructuras.base import DefinicionEstructura
from app.armado_guirnalda import FORMAS, POSICIONES_REMATE, SOPORTES, UNIDADES

DEFINICION = DefinicionEstructura(
    clave="guirnalda",
    inicio_de_pieza="the left end of a garland",
    como_contar=(
        "an organic run of clusters along a wall, a table, the floor or another piece, "
        "usually with small filler balloons between the clusters. Count the clusters from "
        "one end to the other and the balloons of each, then add the fillers and any foils "
        "on it"
    ),
)

CLASES_REMATE = ("latex", "metalizado", "burbuja")
MAX_REMATES = 6
MAX_COLORES_RACIMO = 5
MAX_RACIMOS = 2_500
MAX_PROPORCION_RELLENO = 0.5
#: Topes de la caída y del desnivel leídos, como fracción del largo (``LecturaGuirnaldaSchema``).
MAX_CAIDA_RELATIVA = 0.6
MAX_DESNIVEL_RELATIVO = 0.6


def instruccion_sistema(paleta: Sequence[str]) -> str:
    """El prompt de la lectura de la guirnalda, con la paleta de colores del catálogo."""
    return f"""You are an expert balloon decorator trained in the Sempertex method. You read how each balloon garland in a customer's reference photo is BUILT, the way a decorator would rebuild it cluster by cluster. You do not count the whole garland for a quote, price anything or judge quality.

For each element listed in the message (element_id and, when given, its bounding box as fractions of the image with the origin at the top-left corner), look only at that piece. A garland is an organic run of balloon clusters along something. A balloon arch standing on two bases, a column, a balloon wall or a ceiling installation is not a garland: give it confianza 0.

soporte: what holds the garland.
- "pared": fixed flat on a wall or backdrop with hooks or tape.
- "colgada": hung from two or more points with the cord in the air (over a doorway, between two posts, from the ceiling).
- "piso": resting on the floor.
- "mesa": resting on a table or along its edge.
- "sobre_estructura": wrapped around another balloon piece of the photo (an arch, a backdrop frame). Then anfitriona_element_id is that piece's element_id, taken from OTHER_PIECES or an arch or half-arch listed in ELEMENTS (never the garland itself).
forma: "recta" (straight), "curva" (one gentle curve), "ondulada" (rises and falls along its length), "u_invertida" (frames something from above with both sides dropping) or "arco_caido" (hangs between anchor points and dips at the center). puntos_de_anclaje: how many points it hangs or is fixed from, 2 to 6, only when you can see them.
Measure the garland's center line against the straight line joining its two ends, in fractions of the horizontal distance between the ends, never in meters. caida_relativa (0 to {MAX_CAIDA_RELATIVA}): how far, at most, the center line hangs below that straight line, measured straight down; for an inverted U, how far its sides drop from its top; 0 when it follows that line or bows above it. desnivel_relativo (-{MAX_DESNIVEL_RELATIVO} to {MAX_DESNIVEL_RELATIVO}): the height of the right end minus the height of the left end; negative when the right end is lower (the garland falls toward the right), 0 when both ends are level. Example: a garland 2 m wide whose right end is 30 cm lower than its left end has desnivel_relativo -0.15. Omit either one when you cannot tell.
racimos_visibles: the clusters you can see from one end to the other. unidad_racimo: the balloons of one cluster, "trio" (3), "cuarteto" (4) or "quinteto" (5); omit it when you cannot tell. colores_por_racimo: the colors of a typical cluster in position order (at most {MAX_COLORES_RACIMO}).
relleno: the small balloons tucked between the clusters, with their main color and the share of the garland's balloons they make up (0 to {MAX_PROPORCION_RELLENO}); omit it when there are none.
remates: balloons clearly bigger than the cluster balloons, or foil or bubble balloons, placed on the garland: clase "latex", "metalizado" or "burbuja", their color, and posicion "extremo_izq" (at the left end), "extremo_der" (at the right end), "centro" (at the center) or "cada_n" (repeated along the garland). At most {MAX_REMATES}; empty when there are none.

Colors: use ONLY these catalog color names, spelled exactly as written: {", ".join(paleta)}. Map what you see to the closest of these names (light pink is rosado, chrome or metallic gold is dorado, clear is transparente). Never write any other color name.

confianza: a number from 0 to 1 for how sure you are of how the garland is built. Below 0.5 means a decorator would not rely on it.

Return exactly one entry per listed element_id and never an element that is not listed."""


def esquema_respuesta(paleta: Sequence[str]) -> dict[str, object]:
    """Salida estructurada de la lectura. Sin ``maxItems``: gemini-3.6-flash lo
    rechaza (ver ``patron_referencia.py``); los topes los aplica ``validar_lecturas``."""
    color = {"type": "string", "enum": list(paleta)}
    return {
        "type": "object",
        "properties": {
            "lecturas": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "element_id": {"type": "string"},
                        "soporte": {"type": "string", "enum": list(SOPORTES)},
                        "anfitriona_element_id": {"type": "string"},
                        "forma": {"type": "string", "enum": list(FORMAS)},
                        "puntos_de_anclaje": {"type": "integer", "minimum": 2, "maximum": 6},
                        # Opcionales: sin ellas el modelo las omite y la lectura lleva null.
                        "caida_relativa": {
                            "type": "number",
                            "minimum": 0,
                            "maximum": MAX_CAIDA_RELATIVA,
                        },
                        "desnivel_relativo": {
                            "type": "number",
                            "minimum": -MAX_DESNIVEL_RELATIVO,
                            "maximum": MAX_DESNIVEL_RELATIVO,
                        },
                        "racimos_visibles": {"type": "integer", "minimum": 0},
                        "unidad_racimo": {"type": "string", "enum": list(UNIDADES)},
                        "colores_por_racimo": {"type": "array", "items": color},
                        # Opcional en vez de nulo: sin relleno, el modelo lo omite.
                        "relleno": {
                            "type": "object",
                            "properties": {
                                "color": color,
                                "proporcion": {"type": "number", "minimum": 0, "maximum": 1},
                            },
                            "required": ["color", "proporcion"],
                        },
                        "remates": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "clase": {"type": "string", "enum": list(CLASES_REMATE)},
                                    "color": color,
                                    "posicion": {"type": "string", "enum": list(POSICIONES_REMATE)},
                                },
                                "required": ["clase", "posicion"],
                            },
                        },
                        "confianza": {"type": "number", "minimum": 0, "maximum": 1},
                    },
                    "required": [
                        "element_id",
                        "soporte",
                        "forma",
                        "racimos_visibles",
                        "colores_por_racimo",
                        "remates",
                        "confianza",
                    ],
                },
            },
        },
        "required": ["lecturas"],
    }


def mensaje(
    elementos: Sequence[Mapping[str, object]], otras: Sequence[Mapping[str, object]] = ()
) -> str:
    """Las guirnaldas a leer y las otras piezas de la foto que podrían sostener una."""
    texto = (
        "Read how each of these balloon garlands is built.\n"
        f"<ELEMENTS>{json.dumps(list(elementos), ensure_ascii=False)}</ELEMENTS>"
    )
    if otras:
        texto += f"\n<OTHER_PIECES>{json.dumps(list(otras), ensure_ascii=False)}</OTHER_PIECES>"
    return texto


def _texto(valor: object) -> str | None:
    """Texto sin tildes, sin espacios a los lados y en minúsculas; ``None`` si no es texto."""
    if not isinstance(valor, str):
        return None
    sin_tildes = unicodedata.normalize("NFD", valor)
    return "".join(c for c in sin_tildes if unicodedata.category(c) != "Mn").strip().lower()


def _numero(valor: object) -> float | None:
    if isinstance(valor, bool) or not isinstance(valor, (int, float)):
        return None
    return float(valor) if math.isfinite(valor) else None


def _relativo(valor: object, minimo: float, maximo: float) -> float | None:
    """Una medida relativa al largo, a milésimas; ``None`` fuera de rango (no se recorta)."""
    numero = _numero(valor)
    if numero is None or not minimo <= numero <= maximo:
        return None
    return round(numero, 3) + 0.0


def _entero(valor: object, minimo: int, maximo: int) -> int | None:
    numero = _numero(valor)
    if numero is None:
        return None
    entero = int(round(numero))
    return entero if minimo <= entero <= maximo else None


def _lectura(
    item: object, pendientes: set[str], otras: set[str], color_de: Mapping[str, str]
) -> dict[str, object] | None:
    if not isinstance(item, Mapping):
        return None
    element_id = item.get("element_id")
    if not isinstance(element_id, str) or element_id.strip() not in pendientes:
        return None
    soporte = _texto(item.get("soporte"))
    forma = _texto(item.get("forma"))
    confianza = _numero(item.get("confianza"))
    if soporte not in SOPORTES or forma not in FORMAS or confianza is None:
        return None
    element_id = element_id.strip()
    pendientes.discard(element_id)

    colores_crudos = item.get("colores_por_racimo")
    colores = [
        color_de[c]
        for c in (_texto(x) for x in (colores_crudos if isinstance(colores_crudos, list) else []))
        if c is not None and c in color_de
    ][:MAX_COLORES_RACIMO]
    lectura: dict[str, object] = {
        "element_id": element_id,
        "soporte": soporte,
        "forma": forma,
        # Los racimos que se ven no se recortan: fuera de rango no se inventa un número.
        "racimos_visibles": _entero(item.get("racimos_visibles"), 0, MAX_RACIMOS) or 0,
        # Fuera de rango no se recorta: una caída o un desnivel absurdos no se inventan.
        "caida_relativa": _relativo(item.get("caida_relativa"), 0.0, MAX_CAIDA_RELATIVA),
        "desnivel_relativo": _relativo(
            item.get("desnivel_relativo"), -MAX_DESNIVEL_RELATIVO, MAX_DESNIVEL_RELATIVO
        ),
        "colores_por_racimo": colores,
        "relleno": None,
        "remates": [],
        "confianza": min(1.0, max(0.0, confianza)),
    }
    anfitriona = item.get("anfitriona_element_id")
    if (
        soporte == "sobre_estructura"
        and isinstance(anfitriona, str)
        and anfitriona.strip() in otras
        and anfitriona.strip() != element_id
    ):
        lectura["anfitriona_element_id"] = anfitriona.strip()
    puntos = _entero(item.get("puntos_de_anclaje"), 2, 6)
    if puntos is not None:
        lectura["puntos_de_anclaje"] = puntos
    unidad = _texto(item.get("unidad_racimo"))
    if unidad in UNIDADES:
        lectura["unidad_racimo"] = unidad
    relleno = item.get("relleno")
    if isinstance(relleno, Mapping):
        color = _texto(relleno.get("color"))
        proporcion = _numero(relleno.get("proporcion"))
        if color is not None and color in color_de and proporcion is not None and proporcion > 0:
            lectura["relleno"] = {
                "color": color_de[color],
                "proporcion": round(min(MAX_PROPORCION_RELLENO, proporcion), 3),
            }
    remates: list[dict[str, object]] = []
    crudos = item.get("remates")
    for remate in crudos if isinstance(crudos, list) else []:
        if not isinstance(remate, Mapping):
            continue
        clase = _texto(remate.get("clase"))
        posicion = _texto(remate.get("posicion"))
        if clase not in CLASES_REMATE or posicion not in POSICIONES_REMATE:
            continue
        leido: dict[str, object] = {"clase": clase, "posicion": posicion}
        color = _texto(remate.get("color"))
        if color is not None and color in color_de:
            leido["color"] = color_de[color]
        remates.append(leido)
    lectura["remates"] = remates[:MAX_REMATES]
    return lectura


def validar_lecturas(
    raw: object,
    element_ids: Sequence[str],
    paleta: Sequence[str],
    otras_ids: Sequence[str] = (),
) -> list[dict[str, object]] | None:
    """Valida la salida del proveedor contra lo que se pidió.

    ``None`` si falta la forma de nivel superior (no hay respuesta que leer).
    Cada lectura se valida por separado: un elemento que no se pidió, repetido,
    o con soporte, forma o confianza desconocidos se descarta; una caída o un
    desnivel que falta, no es un número o sale de su rango queda en ``null``
    (no se recorta); los colores fuera de la paleta se quitan, un relleno sin color de la paleta o sin
    proporción queda en ``null``, un remate con clase o posición desconocidas se
    quita, y la anfitriona solo queda si es otra pieza de la misma foto: de
    ``otras`` o, como un arco que también se lee, de los elementos pedidos,
    nunca la propia guirnalda (revisión 6/13). El
    contrato exportado lo comprueba después quien llama.
    """
    if not isinstance(raw, Mapping) or not isinstance(raw.get("lecturas"), list):
        return None
    pendientes = set(element_ids)
    color_de = {cast(str, _texto(color)): color for color in paleta}
    lecturas: list[dict[str, object]] = []
    for item in cast(list[object], raw["lecturas"]):
        # Un arco o semiarco viaja en los elementos (se lee como guirnalda posible)
        # y también puede sostener una guirnalda (revisión 6/13).
        lectura = _lectura(item, pendientes, set(otras_ids) | set(element_ids), color_de)
        if lectura is not None:
            lecturas.append(lectura)
    return lecturas
