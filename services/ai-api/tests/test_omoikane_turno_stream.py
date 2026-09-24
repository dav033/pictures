import asyncio
import base64
from types import SimpleNamespace
from typing import Any

import pytest

from app.omoikane.turno_stream import (
    CHAT_TURN_STREAM_SCHEMA_VERSION,
    DEFAULT_MODEL,
    ChatTurnError,
    ChatTurnStreamRequest,
    abrir_turno_stream,
)


def _request_dict(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "context": {
            "schema_version": "operational.v1",
            "request_id": "00000000-0000-0000-0000-000000000000",
            "correlation_id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
            "deadline_at": "2030-01-01T00:00:00Z",
            "deadline_ms": 15000,
            "body_sha256": "a" * 64,
            "scopes": ["ia.chat_turn_stream"],
        },
        "schema_version": CHAT_TURN_STREAM_SCHEMA_VERSION,
        "system_instruction": "Eres un asesor de decoración.",
        "contents": [{"role": "user", "parts": [{"text": "Quiero globos dorados."}]}],
        "tools": [
            {
                "name": "buscar_catalogo_rag",
                "description": "Busca en el catálogo.",
                "parameters_json_schema": {"type": "object", "properties": {"q": {"type": "string"}}},
            }
        ],
    }
    body.update(overrides)
    return body


def _part(text: str | None = None, *, thought: bool = False, call: dict[str, Any] | None = None, signature: bytes | None = None) -> object:
    function_call = SimpleNamespace(name=call["name"], args=call.get("args"), id=call.get("id")) if call else None
    return SimpleNamespace(text=text, thought=thought, function_call=function_call, thought_signature=signature)


def _chunk(parts: list[object], *, finish: object = None, usage: object = None, block: object = None) -> object:
    candidate = SimpleNamespace(content=SimpleNamespace(parts=parts), finish_reason=finish)
    return SimpleNamespace(
        candidates=[candidate],
        usage_metadata=usage,
        prompt_feedback=SimpleNamespace(block_reason=block) if block else None,
    )


class _FakeStream:
    def __init__(self, items: list[object]) -> None:
        self._items = list(items)
        self.closed = False

    def __aiter__(self) -> "_FakeStream":
        return self

    async def __anext__(self) -> object:
        if not self._items:
            raise StopAsyncIteration
        item = self._items.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    async def aclose(self) -> None:
        self.closed = True


class _FakeModels:
    def __init__(self, result: object) -> None:
        self._result = result
        self.calls: list[dict[str, Any]] = []

    async def generate_content_stream(self, **kwargs: Any) -> object:
        self.calls.append(kwargs)
        if isinstance(self._result, Exception):
            raise self._result
        return self._result


class _FakeClient:
    def __init__(self, result: object) -> None:
        self.aio = SimpleNamespace(models=_FakeModels(result))


class _ProviderError(Exception):
    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code


def _collect(generator: Any) -> list[dict[str, Any]]:
    async def run() -> list[dict[str, Any]]:
        return [event async for event in generator]

    return asyncio.run(run())


def _open(monkeypatch: pytest.MonkeyPatch, result: object, **overrides: object) -> tuple[Any, _FakeClient]:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    client = _FakeClient(result)
    payload = ChatTurnStreamRequest.model_validate(_request_dict(**overrides))
    return abrir_turno_stream(payload, client_factory=lambda _key: client), client


def test_request_requires_at_least_one_content() -> None:
    with pytest.raises(ValueError):
        ChatTurnStreamRequest.model_validate(_request_dict(contents=[]))


def test_request_defaults_to_the_chat_model() -> None:
    assert ChatTurnStreamRequest.model_validate(_request_dict()).model == DEFAULT_MODEL


def test_fails_closed_without_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    payload = ChatTurnStreamRequest.model_validate(_request_dict())

    with pytest.raises(ChatTurnError) as excinfo:
        abrir_turno_stream(payload)
    assert (excinfo.value.code, excinfo.value.status_code) == ("chat_turn_unavailable", 503)


def test_rejects_contents_the_sdk_cannot_read_before_opening(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    payload = ChatTurnStreamRequest.model_validate(_request_dict(contents=[{"role": "user", "parts": "no es una lista"}]))

    with pytest.raises(ChatTurnError) as excinfo:
        abrir_turno_stream(payload, client_factory=lambda _key: _FakeClient(_FakeStream([])))
    assert (excinfo.value.code, excinfo.value.status_code) == ("chat_turn_invalid_contents", 422)


def test_accepts_the_camelcase_contents_historialAContents_builds(monkeypatch: pytest.MonkeyPatch) -> None:
    png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    contents = [
        {"role": "user", "parts": [{"text": "[IMAGEN_ID=ESPACIO_BASE]"}, {"inlineData": {"mimeType": "image/png", "data": png}}, {"text": "hola"}]},
        {"role": "model", "parts": [{"functionCall": {"name": "buscar_catalogo_rag", "args": {"q": "dorado"}, "id": "c1"}, "thoughtSignature": "c2lnbmF0dXJh"}]},
        {"role": "user", "parts": [{"functionResponse": {"name": "buscar_catalogo_rag", "response": {"ok": True}, "id": "c1"}}]},
    ]
    stream = _FakeStream([_chunk([_part("Listo")], finish=SimpleNamespace(value="STOP"))])
    generator, client = _open(monkeypatch, stream, contents=contents)

    _collect(generator)

    sent = client.aio.models.calls[0]["contents"]
    assert sent[0].parts[1].inline_data.data.startswith(b"\x89PNG")
    assert sent[1].parts[0].thought_signature == b"signatura"
    assert sent[1].parts[0].function_call.id == "c1"


def test_streams_text_deltas_then_one_end_event(monkeypatch: pytest.MonkeyPatch) -> None:
    usage = SimpleNamespace(prompt_token_count=100, candidates_token_count=20, cached_content_token_count=0, thoughts_token_count=7, tool_use_prompt_token_count=None)
    stream = _FakeStream([
        _chunk([_part("Hola, "), _part("pensando...", thought=True)]),
        _chunk([_part("te recomiendo dorado.")], finish=SimpleNamespace(value="STOP"), usage=usage),
    ])
    generator, _client = _open(monkeypatch, stream)

    events = _collect(generator)

    assert events[:2] == [{"type": "text", "delta": "Hola, "}, {"type": "text", "delta": "te recomiendo dorado."}]
    end = events[2]
    assert end["type"] == "end"
    assert end["text"] == "Hola, te recomiendo dorado."
    assert end["tool_calls"] == []
    assert end["finish_reason"] == "STOP"
    assert end["usage_metadata"] == {"promptTokenCount": 100, "candidatesTokenCount": 20, "cachedContentTokenCount": 0, "thoughtsTokenCount": 7}
    assert len(events) == 3
    assert stream.closed is True


def test_accumulates_calls_split_across_chunks_with_their_signatures(monkeypatch: pytest.MonkeyPatch) -> None:
    stream = _FakeStream([
        _chunk([_part(call={"name": "guardar_brief", "args": {"invitados": 80}, "id": "c1"}, signature=b"firma-1")]),
        _chunk([_part(call={"name": "buscar_catalogo_rag", "args": {"q": "dorado"}}, signature=b"firma-2")]),
        _chunk([], finish=SimpleNamespace(value="STOP")),
    ])
    generator, _client = _open(monkeypatch, stream)

    end = _collect(generator)[-1]

    assert end["tool_calls"] == [
        {"id": "c1", "name": "guardar_brief", "args": {"invitados": 80}, "thought_signature": base64.b64encode(b"firma-1").decode()},
        {"id": None, "name": "buscar_catalogo_rag", "args": {"q": "dorado"}, "thought_signature": base64.b64encode(b"firma-2").decode()},
    ]


def test_builds_config_with_tools_and_thinking_level(monkeypatch: pytest.MonkeyPatch) -> None:
    generator, client = _open(monkeypatch, _FakeStream([_chunk([_part("ok")])]), thinking_level="low")

    _collect(generator)

    config = client.aio.models.calls[0]["config"]
    assert config.system_instruction == "Eres un asesor de decoración."
    assert config.thinking_config.thinking_level.value == "LOW"
    declaration = config.tools[0].function_declarations[0]
    assert declaration.name == "buscar_catalogo_rag"
    assert declaration.parameters_json_schema == {"type": "object", "properties": {"q": {"type": "string"}}}


def test_omits_tools_and_thinking_when_not_requested(monkeypatch: pytest.MonkeyPatch) -> None:
    generator, client = _open(monkeypatch, _FakeStream([_chunk([_part("ok")])]), tools=[])

    _collect(generator)

    config = client.aio.models.calls[0]["config"]
    assert config.tools is None
    assert config.thinking_config is None


def test_provider_failure_while_opening_is_an_open_phase_error(monkeypatch: pytest.MonkeyPatch) -> None:
    generator, _client = _open(monkeypatch, _ProviderError(429, "429 RESOURCE_EXHAUSTED. quota exceeded"))

    events = _collect(generator)

    assert events == [{
        "type": "error",
        "code": "chat_turn_provider_error",
        "provider_status": 429,
        "provider_message": "429 RESOURCE_EXHAUSTED. quota exceeded",
        "phase": "open",
    }]


def test_failure_before_any_chunk_is_still_the_open_phase(monkeypatch: pytest.MonkeyPatch) -> None:
    generator, _client = _open(monkeypatch, _FakeStream([_ProviderError(503, "503 UNAVAILABLE")]))

    assert _collect(generator)[-1]["phase"] == "open"


def test_failure_after_a_chunk_is_a_stream_phase_error(monkeypatch: pytest.MonkeyPatch) -> None:
    stream = _FakeStream([_chunk([_part("Hola")]), RuntimeError("connection reset")])
    generator, _client = _open(monkeypatch, stream)

    events = _collect(generator)

    assert events[0] == {"type": "text", "delta": "Hola"}
    assert events[1]["type"] == "error"
    assert events[1]["phase"] == "stream"
    assert events[1]["provider_status"] is None
    assert stream.closed is True


def test_closing_early_closes_the_provider_stream(monkeypatch: pytest.MonkeyPatch) -> None:
    stream = _FakeStream([_chunk([_part("uno")]), _chunk([_part("dos")])])
    generator, _client = _open(monkeypatch, stream)

    async def take_one_then_close() -> None:
        await generator.__anext__()
        await generator.aclose()

    asyncio.run(take_one_then_close())
    assert stream.closed is True
