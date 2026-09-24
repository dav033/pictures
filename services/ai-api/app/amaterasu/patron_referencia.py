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

import base64
import hashlib
import json
import math
import os
import unicodedata
from typing import Annotated, Callable, Literal, cast

from pydantic import Field, StringConstraints, model_validator

from app.amaterasu.turno import (
    DEFAULT_MODEL,
    _block_reason,
    _default_client,
    _finish_reason,
    _usage_dict,
)
from app.generated_models import contract_schema
from app.operational_models import ContractModel, OperationalRequest


PATRON_REFERENCIA_SCOPE = "ia.patron_referencia"
PATRON_REFERENCIA_SCHEMA_VERSION = "patron-referencia.v1"
PATRON_REFERENCIA_RESULT_VERSION = "patron-referencia-result.v1"
MAX_ELEMENTOS = 12
MAX_COLORES = 12
# Una sola foto: el techo real es el cuerpo de 11MB de la ruta (el mismo que el
# análisis de referencia); esto solo rechaza lo absurdo antes de decodificar.
MAX_IMAGE_BASE64_CHARS = 15_000_000
MAX_OUTPUT_TOKENS = 2_048

MODOS = ("espiral", "anillos", "bloques", "degradado", "aleatorio", "flor", "damero")
MODO_NINGUNO = "ninguno"

# Vocabulario de color del catálogo: `x-paleta-colores` del contrato
# `plan-decoracion.v1` (exportada desde PALETA_COLORES_V2 en TypeScript).
# "multicolor" es un producto surtido, no el color de una posición del patrón.
PALETA: tuple[str, ...] = tuple(
    color
    for color in cast(list[str], contract_schema("PlanDecoracion")["x-paleta-colores"])
    if color != "multicolor"
)


class PatronReferenciaError(Exception):
    """Stable domain error translated by the HTTP boundary. `provider_detail`
    carries the provider's finish/block reason when the answer was empty."""

    def __init__(self, code: str, status_code: int = 502, provider_detail: str | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code
        self.provider_detail = provider_detail


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

For each element listed in the message (element_id, its structure type and, when given, its bounding box as fractions of the image with the origin at the top-left corner), look only at that piece and name the color pattern a decorator would use to build it:

- "espiral" (spiral, zigzag or straight stripes): the piece is made of identical clusters, usually quartets of 4 balloons, with the same colors in the same positions in every cluster. Rotated one eighth of a turn per layer the colors form continuous diagonal spiral stripes; turned left for two layers and right for the next two they form zigzag chevrons; stacked without rotation each color runs as a straight vertical stripe. All three are "espiral". colores = the colors of ONE cluster in position order, repeating a color when it takes two positions (for example blanco, negro, blanco, azul). globos_por_racimo = balloons per cluster.
- "anillos" (rings, "salvavidas"): every cluster is a single color and the colors follow each other along the piece (for example a blanco ring, a dorado ring, a blanco ring...). colores = the ring colors in order from the start of the piece, one per ring of the repeating sequence.
- "bloques" (color-blocked sections): long solid sections of one color each with clean transitions. colores = the sections in order from the start of the piece. pesos = the relative length of each section as integers from 1 to 100, one per color.
- "degradado" (degradé, ombré): the colors blend gradually from one into the next along the piece. colores = the stops in order from the start of the piece, 2 to 6 colors.
- "aleatorio" (confetti, organic mix): the colors are mixed with no regular order, as in an organic garland. colores = the colors present, the most used first. pesos = the approximate share of each color as integers from 1 to 100, one per color.
- "flor" (daisy motif): runs of background clusters, then a flower made of petal clusters around one center balloon, repeating. colores = exactly three colors: background, petal, center.
- "damero" (checkerboard, only on flat balloon walls): a checkerboard of 2 colors, or diagonal rainbow bands of 3 or 4 colors. colores = the colors in order.
- "ninguno": the piece is a single color, is hidden, or you cannot tell the arrangement. colores = [].

The start of a piece is: the base of a column; the left foot of an arch (going up over the top and down to the right foot); the base of a half-arch toward its open tip; the left end of a garland; the top-left corner of a wall; the bottom of a centerpiece.

Colors: use ONLY these catalog color names, spelled exactly as written: {", ".join(PALETA)}. Map what you see to the closest of these names (light pink is rosado, chrome or metallic gold is dorado, clear is transparente). Never write any other color name, and never write "multicolor". The colors the first analysis observed are given as a hint; trust the photo when they disagree.

confianza: a number from 0 to 1 for how sure you are of the pattern (not of the exact colors). Below 0.5 means a decorator would not rely on it; prefer "ninguno" to a guess.

Return exactly one entry per listed element_id and never an element that is not listed."""

RESPONSE_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {
        "pistas": {
            "type": "array",
            "maxItems": MAX_ELEMENTOS,
            "items": {
                "type": "object",
                "properties": {
                    "element_id": {"type": "string"},
                    "modo": {"type": "string", "enum": [*MODOS, MODO_NINGUNO]},
                    "colores": {
                        "type": "array",
                        "maxItems": MAX_COLORES,
                        "items": {"type": "string", "enum": list(PALETA)},
                    },
                    "globos_por_racimo": {"type": "integer", "minimum": 1, "maximum": 8},
                    "pesos": {
                        "type": "array",
                        "maxItems": MAX_COLORES,
                        "items": {"type": "integer", "minimum": 1, "maximum": 100},
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
PROMPT_VERSION = "patron-referencia.v1:" + hashlib.sha256(
    (SYSTEM_INSTRUCTION + json.dumps(RESPONSE_SCHEMA, sort_keys=True)).encode("utf-8")
).hexdigest()[:16]


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


def _pista(item: object, pendientes: set[str]) -> dict[str, object] | None:
    """Una pista del proveedor, validada; `None` si no se puede usar."""
    if not isinstance(item, dict):
        return None
    element_id = item.get("element_id")
    if not isinstance(element_id, str) or element_id.strip() not in pendientes:
        return None
    element_id = element_id.strip()
    modo = item.get("modo")
    modo = modo.strip().lower() if isinstance(modo, str) else None
    if modo not in (*MODOS, MODO_NINGUNO):
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
    if modo == MODO_NINGUNO:
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
    if pesos_alineados and pesos:
        pista["pesos"] = pesos[:MAX_COLORES]
    return pista


def validar_pistas(raw: object, elementos: list[ElementoReferencia]) -> list[dict[str, object]]:
    """Valida la salida del proveedor contra lo que se pidió.

    La forma de nivel superior es obligatoria (sin ella no hay respuesta que
    leer). Cada pista se valida por separado: una que nombra un elemento que no
    se pidió, repite uno o trae un modo desconocido se descarta; los colores
    fuera de la paleta se quitan y los números se acotan a su rango. Una pista
    que se queda sin colores pasa a "ninguno".
    """

    if not isinstance(raw, dict) or not isinstance(raw.get("pistas"), list):
        raise PatronReferenciaError("patron_referencia_invalid_output", 502)
    pendientes = {elemento.element_id for elemento in elementos}
    pistas: list[dict[str, object]] = []
    for item in cast(list[object], raw["pistas"]):
        pista = _pista(item, pendientes)
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

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise PatronReferenciaError("patron_referencia_unavailable", 503)

    try:
        # `Blob.data` wants raw bytes, not the base64 text (see turno.py).
        raw_bytes = base64.b64decode(payload.imagen.data_base64, validate=True)
    except Exception as error:
        raise PatronReferenciaError("patron_referencia_invalid_image", 422) from error
    if not raw_bytes:
        raise PatronReferenciaError("patron_referencia_invalid_image", 422)

    from google.genai import types

    client: object = (client_factory or _default_client)(api_key)
    content = types.Content(
        role="user",
        parts=[
            types.Part(inline_data=types.Blob(mime_type=payload.imagen.mime_type, data=raw_bytes)),
            types.Part(text=_mensaje(payload.elementos)),
        ],
    )
    try:
        response = await client.aio.models.generate_content(  # type: ignore[attr-defined]
            model=DEFAULT_MODEL,
            contents=[content],
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                response_mime_type="application/json",
                response_schema=RESPONSE_SCHEMA,
                temperature=0,
                max_output_tokens=MAX_OUTPUT_TOKENS,
                # Extracción estructurada: sin razonamiento, igual que Inari y
                # Happie, para que el presupuesto de salida sea todo JSON.
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            ),
        )
    except Exception as error:
        raise PatronReferenciaError("patron_referencia_provider_error", 502) from error

    text = getattr(response, "text", None)
    if not text:
        # Bloqueada o vacía: no hay nada que leer. El motivo del proveedor viaja
        # en el error para el log de Next, nunca como un éxito sin pistas.
        motivos = {
            "finish_reason": _finish_reason(response),
            "block_reason": _block_reason(response),
        }
        raise PatronReferenciaError(
            "patron_referencia_empty_response",
            502,
            " ".join(f"{clave}={valor}" for clave, valor in motivos.items() if valor) or None,
        )
    try:
        raw = json.loads(str(text))
    except json.JSONDecodeError as error:
        raise PatronReferenciaError("patron_referencia_invalid_output", 502) from error

    return {
        "operation_schema_version": PATRON_REFERENCIA_RESULT_VERSION,
        "pistas": validar_pistas(raw, payload.elementos),
        "modelo": DEFAULT_MODEL,
        "prompt_version": PROMPT_VERSION,
        "usage": _usage_dict(getattr(response, "usage_metadata", None)),
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
