"""Happie -- the two Gemini calls behind the Happia package chat.

TypeScript still owns everything that is not a network call to the provider:
the conversation state machine and its extraction prompt
(`src/lib/happie/conversacion-webhook.ts`), the package narrowing, the
recommendation prompt, the id anti-hallucination filter
(`packages/happie-package-ia/src/recomendador.ts`), and the Zod schemas both
results are validated against after this call returns. This module receives
the already-built instruction, text parts and response schema and makes the
one structured-output call to Gemini that TypeScript used to make directly
with `@google/genai`. Migration context:
docs/architecture/decisions/0026-migrar-las-ias-a-python.md (Fase 5).
"""

from __future__ import annotations

import os
from typing import Callable, Literal

from pydantic import Field, field_validator

from app.operational_models import OperationalRequest


HAPPIE_GENERATE_SCOPE = "ia.happie_generate"
HAPPIE_GENERATE_SCHEMA_VERSION = "happie-generate.v1"
DEFAULT_MODEL = "gemini-3.6-flash"
# The recommendation call carries the active Happia catalog as JSON text; the
# conversation call carries one short customer message. The per-part cap is the
# largest single string either sends, not a target size.
MAX_PART_CHARS = 1_000_000


class HappieGenerateError(Exception):
    """Stable domain error translated by the HTTP boundary."""

    def __init__(self, code: str, status_code: int = 502) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code


class HappieGenerateRequest(OperationalRequest):
    """Authenticated operation body for one Happie structured-output call.

    `purpose` names which of the two Happie calls this is. It changes nothing
    about the provider call; it exists so the boundary logs and metrics can
    tell them apart. `response_json_schema` travels from TypeScript on every
    call (already adapted to Google's schema subset) for the same reason as in
    Inari: the Zod schema that validates the result stays the only owner.
    """

    schema_version: Literal["happie-generate.v1"]
    purpose: Literal["conversation_extract", "package_recommend"]
    parts: list[str] = Field(min_length=1, max_length=4)
    system_instruction: str = Field(min_length=1, max_length=16_000)
    response_json_schema: dict[str, object]
    model: str = Field(default=DEFAULT_MODEL, min_length=1, max_length=200)

    @field_validator("parts")
    @classmethod
    def reject_blank_parts(cls, value: list[str]) -> list[str]:
        for part in value:
            if not part.strip():
                raise ValueError("parts must not be blank")
            if len(part) > MAX_PART_CHARS:
                raise ValueError("part is too long")
        return value

    @field_validator("system_instruction")
    @classmethod
    def reject_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("value must not be blank")
        return stripped

    @field_validator("response_json_schema")
    @classmethod
    def reject_empty_schema(cls, value: dict[str, object]) -> dict[str, object]:
        if not value:
            raise ValueError("response_json_schema must not be empty")
        return value


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


def _default_client(api_key: str) -> object:
    from google import genai

    return genai.Client(api_key=api_key)


async def generar_happie_gemini(
    payload: HappieGenerateRequest,
    client_factory: Callable[[str], object] | None = None,
) -> dict[str, object]:
    """Makes the one Gemini call a Happie turn used to make directly from
    TypeScript. Raises HappieGenerateError on any provider failure and never
    retries: the direct path ran with `retryOptions: { attempts: 1 }`, and the
    TypeScript callers already turn a failure into their own 502/504.

    `client_factory` is dependency injection for tests, as in Inari.
    """

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise HappieGenerateError("happie_unavailable", 503)

    from google.genai import types

    client = (client_factory or _default_client)(api_key)
    try:
        response = await client.aio.models.generate_content(  # type: ignore[attr-defined]
            model=payload.model,
            contents=[{"role": "user", "parts": [{"text": part} for part in payload.parts]}],
            config=types.GenerateContentConfig(
                system_instruction=payload.system_instruction,
                response_mime_type="application/json",
                response_schema=payload.response_json_schema,
                # Same equivalence as Inari: this SDK has no ThinkingLevel;
                # thinking_budget=0 matches TS's ThinkingLevel.MINIMAL.
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            ),
        )
    except Exception as error:
        raise HappieGenerateError("happie_provider_error", 502) from error

    text = getattr(response, "text", None)
    if not text:
        raise HappieGenerateError("happie_empty_response", 502)

    return {
        "text": str(text),
        "model": payload.model,
        "usage": _usage_dict(getattr(response, "usage_metadata", None)),
    }


__all__ = [
    "DEFAULT_MODEL",
    "HAPPIE_GENERATE_SCHEMA_VERSION",
    "HAPPIE_GENERATE_SCOPE",
    "HappieGenerateError",
    "HappieGenerateRequest",
    "generar_happie_gemini",
]
