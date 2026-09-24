import asyncio
from types import SimpleNamespace

import pytest

from app.uzume.interaction import (
    DEFAULT_MODEL,
    ImageGenerateError,
    ImageGenerateRequest,
    crear_interaccion_gemini,
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
            "scopes": ["ia.image_generate"],
        },
        "schema_version": "image-generate.v1",
        "input": [
            {"type": "text", "text": "Un arco de globos dorados en la entrada."},
            {"type": "text", "text": "Reference image role: venue_base."},
            {"type": "image", "data": "aGVsbG8=", "mime_type": "image/jpeg"},
        ],
        "aspect_ratio": "3:2",
        "image_size": "2K",
    }
    body.update(overrides)
    return body


def test_image_generate_request_requires_at_least_one_input_block() -> None:
    with pytest.raises(ValueError):
        ImageGenerateRequest.model_validate(_request_dict(input=[]))


def test_image_generate_request_defaults_to_default_model_and_store_true() -> None:
    payload = ImageGenerateRequest.model_validate(_request_dict())
    assert payload.model == DEFAULT_MODEL
    assert payload.store is True
    assert payload.previous_interaction_id is None


def test_image_generate_request_rejects_unknown_block_type() -> None:
    with pytest.raises(ValueError):
        ImageGenerateRequest.model_validate(_request_dict(input=[{"type": "audio", "text": "no"}]))


def test_crear_interaccion_fails_closed_without_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    payload = ImageGenerateRequest.model_validate(_request_dict())

    with pytest.raises(ImageGenerateError) as excinfo:
        asyncio.run(crear_interaccion_gemini(payload))
    assert excinfo.value.code == "image_generate_unavailable"
    assert excinfo.value.status_code == 503


class _FakeInteractions:
    def __init__(self, response: object) -> None:
        self._response = response
        self.calls: list[dict[str, object]] = []

    async def create(self, **kwargs: object) -> object:
        self.calls.append(kwargs)
        if isinstance(self._response, Exception):
            raise self._response
        return self._response


class _FakeClient:
    def __init__(self, response: object) -> None:
        self.aio = SimpleNamespace(interactions=_FakeInteractions(response))


def _completed_interaction(image_data: str | None, usage: object = None) -> object:
    output_image = SimpleNamespace(data=image_data) if image_data else None
    return SimpleNamespace(status="completed", output_image=output_image, steps=[], id="int_123", usage=usage, errors=None)


def test_crear_interaccion_returns_image_model_and_interaction_id(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    usage = SimpleNamespace(total_input_tokens=500, total_output_tokens=1200, total_thought_tokens=0, total_cached_tokens=0, total_tool_use_tokens=0, total_tokens=1700)
    interaction = _completed_interaction("aW1hZ2VkYXRh", usage=usage)
    fake_client = _FakeClient(interaction)
    payload = ImageGenerateRequest.model_validate(_request_dict())

    result = asyncio.run(crear_interaccion_gemini(payload, client_factory=lambda _api_key: fake_client))

    assert result["image_base64"] == "aW1hZ2VkYXRh"
    assert result["model"] == DEFAULT_MODEL
    assert result["interaction_id"] == "int_123"
    assert result["usage"]["total_input_tokens"] == 500
    call = fake_client.aio.interactions.calls[0]
    assert call["model"] == DEFAULT_MODEL
    assert call["store"] is True
    assert "previous_interaction_id" not in call
    assert call["response_format"] == {"type": "image", "mime_type": "image/jpeg", "aspect_ratio": "3:2", "image_size": "2K"}
    assert len(call["input"]) == 3


def test_crear_interaccion_forwards_previous_interaction_id(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    interaction = _completed_interaction("aW1hZ2VkYXRh")
    fake_client = _FakeClient(interaction)
    payload = ImageGenerateRequest.model_validate(_request_dict(previous_interaction_id="int_prev"))

    asyncio.run(crear_interaccion_gemini(payload, client_factory=lambda _api_key: fake_client))

    assert fake_client.aio.interactions.calls[0]["previous_interaction_id"] == "int_prev"


def test_crear_interaccion_falls_back_to_steps_for_the_image(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    step = SimpleNamespace(content=[SimpleNamespace(type="image", data="ZnJvbXN0ZXA=")])
    interaction = SimpleNamespace(status="completed", output_image=None, steps=[step], id="int_456", usage=None, errors=None)
    fake_client = _FakeClient(interaction)
    payload = ImageGenerateRequest.model_validate(_request_dict())

    result = asyncio.run(crear_interaccion_gemini(payload, client_factory=lambda _api_key: fake_client))

    assert result["image_base64"] == "ZnJvbXN0ZXA="


def test_crear_interaccion_fails_closed_on_empty_image(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    interaction = _completed_interaction(None)
    fake_client = _FakeClient(interaction)
    payload = ImageGenerateRequest.model_validate(_request_dict())

    with pytest.raises(ImageGenerateError) as excinfo:
        asyncio.run(crear_interaccion_gemini(payload, client_factory=lambda _api_key: fake_client))
    assert excinfo.value.code == "image_generate_empty_response"


def test_crear_interaccion_fails_closed_on_failed_status(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    error = SimpleNamespace(message="content blocked by safety filters")
    interaction = SimpleNamespace(status="failed", output_image=None, steps=[], id="int_789", usage=None, errors=[error])
    fake_client = _FakeClient(interaction)
    payload = ImageGenerateRequest.model_validate(_request_dict())

    with pytest.raises(ImageGenerateError) as excinfo:
        asyncio.run(crear_interaccion_gemini(payload, client_factory=lambda _api_key: fake_client))
    assert excinfo.value.code == "image_generate_filtered"
    assert excinfo.value.status_code == 422


@pytest.mark.parametrize(
    ("message", "expected_code", "expected_status"),
    [
        ("Invalid API key provided", "image_generate_unavailable", 503),
        ("Resource exhausted: 429 quota exceeded", "image_generate_quota", 429),
        ("Response blocked due to SAFETY", "image_generate_filtered", 422),
        ("Request timeout after 105s", "image_generate_timeout", 504),
        ("something else entirely", "image_generate_provider_error", 502),
    ],
)
def test_crear_interaccion_classifies_provider_exceptions(
    monkeypatch: pytest.MonkeyPatch, message: str, expected_code: str, expected_status: int,
) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    fake_client = _FakeClient(RuntimeError(message))
    payload = ImageGenerateRequest.model_validate(_request_dict())

    with pytest.raises(ImageGenerateError) as excinfo:
        asyncio.run(crear_interaccion_gemini(payload, client_factory=lambda _api_key: fake_client))
    assert excinfo.value.code == expected_code
    assert excinfo.value.status_code == expected_status
