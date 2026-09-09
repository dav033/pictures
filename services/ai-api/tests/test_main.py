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
    RerankRequest,
    Settings,
    build_signature,
    create_app,
)
from app import main as main_module
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
