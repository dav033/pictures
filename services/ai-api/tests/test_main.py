import asyncio
import hashlib
import json
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID

from fastapi.testclient import TestClient

import sys

sys.path.insert(0, str(Path(__file__).parents[1]))

from app.main import (
    MAX_BODY_BYTES,
    EchoRequest,
    EmbeddingRequest,
    IntentParseRequest,
    LoraGenerateRequest,
    RerankRequest,
    Settings,
    build_signature,
    create_app,
)
from app import main as main_module
from app.happie.generacion import HappieGenerateRequest
from app.operational_store import InMemoryOperationalStore


SECRET = "t" * 32
NONCE = UUID("00000000-0000-0000-0000-000000000000")


def _body(
    scopes: list[str] | None = None,
    *,
    idempotency_key: str | None = None,
    deadline_ms: int = 1000,
    deadline_at: str = "2030-01-01T00:00:00Z",
    payload: dict[str, object] | None = None,
    request_id: str = "00000000-0000-0000-0000-000000000000",
    correlation_id: str = "ffffffff-ffff-ffff-ffff-ffffffffffff",
) -> bytes:
    selected_payload = payload or {"message": "hello"}
    payload_hash = hashlib.sha256(
        json.dumps(selected_payload, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()
    context: dict[str, object] = {
        "schema_version": "operational.v1",
        "request_id": request_id,
        "correlation_id": correlation_id,
        "deadline_at": deadline_at,
        "deadline_ms": deadline_ms,
        "body_sha256": payload_hash,
        "scopes": scopes or ["ai.echo"],
    }
    if idempotency_key is not None:
        context["idempotency_key"] = idempotency_key
    return json.dumps(
        {"context": context, "payload": selected_payload},
        separators=(",", ":"),
    ).encode()


def _headers(
    body: bytes,
    scopes: list[str] | None = None,
    *,
    nonce: UUID = NONCE,
    path: str = "/internal/v1/echo",
) -> dict[str, str]:
    selected_scopes = scopes or ["ai.echo"]
    timestamp = int(time.time())
    return {
        "content-type": "application/json",
        "x-internal-schema-version": "operational.v1",
        "x-internal-timestamp": str(timestamp),
        "x-internal-nonce": str(nonce),
        "x-internal-scopes": ",".join(selected_scopes),
        "x-internal-signature": build_signature(
            secret=SECRET,
            method="POST",
            path=path,
            timestamp=timestamp,
            nonce=nonce,
            scopes=selected_scopes,
            body=body,
        ),
    }


def _rerank_body(
    scopes: list[str] | None = None,
    *,
    idempotency_key: str | None = None,
    deadline_ms: int = 1000,
    deadline_at: str = "2030-01-01T00:00:00Z",
    query: str = "ramo de rosas",
    candidates: list[dict[str, str]] | None = None,
    request_id: str = "00000000-0000-0000-0000-000000000000",
    correlation_id: str = "ffffffff-ffff-ffff-ffff-ffffffffffff",
) -> bytes:
    operation_payload: dict[str, object] = {
        "query": query,
        "candidates": candidates
        if candidates is not None
        else [
            {"id": "prod-1", "text": "Ramo de rosas rojas"},
            {"id": "prod-2", "text": "Arreglo de girasoles"},
        ],
    }
    payload_hash = hashlib.sha256(
        json.dumps(operation_payload, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()
    context: dict[str, object] = {
        "schema_version": "operational.v1",
        "request_id": request_id,
        "correlation_id": correlation_id,
        "deadline_at": deadline_at,
        "deadline_ms": deadline_ms,
        "body_sha256": payload_hash,
        "scopes": scopes or ["ai.rerank"],
    }
    if idempotency_key is not None:
        context["idempotency_key"] = idempotency_key
    return json.dumps(
        {"context": context, **operation_payload},
        separators=(",", ":"),
    ).encode()


def _embedding_body(
    scopes: list[str] | None = None,
    *,
    text: str = "ramo de rosas",
    idempotency_key: str | None = None,
    request_id: str = "00000000-0000-0000-0000-000000000000",
    correlation_id: str = "ffffffff-ffff-ffff-ffff-ffffffffffff",
) -> bytes:
    operation_payload = {"text": text, "task_type": "RETRIEVAL_QUERY"}
    context = {
        "schema_version": "operational.v1",
        "request_id": request_id,
        "correlation_id": correlation_id,
        "deadline_at": "2030-01-01T00:00:00Z",
        "deadline_ms": 1000,
        "body_sha256": hashlib.sha256(
            json.dumps(operation_payload, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest(),
        "scopes": scopes or ["ai.embedding"],
    }
    if idempotency_key is not None:
        context["idempotency_key"] = idempotency_key
    return json.dumps(
        {"context": context, **operation_payload},
        separators=(",", ":"),
    ).encode()


def _intent_parse_body(
    scopes: list[str] | None = None,
    *,
    message: str = "algo elegante en dorado y blanco",
    idempotency_key: str | None = None,
    request_id: str = "00000000-0000-0000-0000-000000000000",
    correlation_id: str = "ffffffff-ffff-ffff-ffff-ffffffffffff",
) -> bytes:
    operation_payload: dict[str, object] = {
        "schema_version": "intent-parse.v1",
        "message": message,
        "system_instruction": "Interpretas mensajes de clientes.",
        "response_json_schema": {"type": "object"},
    }
    context: dict[str, object] = {
        "schema_version": "operational.v1",
        "request_id": request_id,
        "correlation_id": correlation_id,
        "deadline_at": "2030-01-01T00:00:00Z",
        "deadline_ms": 1000,
        "body_sha256": hashlib.sha256(
            json.dumps(operation_payload, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest(),
        "scopes": scopes or ["ia.intent_parse"],
    }
    if idempotency_key is not None:
        context["idempotency_key"] = idempotency_key
    return json.dumps(
        {"context": context, **operation_payload},
        separators=(",", ":"),
    ).encode()


def test_healthz_is_public() -> None:
    client = TestClient(create_app(Settings(environment="test", hmac_secret=SECRET)))
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_production_without_secret_is_not_ready() -> None:
    client = TestClient(create_app(Settings(environment="production")))
    response = client.get("/readyz")
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "not_ready"


def test_production_short_secret_is_not_ready() -> None:
    client = TestClient(create_app(Settings(environment="production", hmac_secret="short")))
    response = client.get("/readyz")
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "not_ready"


def test_production_with_secret_without_durable_nonce_store_is_not_ready() -> None:
    client = TestClient(create_app(Settings(environment="production", hmac_secret=SECRET)))
    response = client.get("/readyz")
    assert response.status_code == 503


def test_rerank_warmup_failure_keeps_readiness_fail_closed(monkeypatch) -> None:
    async def failed_warmup() -> None:
        raise RuntimeError("model unavailable")

    monkeypatch.setattr(main_module, "_warm_rerank_model", failed_warmup)
    monkeypatch.setenv("RERANK_MODEL_WARMUP", "1")
    store = InMemoryOperationalStore()

    with TestClient(
        create_app(Settings(environment="test", hmac_secret=SECRET), operational_store=store)
    ) as client:
        response = client.get("/readyz")

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "not_ready"


def test_echo_requires_valid_hmac_and_scope() -> None:
    client = TestClient(create_app(Settings(environment="test", hmac_secret=SECRET)))
    body = _body()
    response = client.post("/internal/v1/echo", content=body, headers=_headers(body))
    assert response.status_code == 200
    assert response.json()["payload"] == {"message": "hello"}

    bad_headers = _headers(body)
    bad_headers["x-internal-signature"] = "0" * 64
    assert client.post("/internal/v1/echo", content=body, headers=bad_headers).status_code == 401

    missing_scope_body = _body(["other.scope"])
    missing_scope_headers = _headers(missing_scope_body, ["other.scope"])
    assert (
        client.post(
            "/internal/v1/echo", content=missing_scope_body, headers=missing_scope_headers
        ).status_code
        == 403
    )


def test_invalid_auth_has_stable_error_and_ids() -> None:
    client = TestClient(create_app(Settings(environment="test", hmac_secret=SECRET)))
    body = _body()
    headers = _headers(body)
    headers["x-internal-signature"] = "0" * 64
    headers["x-request-id"] = "00000000-0000-4000-8000-000000000001"
    headers["x-correlation-id"] = "00000000-0000-4000-8000-000000000002"

    response = client.post("/internal/v1/echo", content=body, headers=headers)

    assert response.status_code == 401
    assert response.json() == {
        "detail": {
            "code": "invalid_signature",
            "request_id": "00000000-0000-4000-8000-000000000001",
            "correlation_id": "00000000-0000-4000-8000-000000000002",
        }
    }
    assert response.headers["x-request-id"] == headers["x-request-id"]


def test_nonce_is_one_use_even_when_body_matches() -> None:
    client = TestClient(create_app(Settings(environment="test", hmac_secret=SECRET)))
    body = _body()
    headers = _headers(body)

    assert client.post("/internal/v1/echo", content=body, headers=headers).status_code == 200
    replay = client.post("/internal/v1/echo", content=body, headers=headers)

    assert replay.status_code == 401
    assert replay.json()["detail"]["code"] == "nonce_replay"


def test_idempotency_replay_and_conflict() -> None:
    store = InMemoryOperationalStore()
    client = TestClient(
        create_app(Settings(environment="test", hmac_secret=SECRET), operational_store=store)
    )
    body = _body(idempotency_key="echo-1")
    first = client.post(
        "/internal/v1/echo",
        content=body,
        headers=_headers(body, nonce=UUID("00000000-0000-4000-8000-000000000001")),
    )
    replay_body = _body(
        idempotency_key="echo-1",
        request_id="00000000-0000-4000-8000-000000000001",
        correlation_id="00000000-0000-4000-8000-000000000002",
    )
    replay = client.post(
        "/internal/v1/echo",
        content=replay_body,
        headers=_headers(replay_body, nonce=UUID("00000000-0000-4000-8000-000000000002")),
    )
    conflict_body = _body(idempotency_key="echo-1", payload={"message": "different"})
    conflict = client.post(
        "/internal/v1/echo",
        content=conflict_body,
        headers=_headers(conflict_body, nonce=UUID("00000000-0000-4000-8000-000000000003")),
    )

    assert first.status_code == 200
    assert replay.status_code == 200
    assert replay.headers["x-idempotency-result"] == "replay"
    assert replay.json() == first.json()
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "idempotency_conflict"


def test_idempotency_in_flight_is_stable() -> None:
    store = InMemoryOperationalStore()
    client = TestClient(
        create_app(Settings(environment="test", hmac_secret=SECRET), operational_store=store)
    )
    body = _body(idempotency_key="already-running")
    store.claim(
        scope="ai.echo",
        idempotency_key="already-running",
        body_sha256=hashlib.sha256(b'{"message":"hello"}').hexdigest(),
        request_id="00000000-0000-4000-8000-000000000001",
        correlation_id="00000000-0000-4000-8000-000000000002",
    )

    response = client.post(
        "/internal/v1/echo",
        content=body,
        headers=_headers(body, nonce=UUID("00000000-0000-4000-8000-000000000006")),
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "idempotency_in_flight"


def test_body_size_error_is_stable_before_auth() -> None:
    client = TestClient(create_app(Settings(environment="test", hmac_secret=SECRET)))

    response = client.post("/internal/v1/echo", content=b"x" * (MAX_BODY_BYTES + 1))

    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "body_too_large"


def test_timeout_is_stable_and_failed_idempotency_replays() -> None:
    async def slow_echo(_: EchoRequest) -> dict[str, object]:
        await asyncio.sleep(0.05)
        return {"payload": {"slow": True}}

    store = InMemoryOperationalStore()
    client = TestClient(
        create_app(
            Settings(environment="test", hmac_secret=SECRET),
            operational_store=store,
            echo_handler=slow_echo,
        )
    )
    deadline = (
        (datetime.now(timezone.utc) + timedelta(seconds=1)).isoformat().replace("+00:00", "Z")
    )
    body = _body(idempotency_key="timeout-1", deadline_ms=10, deadline_at=deadline)
    first = client.post(
        "/internal/v1/echo",
        content=body,
        headers=_headers(body, nonce=UUID("00000000-0000-4000-8000-000000000004")),
    )
    replay = client.post(
        "/internal/v1/echo",
        content=body,
        headers=_headers(body, nonce=UUID("00000000-0000-4000-8000-000000000005")),
    )

    assert first.status_code == 408
    assert first.json()["detail"]["code"] == "deadline_exceeded"
    assert replay.status_code == 408
    assert replay.json()["detail"]["code"] == "deadline_exceeded"


def test_echo_rejects_invalid_operational_context() -> None:
    client = TestClient(create_app(Settings(environment="test", hmac_secret=SECRET)))
    body = _body()
    invalid_body = body.replace(b'"schema_version":"operational.v1"', b'"schema_version":"wrong"')
    response = client.post(
        "/internal/v1/echo", content=invalid_body, headers=_headers(invalid_body)
    )
    assert response.status_code == 422


def test_operational_context_rejects_body_hash_mismatch() -> None:
    body = json.loads(_body())
    body["context"]["body_sha256"] = "0" * 64
    invalid_body = json.dumps(body, separators=(",", ":")).encode()
    client = TestClient(create_app(Settings(environment="test", hmac_secret=SECRET)))

    response = client.post(
        "/internal/v1/echo",
        content=invalid_body,
        headers=_headers(invalid_body),
    )

    assert response.status_code == 422


async def _stub_rerank_handler(payload: RerankRequest) -> dict[str, object]:
    # Deterministic reversal, not the real cross-encoder: proves the shared
    # /internal/v1/* boundary wires a distinct handler/scope through
    # correctly, without loading sentence-transformers/torch in this test.
    ordered = list(reversed(payload.candidates))
    return {
        "payload": {
            "order": [candidate.id for candidate in ordered],
            "scores": {candidate.id: float(index) for index, candidate in enumerate(ordered)},
        }
    }


async def _stub_embedding_handler(payload: EmbeddingRequest) -> dict[str, object]:
    return {
        "payload": {
            "values": [0.1, 0.2],
            "model": "gemini-embedding-2",
            "dimensions": 2,
            "task_type": payload.task_type,
            "attempts": [{"attempt": 1, "result": "ok", "elapsed_ms": 0}],
        }
    }


async def _failed_embedding_handler(payload: EmbeddingRequest) -> dict[str, object]:
    del payload
    raise main_module._error(
        "embedding_provider_unavailable",
        503,
        {
            "attempts": [
                {"attempt": 1, "result": "error", "elapsed_ms": 4},
                {"attempt": 2, "result": "error", "elapsed_ms": 8},
                {"attempt": 3, "result": "error", "elapsed_ms": 12},
            ]
        },
    )


def test_embedding_requires_its_own_scope_and_returns_vector() -> None:
    client = TestClient(
        create_app(
            Settings(environment="test", hmac_secret=SECRET),
            embedding_handler=_stub_embedding_handler,
        )
    )
    body = _embedding_body()
    response = client.post(
        "/internal/v1/embed",
        content=body,
        headers=_headers(body, ["ai.embedding"], path="/internal/v1/embed"),
    )
    assert response.status_code == 200
    assert response.json()["payload"]["values"] == [0.1, 0.2]

    bad_scope_body = _embedding_body(["ai.rerank"])
    bad_scope = client.post(
        "/internal/v1/embed",
        content=bad_scope_body,
        headers=_headers(bad_scope_body, ["ai.rerank"], path="/internal/v1/embed"),
    )
    assert bad_scope.status_code == 403


def test_embedding_failure_preserves_attempts_for_idempotency_replay() -> None:
    store = InMemoryOperationalStore()
    client = TestClient(
        create_app(
            Settings(environment="test", hmac_secret=SECRET),
            operational_store=store,
            embedding_handler=_failed_embedding_handler,
        )
    )
    body = _embedding_body(idempotency_key="failed-embedding")
    first = client.post(
        "/internal/v1/embed",
        content=body,
        headers=_headers(body, ["ai.embedding"], path="/internal/v1/embed"),
    )
    replay = client.post(
        "/internal/v1/embed",
        content=body,
        headers=_headers(
            body,
            ["ai.embedding"],
            path="/internal/v1/embed",
            nonce=UUID("00000000-0000-4000-8000-000000000001"),
        ),
    )

    expected_attempts = [
        {"attempt": 1, "result": "error", "elapsed_ms": 4},
        {"attempt": 2, "result": "error", "elapsed_ms": 8},
        {"attempt": 3, "result": "error", "elapsed_ms": 12},
    ]
    assert first.status_code == 503
    assert first.json()["detail"]["attempts"] == expected_attempts
    assert replay.status_code == 503
    assert replay.json()["detail"]["attempts"] == expected_attempts


async def _stub_intent_parse_handler(payload: IntentParseRequest) -> dict[str, object]:
    return {
        "payload": {
            "text": json.dumps({"filtros_duros": {}, "semantic_query": payload.message}),
            "model": payload.model,
            "usage": {"prompt_token_count": 3, "candidates_token_count": 2},
        }
    }


def test_intent_parse_requires_its_own_scope_and_returns_text() -> None:
    client = TestClient(
        create_app(
            Settings(environment="test", hmac_secret=SECRET),
            intent_parse_handler=_stub_intent_parse_handler,
        )
    )
    body = _intent_parse_body()
    response = client.post(
        "/internal/v1/ia/intent-parse",
        content=body,
        headers=_headers(body, ["ia.intent_parse"], path="/internal/v1/ia/intent-parse"),
    )
    assert response.status_code == 200
    assert "semantic_query" in response.json()["payload"]["text"]

    bad_scope_body = _intent_parse_body(["ai.rerank"])
    bad_scope = client.post(
        "/internal/v1/ia/intent-parse",
        content=bad_scope_body,
        headers=_headers(bad_scope_body, ["ai.rerank"], path="/internal/v1/ia/intent-parse"),
    )
    assert bad_scope.status_code == 403


def _happie_generate_body(scopes: list[str] | None = None, *, catalog_chars: int = 10) -> bytes:
    operation_payload: dict[str, object] = {
        "schema_version": "happie-generate.v1",
        "purpose": "package_recommend",
        "parts": ["Descripción del cliente: boda para 80", "Paquetes disponibles (JSON): " + "x" * catalog_chars],
        "system_instruction": "Recomiendas paquetes de eventos.",
        "response_json_schema": {"type": "object"},
    }
    context: dict[str, object] = {
        "schema_version": "operational.v1",
        "request_id": "00000000-0000-0000-0000-000000000000",
        "correlation_id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
        "deadline_at": "2030-01-01T00:00:00Z",
        "deadline_ms": 1000,
        "body_sha256": hashlib.sha256(
            json.dumps(operation_payload, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest(),
        "scopes": scopes or ["ia.happie_generate"],
    }
    return json.dumps({"context": context, **operation_payload}, separators=(",", ":")).encode()


async def _stub_happie_generate_handler(payload: HappieGenerateRequest) -> dict[str, object]:
    return {
        "payload": {
            "text": json.dumps({"recomendaciones": [], "resumen": payload.purpose}),
            "model": payload.model,
            "usage": None,
        }
    }


def test_happie_generate_requires_its_own_scope_and_accepts_a_catalog_above_64kb() -> None:
    client = TestClient(
        create_app(
            Settings(environment="test", hmac_secret=SECRET),
            happie_generate_handler=_stub_happie_generate_handler,
        )
    )
    path = "/internal/v1/ia/happie-generate"
    # A Happia catalog does not fit the 64KB cap the other text operations share.
    body = _happie_generate_body(catalog_chars=MAX_BODY_BYTES * 2)
    response = client.post(path, content=body, headers=_headers(body, ["ia.happie_generate"], path=path))
    assert response.status_code == 200
    assert json.loads(response.json()["payload"]["text"])["resumen"] == "package_recommend"

    bad_scope_body = _happie_generate_body(["ia.intent_parse"])
    bad_scope = client.post(
        path,
        content=bad_scope_body,
        headers=_headers(
            bad_scope_body,
            ["ia.intent_parse"],
            nonce=UUID("00000000-0000-4000-8000-0000000000a1"),
            path=path,
        ),
    )
    assert bad_scope.status_code == 403


def _lora_generate_body(
    scopes: list[str] | None = None,
    *,
    idempotency_key: str | None = None,
    request_id: str = "00000000-0000-0000-0000-000000000000",
    correlation_id: str = "ffffffff-ffff-ffff-ffff-ffffffffffff",
) -> bytes:
    operation_payload: dict[str, object] = {
        "schema_version": "lora-generate.v1",
        "mode": "text",
        "prompt": "eventdecor_style_v3, arco de globos dorados en la entrada",
        "loras": [{"path": "loras/eventdecor-style-v3.safetensors", "scale": 1.0}],
        "guidance_scale": 3.5,
        "num_inference_steps": 28,
        "image_width": 1536,
        "image_height": 1024,
        "image_data_urls": [],
    }
    context: dict[str, object] = {
        "schema_version": "operational.v1",
        "request_id": request_id,
        "correlation_id": correlation_id,
        "deadline_at": "2030-01-01T00:00:00Z",
        "deadline_ms": 1000,
        "body_sha256": hashlib.sha256(
            json.dumps(operation_payload, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest(),
        "scopes": scopes or ["ia.lora_generate"],
    }
    if idempotency_key is not None:
        context["idempotency_key"] = idempotency_key
    return json.dumps(
        {"context": context, **operation_payload},
        separators=(",", ":"),
    ).encode()


async def _stub_lora_generate_handler(payload: LoraGenerateRequest) -> dict[str, object]:
    return {
        "payload": {
            "image_base64": "aGVsbG8=",
            "mime": "image/png",
            "provider_request_id": "req_123",
            "endpoint": "flux-2/lora" if payload.mode == "text" else "flux-2/lora/edit",
        }
    }


async def _failed_lora_generate_handler(payload: LoraGenerateRequest) -> dict[str, object]:
    del payload
    raise main_module._error(
        "lora_account_saldo_agotado",
        503,
        {"provider_status": 402, "provider_detail": "insufficient balance"},
    )


def test_lora_generate_requires_its_own_scope_and_returns_image() -> None:
    client = TestClient(
        create_app(
            Settings(environment="test", hmac_secret=SECRET),
            lora_generate_handler=_stub_lora_generate_handler,
        )
    )
    body = _lora_generate_body()
    response = client.post(
        "/internal/v1/ia/lora-generate",
        content=body,
        headers=_headers(body, ["ia.lora_generate"], path="/internal/v1/ia/lora-generate"),
    )
    assert response.status_code == 200
    assert response.json()["payload"]["endpoint"] == "flux-2/lora"

    bad_scope_body = _lora_generate_body(["ai.rerank"])
    bad_scope = client.post(
        "/internal/v1/ia/lora-generate",
        content=bad_scope_body,
        headers=_headers(bad_scope_body, ["ai.rerank"], path="/internal/v1/ia/lora-generate"),
    )
    assert bad_scope.status_code == 403


def test_lora_generate_propagates_provider_status_and_detail_on_account_rejection() -> None:
    client = TestClient(
        create_app(
            Settings(environment="test", hmac_secret=SECRET),
            lora_generate_handler=_failed_lora_generate_handler,
        )
    )
    body = _lora_generate_body()
    response = client.post(
        "/internal/v1/ia/lora-generate",
        content=body,
        headers=_headers(body, ["ia.lora_generate"], path="/internal/v1/ia/lora-generate"),
    )
    assert response.status_code == 503
    detail = response.json()["detail"]
    assert detail["code"] == "lora_account_saldo_agotado"
    assert detail["provider_status"] == 402
    assert detail["provider_detail"] == "insufficient balance"


CHAT_STREAM_PATH = "/internal/v1/ia/chat-turn-stream"


def _chat_stream_body(
    scopes: list[str] | None = None,
    *,
    idempotency_key: str | None = None,
    deadline_ms: int = 1000,
) -> bytes:
    operation_payload: dict[str, object] = {
        "schema_version": "chat-turn-stream.v1",
        "system_instruction": "Eres un asesor de decoración.",
        "contents": [{"role": "user", "parts": [{"text": "hola"}]}],
    }
    context: dict[str, object] = {
        "schema_version": "operational.v1",
        "request_id": "00000000-0000-0000-0000-000000000000",
        "correlation_id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
        "deadline_at": "2030-01-01T00:00:00Z",
        "deadline_ms": deadline_ms,
        "body_sha256": hashlib.sha256(
            json.dumps(operation_payload, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest(),
        "scopes": scopes or ["ia.chat_turn_stream"],
    }
    if idempotency_key is not None:
        context["idempotency_key"] = idempotency_key
    return json.dumps({"context": context, **operation_payload}, separators=(",", ":")).encode()


def _chat_stream_client(handler: object) -> TestClient:
    return TestClient(
        create_app(Settings(environment="test", hmac_secret=SECRET), chat_turn_stream_handler=handler)  # type: ignore[arg-type]
    )


def _post_chat_stream(client: TestClient, body: bytes, scopes: list[str] | None = None) -> object:
    return client.post(
        CHAT_STREAM_PATH,
        content=body,
        headers=_headers(body, scopes or ["ia.chat_turn_stream"], path=CHAT_STREAM_PATH),
    )


def _ndjson(response: object) -> list[dict[str, object]]:
    return [json.loads(line) for line in response.text.splitlines() if line]  # type: ignore[attr-defined]


def _events_handler(*events: dict[str, object]):  # type: ignore[no-untyped-def]
    def open_stream(payload: object):  # type: ignore[no-untyped-def]
        del payload

        async def generator():  # type: ignore[no-untyped-def]
            for event in events:
                yield event

        return generator()

    return open_stream


def test_chat_stream_streams_ndjson_events_and_requires_its_scope() -> None:
    client = _chat_stream_client(_events_handler(
        {"type": "text", "delta": "Hola"},
        {"type": "end", "text": "Hola", "tool_calls": [], "usage_metadata": {}, "model": "m", "finish_reason": "STOP", "block_reason": None},
        {"type": "text", "delta": "nunca se envía"},
    ))
    response = _post_chat_stream(client, _chat_stream_body())

    assert response.status_code == 200  # type: ignore[attr-defined]
    assert response.headers["content-type"].startswith("application/x-ndjson")  # type: ignore[attr-defined]
    assert response.headers["cache-control"] == "no-store"  # type: ignore[attr-defined]
    assert response.headers["x-request-id"]  # type: ignore[attr-defined]
    events = _ndjson(response)
    assert [event["type"] for event in events] == ["text", "end"]

    bad_scope_body = _chat_stream_body(["ai.rerank"])
    assert _post_chat_stream(client, bad_scope_body, ["ai.rerank"]).status_code == 403  # type: ignore[attr-defined]


def test_chat_stream_rejects_idempotency_keys_instead_of_replaying_a_turn() -> None:
    client = _chat_stream_client(_events_handler({"type": "end", "text": "", "tool_calls": []}))
    response = _post_chat_stream(client, _chat_stream_body(idempotency_key="turno-1"))

    assert response.status_code == 422  # type: ignore[attr-defined]
    assert response.json()["detail"]["code"] == "idempotency_not_supported"  # type: ignore[attr-defined]


def test_chat_stream_failure_before_opening_is_a_plain_http_error() -> None:
    def open_stream(payload: object):  # type: ignore[no-untyped-def]
        del payload
        raise main_module._error("chat_turn_unavailable", 503)

    response = _post_chat_stream(_chat_stream_client(open_stream), _chat_stream_body())

    assert response.status_code == 503  # type: ignore[attr-defined]
    assert response.json()["detail"]["code"] == "chat_turn_unavailable"  # type: ignore[attr-defined]


def test_chat_stream_without_terminal_event_ends_with_an_error_event() -> None:
    response = _post_chat_stream(_chat_stream_client(_events_handler({"type": "text", "delta": "a medias"})), _chat_stream_body())

    events = _ndjson(response)
    assert events[0] == {"type": "text", "delta": "a medias"}
    assert events[-1] == {"type": "error", "code": "internal_error", "phase": "stream"}


def test_chat_stream_enforces_the_signed_deadline() -> None:
    def open_stream(payload: object):  # type: ignore[no-untyped-def]
        del payload

        async def generator():  # type: ignore[no-untyped-def]
            yield {"type": "text", "delta": "empezando"}
            await asyncio.sleep(5)
            yield {"type": "end", "text": "", "tool_calls": []}

        return generator()

    response = _post_chat_stream(_chat_stream_client(open_stream), _chat_stream_body(deadline_ms=200))

    events = _ndjson(response)
    assert events[0]["type"] == "text"
    assert events[-1] == {"type": "error", "code": "deadline_exceeded", "phase": "stream"}


def test_chat_stream_disconnect_closes_the_event_generator() -> None:
    closed = threading.Event()

    def open_stream(payload: object):  # type: ignore[no-untyped-def]
        del payload

        async def generator():  # type: ignore[no-untyped-def]
            try:
                yield {"type": "text", "delta": "primero"}
                await asyncio.sleep(30)
                yield {"type": "end", "text": "", "tool_calls": []}
            finally:
                closed.set()

        return generator()

    app = create_app(Settings(environment="test", hmac_secret=SECRET), chat_turn_stream_handler=open_stream)  # type: ignore[arg-type]
    body = _chat_stream_body(deadline_ms=60000)
    headers = _headers(body, ["ia.chat_turn_stream"], path=CHAT_STREAM_PATH)

    async def run() -> list[dict[str, object]]:
        first_chunk = asyncio.Event()
        request_sent = False
        sent: list[dict[str, object]] = []

        async def receive() -> dict[str, object]:
            nonlocal request_sent
            if not request_sent:
                request_sent = True
                return {"type": "http.request", "body": body, "more_body": False}
            await first_chunk.wait()
            return {"type": "http.disconnect"}

        async def send(message: dict[str, object]) -> None:
            sent.append(message)
            if message["type"] == "http.response.body" and message.get("body"):
                first_chunk.set()

        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": CHAT_STREAM_PATH,
            "raw_path": CHAT_STREAM_PATH.encode(),
            "query_string": b"",
            "root_path": "",
            "headers": [(key.lower().encode(), value.encode()) for key, value in headers.items()],
            "client": ("127.0.0.1", 1234),
            "server": ("127.0.0.1", 8000),
        }
        async with main_module_lifespan(app):
            await asyncio.wait_for(app(scope, receive, send), timeout=10)
        return sent

    sent = asyncio.run(run())

    assert sent[0]["status"] == 200
    assert closed.is_set(), "a disconnect must close the generator (and with it the provider stream)"


class main_module_lifespan:
    """Runs the app's lifespan around a raw ASGI call, as uvicorn would."""

    def __init__(self, app: object) -> None:
        self._app = app
        self._context: object = None

    async def __aenter__(self) -> None:
        self._context = self._app.router.lifespan_context(self._app)  # type: ignore[attr-defined]
        await self._context.__aenter__()  # type: ignore[attr-defined]

    async def __aexit__(self, *exc: object) -> None:
        await self._context.__aexit__(*exc)  # type: ignore[attr-defined]


def test_rerank_requires_valid_hmac_and_its_own_scope() -> None:
    client = TestClient(
        create_app(
            Settings(environment="test", hmac_secret=SECRET),
            rerank_handler=_stub_rerank_handler,
        )
    )
    body = _rerank_body()
    response = client.post(
        "/internal/v1/rerank",
        content=body,
        headers=_headers(body, ["ai.rerank"], path="/internal/v1/rerank"),
    )
    assert response.status_code == 200
    assert response.json()["payload"]["order"] == ["prod-2", "prod-1"]
    assert response.json()["payload"]["scores"] == {"prod-2": 0.0, "prod-1": 1.0}

    bad_headers = _headers(body, ["ai.rerank"], path="/internal/v1/rerank")
    bad_headers["x-internal-signature"] = "0" * 64
    assert client.post("/internal/v1/rerank", content=body, headers=bad_headers).status_code == 401


def test_rerank_and_echo_scopes_are_independent() -> None:
    # The load-bearing fix in Fase 8.2: required_scope used to be a single
    # app-wide Settings value. A signature scoped for echo must not satisfy
    # rerank, and vice versa -- each route now requires its own scope.
    client = TestClient(
        create_app(
            Settings(environment="test", hmac_secret=SECRET),
            rerank_handler=_stub_rerank_handler,
        )
    )
    rerank_payload = _rerank_body(["ai.echo"])
    echo_scoped_on_rerank = client.post(
        "/internal/v1/rerank",
        content=rerank_payload,
        headers=_headers(rerank_payload, ["ai.echo"], path="/internal/v1/rerank"),
    )
    assert echo_scoped_on_rerank.status_code == 403
    assert echo_scoped_on_rerank.json()["detail"]["code"] == "insufficient_scope"

    echo_payload = _body(["ai.rerank"])
    rerank_scoped_on_echo = client.post(
        "/internal/v1/echo",
        content=echo_payload,
        headers=_headers(echo_payload, ["ai.rerank"], path="/internal/v1/echo"),
    )
    assert rerank_scoped_on_echo.status_code == 403
    assert rerank_scoped_on_echo.json()["detail"]["code"] == "insufficient_scope"


def test_rerank_idempotency_replay() -> None:
    store = InMemoryOperationalStore()
    client = TestClient(
        create_app(
            Settings(environment="test", hmac_secret=SECRET),
            operational_store=store,
            rerank_handler=_stub_rerank_handler,
        )
    )
    body = _rerank_body(idempotency_key="rerank-1")
    first = client.post(
        "/internal/v1/rerank",
        content=body,
        headers=_headers(
            body,
            ["ai.rerank"],
            nonce=UUID("00000000-0000-4000-8000-000000000010"),
            path="/internal/v1/rerank",
        ),
    )
    replay_body = _rerank_body(
        idempotency_key="rerank-1",
        request_id="00000000-0000-4000-8000-000000000001",
        correlation_id="00000000-0000-4000-8000-000000000002",
    )
    replay = client.post(
        "/internal/v1/rerank",
        content=replay_body,
        headers=_headers(
            replay_body,
            ["ai.rerank"],
            nonce=UUID("00000000-0000-4000-8000-000000000011"),
            path="/internal/v1/rerank",
        ),
    )

    assert first.status_code == 200
    assert replay.status_code == 200
    assert replay.headers["x-idempotency-result"] == "replay"
    assert replay.json() == first.json()


def test_rerank_never_changes_the_candidate_set() -> None:
    # The contract from PLAN-MAESTRO-V2 Fase 8.2: reranking may only reorder
    # the candidates PostgreSQL already authorized, never add or remove one.
    client = TestClient(
        create_app(
            Settings(environment="test", hmac_secret=SECRET),
            rerank_handler=_stub_rerank_handler,
        )
    )
    candidates = [
        {"id": "a", "text": "uno"},
        {"id": "b", "text": "dos"},
        {"id": "c", "text": "tres"},
    ]
    body = _rerank_body(candidates=candidates)
    response = client.post(
        "/internal/v1/rerank",
        content=body,
        headers=_headers(body, ["ai.rerank"], path="/internal/v1/rerank"),
    )
    assert response.status_code == 200
    order = response.json()["payload"]["order"]
    assert set(order) == {"a", "b", "c"}
    assert len(order) == len(candidates)


def test_rerank_rejects_duplicate_ids_and_invalid_text() -> None:
    client = TestClient(
        create_app(
            Settings(environment="test", hmac_secret=SECRET),
            rerank_handler=_stub_rerank_handler,
        )
    )
    duplicate_body = _rerank_body(
        candidates=[{"id": "a", "text": "uno"}, {"id": "a", "text": "dos"}]
    )
    duplicate = client.post(
        "/internal/v1/rerank",
        content=duplicate_body,
        headers=_headers(duplicate_body, ["ai.rerank"], path="/internal/v1/rerank"),
    )
    empty_query_body = _rerank_body(query="")
    empty_query = client.post(
        "/internal/v1/rerank",
        content=empty_query_body,
        headers=_headers(
            empty_query_body,
            ["ai.rerank"],
            nonce=UUID("00000000-0000-4000-8000-000000000012"),
            path="/internal/v1/rerank",
        ),
    )
    assert duplicate.status_code == 422
    assert empty_query.status_code == 422

    blank_text_body = _rerank_body(candidates=[{"id": "a", "text": "   "}])
    blank_text = client.post(
        "/internal/v1/rerank",
        content=blank_text_body,
        headers=_headers(
            blank_text_body,
            ["ai.rerank"],
            nonce=UUID("00000000-0000-4000-8000-000000000013"),
            path="/internal/v1/rerank",
        ),
    )
    assert blank_text.status_code == 422


def test_default_rerank_handler_runs_outside_event_loop(monkeypatch) -> None:
    payload = RerankRequest.model_validate_json(_rerank_body())
    caller_thread = threading.get_ident()
    worker_threads: list[int] = []

    def fake_worker(_: RerankRequest) -> dict[str, object]:
        worker_threads.append(threading.get_ident())
        return {"payload": {"order": [], "scores": {}}}

    monkeypatch.setattr(main_module, "_rerank_in_worker", fake_worker)
    result = asyncio.run(main_module._default_rerank_handler(payload))

    assert result["payload"] == {"order": [], "scores": {}}
    assert worker_threads and worker_threads[0] != caller_thread


# --- modos_admitidos in an error body (ADR-0028 §10) --------------------------------

_ESTILOS = [
    {"modo": "anillos", "direcciones": ["longitudinal", "transversal"], "espejo": False},
    {"modo": "degradado", "direcciones": ["longitudinal", "transversal", "diagonal"], "espejo": False},
    {"modo": "flor", "direcciones": ["longitudinal"], "espejo": True},
]


def _metadata_with_styles(styles: object) -> dict[str, object]:
    error = main_module._error(
        "patron_invalido",
        422,
        {"estructura_id": "EST_01", "motivo": "material_sin_uso", "mensaje": "m", "modos_admitidos": styles},
    )
    return main_module._detail_metadata(error)


def test_error_details_carry_the_pattern_styles_rebuilt_from_known_values() -> None:
    metadata = _metadata_with_styles(_ESTILOS)

    assert metadata["modos_admitidos"] == _ESTILOS
    assert metadata["modos_admitidos"] is not _ESTILOS
    # A piece that admits no pattern says so with an empty list.
    assert _metadata_with_styles([])["modos_admitidos"] == []


def test_error_details_drop_malformed_pattern_styles_whole() -> None:
    valid = {"modo": "anillos", "direcciones": ["longitudinal"], "espejo": False}
    malformed: list[object] = [
        "anillos",
        {"modo": "anillos"},
        [valid, "x"],
        [{**valid, "extra": 1}],
        [{**valid, "modo": "rombos"}],
        [{**valid, "modo": ["anillos"]}],
        [valid, valid],
        [{**valid, "direcciones": []}],
        [{**valid, "direcciones": ["arriba"]}],
        [{**valid, "direcciones": ["longitudinal", "longitudinal"]}],
        [{**valid, "direcciones": [["longitudinal"]]}],
        [{**valid, "direcciones": "longitudinal"}],
        [{**valid, "espejo": 1}],
        [{**valid, "modo": modo} for modo in (*main_module._PATTERN_MODES, "espiral")],
    ]

    for value in malformed:
        metadata = _metadata_with_styles(value)
        assert "modos_admitidos" not in metadata, value
        assert metadata["motivo"] == "material_sin_uso"
