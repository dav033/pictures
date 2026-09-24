"""Inari -- the Gemini call inside the catalog query intent parser.

TypeScript (`src/lib/ia/inari/parse.ts`) still owns everything that is not a
network call to the provider: the deterministic-first parse
(`interpretarConsultaDeterminista`), the decision to call Gemini at all (only
when the local parse is not "certain"), the system instruction, the response
JSON schema (from its own `IntentQuerySchema`), and the merge of the local and
remote results (`mergeGeminiIntent`). This module receives that already-built
instruction and schema and makes the one HTTP call to Gemini that TypeScript
used to make directly with `@google/genai` -- nothing here decides what the
prompt says or what the final answer means to the rest of the app. Migration
context: docs/architecture/decisions/0026-migrar-las-ias-a-python.md.
"""

from __future__ import annotations

import os
from typing import Callable, Literal

from pydantic import Field, field_validator

from app.operational_models import OperationalRequest


INTENT_PARSE_SCOPE = "ia.intent_parse"
INTENT_PARSE_SCHEMA_VERSION = "intent-parse.v1"
DEFAULT_MODEL = "gemini-3.6-flash"


class IntentParseError(Exception):
    """Stable domain error translated by the HTTP boundary."""

    def __init__(self, code: str, status_code: int = 502) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code


class IntentParseRequest(OperationalRequest):
    """Authenticated operation body for one Gemini intent-parse call.

    `response_json_schema` travels from TypeScript on every call instead of
    being duplicated here: it is `z.toJSONSchema(IntentQuerySchema, ...)`,
    computed from the Zod schema TypeScript already owns and validates the
    result against after this call returns. Keeping it out of Python means
    there is nothing here to fall out of sync with that schema.
    """

    schema_version: Literal["intent-parse.v1"]
    message: str = Field(min_length=1, max_length=4_000)
    system_instruction: str = Field(min_length=1, max_length=8_000)
    response_json_schema: dict[str, object]
    model: str = Field(default=DEFAULT_MODEL, min_length=1, max_length=200)

    @field_validator("message", "system_instruction")
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
        "total_token_count": getattr(usage, "total_token_count", None),
    }
    counted = {key: int(value) for key, value in fields.items() if isinstance(value, int)}
    return counted or None


def _default_client(api_key: str) -> object:
    from google import genai

    return genai.Client(api_key=api_key)


async def interpretar_consulta_gemini(
    payload: IntentParseRequest,
    client_factory: Callable[[str], object] | None = None,
) -> dict[str, object]:
    """Makes the one Gemini call `interpretarConsulta` used to make directly
    from TypeScript. Raises IntentParseError on any provider failure; never
    falls back silently -- TypeScript's caller already has its own local
    fallback (the deterministic parse) and decides what to do with a failure
    here, the same way it already handles a thrown error from the direct
    Gemini call today.

    `client_factory` is dependency injection for tests (mirrors how
    `embed_with_retry` takes an `EmbeddingProvider`) -- it avoids
    monkeypatching the third-party `google.genai` module.
    """

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise IntentParseError("intent_parser_unavailable", 503)

    from google.genai import types

    client = (client_factory or _default_client)(api_key)
    try:
        response = await client.aio.models.generate_content(  # type: ignore[attr-defined]
            model=payload.model,
            contents=[{"role": "user", "parts": [{"text": payload.message}]}],
            config=types.GenerateContentConfig(
                system_instruction=payload.system_instruction,
                response_mime_type="application/json",
                # The installed google-genai (Python) has no ThinkingLevel enum
                # (that is a @google/genai/JS concept); thinking_budget=0 is
                # this SDK's equivalent of TS's ThinkingLevel.MINIMAL for a
                # plain structured-extraction call.
                response_schema=payload.response_json_schema,
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            ),
        )
    except Exception as error:
        raise IntentParseError("intent_parser_provider_error", 502) from error

    text = getattr(response, "text", None)
    if not text:
        raise IntentParseError("intent_parser_empty_response", 502)

    return {
        "text": str(text),
        "model": payload.model,
        "usage": _usage_dict(getattr(response, "usage_metadata", None)),
    }


__all__ = [
    "DEFAULT_MODEL",
    "INTENT_PARSE_SCHEMA_VERSION",
    "INTENT_PARSE_SCOPE",
    "IntentParseError",
    "IntentParseRequest",
    "interpretar_consulta_gemini",
]
