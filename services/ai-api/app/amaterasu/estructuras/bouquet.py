"""Bouquet de globos: qué lee Amaterasu de un bouquet en la foto (ADR-0030).

En el plan un bouquet es un ``kit`` con la estructura oficial ``bouquet``; aquí
se describe cómo está armado: la variante (con base de aire, o de helio
apilado o escalonado), los niveles de látex de abajo hacia arriba en unidades
Sempertex (cuántas unidades iguales forman cada nivel y de qué clase de tamaño
son sus globos), el remate y los globos número. La lectura no decide nada
comercial: al confirmar el plan viaja como ``pistas_armado`` y
``app/armado_bouquet.py`` decide si la usa. La cuenta de globos de la lectura
(``total_globos``) también es de ese módulo (``total_leido``): aquí solo se
publica.

Nada se descarta en silencio: lo que la validación recorta o quita de una
lectura queda en sus ``avisos``, y lo que descarta entera (un elemento que no se
pidió, repetido o con variante desconocida) sale en ``descartes`` para el log
con correlación de ``bouquet_referencia.py``.

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
from dataclasses import dataclass, field
from typing import cast

from app.amaterasu.estructuras.base import DefinicionEstructura
from app.armado_bouquet import (
    CLASES_TAMANO_NIVEL,
    GLOBOS_POR_UNIDAD,
    MAX_CANTIDAD_NIVEL,
    MAX_SUELTOS_LEIDOS,
    total_leido,
)

DEFINICION = DefinicionEstructura(
    clave="bouquet",
    inicio_de_pieza=None,
    como_contar=(
        "balloons tied to one weight or stacked on one base. Count every balloon one by "
        "one: latex, foil shapes, number balloons and bubble balloons alike"
    ),
)

VARIANTES = ("base_aire", "helio_apilado", "helio_escalonado")
UNIDADES = tuple(GLOBOS_POR_UNIDAD)
CLASES_REMATE = ("metalizado", "burbuja", "latex")
CLASES_TAMANO_NUMERO = ("chico", "grande")
CLASES_TAMANO = tuple(CLASES_TAMANO_NIVEL)
DISPOSICIONES = ("centro", "lados", "arriba", "abajo")
MAX_NIVELES = 8
MAX_NUMEROS = 3
#: Avisos por lectura (``LecturaArmadoSchema.avisos``).
MAX_AVISOS = 12


def instruccion_sistema(paleta: Sequence[str]) -> str:
    """El prompt de la lectura del armado, con la paleta de colores del catálogo."""
    return f"""You are an expert balloon decorator trained in the Sempertex method. You read how each balloon bouquet in a customer's reference photo is ASSEMBLED, the way a decorator would rebuild it level by level. You do not price anything or judge quality.

For each element listed in the message (element_id and, when given, its bounding box as fractions of the image with the origin at the top-left corner), look only at that piece. Any compact standalone balloon arrangement counts as a bouquet here, including a small gift-style piece with a few balloons and foil numbers and anything another pass may have called a table centerpiece: read how it is assembled. Only a piece that is clearly not an arrangement of that kind (a column, an arch, a garland, a balloon wall, a ceiling installation) gets confianza 0.

variante:
- "base_aire": air-filled balloons stacked on a base or stand (clusters sitting on each other), usually with a foil, number or bubble balloon fixed on top with a stick. It does not float.
- "helio_apilado": helium balloons tied at the same height in tight layers (usually three per layer, the next layer nested on the one below), with a foil or bubble balloon nested on top; all ribbons go to one weight.
- "helio_escalonado": helium balloons on ribbons of different lengths, at different heights around one larger central balloon (a big foil shape or number); all ribbons go to one weight.

niveles: the latex levels from the bottom up (for a helium bouquet, from the lowest layer). unidad is the balloon unit of that level: "suelto" (single balloons), "pareja" (2 tied together), "trio" (3), "cuarteto" (4), "quinteto" (5) or "sexteto" (6). colores = the color of each balloon of ONE unit in position order (a quartet of white, pink, white, pink is blanco, rosado, blanco, rosado); for "suelto", the colors of one group of single balloons that repeats around the level (at most {MAX_SUELTOS_LEIDOS}). cantidad = how many identical units form that level all around the piece, counting the units hidden behind it by symmetry (a ring of four quartets is "cuarteto" with cantidad 4; for "suelto", how many times the group repeats), from 1 to {MAX_CANTIDAD_NIVEL}. clase_tamano = the size of the balloons of that level: "chico" (5 to 9 inches, clearly smaller than a regular balloon), "mediano" (11 to 12 inches, a regular balloon), "grande" (16 to 18 inches) or "gigante" (24 to 36 inches); omit it when you cannot tell. When a level mixes balloon sizes, write one level per size. At most {MAX_NIVELES} levels. When the numbers are on the sides (disposicion "lados"), the two groups are identical: describe ONE of them. niveles, cantidad and remate are those of a single group, not of both together.

remate: the balloon on top or at the center that is not part of a latex level: clase "metalizado" (a foil shape such as a heart or a star), "burbuja" (a clear bubble balloon, possibly with confetti or small balloons inside) or "latex" (one large latex balloon), and its color.

numeros: foil number balloons in the piece, in reading order: digito (0 to 9) and clase_tamano "chico" (about the size of a regular balloon, usually on a stick) or "grande" (much taller than the other balloons). Omit when there are none.
disposicion: where the numbers are: "centro" (in the middle of the bouquet), "arriba" (on top, as the topper), "abajo" (standing at the bottom, at the base or on the floor, with the balloons above them) or "lados" (one number on each side, each with its own identical group of balloons; niveles and remate describe one group). Omit when there are no numbers.

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
                                    "cantidad": {
                                        "type": "integer",
                                        "minimum": 1,
                                        "maximum": MAX_CANTIDAD_NIVEL,
                                    },
                                    "clase_tamano": {
                                        "type": "string",
                                        "enum": list(CLASES_TAMANO),
                                    },
                                },
                                "required": ["unidad", "colores", "cantidad"],
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


def _plural(n: int, singular: str, plural: str) -> str:
    return f"{n} {singular if n == 1 else plural}"


def _cantidad(valor: object, posicion: int, avisos: list[str]) -> int:
    """Unidades del nivel, de 1 a 24; lo que no se puede leer vale 1, con aviso."""
    if valor is None:
        avisos.append(f"nivel {posicion}: sin cantidad; vale 1")
        return 1
    if (
        isinstance(valor, bool)
        or not isinstance(valor, (int, float))
        or not math.isfinite(valor)
        or valor != int(valor)
    ):
        avisos.append(f"nivel {posicion}: cantidad no entera; vale 1")
        return 1
    cantidad = int(valor)
    acotada: int = min(MAX_CANTIDAD_NIVEL, max(1, cantidad))
    if acotada != cantidad:
        avisos.append(
            f"nivel {posicion}: cantidad {cantidad} fuera de 1-{MAX_CANTIDAD_NIVEL}; "
            f"quedó en {acotada}"
        )
    return acotada


def _nivel(
    nivel: object, posicion: int, color_de: Mapping[str, str], avisos: list[str]
) -> dict[str, object] | None:
    """Un nivel validado, o ``None`` (con aviso) si no se puede usar."""
    if not isinstance(nivel, Mapping):
        avisos.append(f"nivel {posicion}: no es un nivel; se descartó")
        return None
    unidad = _texto(nivel.get("unidad"))
    if unidad not in UNIDADES:
        avisos.append(f"nivel {posicion}: unidad desconocida; se descartó")
        return None
    crudos = nivel.get("colores")
    leidos = [_texto(x) for x in (crudos if isinstance(crudos, list) else [])]
    colores = [color_de[c] for c in leidos if c is not None and c in color_de]
    fuera = len(leidos) - len(colores)
    if fuera:
        avisos.append(
            f"nivel {posicion}: {_plural(fuera, 'color', 'colores')} fuera de la paleta; "
            "se descartaron"
        )
    tope = MAX_SUELTOS_LEIDOS if unidad == "suelto" else GLOBOS_POR_UNIDAD[unidad]
    if len(colores) > tope:
        avisos.append(
            f"nivel {posicion}: {len(colores)} colores para {unidad}; se conservaron {tope}"
        )
        colores = colores[:tope]
    if not colores:
        avisos.append(f"nivel {posicion}: sin colores de la paleta; se descartó")
        return None
    if unidad != "suelto" and len(colores) < tope:
        avisos.append(f"nivel {posicion}: {unidad} con {len(colores)} de {tope} colores")
    leido: dict[str, object] = {
        "unidad": unidad,
        "colores": colores,
        "cantidad": _cantidad(nivel.get("cantidad"), posicion, avisos),
    }
    clase = nivel.get("clase_tamano")
    if clase is not None:
        if _texto(clase) in CLASES_TAMANO:
            leido["clase_tamano"] = _texto(clase)
        else:
            avisos.append(f"nivel {posicion}: clase de tamaño desconocida; se omitió")
    return leido


def _numeros(crudos: object, avisos: list[str]) -> list[dict[str, object]]:
    if crudos is None:
        return []
    if not isinstance(crudos, list):
        avisos.append("números: no es una lista; se descartaron")
        return []
    numeros = [
        {"digito": numero["digito"], "clase_tamano": _texto(numero.get("clase_tamano"))}
        for numero in crudos
        if isinstance(numero, Mapping)
        and isinstance(numero.get("digito"), str)
        and re.fullmatch(r"\d", cast(str, numero["digito"]))
        and _texto(numero.get("clase_tamano")) in CLASES_TAMANO_NUMERO
    ]
    invalidos = len(crudos) - len(numeros)
    if invalidos:
        avisos.append(
            f"números: {_plural(invalidos, 'globo', 'globos')} con dígito o tamaño inválido; "
            "se descartaron"
        )
    if len(numeros) > MAX_NUMEROS:
        avisos.append(f"números: se leyeron {len(numeros)}; se conservaron {MAX_NUMEROS}")
    return numeros[:MAX_NUMEROS]


def _acotar_avisos(avisos: list[str]) -> list[str]:
    unicos = list(dict.fromkeys(avisos))
    if len(unicos) <= MAX_AVISOS:
        return unicos
    return [*unicos[: MAX_AVISOS - 1], f"y {len(unicos) - MAX_AVISOS + 1} avisos más"]


def _lectura(
    item: Mapping[str, object], element_id: str, color_de: Mapping[str, str]
) -> dict[str, object]:
    """La lectura de un elemento ya aceptado (id pedido, variante y confianza válidas)."""
    avisos: list[str] = []
    confianza = float(cast(float, item["confianza"]))
    acotada = min(1.0, max(0.0, confianza))
    if acotada != confianza:
        avisos.append(f"confianza {confianza:g} fuera de 0-1; quedó en {acotada:g}")

    crudos = item.get("niveles")
    if crudos is not None and not isinstance(crudos, list):
        avisos.append("niveles: no es una lista; se descartaron")
    niveles = [
        nivel
        for nivel in (
            _nivel(crudo, posicion, color_de, avisos)
            for posicion, crudo in enumerate(crudos if isinstance(crudos, list) else [], start=1)
        )
        if nivel is not None
    ]
    if len(niveles) > MAX_NIVELES:
        avisos.append(
            f"se leyeron {len(niveles)} niveles; se conservaron los primeros {MAX_NIVELES}"
        )
    lectura: dict[str, object] = {
        "element_id": element_id,
        "variante": _texto(item.get("variante")),
        "niveles": niveles[:MAX_NIVELES],
        "confianza": acotada,
    }
    remate = item.get("remate")
    if isinstance(remate, Mapping) and _texto(remate.get("clase")) in CLASES_REMATE:
        leido: dict[str, object] = {"clase": _texto(remate.get("clase"))}
        color = _texto(remate.get("color"))
        if color is not None and color in color_de:
            leido["color"] = color_de[color]
        elif remate.get("color") is not None:
            avisos.append("remate: color fuera de la paleta; se omitió el color")
        lectura["remate"] = leido
    elif remate is not None:
        avisos.append("remate: clase desconocida; se descartó")
    numeros = _numeros(item.get("numeros"), avisos)
    disposicion = item.get("disposicion")
    if numeros:
        lectura["numeros"] = numeros
        if _texto(disposicion) in DISPOSICIONES:
            lectura["disposicion"] = _texto(disposicion)
        elif disposicion is not None:
            avisos.append("disposición desconocida; se omitió")
    elif disposicion is not None:
        avisos.append("disposición sin números; se omitió")
    lectura["total_globos"] = total_leido(lectura)
    if avisos:
        lectura["avisos"] = _acotar_avisos(avisos)
    return lectura


@dataclass(frozen=True)
class LecturasValidadas:
    """Las lecturas válidas y lo que se descartó entero (para el log con correlación)."""

    lecturas: list[dict[str, object]]
    descartes: list[str] = field(default_factory=list)


def _id_corto(valor: object) -> str:
    return valor.strip()[:80] if isinstance(valor, str) else "sin element_id"


def validar_lecturas_con_descartes(
    raw: object, element_ids: Sequence[str], paleta: Sequence[str]
) -> LecturasValidadas | None:
    """Valida la salida del proveedor contra lo que se pidió.

    ``None`` si falta la forma de nivel superior (no hay respuesta que leer).
    Cada lectura se valida por separado: un elemento que no se pidió, repetido o
    con variante o confianza inválidas se descarta y queda en ``descartes``; lo
    que se corrige dentro de una lectura (colores fuera de la paleta, niveles
    sin colores, topes de colores, niveles, cantidad y números) queda en sus
    ``avisos``. Cada lectura publica ``total_globos``, la cuenta de
    ``armado_bouquet.total_leido``.
    """
    if not isinstance(raw, Mapping) or not isinstance(raw.get("lecturas"), list):
        return None
    pedidos = set(element_ids)
    pendientes = set(element_ids)
    color_de = {cast(str, _texto(color)): color for color in paleta}
    lecturas: list[dict[str, object]] = []
    descartes: list[str] = []
    for item in cast(list[object], raw["lecturas"]):
        if not isinstance(item, Mapping):
            descartes.append("una entrada que no es un objeto")
            continue
        crudo = item.get("element_id")
        element_id = crudo.strip() if isinstance(crudo, str) else None
        if element_id is None or element_id not in pedidos:
            descartes.append(f"{_id_corto(crudo)}: no se pidió")
            continue
        if element_id not in pendientes:
            descartes.append(f"{element_id}: repetido")
            continue
        confianza = item.get("confianza")
        if _texto(item.get("variante")) not in VARIANTES:
            descartes.append(f"{element_id}: variante desconocida")
            continue
        if (
            isinstance(confianza, bool)
            or not isinstance(confianza, (int, float))
            or not math.isfinite(confianza)
        ):
            descartes.append(f"{element_id}: confianza inválida")
            continue
        pendientes.discard(element_id)
        lecturas.append(_lectura(item, element_id, color_de))
    descartes.extend(
        f"{element_id}: el proveedor no devolvió lectura"
        for element_id in element_ids
        if element_id in pendientes
    )
    return LecturasValidadas(lecturas, descartes)


def validar_lecturas(
    raw: object, element_ids: Sequence[str], paleta: Sequence[str]
) -> list[dict[str, object]] | None:
    """Las lecturas de ``validar_lecturas_con_descartes``, sin los descartes."""
    validadas = validar_lecturas_con_descartes(raw, element_ids, paleta)
    return validadas.lecturas if validadas is not None else None
