"""Lectura del armado de los bouquets de la foto de referencia (ADR-0030).

Next manda la foto y los elementos que el análisis de Amaterasu llamó bouquet;
Python los lee con el prompt, el esquema y la validación del submódulo
``estructuras/bouquet.py`` y devuelve una lectura por bouquet. Nada de esto es
comercial: al confirmar el plan viaja como ``pistas_armado`` y
``app/armado_bouquet.py`` decide si la usa. Mismo proveedor, modelo y cliente
que el turno del análisis; la llamada vive en ``vision_estructurada.py``.
"""

from __future__ import annotations

import hashlib
import json
from typing import Callable, Literal

from pydantic import Field, model_validator

from app.amaterasu.estructuras import bouquet
from app.amaterasu.patron_referencia import PALETA, CajaElemento, ImagenReferencia, TextoCorto
from app.amaterasu.vision_estructurada import DEFAULT_MODEL, LecturaFotoError, leer_foto
from app.operational_models import ContractModel, OperationalRequest


BOUQUET_REFERENCIA_SCOPE = "ia.bouquet_referencia"
BOUQUET_REFERENCIA_SCHEMA_VERSION = "bouquet-referencia.v1"
BOUQUET_REFERENCIA_RESULT_VERSION = "bouquet-referencia-result.v1"
MAX_ELEMENTOS = 12
MAX_COLORES = 12
MAX_OUTPUT_TOKENS = 2_048

SYSTEM_INSTRUCTION = bouquet.instruccion_sistema(PALETA)
RESPONSE_SCHEMA = bouquet.esquema_respuesta(PALETA)
PROMPT_VERSION = (
    "bouquet-referencia.v1:"
    + hashlib.sha256(
        (SYSTEM_INSTRUCTION + json.dumps(RESPONSE_SCHEMA, sort_keys=True)).encode("utf-8")
    ).hexdigest()[:16]
)


class BouquetReferenciaError(LecturaFotoError):
    """Stable domain error translated by the HTTP boundary."""


class ElementoBouquet(ContractModel):
    element_id: TextoCorto
    bbox: CajaElemento | None = None
    colores_observados: list[TextoCorto] = Field(default_factory=list, max_length=MAX_COLORES)


class BouquetReferenciaRequest(OperationalRequest):
    """Authenticated operation body: one reference photo and the bouquets the
    reference analysis found in it (1..12)."""

    schema_version: Literal["bouquet-referencia.v1"]
    imagen: ImagenReferencia
    elementos: list[ElementoBouquet] = Field(min_length=1, max_length=MAX_ELEMENTOS)

    @model_validator(mode="after")
    def reject_duplicate_element_ids(self) -> "BouquetReferenciaRequest":
        ids = [elemento.element_id for elemento in self.elementos]
        if len(ids) != len(set(ids)):
            raise ValueError("element ids must be unique")
        return self


async def leer_armados_referencia(
    payload: BouquetReferenciaRequest,
    client_factory: Callable[[str], object] | None = None,
) -> dict[str, object]:
    """Una llamada de visión con salida estructurada. Nunca reintenta: la
    lectura es opcional y Next sigue sin ella ante cualquier fallo."""
    datos = [
        {
            "element_id": elemento.element_id,
            **({"bbox": elemento.bbox.model_dump()} if elemento.bbox else {}),
            "colores_observados": elemento.colores_observados,
        }
        for elemento in payload.elementos
    ]
    raw, usage = await leer_foto(
        mime_type=payload.imagen.mime_type,
        data_base64=payload.imagen.data_base64,
        mensaje=bouquet.mensaje(datos),
        system_instruction=SYSTEM_INSTRUCTION,
        response_schema=RESPONSE_SCHEMA,
        max_output_tokens=MAX_OUTPUT_TOKENS,
        prefijo="bouquet_referencia",
        error=BouquetReferenciaError,
        client_factory=client_factory,
    )
    lecturas = bouquet.validar_lecturas(
        raw, [elemento.element_id for elemento in payload.elementos], PALETA
    )
    if lecturas is None:
        raise BouquetReferenciaError("bouquet_referencia_invalid_output", 502)
    return {
        "operation_schema_version": BOUQUET_REFERENCIA_RESULT_VERSION,
        "lecturas": lecturas,
        "modelo": DEFAULT_MODEL,
        "prompt_version": PROMPT_VERSION,
        "usage": usage,
    }


__all__ = [
    "BOUQUET_REFERENCIA_RESULT_VERSION",
    "BOUQUET_REFERENCIA_SCHEMA_VERSION",
    "BOUQUET_REFERENCIA_SCOPE",
    "PROMPT_VERSION",
    "BouquetReferenciaError",
    "BouquetReferenciaRequest",
    "leer_armados_referencia",
]
