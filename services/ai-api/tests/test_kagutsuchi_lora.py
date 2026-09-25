import asyncio

import pytest

from app.kagutsuchi.lora import (
    LORA_GENERATE_SCHEMA_VERSION,
    LoraGenerateError,
    LoraGenerateRequest,
    generar_lora_fal,
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
            "scopes": ["ia.lora_generate"],
        },
        "schema_version": LORA_GENERATE_SCHEMA_VERSION,
        "mode": "text",
        "prompt": "eventdecor_style_v3, arco de globos dorados en la entrada",
        "loras": [{"path": "loras/eventdecor-style-v3.safetensors", "scale": 1.0}],
        "guidance_scale": 3.5,
        "num_inference_steps": 28,
        "image_width": 1536,
        "image_height": 1024,
        "image_data_urls": [],
    }
    body.update(overrides)
    return body


def test_lora_generate_request_requires_at_least_one_lora() -> None:
    with pytest.raises(ValueError):
        LoraGenerateRequest.model_validate(_request_dict(loras=[]))


def test_lora_generate_request_rejects_more_than_one_lora() -> None:
    lora = {"path": "loras/a.safetensors", "scale": 1.0}
    with pytest.raises(ValueError):
        LoraGenerateRequest.model_validate(_request_dict(loras=[lora, lora]))


def test_lora_generate_request_rejects_more_than_four_images() -> None:
    urls = ["data:image/png;base64,aGVsbG8="] * 5
    with pytest.raises(ValueError):
        LoraGenerateRequest.model_validate(_request_dict(mode="edit", image_data_urls=urls))


def test_generar_lora_fal_fails_closed_without_fal_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("FAL_KEY", raising=False)
    payload = LoraGenerateRequest.model_validate(_request_dict())

    with pytest.raises(LoraGenerateError) as excinfo:
        asyncio.run(generar_lora_fal(payload))
    assert excinfo.value.code == "lora_unavailable"
    assert excinfo.value.status_code == 503


class _FakeResponse:
    def __init__(
        self, status_code: int, json_body: object = None, headers: dict[str, str] | None = None
    ) -> None:
        self.status_code = status_code
        self._json_body = json_body
        self.headers = headers or {}

    def json(self) -> object:
        if self._json_body is None:
            raise ValueError("no json body")
        return self._json_body


class _FakeStreamResponse:
    def __init__(
        self, status_code: int, chunks: list[bytes], headers: dict[str, str] | None = None
    ) -> None:
        self.status_code = status_code
        self.headers = headers or {}
        self._chunks = chunks

    async def aiter_bytes(self):
        for chunk in self._chunks:
            yield chunk

    async def __aenter__(self) -> "_FakeStreamResponse":
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False


class _FakeAsyncClient:
    def __init__(
        self,
        responses: list[_FakeResponse],
        stream_responses: list[_FakeStreamResponse] | None = None,
    ) -> None:
        self._responses = list(responses)
        self._stream_responses = list(stream_responses or [])
        self.requests: list[dict[str, object]] = []

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False

    async def request(
        self, method: str, url: str, *, headers: dict[str, str] | None = None, json: object = None
    ) -> _FakeResponse:
        self.requests.append({"method": method, "url": url, "headers": headers, "json": json})
        return self._responses.pop(0)

    def stream(self, method: str, url: str, **_kwargs: object) -> _FakeStreamResponse:
        self.requests.append({"method": method, "url": url, "stream": True})
        return self._stream_responses.pop(0)


def _submission(request_id: str = "req_123") -> _FakeResponse:
    return _FakeResponse(
        200,
        {
            "request_id": request_id,
            "status_url": "https://queue.fal.run/fal-ai/flux-2/lora/requests/req_123/status",
            "response_url": "https://queue.fal.run/fal-ai/flux-2/lora/requests/req_123",
        },
    )


def _completed_status() -> _FakeResponse:
    return _FakeResponse(200, {"status": "COMPLETED"})


def _result(
    url: str = "https://fal.media/files/abc/image.png", content_type: str | None = "image/png"
) -> _FakeResponse:
    return _FakeResponse(200, {"images": [{"url": url, "content_type": content_type}]})


def _image_stream(content_type: str = "image/png") -> _FakeStreamResponse:
    return _FakeStreamResponse(
        200, [b"\x89PNG", b"restofthebytes"], headers={"content-type": content_type}
    )


def test_generar_lora_fal_happy_path_text_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FAL_KEY", "test-key")
    client = _FakeAsyncClient(
        responses=[_submission(), _completed_status(), _result()],
        stream_responses=[_image_stream()],
    )
    payload = LoraGenerateRequest.model_validate(_request_dict())

    result = asyncio.run(generar_lora_fal(payload, client_factory=lambda: client))

    assert result["image_base64"]
    assert result["mime"] == "image/png"
    assert result["provider_request_id"] == "req_123"
    assert result["endpoint"] == "flux-2/lora"
    submit_call = client.requests[0]
    assert submit_call["url"] == "https://queue.fal.run/fal-ai/flux-2/lora"
    submit_body = submit_call["json"]
    assert isinstance(submit_body, dict)
    assert submit_body["prompt"] == payload.prompt
    assert "image_urls" not in submit_body


def test_generar_lora_fal_edit_mode_forwards_image_urls(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FAL_KEY", "test-key")
    client = _FakeAsyncClient(
        responses=[_submission(), _completed_status(), _result()],
        stream_responses=[_image_stream()],
    )
    payload = LoraGenerateRequest.model_validate(
        _request_dict(
            mode="edit",
            image_data_urls=["data:image/jpeg;base64,aGVsbG8="],
        )
    )

    asyncio.run(generar_lora_fal(payload, client_factory=lambda: client))

    submit_call = client.requests[0]
    assert submit_call["url"] == "https://queue.fal.run/fal-ai/flux-2/lora/edit"
    submit_body = submit_call["json"]
    assert isinstance(submit_body, dict)
    assert submit_body["image_urls"] == ["data:image/jpeg;base64,aGVsbG8="]


def test_generar_lora_fal_polls_until_completed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FAL_KEY", "test-key")
    import app.kagutsuchi.lora as lora_module

    monkeypatch.setattr(lora_module, "POLL_INTERVAL_SECONDS", 0)
    client = _FakeAsyncClient(
        responses=[
            _submission(),
            _FakeResponse(200, {"status": "IN_QUEUE"}),
            _FakeResponse(200, {"status": "IN_PROGRESS"}),
            _completed_status(),
            _result(),
        ],
        stream_responses=[_image_stream()],
    )
    payload = LoraGenerateRequest.model_validate(_request_dict())

    result = asyncio.run(generar_lora_fal(payload, client_factory=lambda: client))

    assert result["image_base64"]


def test_generar_lora_fal_fails_closed_on_generation_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FAL_KEY", "test-key")
    client = _FakeAsyncClient(
        responses=[
            _submission(),
            _FakeResponse(200, {"status": "FAILED", "error": "safety filter rejected the prompt"}),
        ]
    )
    payload = LoraGenerateRequest.model_validate(_request_dict())

    with pytest.raises(LoraGenerateError) as excinfo:
        asyncio.run(generar_lora_fal(payload, client_factory=lambda: client))
    assert excinfo.value.code == "lora_generation_failed"
    assert excinfo.value.provider_detail == "safety filter rejected the prompt"


def test_generar_lora_fal_times_out_when_never_completed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FAL_KEY", "test-key")
    import app.kagutsuchi.lora as lora_module

    monkeypatch.setattr(lora_module, "POLL_DEADLINE_SECONDS", 0)
    client = _FakeAsyncClient(responses=[_submission()])
    payload = LoraGenerateRequest.model_validate(_request_dict())

    with pytest.raises(LoraGenerateError) as excinfo:
        asyncio.run(generar_lora_fal(payload, client_factory=lambda: client))
    assert excinfo.value.code == "lora_timeout"
    assert excinfo.value.status_code == 504


@pytest.mark.parametrize(
    ("status_code", "body", "expected_causa"),
    [
        (402, {"error": "insufficient balance"}, "saldo_agotado"),
        (401, {"detail": "invalid api key"}, "acceso_denegado"),
        (403, {"error": "account locked: billing overdue"}, "saldo_agotado"),
    ],
)
def test_generar_lora_fal_classifies_account_rejected_submissions(
    monkeypatch: pytest.MonkeyPatch,
    status_code: int,
    body: dict[str, object],
    expected_causa: str,
) -> None:
    monkeypatch.setenv("FAL_KEY", "test-key")
    client = _FakeAsyncClient(responses=[_FakeResponse(status_code, body)])
    payload = LoraGenerateRequest.model_validate(_request_dict())

    with pytest.raises(LoraGenerateError) as excinfo:
        asyncio.run(generar_lora_fal(payload, client_factory=lambda: client))
    assert excinfo.value.causa == expected_causa
    assert excinfo.value.provider_status == status_code
    assert excinfo.value.status_code == 503


def test_generar_lora_fal_classifies_generic_submit_rejection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FAL_KEY", "test-key")
    client = _FakeAsyncClient(responses=[_FakeResponse(500, {"error": "internal error"})])
    payload = LoraGenerateRequest.model_validate(_request_dict())

    with pytest.raises(LoraGenerateError) as excinfo:
        asyncio.run(generar_lora_fal(payload, client_factory=lambda: client))
    assert excinfo.value.causa is None
    assert excinfo.value.status_code == 502


def test_generar_lora_fal_rejects_submission_with_disallowed_status_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FAL_KEY", "test-key")
    client = _FakeAsyncClient(
        responses=[
            _FakeResponse(
                200,
                {
                    "request_id": "req_123",
                    "status_url": "https://evil.example.com/status",
                    "response_url": "https://queue.fal.run/fal-ai/flux-2/lora/requests/req_123",
                },
            )
        ]
    )
    payload = LoraGenerateRequest.model_validate(_request_dict())

    with pytest.raises(LoraGenerateError) as excinfo:
        asyncio.run(generar_lora_fal(payload, client_factory=lambda: client))
    assert excinfo.value.code == "lora_invalid_submission"


def test_generar_lora_fal_rejects_image_url_on_disallowed_host(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FAL_KEY", "test-key")
    client = _FakeAsyncClient(
        responses=[
            _submission(),
            _completed_status(),
            _result(url="https://evil.example.com/image.png"),
        ]
    )
    payload = LoraGenerateRequest.model_validate(_request_dict())

    with pytest.raises(LoraGenerateError) as excinfo:
        asyncio.run(generar_lora_fal(payload, client_factory=lambda: client))
    assert excinfo.value.code == "lora_invalid_image_response"


def test_generar_lora_fal_rejects_image_too_large_by_content_length(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FAL_KEY", "test-key")
    client = _FakeAsyncClient(
        responses=[_submission(), _completed_status(), _result()],
        stream_responses=[
            _FakeStreamResponse(
                200, [b"x"], headers={"content-length": "99999999", "content-type": "image/png"}
            )
        ],
    )
    payload = LoraGenerateRequest.model_validate(_request_dict())

    with pytest.raises(LoraGenerateError) as excinfo:
        asyncio.run(generar_lora_fal(payload, client_factory=lambda: client))
    assert excinfo.value.code == "lora_image_too_large"


def test_generar_lora_fal_rejects_disallowed_image_content_type(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FAL_KEY", "test-key")
    client = _FakeAsyncClient(
        responses=[_submission(), _completed_status(), _result(content_type=None)],
        stream_responses=[_image_stream(content_type="text/html")],
    )
    payload = LoraGenerateRequest.model_validate(_request_dict())

    with pytest.raises(LoraGenerateError) as excinfo:
        asyncio.run(generar_lora_fal(payload, client_factory=lambda: client))
    assert excinfo.value.code == "lora_image_type_rejected"


def test_generar_lora_fal_follows_allowed_redirect_on_submit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FAL_KEY", "test-key")
    client = _FakeAsyncClient(
        responses=[
            _FakeResponse(
                302, headers={"location": "https://rest.alpha.fal.ai/fal-ai/flux-2/lora"}
            ),
            _submission(),
            _completed_status(),
            _result(),
        ],
        stream_responses=[_image_stream()],
    )
    payload = LoraGenerateRequest.model_validate(_request_dict())

    result = asyncio.run(generar_lora_fal(payload, client_factory=lambda: client))

    assert result["image_base64"]
    assert client.requests[1]["url"] == "https://rest.alpha.fal.ai/fal-ai/flux-2/lora"


def test_generar_lora_fal_rejects_redirect_to_disallowed_host(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FAL_KEY", "test-key")
    client = _FakeAsyncClient(
        responses=[
            _FakeResponse(302, headers={"location": "https://evil.example.com/fal-ai/flux-2/lora"}),
        ]
    )
    payload = LoraGenerateRequest.model_validate(_request_dict())

    with pytest.raises(LoraGenerateError) as excinfo:
        asyncio.run(generar_lora_fal(payload, client_factory=lambda: client))
    assert excinfo.value.code == "lora_redirect_forbidden_host"


def test_generar_lora_fal_wraps_unexpected_exceptions(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FAL_KEY", "test-key")

    class _BrokenClient:
        async def __aenter__(self) -> "_BrokenClient":
            return self

        async def __aexit__(self, *exc: object) -> bool:
            return False

        async def request(self, *_args: object, **_kwargs: object) -> _FakeResponse:
            raise RuntimeError("connection reset")

    payload = LoraGenerateRequest.model_validate(_request_dict())

    with pytest.raises(LoraGenerateError) as excinfo:
        asyncio.run(generar_lora_fal(payload, client_factory=lambda: _BrokenClient()))
    assert excinfo.value.code == "lora_network_error"
    assert excinfo.value.status_code == 502
