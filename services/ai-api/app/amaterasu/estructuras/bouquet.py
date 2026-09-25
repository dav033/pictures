"""Bouquet de globos: qué lee Amaterasu de un bouquet en la foto (ADR-0030).

En el plan un bouquet es un ``kit`` con la estructura oficial ``bouquet``; aquí
se describe cómo está armado: la variante (con base de aire, o de helio
apilado o escalonado), los niveles de látex de abajo hacia arriba en unidades
Sempertex, el remate y los globos número. La lectura no decide nada comercial:
al confirmar el plan viaja como ``pistas_armado`` y ``app/armado_bouquet.py``
decide si la usa, siempre sin cambiar lo que se compra.

Criterios de detección (fuentes en ADR-0030):

- Bouquet frente a centro de mesa: por tamaño y carga de globos, no por dónde
  está (regla v16 del reconocedor). Esta lectura solo recibe lo que el análisis
  ya llamó bouquet; si la pieza no lo es, la confianza debe ser 0.
- Con base de aire: racimos apilados sobre una base o soporte, con el remate o
  los números fijos con varilla. No flota.
- Helio apilado: capas de globos a la misma altura (suelen ser tres por capa,
  la segunda anidada sobre la primera), con un metalizado o una burbuja
  arriba (técnica publicada por Qualatex).
- Helio escalonado: globos con cintas de largos distintos alrededor de una
  pieza central más grande (formato de bouquet de Anagram).
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
from collections.abc import Mapping, Sequence
from typing import cast

from app.amaterasu.estructuras.base import DefinicionEstructura
from app.armado_bouquet import GLOBOS_POR_UNIDAD

DEFINICION = DefinicionEstructura(clave="bouquet", inicio_de_pieza=None)

VARIANTES = ("base_aire", "helio_apilado", "helio_escalonado")
UNIDADES = tuple(GLOBOS_POR_UNIDAD)
CLASES_REMATE = ("metalizado", "burbuja", "latex")
CLASES_TAMANO_NUMERO = ("chico", "grande")
DISPOSICIONES = ("centro", "lados", "arriba", "abajo")
MAX_NIVELES = 8
MAX_NUMEROS = 3


def instruccion_sistema(paleta: Sequence[str]) -> str:
    """El prompt de la lectura del armado, con la paleta de colores del catálogo."""
    return f"""You are an expert balloon decorator trained in the Sempertex method. You read how each balloon bouquet in a customer's reference photo is ASSEMBLED, the way a decorator would rebuild it level by level. You do not price anything or judge quality.

For each element listed in the message (element_id and, when given, its bounding box as fractions of the image with the origin at the top-left corner), look only at that piece. If the piece is not a balloon bouquet (for example a table centerpiece, a column or a garland), return confianza 0.

variante:
- "base_aire": air-filled balloons stacked on a base or stand (clusters sitting on each other), usually with a foil, number or bubble balloon fixed on top with a stick. It does not float.
- "helio_apilado": helium balloons tied at the same height in tight layers (usually three per layer, the next layer nested on the one below), with a foil or bubble balloon nested on top; all ribbons go to one weight.
- "helio_escalonado": helium balloons on ribbons of different lengths, at different heights around one larger central balloon (a big foil shape or number); all ribbons go to one weight.

niveles: the latex levels from the bottom up (for a helium bouquet, from the lowest layer). unidad is the balloon unit of that level: "suelto" (single balloons), "pareja" (2 tied together), "trio" (3), "cuarteto" (4), "quinteto" (5) or "sexteto" (6). colores = the color of each balloon of ONE unit in position order (a quartet of white, pink, white, pink is blanco, rosado, blanco, rosado); for "suelto", the colors of those single balloons. At most {MAX_NIVELES} levels.

remate: the balloon on top or at the center that is not part of a latex level: clase "metalizado" (a foil shape such as a heart or a star), "burbuja" (a clear bubble balloon, possibly with confetti or small balloons inside) or "latex" (one large latex balloon), and its color.

numeros: foil number balloons in the piece, in reading order: digito (0 to 9) and clase_tamano "chico" (about the size of a regular balloon, usually on a stick) or "grande" (much taller than the other balloons). Omit when there are none.
disposicion: where the numbers are: "centro" (in the middle of the bouquet), "arriba" (on top, as the topper), "abajo" (standing at the bottom, at the base or on the floor, with the balloons above them) or "lados" (one number on each side, each with its own group of balloons). Omit when there are no numbers.

Colors: use ONLY these catalog color names, spelled exactly as written: {", ".join(paleta)}. Map what you see to the closest of these names (light pink is rosado, chrome or metallic gold is dorado, clear is transparente). Never write any other color name.

confianza: a number from 0 to 1 for how sure you are of the assembly. Below 0.5 means a decorator would not rely on it.

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
                        "variante": {"type": "string", "enum": list(VARIANTES)},
                        "niveles": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "unidad": {"type": "string", "enum": list(UNIDADES)},
                                    "colores": {"type": "array", "items": color},
                                },
                                "required": ["unidad", "colores"],
                            },
                        },
                        "remate": {
                            "type": "object",
                            "properties": {
                                "clase": {"type": "string", "enum": list(CLASES_REMATE)},
                                "color": color,
                            },
                            "required": ["clase"],
                        },
                        "numeros": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "digito": {
                                        "type": "string",
                                        "enum": [str(d) for d in range(10)],
                                    },
                                    "clase_tamano": {
                                        "type": "string",
                                        "enum": list(CLASES_TAMANO_NUMERO),
                                    },
                                },
                                "required": ["digito", "clase_tamano"],
                            },
                        },
                        "disposicion": {"type": "string", "enum": list(DISPOSICIONES)},
                        "confianza": {"type": "number", "minimum": 0, "maximum": 1},
                    },
                    "required": ["element_id", "variante", "niveles", "confianza"],
                },
            },
        },
        "required": ["lecturas"],
    }


def mensaje(elementos: Sequence[Mapping[str, object]]) -> str:
    return (
        "Read how each of these balloon bouquets is assembled.\n"
        f"<ELEMENTS>{json.dumps(list(elementos), ensure_ascii=False)}</ELEMENTS>"
    )


def _texto(valor: object) -> str | None:
    """Texto sin tildes, sin espacios a los lados y en minúsculas; ``None`` si no es texto."""
    if not isinstance(valor, str):
        return None
    sin_tildes = unicodedata.normalize("NFD", valor)
    return "".join(c for c in sin_tildes if unicodedata.category(c) != "Mn").strip().lower()


def _lectura(
    item: object, pendientes: set[str], color_de: Mapping[str, str]
) -> dict[str, object] | None:
    if not isinstance(item, Mapping):
        return None
    element_id = item.get("element_id")
    if not isinstance(element_id, str) or element_id.strip() not in pendientes:
        return None
    variante = _texto(item.get("variante"))
    confianza = item.get("confianza")
    if variante not in VARIANTES or isinstance(confianza, bool):
        return None
    if not isinstance(confianza, (int, float)) or not math.isfinite(confianza):
        return None
    element_id = element_id.strip()
    pendientes.discard(element_id)

    niveles: list[dict[str, object]] = []
    crudos = item.get("niveles")
    for nivel in crudos if isinstance(crudos, list) else []:
        if not isinstance(nivel, Mapping) or _texto(nivel.get("unidad")) not in UNIDADES:
            continue
        unidad = cast(str, _texto(nivel.get("unidad")))
        colores_crudos = nivel.get("colores")
        colores = [
            color_de[c]
            for c in (
                _texto(x) for x in (colores_crudos if isinstance(colores_crudos, list) else [])
            )
            if c is not None and c in color_de
        ]
        tope = 6 if unidad == "suelto" else GLOBOS_POR_UNIDAD[unidad]
        if colores:
            niveles.append({"unidad": unidad, "colores": colores[:tope]})
    lectura: dict[str, object] = {
        "element_id": element_id,
        "variante": variante,
        "niveles": niveles[:MAX_NIVELES],
        "confianza": min(1.0, max(0.0, float(confianza))),
    }
    remate = item.get("remate")
    if isinstance(remate, Mapping) and _texto(remate.get("clase")) in CLASES_REMATE:
        leido: dict[str, object] = {"clase": _texto(remate.get("clase"))}
        color = _texto(remate.get("color"))
        if color is not None and color in color_de:
            leido["color"] = color_de[color]
        lectura["remate"] = leido
    numeros_crudos = item.get("numeros")
    numeros = [
        {"digito": numero["digito"], "clase_tamano": _texto(numero.get("clase_tamano"))}
        for numero in (numeros_crudos if isinstance(numeros_crudos, list) else [])
        if isinstance(numero, Mapping)
        and isinstance(numero.get("digito"), str)
        and re.fullmatch(r"\d", cast(str, numero["digito"]))
        and _texto(numero.get("clase_tamano")) in CLASES_TAMANO_NUMERO
    ][:MAX_NUMEROS]
    if numeros:
        lectura["numeros"] = numeros
        disposicion = _texto(item.get("disposicion"))
        if disposicion in DISPOSICIONES:
            lectura["disposicion"] = disposicion
    return lectura


def validar_lecturas(
    raw: object, element_ids: Sequence[str], paleta: Sequence[str]
) -> list[dict[str, object]] | None:
    """Valida la salida del proveedor contra lo que se pidió.

    ``None`` si falta la forma de nivel superior (no hay respuesta que leer).
    Cada lectura se valida por separado: un elemento que no se pidió, repetido o
    con variante desconocida se descarta; los colores fuera de la paleta se
    quitan (un nivel sin colores se quita) y los números se acotan a su rango.
    """
    if not isinstance(raw, Mapping) or not isinstance(raw.get("lecturas"), list):
        return None
    pendientes = set(element_ids)
    color_de = {cast(str, _texto(color)): color for color in paleta}
    lecturas: list[dict[str, object]] = []
    for item in cast(list[object], raw["lecturas"]):
        lectura = _lectura(item, pendientes, color_de)
        if lectura is not None:
            lecturas.append(lectura)
    return lecturas
