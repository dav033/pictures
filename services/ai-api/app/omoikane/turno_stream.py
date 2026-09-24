"""Omoikane -- one streamed Gemini turn of the customer chat.

TypeScript keeps the whole conversation: the tool-calling loop
(`packages/agente-core/src/ejecutar.ts`), the browser-facing SSE
(`chat.sse.v1`), the system prompt, the tool declarations and their handlers.
It also builds the provider `contents` itself with `historialAContents`, so the
history translation (image labels, `thoughtSignature`, grouped
`functionResponse` parts) keeps a single owner. This module makes exactly the
one `generate_content_stream` call a turn used to make directly with
`@google/genai`, and reports what came back. It does not classify provider
errors either: it forwards the provider's status and message, and TypeScript
runs the same `categorizarError` the direct path uses. Migration context:
docs/architecture/decisions/0027-streaming-del-chat-en-python.md.
"""

from __future__ import annotations

import base64
import json
import os
from typing import Any, AsyncGenerator, Callable, Literal

from pydantic import Field, ValidationError

from app.operational_models import ContractModel, OperationalRequest


CHAT_TURN_STREAM_SCOPE = "ia.chat_turn_stream"
CHAT_TURN_STREAM_SCHEMA_VERSION = "chat-turn-stream.v1"
DEFAULT_MODEL = "gemini-3.6-flash"
MAX_CONTENTS = 400
MAX_TOOLS = 32
MAX_PROVIDER_MESSAGE = 1000


class ChatTurnError(Exception):
    """A failure detected before the stream opens, returned as a plain HTTP
    error by the boundary. Anything after the stream opens travels as an
    `error` event instead, because the 200 status is already sent."""

    def __init__(self, code: str, status_code: int) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code


class ChatTurnTool(ContractModel):
    name: str = Field(min_length=1, max_length=64)
    description: str = Field(max_length=8000)
    parameters_json_schema: dict[str, Any]


class ChatTurnStreamRequest(OperationalRequest):
    """`contents` travels as the Gemini `Content` JSON `historialAContents`
    already built in TypeScript (camelCase, base64 image data and signatures);
    the SDK's own model validates it here instead of a hand-written schema."""

    schema_version: Literal["chat-turn-stream.v1"]
    model: str = Field(default=DEFAULT_MODEL, min_length=1, max_length=200)
    system_instruction: str = Field(max_length=400_000)
    contents: list[dict[str, Any]] = Field(min_length=1, max_length=MAX_CONTENTS)
    tools: list[ChatTurnTool] = Field(default_factory=list, max_length=MAX_TOOLS)
    thinking_level: Literal["low", "minimal"] | None = None
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_output_tokens: int | None = Field(default=None, ge=1, le=65536)


def _default_client(api_key: str) -> object:
    from google import genai

    return genai.Client(api_key=api_key)


def _enum_value(value: object) -> str | None:
    raw = getattr(value, "value", value)
    return raw if isinstance(raw, str) and raw else None


def _usage_metadata(usage: object) -> dict[str, int]:
    """Same keys as `MetadatosUsoGemini` in agente-core, so TypeScript feeds it
    to the existing `extraerUsoGemini` instead of re-mapping token fields."""

    fields = {
        "promptTokenCount": getattr(usage, "prompt_token_count", None),
        "candidatesTokenCount": getattr(usage, "candidates_token_count", None),
        "cachedContentTokenCount": getattr(usage, "cached_content_token_count", None),
        "thoughtsTokenCount": getattr(usage, "thoughts_token_count", None),
        "toolUsePromptTokenCount": getattr(usage, "tool_use_prompt_token_count", None),
    }
    return {key: value for key, value in fields.items() if isinstance(value, int)}


def _provider_error_event(error: BaseException, *, phase: Literal["open", "stream"]) -> dict[str, object]:
    """`phase` is "open" only while no provider chunk has arrived: that is the
    one window where TypeScript may retry the turn (the same window
    `conReintento` covers on the direct path), because nothing was generated
    or shown yet."""

    status = getattr(error, "code", None)
    return {
        "type": "error",
        "code": "chat_turn_provider_error",
        "provider_status": status if isinstance(status, int) and not isinstance(status, bool) else None,
        "provider_message": (str(error) or type(error).__name__)[:MAX_PROVIDER_MESSAGE],
        "phase": phase,
    }


def _build_config(payload: ChatTurnStreamRequest) -> object:
    from google.genai import types

    config: dict[str, object] = {"system_instruction": payload.system_instruction}
    if payload.tools:
        config["tools"] = [
            types.Tool(
                function_declarations=[
                    types.FunctionDeclaration(
                        name=tool.name,
                        description=tool.description,
                        parameters_json_schema=tool.parameters_json_schema,
                    )
                    for tool in payload.tools
                ]
            )
        ]
    if payload.thinking_level is not None:
        config["thinking_config"] = types.ThinkingConfig(thinking_level=payload.thinking_level.upper())
    if payload.temperature is not None:
        config["temperature"] = payload.temperature
    if payload.max_output_tokens is not None:
        config["max_output_tokens"] = payload.max_output_tokens
    return types.GenerateContentConfig(**config)


async def _events(
    client: Any, model: str, contents: list[object], config: object
) -> AsyncGenerator[dict[str, object], None]:
    received_chunk = False
    stream: Any = None
    try:
        stream = await client.aio.models.generate_content_stream(model=model, contents=contents, config=config)
        text = ""
        # Mirrors turnoStream in agente-core: calls that arrive in separate
        # chunks are accumulated by id (or name+args), never overwritten, so no
        # call loses its thoughtSignature.
        calls: dict[str, dict[str, object]] = {}
        usage: dict[str, int] = {}
        finish_reason: str | None = None
        block_reason: str | None = None
        async for chunk in stream:
            received_chunk = True
            candidates = getattr(chunk, "candidates", None) or []
            first = candidates[0] if candidates else None
            content = getattr(first, "content", None)
            delta = ""
            for part in getattr(content, "parts", None) or []:
                function_call = getattr(part, "function_call", None)
                if function_call is not None and getattr(function_call, "name", None):
                    signature = getattr(part, "thought_signature", None)
                    args = getattr(function_call, "args", None) or {}
                    call_id = getattr(function_call, "id", None)
                    key = call_id or f"{function_call.name}:{json.dumps(args, sort_keys=True)}"
                    calls[key] = {
                        "id": call_id,
                        "name": function_call.name,
                        "args": args,
                        "thought_signature": base64.b64encode(signature).decode("ascii") if signature else None,
                    }
                elif isinstance(getattr(part, "text", None), str) and not getattr(part, "thought", False):
                    delta += part.text
            if delta:
                text += delta
                yield {"type": "text", "delta": delta}
            chunk_usage = getattr(chunk, "usage_metadata", None)
            if chunk_usage is not None:
                usage = _usage_metadata(chunk_usage)
            finish_reason = _enum_value(getattr(first, "finish_reason", None)) or finish_reason
            feedback = getattr(chunk, "prompt_feedback", None)
            block_reason = _enum_value(getattr(feedback, "block_reason", None)) or block_reason
        yield {
            "type": "end",
            "text": text,
            "tool_calls": list(calls.values()),
            "usage_metadata": usage,
            "model": model,
            "finish_reason": finish_reason,
            "block_reason": block_reason,
        }
    except Exception as error:
        yield _provider_error_event(error, phase="stream" if received_chunk else "open")
    finally:
        # Reached on normal end, on error, and when the boundary cancels this
        # generator because Next disconnected: closing the SDK stream closes
        # the provider HTTP response instead of letting it run to completion.
        close = getattr(stream, "aclose", None)
        if callable(close):
            try:
                await close()
            except Exception:
                pass


def abrir_turno_stream(
    payload: ChatTurnStreamRequest,
    client_factory: Callable[[str], object] | None = None,
) -> AsyncGenerator[dict[str, object], None]:
    """Validates everything that can fail before the stream opens (key,
    contents) and returns the event iterator. Raises ChatTurnError for those;
    every later failure is an `error` event, and the iterator always ends
    with exactly one `end` or `error` event."""

    from google.genai import types

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise ChatTurnError("chat_turn_unavailable", 503)
    try:
        contents: list[object] = [types.Content.model_validate(item) for item in payload.contents]
    except ValidationError:
        raise ChatTurnError("chat_turn_invalid_contents", 422) from None
    try:
        config = _build_config(payload)
    except ValidationError:
        raise ChatTurnError("chat_turn_invalid_tools", 422) from None
    client = (client_factory or _default_client)(api_key)
    return _events(client, payload.model, contents, config)


__all__ = [
    "CHAT_TURN_STREAM_SCHEMA_VERSION",
    "CHAT_TURN_STREAM_SCOPE",
    "DEFAULT_MODEL",
    "ChatTurnError",
    "ChatTurnStreamRequest",
    "ChatTurnTool",
    "abrir_turno_stream",
]
