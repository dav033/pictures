import asyncio
import base64
from types import SimpleNamespace

import pytest

from app.amaterasu.turno import (
    DEFAULT_MODEL,
    ReferenceTurnError,
    ReferenceTurnRequest,
    ejecutar_turno_gemini,
)

TINY_PNG_BASE64 = base64.b64encode(bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753"
    "de0000000c4944415478da6360000002000155bce9a70000000049454e44ae42"
    "6082"
)).decode("ascii")


def _request_dict(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "context": {
            "schema_version": "operational.v1",
            "request_id": "00000000-0000-0000-0000-000000000000",
            "correlation_id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
            "deadline_at": "2030-01-01T00:00:00Z",
            "deadline_ms": 15000,
            "body_sha256": "a" * 64,
            "scopes": ["ia.reference_turn"],
        },
        "schema_version": "reference-turn.v1",
        "system_instruction": "Eres un analista forense de decoracion de eventos.",
        "message": "Inventaria estas referencias.",
        "images": [
            {"id": "REF_01", "mime": "image/png", "base64": TINY_PNG_BASE64, "descripcion": "foto del cliente"},
        ],
        "tools": [
            {
                "name": "return_reference_inventory",
                "description": "Return structured inventory.",
                "parameters_json_schema": {"type": "object", "properties": {"images": {"type": "array"}}},
            },
        ],
    }
    body.update(overrides)
    return body


def test_reference_turn_request_rejects_blank_message() -> None:
    with pytest.raises(ValueError, match="blank"):
        ReferenceTurnRequest.model_validate(_request_dict(message="   "))


def test_reference_turn_request_accepts_an_audit_sized_turn() -> None:
    # Regression 2026-09-24: the audit pass embeds the whole draft inventory in
    # the message and the catalog mode appends every valid product to the
    # system prompt; a 4k/20k cap rejected real turns with 422.
    payload = ReferenceTurnRequest.model_validate(_request_dict(
        message="Audit the draft inventory below.\n<DRAFT_INVENTORY>" + "x" * 60_000 + "</DRAFT_INVENTORY>",
        system_instruction="Inventory rules.\nVALID CATALOG PRODUCTS\n" + "producto\n" * 10_000,
    ))
    assert len(payload.message) > 60_000


def test_reference_turn_request_requires_at_least_one_image() -> None:
    with pytest.raises(ValueError):
        ReferenceTurnRequest.model_validate(_request_dict(images=[]))


def test_reference_turn_request_rejects_more_than_three_images() -> None:
    image = _request_dict()["images"][0]  # type: ignore[index]
    with pytest.raises(ValueError):
        ReferenceTurnRequest.model_validate(_request_dict(images=[image, image, image, image]))


def test_reference_turn_request_defaults_to_default_model() -> None:
    payload = ReferenceTurnRequest.model_validate(_request_dict())
    assert payload.model == DEFAULT_MODEL


def test_ejecutar_turno_gemini_fails_closed_without_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    payload = ReferenceTurnRequest.model_validate(_request_dict())

    with pytest.raises(ReferenceTurnError) as excinfo:
        asyncio.run(ejecutar_turno_gemini(payload))
    assert excinfo.value.code == "reference_turn_unavailable"
    assert excinfo.value.status_code == 503


def test_ejecutar_turno_gemini_fails_closed_on_invalid_base64(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    payload = ReferenceTurnRequest.model_validate(_request_dict(
        images=[{"id": "REF_01", "mime": "image/png", "base64": "not-valid-base64!!", "descripcion": ""}],
    ))
    with pytest.raises(ReferenceTurnError) as excinfo:
        asyncio.run(ejecutar_turno_gemini(payload))
    assert excinfo.value.code == "reference_turn_invalid_image"
    assert excinfo.value.status_code == 422


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


def _fake_response(text: str, tool_call: dict[str, object] | None) -> object:
    part = SimpleNamespace(function_call=SimpleNamespace(**tool_call) if tool_call else None, text=None)
    content = SimpleNamespace(parts=[part])
    candidate = SimpleNamespace(content=content, finish_reason="STOP")
    usage = SimpleNamespace(
        prompt_token_count=100,
        candidates_token_count=40,
        thoughts_token_count=0,
        cached_content_token_count=0,
        tool_use_prompt_token_count=0,
        total_token_count=140,
    )
    return SimpleNamespace(text=text, candidates=[candidate], usage_metadata=usage, prompt_feedback=None)


def test_ejecutar_turno_gemini_returns_text_tool_calls_and_usage(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    response = _fake_response(
        text='{"images":[]}',
        tool_call={"name": "return_reference_inventory", "args": {"images": []}},
    )
    fake_client = _FakeClient(response)
    payload = ReferenceTurnRequest.model_validate(_request_dict())

    result = asyncio.run(ejecutar_turno_gemini(payload, client_factory=lambda _api_key: fake_client))

    assert result["text"] == '{"images":[]}'
    assert result["tool_calls"] == [{"name": "return_reference_inventory", "args": {"images": []}}]
    assert result["model"] == DEFAULT_MODEL
    assert result["finish_reason"] == "STOP"
    assert result["usage"]["prompt_token_count"] == 100
    call = fake_client.aio.models.calls[0]
    assert call["model"] == DEFAULT_MODEL
    contents = call["contents"]
    assert len(contents) == 1
    parts = contents[0].parts
    # label part, inline image part, final message part
    assert len(parts) == 3


def test_ejecutar_turno_gemini_decodes_base64_to_raw_bytes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    response = _fake_response(text="ok", tool_call=None)
    fake_client = _FakeClient(response)
    payload = ReferenceTurnRequest.model_validate(_request_dict())

    asyncio.run(ejecutar_turno_gemini(payload, client_factory=lambda _api_key: fake_client))

    contents = fake_client.aio.models.calls[0]["contents"]
    image_part = contents[0].parts[1]
    assert image_part.inline_data.data == base64.b64decode(TINY_PNG_BASE64)
    assert image_part.inline_data.mime_type == "image/png"


def test_ejecutar_turno_gemini_wraps_provider_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")

    class _RaisingModels:
        async def generate_content(self, **_kwargs: object) -> object:
            raise RuntimeError("boom")

    class _RaisingClient:
        def __init__(self) -> None:
            self.aio = SimpleNamespace(models=_RaisingModels())

    payload = ReferenceTurnRequest.model_validate(_request_dict())
    with pytest.raises(ReferenceTurnError) as excinfo:
        asyncio.run(ejecutar_turno_gemini(payload, client_factory=lambda _api_key: _RaisingClient()))
    assert excinfo.value.code == "reference_turn_provider_error"
    assert excinfo.value.status_code == 502
