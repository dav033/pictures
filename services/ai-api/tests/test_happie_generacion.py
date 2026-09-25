import asyncio
from types import SimpleNamespace

import pytest

from app.happie.generacion import (
    DEFAULT_MODEL,
    MAX_PART_CHARS,
    HappieGenerateError,
    HappieGenerateRequest,
    generar_happie_gemini,
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
            "scopes": ["ia.happie_generate"],
        },
        "schema_version": "happie-generate.v1",
        "purpose": "package_recommend",
        "parts": ["Descripción del cliente: boda para 80", "Paquetes disponibles (JSON): []"],
        "system_instruction": "Recomiendas paquetes de eventos.",
        "response_json_schema": {"type": "object"},
    }
    body.update(overrides)
    return body


def test_request_rejects_blank_part() -> None:
    with pytest.raises(ValueError, match="blank"):
        HappieGenerateRequest.model_validate(_request_dict(parts=["ok", "   "]))


def test_request_rejects_oversized_part() -> None:
    with pytest.raises(ValueError, match="too long"):
        HappieGenerateRequest.model_validate(_request_dict(parts=["x" * (MAX_PART_CHARS + 1)]))


def test_request_rejects_unknown_purpose() -> None:
    with pytest.raises(ValueError):
        HappieGenerateRequest.model_validate(_request_dict(purpose="free_chat"))


def test_request_rejects_no_parts_and_empty_schema() -> None:
    with pytest.raises(ValueError):
        HappieGenerateRequest.model_validate(_request_dict(parts=[]))
    with pytest.raises(ValueError, match="empty"):
        HappieGenerateRequest.model_validate(_request_dict(response_json_schema={}))


def test_request_defaults_to_default_model() -> None:
    assert HappieGenerateRequest.model_validate(_request_dict()).model == DEFAULT_MODEL


def test_fails_closed_without_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    payload = HappieGenerateRequest.model_validate(_request_dict())
    with pytest.raises(HappieGenerateError) as excinfo:
        asyncio.run(generar_happie_gemini(payload))
    assert excinfo.value.code == "happie_unavailable"
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


def test_sends_every_part_in_one_user_message(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    usage = SimpleNamespace(
        prompt_token_count=40,
        candidates_token_count=12,
        thoughts_token_count=None,
        cached_content_token_count=0,
        tool_use_prompt_token_count=None,
        total_token_count=52,
    )
    fake_client = _FakeClient(
        SimpleNamespace(text='{"recomendaciones": [], "resumen": "x"}', usage_metadata=usage)
    )
    payload = HappieGenerateRequest.model_validate(_request_dict())

    result = asyncio.run(generar_happie_gemini(payload, client_factory=lambda _key: fake_client))

    assert result["text"] == '{"recomendaciones": [], "resumen": "x"}'
    assert result["model"] == DEFAULT_MODEL
    assert result["usage"] == {
        "prompt_token_count": 40,
        "candidates_token_count": 12,
        "cached_content_token_count": 0,
        "total_token_count": 52,
    }
    call = fake_client.aio.models.calls[0]
    assert call["contents"] == [
        {
            "role": "user",
            "parts": [
                {"text": "Descripción del cliente: boda para 80"},
                {"text": "Paquetes disponibles (JSON): []"},
            ],
        }
    ]
    config = call["config"]
    assert getattr(config, "response_mime_type") == "application/json"
    assert getattr(config, "system_instruction") == "Recomiendas paquetes de eventos."


def test_fails_closed_on_empty_text(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    fake_client = _FakeClient(SimpleNamespace(text="", usage_metadata=None))
    payload = HappieGenerateRequest.model_validate(_request_dict())
    with pytest.raises(HappieGenerateError) as excinfo:
        asyncio.run(generar_happie_gemini(payload, client_factory=lambda _key: fake_client))
    assert excinfo.value.code == "happie_empty_response"


def test_wraps_provider_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")

    class _RaisingModels:
        async def generate_content(self, **_kwargs: object) -> object:
            raise RuntimeError("boom")

    class _RaisingClient:
        def __init__(self) -> None:
            self.aio = SimpleNamespace(models=_RaisingModels())

    payload = HappieGenerateRequest.model_validate(_request_dict())
    with pytest.raises(HappieGenerateError) as excinfo:
        asyncio.run(generar_happie_gemini(payload, client_factory=lambda _key: _RaisingClient()))
    assert excinfo.value.code == "happie_provider_error"
    assert excinfo.value.status_code == 502
