import asyncio
from types import SimpleNamespace

import pytest

from app.inari.parse import (
    DEFAULT_MODEL,
    IntentParseError,
    IntentParseRequest,
    interpretar_consulta_gemini,
)


def _request_dict(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "context": {
            "schema_version": "operational.v1",
            "request_id": "00000000-0000-0000-0000-000000000000",
            "correlation_id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
            "deadline_at": "2030-01-01T00:00:00Z",
            "deadline_ms": 1000,
            "body_sha256": "a" * 64,
            "scopes": ["ia.intent_parse"],
        },
        "schema_version": "intent-parse.v1",
        "message": "algo elegante en dorado y blanco",
        "system_instruction": "Interpretas mensajes de clientes.",
        "response_json_schema": {"type": "object"},
    }
    body.update(overrides)
    return body


def test_intent_parse_request_rejects_blank_message() -> None:
    with pytest.raises(ValueError, match="blank"):
        IntentParseRequest.model_validate(_request_dict(message="   "))


def test_intent_parse_request_rejects_blank_system_instruction() -> None:
    with pytest.raises(ValueError, match="blank"):
        IntentParseRequest.model_validate(_request_dict(system_instruction="   "))


def test_intent_parse_request_rejects_empty_schema() -> None:
    with pytest.raises(ValueError, match="empty"):
        IntentParseRequest.model_validate(_request_dict(response_json_schema={}))


def test_intent_parse_request_defaults_to_default_model() -> None:
    payload = IntentParseRequest.model_validate(_request_dict())
    assert payload.model == DEFAULT_MODEL


def test_interpretar_consulta_gemini_fails_closed_without_api_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    payload = IntentParseRequest.model_validate(_request_dict())

    with pytest.raises(IntentParseError) as excinfo:
        asyncio.run(interpretar_consulta_gemini(payload))
    assert excinfo.value.code == "intent_parser_unavailable"
    assert excinfo.value.status_code == 503


class _FakeModels:
    def __init__(self, response: object) -> None:
        self._response = response
        self.calls: list[dict[str, object]] = []

    async def generate_content(self, **kwargs: object) -> object:
        self.calls.append(kwargs)
        return self._response


class _FakeClient:
    def __init__(self, response: object) -> None:
        self.aio = SimpleNamespace(models=_FakeModels(response))


def test_interpretar_consulta_gemini_returns_text_and_usage(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    usage = SimpleNamespace(
        prompt_token_count=10,
        candidates_token_count=5,
        thoughts_token_count=1,
        cached_content_token_count=0,
        total_token_count=16,
    )
    response = SimpleNamespace(text='{"filtros_duros": {}}', usage_metadata=usage)
    fake_client = _FakeClient(response)

    payload = IntentParseRequest.model_validate(_request_dict())
    result = asyncio.run(
        interpretar_consulta_gemini(payload, client_factory=lambda _api_key: fake_client)
    )

    assert result["text"] == '{"filtros_duros": {}}'
    assert result["model"] == DEFAULT_MODEL
    assert result["usage"] == {
        "prompt_token_count": 10,
        "candidates_token_count": 5,
        "thoughts_token_count": 1,
        "cached_content_token_count": 0,
        "total_token_count": 16,
    }
    assert fake_client.aio.models.calls[0]["model"] == DEFAULT_MODEL


def test_interpretar_consulta_gemini_fails_closed_on_empty_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    response = SimpleNamespace(text=None, usage_metadata=None)
    fake_client = _FakeClient(response)

    payload = IntentParseRequest.model_validate(_request_dict())
    with pytest.raises(IntentParseError) as excinfo:
        asyncio.run(
            interpretar_consulta_gemini(payload, client_factory=lambda _api_key: fake_client)
        )
    assert excinfo.value.code == "intent_parser_empty_response"


def test_interpretar_consulta_gemini_wraps_provider_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")

    class _RaisingModels:
        async def generate_content(self, **_kwargs: object) -> object:
            raise RuntimeError("boom")

    class _RaisingClient:
        def __init__(self) -> None:
            self.aio = SimpleNamespace(models=_RaisingModels())

    payload = IntentParseRequest.model_validate(_request_dict())
    with pytest.raises(IntentParseError) as excinfo:
        asyncio.run(
            interpretar_consulta_gemini(payload, client_factory=lambda _api_key: _RaisingClient())
        )
    assert excinfo.value.code == "intent_parser_provider_error"
    assert excinfo.value.status_code == 502
