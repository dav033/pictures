"""Amaterasu -- the Gemini tool-calling turn inside the reference-photo analyzer.

TypeScript (`src/lib/ia/amaterasu/analizar-referencias-v2.ts`) still owns
everything that is not a network call to the provider: the in-memory
cache/in-flight dedupe, the fixed gallery examples, the retry-on-malformed
loop across the "inventory" and "audit" passes, `buildBlueprint`,
`catalogFallback`, `resolveBillOfMaterials`, and the measured color-dominance
enrichment. This module makes exactly one non-streaming, tool-calling Gemini
turn -- the same primitive `ChatPort.turno()` already is in TypeScript
(`packages/agente-core/src/gemini/chat.ts`), scoped to the single-user-message
shape Amaterasu actually sends (no assistant/tool history: each pass is one
fresh call). Migration context:
docs/architecture/decisions/0026-migrar-las-ias-a-python.md.

Known, accepted difference from the TypeScript path: the JS `ChatPort`
instance dedupes image bytes across the inventory and audit passes of one
analysis (a `WeakSet` scoped to that one `ChatPort`, see chat.ts). This
module has no such session, so both passes resend full image bytes -- more
bandwidth per Python-path analysis, not a behavior change: the model still
sees the same images either way.
"""

from __future__ import annotations

import base64
import os
from typing import Callable, Literal

from pydantic import Field, field_validator

from app.operational_models import ContractModel, OperationalRequest


REFERENCE_TURN_SCOPE = "ia.reference_turn"
REFERENCE_TURN_SCHEMA_VERSION = "reference-turn.v1"
DEFAULT_MODEL = "gemini-3.6-flash"
MAX_IMAGES = 3
MAX_IMAGE_BASE64_CHARS = 15_000_000
MAX_TOOLS = 2
# Text caps only guard against absurd input; the real ceiling is the 11MB body
# cap. The audit pass embeds the whole draft inventory in `message`, and the
# catalog mode appends the full valid-product list to the system prompt, so a
# tight cap here rejected legitimate turns the direct TypeScript path accepts.
MAX_TEXT_CHARS = 400_000


class ReferenceTurnError(Exception):
    """Stable domain error translated by the HTTP boundary."""

    def __init__(self, code: str, status_code: int = 502) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code


class ReferenceTurnImage(ContractModel):
    """A reference photo, tagged the same way `historialAContents` tags it in
    TypeScript: a `[IMAGEN_ID=...]` text part precedes the image bytes, since
    the model does not reliably see EXIF/XMP metadata."""

    id: str = Field(min_length=1, max_length=80)
    mime: Literal["image/png", "image/jpeg", "image/webp"]
    base64: str = Field(min_length=1, max_length=MAX_IMAGE_BASE64_CHARS)
    descripcion: str = Field(default="", max_length=MAX_TEXT_CHARS)


class ReferenceTurnTool(ContractModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    parameters_json_schema: dict[str, object]


class ReferenceTurnRequest(OperationalRequest):
    """Authenticated operation body for one Gemini tool-calling turn. Mirrors
    `PeticionChat` (agente-core/src/tipos.ts) narrowed to Amaterasu's own
    shape: a single user message with images and text, never assistant/tool
    history -- `analizarReferenciasV2` never sends more than that.
    """

    schema_version: Literal["reference-turn.v1"]
    system_instruction: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    message: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    images: list[ReferenceTurnImage] = Field(min_length=1, max_length=MAX_IMAGES)
    tools: list[ReferenceTurnTool] = Field(default_factory=list, max_length=MAX_TOOLS)
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_output_tokens: int | None = Field(default=None, ge=1, le=32_000)
    model: str = Field(default=DEFAULT_MODEL, min_length=1, max_length=200)

    @field_validator("system_instruction", "message")
    @classmethod
    def reject_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("value must not be blank")
        return stripped


def _usage_dict(usage: object) -> dict[str, int] | None:
    if usage is None:
        return None
    fields = {
        "prompt_token_count": getattr(usage, "prompt_token_count", None),
        "candidates_token_count": getattr(usage, "candidates_token_count", None),
        "thoughts_token_count": getattr(usage, "thoughts_token_count", None),
        "cached_content_token_count": getattr(usage, "cached_content_token_count", None),
        "tool_use_prompt_token_count": getattr(usage, "tool_use_prompt_token_count", None),
        "total_token_count": getattr(usage, "total_token_count", None),
    }
    counted = {key: int(value) for key, value in fields.items() if isinstance(value, int)}
    return counted or None


def _tool_calls(response: object) -> list[dict[str, object]]:
    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        return []
    content = getattr(candidates[0], "content", None)
    parts = getattr(content, "parts", None) or []
    calls: list[dict[str, object]] = []
    for part in parts:
        function_call = getattr(part, "function_call", None)
        if function_call is None or not getattr(function_call, "name", None):
            continue
        calls.append({
            "name": function_call.name,
            "args": dict(getattr(function_call, "args", None) or {}),
        })
    return calls


def _finish_reason(response: object) -> str | None:
    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        return None
    reason = getattr(candidates[0], "finish_reason", None)
    return _enum_value(reason)


def _block_reason(response: object) -> str | None:
    feedback = getattr(response, "prompt_feedback", None)
    reason = getattr(feedback, "block_reason", None) if feedback else None
    return _enum_value(reason)


def _enum_value(reason: object) -> str | None:
    """`finish_reason`/`block_reason` are SDK enums (`FinishReason.STOP`), not
    plain strings like the JS SDK's -- `.value` gives the bare "STOP" that
    matches `TurnoChat.finishReason`'s documented shape; `str(enum)` would
    give "FinishReason.STOP" instead."""
    if not reason:
        return None
    value = getattr(reason, "value", reason)
    return str(value) if value else None


def _default_client(api_key: str) -> object:
    from google import genai

    return genai.Client(api_key=api_key)


async def ejecutar_turno_gemini(
    payload: ReferenceTurnRequest,
    client_factory: Callable[[str], object] | None = None,
) -> dict[str, object]:
    """Makes the one Gemini tool-calling turn `analizarReferenciasV2`'s
    inventory and audit passes used to make directly from TypeScript (via
    `ChatPort.turno`). Raises ReferenceTurnError on any provider failure --
    the caller (TypeScript's `pasoConHerramienta`) already retries a
    malformed answer on its own, so this never retries internally.

    `client_factory` is dependency injection for tests, same pattern as
    Inari's `interpretar_consulta_gemini`.
    """

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise ReferenceTurnError("reference_turn_unavailable", 503)

    from google.genai import types

    client = (client_factory or _default_client)(api_key)
    parts: list[object] = []
    for image in payload.images:
        label = f"[IMAGEN_ID={image.id}]"
        parts.append(types.Part(text=f"{label} {image.descripcion}".strip()))
        try:
            # `Blob.data` wants raw bytes, unlike the JS SDK's inlineData.data
            # (a base64 string) -- decode explicitly, don't just re-encode
            # the base64 text itself as bytes.
            raw_bytes = base64.b64decode(image.base64, validate=True)
        except Exception as error:
            raise ReferenceTurnError("reference_turn_invalid_image", 422) from error
        parts.append(types.Part(inline_data=types.Blob(mime_type=image.mime, data=raw_bytes)))
    parts.append(types.Part(text=payload.message))
    content = types.Content(role="user", parts=parts)

    tools = (
        [types.Tool(function_declarations=[
            types.FunctionDeclaration(
                name=tool.name,
                description=tool.description,
                parameters_json_schema=tool.parameters_json_schema,
            )
            for tool in payload.tools
        ])]
        if payload.tools
        else None
    )

    try:
        response = await client.aio.models.generate_content(  # type: ignore[attr-defined]
            model=payload.model,
            contents=[content],
            config=types.GenerateContentConfig(
                system_instruction=payload.system_instruction,
                temperature=payload.temperature,
                max_output_tokens=payload.max_output_tokens,
                tools=tools,
            ),
        )
    except Exception as error:
        raise ReferenceTurnError("reference_turn_provider_error", 502) from error

    return {
        "text": str(getattr(response, "text", None) or ""),
        "tool_calls": _tool_calls(response),
        "model": payload.model,
        "usage": _usage_dict(getattr(response, "usage_metadata", None)),
        "finish_reason": _finish_reason(response),
        "block_reason": _block_reason(response),
    }


__all__ = [
    "DEFAULT_MODEL",
    "MAX_IMAGES",
    "MAX_TOOLS",
    "REFERENCE_TURN_SCHEMA_VERSION",
    "REFERENCE_TURN_SCOPE",
    "ReferenceTurnError",
    "ReferenceTurnImage",
    "ReferenceTurnRequest",
    "ReferenceTurnTool",
    "ejecutar_turno_gemini",
]
