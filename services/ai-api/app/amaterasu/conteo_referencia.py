"""Conteo de globos de cada pieza de la foto de referencia (ADR-0031, entrega E1).

Next manda la foto y las estructuras de globos que el análisis de Amaterasu ya
encontró en ella; Python las cuenta en una sola llamada de visión y devuelve una
lectura por pieza: los globos que se ven, si esa cuenta es el total, un estimado
del total en piezas densas, los racimos, el reparto por tamaño y la escala
respecto de algo conocido de la foto. Cómo se cuenta cada tipo de pieza vive en
su submódulo del registro (``estructuras/<tipo>.py``, campo ``como_contar``).

Amaterasu describe; no decide la cantidad. Nada de esto es comercial y en E1 ningún
plan lo usa: Next guarda cada lectura en ``appearance.conteo`` del blueprint. Por
eso el prompt no sugiere globos por metro ni por densidad: esas cifras son de
``app/plan.py`` y darlas aquí crearía un segundo dueño (la lectura repetiría el
modelo del plan en lugar de medir la foto).

La forma de la lectura es del contrato ``reference-blueprint.v2``
(``appearance.conteo``, dueño Zod ``src/lib/plan/conteo-referencia.ts``): las
clases de tamaño, las referencias de escala y los topes se leen de ahí, y cada
lectura se comprueba contra ese esquema antes de salir. Lo que el esquema no
expresa (coherencia entre campos) lo decide ``validar_lecturas``.

Mismo proveedor, modelo y cliente que el turno del análisis; la llamada vive en
``vision_estructurada.py``.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import unicodedata
from collections.abc import Mapping, Sequence
from typing import Annotated, Callable, Literal, cast

from jsonschema import Draft7Validator
from pydantic import Field, StringConstraints, model_validator

from app.amaterasu.estructuras import definicion_de_pieza, reglas_de_conteo
from app.amaterasu.patron_referencia import CajaElemento, ImagenReferencia, TextoCorto
from app.amaterasu.vision_estructurada import DEFAULT_MODEL, LecturaFotoError, leer_foto
from app.armado_bouquet import CLASES_TAMANO_NIVEL
from app.generated_models import contract_schema
from app.operational_models import ContractModel, OperationalRequest

logger = logging.getLogger(__name__)

CONTEO_REFERENCIA_SCOPE = "ia.conteo_referencia"
CONTEO_REFERENCIA_SCHEMA_VERSION = "conteo-referencia.v1"
CONTEO_REFERENCIA_RESULT_VERSION = "conteo-referencia-result.v1"
MAX_ELEMENTOS = 12
MAX_PIEZAS = 999
# Doce lecturas con reparto por tamaño y escala caben de sobra; se paga lo que
# se genera, no el tope.
MAX_OUTPUT_TOKENS = 4_096
#: Una cuenta es exacta solo en piezas chicas: con más globos visibles, contar
#: uno a uno en una foto deja de ser confiable (ADR-0031).
MAX_GLOBOS_EXACTO = 40
#: Las proporciones por tamaño que devuelve el modelo se aceptan si suman 1 con
#: esta tolerancia y se normalizan; si no, el reparto se descarta.
TOLERANCIA_SUMA_POR_TAMANO = 0.1


def _contrato_lectura() -> dict[str, object]:
    """``appearance.conteo`` del contrato ``reference-blueprint.v2``."""
    esquema = contract_schema("ReferenceBlueprint")
    ruta = ("properties", "elements", "items", "properties", "appearance", "properties", "conteo")
    nodo: object = esquema
    for clave in ruta:
        nodo = cast(Mapping[str, object], nodo)[clave]
    return cast(dict[str, object], nodo)


def _rama(nodo: object) -> Mapping[str, object]:
    """La rama no nula de un campo ``T | null`` del contrato (o el campo tal cual)."""
    campo = cast(Mapping[str, object], nodo)
    ramas = campo.get("anyOf")
    if isinstance(ramas, list):
        return next(
            cast(Mapping[str, object], r)
            for r in ramas
            if cast(Mapping[str, object], r).get("type") != "null"
        )
    return campo


CONTRATO_LECTURA = _contrato_lectura()
_CAMPOS = cast(Mapping[str, object], CONTRATO_LECTURA["properties"])
_POR_TAMANO_ITEM = cast(
    Mapping[str, object], cast(Mapping[str, object], _CAMPOS["por_tamano"])["items"]
)
_ESCALA = _rama(_CAMPOS["largo_relativo"])
_ESCALA_CAMPOS = cast(Mapping[str, object], _ESCALA["properties"])

CLASES_TAMANO: tuple[str, ...] = tuple(
    cast(
        list[str],
        cast(
            Mapping[str, object],
            cast(Mapping[str, object], _POR_TAMANO_ITEM["properties"])["clase"],
        )["enum"],
    )
)
REFERENCIAS_ESCALA: tuple[str, ...] = tuple(
    cast(list[str], cast(Mapping[str, object], _ESCALA_CAMPOS["referencia"])["enum"])
)
MAX_GLOBOS = cast(int, cast(Mapping[str, object], _CAMPOS["globos_visibles"])["maximum"])
MAX_RACIMOS = cast(int, _rama(_CAMPOS["racimos"])["maximum"])
MAX_GLOBOS_POR_RACIMO = cast(int, _rama(_CAMPOS["globos_por_racimo"])["maximum"])
MAX_VECES = cast(float, cast(Mapping[str, object], _ESCALA_CAMPOS["veces"])["maximum"])
_VALIDADOR = Draft7Validator(CONTRATO_LECTURA)


class ConteoReferenciaError(LecturaFotoError):
    """Stable domain error translated by the HTTP boundary."""


TextoTipo = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]


class ElementoConteo(ContractModel):
    element_id: TextoCorto
    #: Tipo de estructura del plan (`visual_semantics.structure_type`) o "desconocido".
    tipo: TextoTipo
    #: Estructura oficial que el chat le daría (`identificarEstructuraOficial`), si hay.
    estructura_oficial: TextoTipo | None = None
    bbox: CajaElemento | None = None
    #: Piezas iguales que el elemento representa ("2 columnas"); se cuenta una.
    piezas: int = Field(default=1, ge=1, le=MAX_PIEZAS)


class ConteoReferenciaRequest(OperationalRequest):
    """Authenticated operation body: one reference photo and the balloon
    structures the reference analysis found in it (1..12)."""

    schema_version: Literal["conteo-referencia.v1"]
    imagen: ImagenReferencia
    elementos: list[ElementoConteo] = Field(min_length=1, max_length=MAX_ELEMENTOS)

    @model_validator(mode="after")
    def reject_duplicate_element_ids(self) -> "ConteoReferenciaRequest":
        ids = [elemento.element_id for elemento in self.elementos]
        if len(ids) != len(set(ids)):
            raise ValueError("element ids must be unique")
        return self


#: Los rangos de cada clase de tamaño, de la única escala del sistema
#: (``armado_bouquet.CLASES_TAMANO_NIVEL``, revisión 1/11).
_RANGO = {
    clase: f"{minimo:g} to {maximo:g} inch"
    for clase, (minimo, maximo) in CLASES_TAMANO_NIVEL.items()
}

SYSTEM_INSTRUCTION = f"""You are an expert balloon decorator trained in the Sempertex method. You COUNT the balloons of each balloon piece in a customer's reference photo, the way a decorator sizes up a piece before quoting it. You do not name colors, price anything or judge quality.

For each element listed in the message (element_id, its tipo and, when given, its bounding box as fractions of the image with the origin at the top-left corner), look only at that piece. When piezas is given, the element stands for that many identical pieces in the photo: count ONE of them, the most visible one.

globos_visibles: the balloons of the piece you can actually see and tell apart, counted one by one, foil and number balloons included. Never count balloons of another piece, loose balloons on the floor or balloons printed on a backdrop.
exacto: true only when the piece has at most {MAX_GLOBOS_EXACTO} visible balloons and none of its balloons is hidden (behind people, furniture, another piece, the piece's own front balloons or the edge of the photo), so that globos_visibles is its real total. Otherwise false.
racimos and globos_por_racimo: when the piece is built from repeated clusters (quartets of 4 are the most common), how many clusters the whole piece has, hidden ones included, and the balloons in each cluster. Omit both when there are no clear clusters.
estimado_total: when exacto is false, your estimate of ALL the balloons of the piece, hidden ones included: racimos times globos_por_racimo plus the loose balloons, or the balloons along one stretch times the stretches that make the whole piece. It is never less than globos_visibles. Omit it when exacto is true.
por_tamano: the share of the piece's balloons in each size class, as fractions that add up to 1, each class once: "chico" ({_RANGO["chico"]}, small balloons often used as fillers), "mediano" ({_RANGO["mediano"]}, the regular party balloon), "grande" ({_RANGO["grande"]}, clearly bigger than a regular balloon) and "gigante" ({_RANGO["gigante"]}, jumbo balloons). Judge sizes against the other balloons and the room. Leave it empty when you cannot tell.
largo_relativo and alto_relativo: only when a standing adult ("persona"), a door ("puerta") or a table ("mesa") is visible at about the same distance as the piece. referencia names it and veces is the piece's length (largo) or height (alto) divided by that reference's height. Omit them otherwise.

How to count each tipo:
{reglas_de_conteo()}
A tipo that is not listed: count every balloon one by one.

confianza: a number from 0 to 1 for how sure you are of the count. Below 0.5 means a decorator would not rely on it.

Return exactly one entry per listed element_id and never an element that is not listed."""

_ESCALA_RESPUESTA: dict[str, object] = {
    "type": "object",
    "properties": {
        "referencia": {"type": "string", "enum": list(REFERENCIAS_ESCALA)},
        "veces": {"type": "number", "minimum": 0},
    },
    "required": ["referencia", "veces"],
}

# Sin `maxItems` (gemini-3.6-flash lo rechaza, ver `patron_referencia.py`): los
# topes los aplica `validar_lecturas`. El SDK manda las propiedades en este
# orden (`property_ordering`) y el modelo las escribe así: primero lo que ve, luego
# los racimos y al final el estimado que sale de ellos.
RESPONSE_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {
        "lecturas": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "element_id": {"type": "string"},
                    "globos_visibles": {"type": "integer", "minimum": 0},
                    "exacto": {"type": "boolean"},
                    "racimos": {"type": "integer", "minimum": 1},
                    "globos_por_racimo": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": MAX_GLOBOS_POR_RACIMO,
                    },
                    "estimado_total": {"type": "integer", "minimum": 1},
                    "por_tamano": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "clase": {"type": "string", "enum": list(CLASES_TAMANO)},
                                "proporcion": {"type": "number", "minimum": 0, "maximum": 1},
                            },
                            "required": ["clase", "proporcion"],
                        },
                    },
                    "largo_relativo": _ESCALA_RESPUESTA,
                    "alto_relativo": _ESCALA_RESPUESTA,
                    "confianza": {"type": "number", "minimum": 0, "maximum": 1},
                },
                "required": [
                    "element_id",
                    "globos_visibles",
                    "exacto",
                    "por_tamano",
                    "confianza",
                ],
            },
        },
    },
    "required": ["lecturas"],
}

# Versión del prompt que viaja en el resultado y en los registros de Next. A
# diferencia de las otras lecturas, el esquema se serializa sin ordenar las
# claves: el orden de las propiedades cambia lo que el modelo escribe primero.
PROMPT_VERSION = (
    "conteo-referencia.v1:"
    + hashlib.sha256(
        (SYSTEM_INSTRUCTION + json.dumps(RESPONSE_SCHEMA)).encode("utf-8")
    ).hexdigest()[:16]
)


def mensaje(elementos: Sequence[ElementoConteo]) -> str:
    """El mensaje de la llamada: cada pieza con la clave del registro que la describe."""
    datos: list[dict[str, object]] = []
    for elemento in elementos:
        registrado = definicion_de_pieza(elemento.tipo, elemento.estructura_oficial)
        datos.append(
            {
                "element_id": elemento.element_id,
                "tipo": registrado.clave if registrado else elemento.tipo,
                **({"bbox": elemento.bbox.model_dump()} if elemento.bbox else {}),
                **({"piezas": elemento.piezas} if elemento.piezas > 1 else {}),
            }
        )
    return (
        "Count the balloons of each of these balloon pieces in the photo.\n"
        f"<ELEMENTS>{json.dumps(datos, ensure_ascii=False)}</ELEMENTS>"
    )


def _texto(valor: object) -> str | None:
    """Texto sin tildes, sin espacios a los lados y en minúsculas; ``None`` si no es texto."""
    if not isinstance(valor, str):
        return None
    sin_tildes = unicodedata.normalize("NFD", valor)
    return "".join(c for c in sin_tildes if unicodedata.category(c) != "Mn").strip().lower()


def _numero(valor: object) -> float | None:
    """Número finito del proveedor; ``None`` si no lo es (un booleano no es un número)."""
    if isinstance(valor, bool) or not isinstance(valor, (int, float)):
        return None
    return float(valor) if math.isfinite(valor) else None


def _entero(valor: object, minimo: int, maximo: int) -> int | None:
    """Entero dentro de su rango; fuera de él, ``None``: una cuenta no se recorta."""
    numero = _numero(valor)
    if numero is None:
        return None
    entero = int(round(numero))
    return entero if minimo <= entero <= maximo else None


def _por_tamano(valor: object) -> list[dict[str, object]]:
    """Reparto por tamaño normalizado a 1, en el orden de las clases; ``[]`` si es
    incoherente (clase repetida o desconocida, proporciones que no suman ~1)."""
    if not isinstance(valor, list):
        return []
    leidas: dict[str, float] = {}
    for item in valor:
        if not isinstance(item, Mapping):
            return []
        clase = _texto(item.get("clase"))
        proporcion = _numero(item.get("proporcion"))
        if clase is None or clase not in CLASES_TAMANO or clase in leidas or proporcion is None:
            return []
        if not 0 <= proporcion <= 1:
            return []
        if proporcion > 0:
            leidas[clase] = proporcion
    suma = sum(leidas.values())
    if not leidas or abs(suma - 1) > TOLERANCIA_SUMA_POR_TAMANO:
        return []
    normalizadas = (
        (clase, round(leidas[clase] / suma, 3)) for clase in CLASES_TAMANO if clase in leidas
    )
    return [{"clase": clase, "proporcion": p} for clase, p in normalizadas if p > 0]


def _escala(valor: object) -> dict[str, object] | None:
    if not isinstance(valor, Mapping):
        return None
    referencia = _texto(valor.get("referencia"))
    veces = _numero(valor.get("veces"))
    if referencia not in REFERENCIAS_ESCALA or veces is None:
        return None
    veces = round(veces, 2)
    if not 0 < veces <= MAX_VECES:
        return None
    return {"referencia": referencia, "veces": veces}


def _lectura(item: object, pendientes: set[str]) -> dict[str, object] | None:
    if not isinstance(item, Mapping):
        return None
    element_id = item.get("element_id")
    if not isinstance(element_id, str) or element_id.strip() not in pendientes:
        return None
    globos_visibles = _entero(item.get("globos_visibles"), 0, MAX_GLOBOS)
    confianza = _numero(item.get("confianza"))
    if globos_visibles is None or confianza is None:
        return None
    element_id = element_id.strip()
    pendientes.discard(element_id)

    # Exacta solo si el modelo lo dice y la pieza es chica: una cuenta de más de
    # MAX_GLOBOS_EXACTO nunca se toma como el total, diga lo que diga.
    exacto = item.get("exacto") is True and 1 <= globos_visibles <= MAX_GLOBOS_EXACTO
    estimado = None if exacto else _entero(item.get("estimado_total"), 1, MAX_GLOBOS)
    if estimado is not None and estimado < globos_visibles:
        # Un total menor que lo que se ve es incoherente: no se corrige, se descarta.
        estimado = None
    racimos = _entero(item.get("racimos"), 1, MAX_RACIMOS)
    por_racimo = _entero(item.get("globos_por_racimo"), 1, MAX_GLOBOS_POR_RACIMO)
    if racimos is not None and por_racimo is not None and racimos * por_racimo > MAX_GLOBOS:
        # Más globos que el tope del contrato: incoherente, se descarta (revisión 10).
        racimos = por_racimo = None
    return {
        "element_id": element_id,
        "globos_visibles": globos_visibles,
        "exacto": exacto,
        "estimado_total": estimado,
        "racimos": racimos,
        "globos_por_racimo": por_racimo,
        "por_tamano": _por_tamano(item.get("por_tamano")),
        "largo_relativo": _escala(item.get("largo_relativo")),
        "alto_relativo": _escala(item.get("alto_relativo")),
        "confianza": min(1.0, max(0.0, confianza)),
    }


def cumple_contrato(lectura: Mapping[str, object]) -> bool:
    """La lectura (sin ``element_id``) cabe en ``appearance.conteo`` del contrato."""
    return bool(_VALIDADOR.is_valid({k: v for k, v in lectura.items() if k != "element_id"}))


def validar_lecturas(raw: object, element_ids: Sequence[str]) -> list[dict[str, object]] | None:
    """Valida la salida del proveedor contra lo que se pidió.

    ``None`` si falta la forma de nivel superior (no hay respuesta que leer).
    Cada lectura se valida por separado: un elemento que no se pidió o repetido,
    o sin cuenta ni confianza, se descarta; un campo opcional fuera de rango o
    incoherente queda en ``null`` (o ``[]`` el reparto por tamaño), nunca se
    inventa ni se recorta. ``exacto`` exige a lo sumo ``MAX_GLOBOS_EXACTO``
    globos visibles, y con él no hay estimado. Lo que no cumpla el contrato
    exportado se descarta con un aviso en el registro.
    """
    if not isinstance(raw, Mapping) or not isinstance(raw.get("lecturas"), list):
        return None
    pendientes = set(element_ids)
    lecturas: list[dict[str, object]] = []
    for item in cast(list[object], raw["lecturas"]):
        lectura = _lectura(item, pendientes)
        if lectura is None:
            continue
        if not cumple_contrato(lectura):
            logger.warning(
                "conteo_referencia: lectura fuera de contrato descartada (element_id=%s)",
                lectura["element_id"],
            )
            continue
        lecturas.append(lectura)
    return lecturas


async def leer_conteos_referencia(
    payload: ConteoReferenciaRequest,
    client_factory: Callable[[str], object] | None = None,
) -> dict[str, object]:
    """Una llamada de visión con salida estructurada. Nunca reintenta: la
    lectura es opcional y Next sigue sin ella ante cualquier fallo."""
    raw, usage = await leer_foto(
        mime_type=payload.imagen.mime_type,
        data_base64=payload.imagen.data_base64,
        mensaje=mensaje(payload.elementos),
        system_instruction=SYSTEM_INSTRUCTION,
        response_schema=RESPONSE_SCHEMA,
        max_output_tokens=MAX_OUTPUT_TOKENS,
        prefijo="conteo_referencia",
        error=ConteoReferenciaError,
        client_factory=client_factory,
    )
    lecturas = validar_lecturas(raw, [elemento.element_id for elemento in payload.elementos])
    if lecturas is None:
        raise ConteoReferenciaError("conteo_referencia_invalid_output", 502)
    return {
        "operation_schema_version": CONTEO_REFERENCIA_RESULT_VERSION,
        "lecturas": lecturas,
        "modelo": DEFAULT_MODEL,
        "prompt_version": PROMPT_VERSION,
        "usage": usage,
    }


__all__ = [
    "CLASES_TAMANO",
    "CONTEO_REFERENCIA_RESULT_VERSION",
    "CONTEO_REFERENCIA_SCHEMA_VERSION",
    "CONTEO_REFERENCIA_SCOPE",
    "MAX_GLOBOS_EXACTO",
    "PROMPT_VERSION",
    "REFERENCIAS_ESCALA",
    "ConteoReferenciaError",
    "ConteoReferenciaRequest",
    "cumple_contrato",
    "leer_conteos_referencia",
    "mensaje",
    "validar_lecturas",
]
