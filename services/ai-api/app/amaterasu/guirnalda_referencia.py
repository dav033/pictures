"""Lectura de las guirnaldas de la foto de referencia (ADR-0032, entrega E4).

Next manda la foto, las piezas que el análisis de Amaterasu llamó guirnalda
(y los arcos y semiarcos, que pueden ser una guirnalda colgada mal nombrada) y
las demás piezas de globos de la foto, que pueden sostener una guirnalda.
Python las lee con el prompt, el esquema y la validación del submódulo
``estructuras/guirnalda.py`` y devuelve una lectura por guirnalda. Nada de esto
es comercial: al confirmar el plan viaja como ``pistas_guirnalda`` y
``app/armado_guirnalda.py`` decide si la usa, sin tocar la cantidad.

La forma de la lectura es del contrato ``reference-blueprint.v2``
(``appearance.armado_guirnalda``, dueño Zod ``src/lib/plan/armado-guirnalda.ts``):
cada lectura se comprueba contra ese esquema antes de salir. Mismo proveedor,
modelo y cliente que el turno del análisis; la llamada vive en
``vision_estructurada.py``.
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Mapping
from typing import Callable, Literal, cast

from jsonschema import Draft7Validator
from pydantic import Field, model_validator

from app.amaterasu.estructuras import guirnalda
from app.amaterasu.patron_referencia import PALETA, CajaElemento, ImagenReferencia, TextoCorto
from app.amaterasu.vision_estructurada import DEFAULT_MODEL, LecturaFotoError, leer_foto
from app.generated_models import contract_schema
from app.operational_models import ContractModel, OperationalRequest

logger = logging.getLogger(__name__)

GUIRNALDA_REFERENCIA_SCOPE = "ia.guirnalda_referencia"
GUIRNALDA_REFERENCIA_SCHEMA_VERSION = "guirnalda-referencia.v1"
GUIRNALDA_REFERENCIA_RESULT_VERSION = "guirnalda-referencia-result.v1"
MAX_ELEMENTOS = 12
MAX_COLORES = 12
MAX_OUTPUT_TOKENS = 3_072

SYSTEM_INSTRUCTION = guirnalda.instruccion_sistema(PALETA)
RESPONSE_SCHEMA = guirnalda.esquema_respuesta(PALETA)
# v2 (ADR-0032, decisión 27): la lectura trae la caída y el desnivel relativos al largo.
PROMPT_VERSION = (
    "guirnalda-referencia.v2:"
    + hashlib.sha256(
        (SYSTEM_INSTRUCTION + json.dumps(RESPONSE_SCHEMA, sort_keys=True)).encode("utf-8")
    ).hexdigest()[:16]
)


def _contrato_lectura() -> dict[str, object]:
    """``appearance.armado_guirnalda`` del contrato ``reference-blueprint.v2``."""
    nodo: object = contract_schema("ReferenceBlueprint")
    ruta = (
        "properties",
        "elements",
        "items",
        "properties",
        "appearance",
        "properties",
        "armado_guirnalda",
    )
    for clave in ruta:
        nodo = cast(Mapping[str, object], nodo)[clave]
    return cast(dict[str, object], nodo)


_VALIDADOR = Draft7Validator(_contrato_lectura())


class GuirnaldaReferenciaError(LecturaFotoError):
    """Stable domain error translated by the HTTP boundary."""


class ElementoGuirnalda(ContractModel):
    element_id: TextoCorto
    bbox: CajaElemento | None = None
    colores_observados: list[TextoCorto] = Field(default_factory=list, max_length=MAX_COLORES)


class OtraPieza(ContractModel):
    """Otra pieza de globos de la foto: una posible anfitriona de ``sobre_estructura``."""

    element_id: TextoCorto
    tipo: TextoCorto
    bbox: CajaElemento | None = None


class GuirnaldaReferenciaRequest(OperationalRequest):
    """Authenticated operation body: one reference photo, the garlands the
    reference analysis found in it (1..12) and its other balloon pieces (0..12)."""

    schema_version: Literal["guirnalda-referencia.v1"]
    imagen: ImagenReferencia
    elementos: list[ElementoGuirnalda] = Field(min_length=1, max_length=MAX_ELEMENTOS)
    otras: list[OtraPieza] = Field(default_factory=list, max_length=MAX_ELEMENTOS)

    @model_validator(mode="after")
    def reject_duplicate_element_ids(self) -> "GuirnaldaReferenciaRequest":
        ids = [elemento.element_id for elemento in self.elementos]
        todos = ids + [otra.element_id for otra in self.otras]
        if len(todos) != len(set(todos)):
            raise ValueError("element ids must be unique")
        return self


def cumple_contrato(lectura: Mapping[str, object]) -> bool:
    """La lectura (sin ``element_id``) cabe en ``appearance.armado_guirnalda`` del contrato."""
    return bool(_VALIDADOR.is_valid({k: v for k, v in lectura.items() if k != "element_id"}))


def validar_lecturas(
    raw: object, element_ids: list[str], otras_ids: list[str]
) -> list[dict[str, object]] | None:
    """``estructuras/guirnalda.validar_lecturas`` y, después, el contrato exportado."""
    lecturas = guirnalda.validar_lecturas(raw, element_ids, PALETA, otras_ids)
    if lecturas is None:
        return None
    validas: list[dict[str, object]] = []
    for lectura in lecturas:
        if cumple_contrato(lectura):
            validas.append(lectura)
        else:
            logger.warning(
                "guirnalda_referencia: lectura fuera de contrato descartada (element_id=%s)",
                lectura["element_id"],
            )
    return validas


async def leer_guirnaldas_referencia(
    payload: GuirnaldaReferenciaRequest,
    client_factory: Callable[[str], object] | None = None,
) -> dict[str, object]:
    """Una llamada de visión con salida estructurada. Nunca reintenta: la
    lectura es opcional y Next sigue sin ella ante cualquier fallo."""
    elementos = [
        {
            "element_id": elemento.element_id,
            **({"bbox": elemento.bbox.model_dump()} if elemento.bbox else {}),
            "colores_observados": elemento.colores_observados,
        }
        for elemento in payload.elementos
    ]
    otras = [
        {
            "element_id": otra.element_id,
            "tipo": otra.tipo,
            **({"bbox": otra.bbox.model_dump()} if otra.bbox else {}),
        }
        for otra in payload.otras
    ]
    raw, usage = await leer_foto(
        mime_type=payload.imagen.mime_type,
        data_base64=payload.imagen.data_base64,
        mensaje=guirnalda.mensaje(elementos, otras),
        system_instruction=SYSTEM_INSTRUCTION,
        response_schema=RESPONSE_SCHEMA,
        max_output_tokens=MAX_OUTPUT_TOKENS,
        prefijo="guirnalda_referencia",
        error=GuirnaldaReferenciaError,
        client_factory=client_factory,
    )
    lecturas = validar_lecturas(
        raw,
        [elemento.element_id for elemento in payload.elementos],
        [otra.element_id for otra in payload.otras],
    )
    if lecturas is None:
        raise GuirnaldaReferenciaError("guirnalda_referencia_invalid_output", 502)
    return {
        "operation_schema_version": GUIRNALDA_REFERENCIA_RESULT_VERSION,
        "lecturas": lecturas,
        "modelo": DEFAULT_MODEL,
        "prompt_version": PROMPT_VERSION,
        "usage": usage,
    }


__all__ = [
    "GUIRNALDA_REFERENCIA_RESULT_VERSION",
    "GUIRNALDA_REFERENCIA_SCHEMA_VERSION",
    "GUIRNALDA_REFERENCIA_SCOPE",
    "PROMPT_VERSION",
    "GuirnaldaReferenciaError",
    "GuirnaldaReferenciaRequest",
    "cumple_contrato",
    "leer_guirnaldas_referencia",
    "validar_lecturas",
]
