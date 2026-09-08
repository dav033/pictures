import asyncio
import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import cast
from uuid import UUID

import pytest

from app.postgres_store import (
    IDEMPOTENCY_DELETE_EXPIRED_SQL,
    IDEMPOTENCY_FINALIZE_SQL,
    IDEMPOTENCY_INSERT_SQL,
    IDEMPOTENCY_SELECT_SQL,
    NONCE_CONSUME_SQL,
    PostgresOperationalStore,
    validate_database_url,
)
from app.operational_store import StoredHttpResponse


NOW = datetime(2030, 1, 1, tzinfo=timezone.utc)
HASH = hashlib.sha256(b"payload").hexdigest()
REQUEST_ID = UUID("00000000-0000-4000-8000-000000000001")
CORRELATION_ID = UUID("00000000-0000-4000-8000-000000000002")


class FakeTransaction:
    async def __aenter__(self) -> "FakeTransaction":
        return self

    async def __aexit__(self, *_: object) -> None:
        return None


class FakeConnection:
    def __init__(self) -> None:
        self.nonces: dict[tuple[str, UUID], datetime] = {}
        self.records: dict[tuple[str, str], dict[str, object]] = {}

    def transaction(self) -> FakeTransaction:
        return FakeTransaction()

    async def fetchval(self, query: str, *_: object) -> object:
        assert query == "SELECT 1"
        return 1

    async def execute(self, query: str, *args: object) -> str:
        assert query == IDEMPOTENCY_DELETE_EXPIRED_SQL
        scope, key = cast(tuple[str, str], args)
        record = self.records.get((scope, key))
        if record and record["state"] != "in_progress" and record["expires_at"] <= NOW:
            del self.records[(scope, key)]
            return "DELETE 1"
        return "DELETE 0"

    async def fetchrow(self, query: str, *args: object) -> dict[str, object] | None:
        if query == NONCE_CONSUME_SQL:
            namespace, nonce, ttl = cast(tuple[str, UUID, int], args)
            key = (namespace, nonce)
            existing = self.nonces.get(key)
            if existing is not None and existing > NOW:
                return {"expires_at": existing, "accepted": False}
            expires_at = NOW + timedelta(seconds=ttl)
            self.nonces[key] = expires_at
            return {"expires_at": expires_at, "accepted": True}

        if query == IDEMPOTENCY_INSERT_SQL:
            scope, key, body, request_id, correlation_id, ttl = args
            record_key = (cast(str, scope), cast(str, key))
            if record_key in self.records:
                return None
            row = {
                "scope": scope,
                "idempotency_key": key,
                "body_sha256": body,
                "request_id": request_id,
                "correlation_id": correlation_id,
                "state": "in_progress",
                "response_body": None,
                "response_status": None,
                "response_content_type": None,
                "expires_at": NOW + timedelta(seconds=cast(int, ttl)),
            }
            self.records[record_key] = row
            return row.copy()

        if query == IDEMPOTENCY_SELECT_SQL:
            scope, key = cast(tuple[str, str], args)
            record = self.records.get((scope, key))
            return None if record is None else record.copy()

        if query == IDEMPOTENCY_FINALIZE_SQL:
            scope, key, state, body, status, content_type, body_sha256 = args
            record = self.records.get((cast(str, scope), cast(str, key)))
            if record is None or record["body_sha256"] != body_sha256:
                return None
            raw_body = cast(str, body)
            record.update(
                {
                    "state": state,
                    "response_body": json.loads(raw_body),
                    "response_status": status,
                    "response_content_type": content_type,
                }
            )
            return record.copy()

        raise AssertionError(f"unexpected query: {query}")


class FakeAcquire:
    def __init__(self, connection: FakeConnection) -> None:
        self.connection = connection

    async def __aenter__(self) -> FakeConnection:
        return self.connection

    async def __aexit__(self, *_: object) -> None:
        return None


class FakePool:
    def __init__(self) -> None:
        self.connection = FakeConnection()

    def acquire(self) -> FakeAcquire:
        return FakeAcquire(self.connection)

    async def close(self) -> None:
        return None


def run(coroutine: object) -> object:
    return asyncio.run(cast("asyncio.Future[object]", coroutine))


def test_database_url_validation_is_fail_closed() -> None:
    assert validate_database_url("postgresql://user:password@localhost/demo")
    assert validate_database_url("postgres://localhost/demo")
    for value in ("", "sqlite:///tmp/demo.db", "postgresql://", "postgresql://host"):
        with pytest.raises(ValueError, match="INVALID_DATABASE_URL"):
            validate_database_url(value)


def test_postgres_store_is_async_and_preserves_operational_semantics() -> None:
    pool = FakePool()
    store = PostgresOperationalStore(
        "postgresql://localhost/demo",
        pool=pool,
        idempotency_ttl_seconds=10,
        nonce_ttl_seconds=5,
    )

    async def scenario() -> None:
        assert await store.check_ready()
        nonce = await store.consume_nonce("ai-api", str(REQUEST_ID))
        assert nonce.kind == "accepted"
        assert (await store.consume_nonce("ai-api", str(REQUEST_ID))).kind == "replay"

        first = await store.claim(
            scope="ai.echo",
            idempotency_key="same",
            body_sha256=HASH,
            request_id=str(REQUEST_ID),
            correlation_id=str(CORRELATION_ID),
        )
        assert first.kind == "new"
        assert (
            await store.claim(
                scope="ai.echo",
                idempotency_key="same",
                body_sha256=HASH,
                request_id=str(REQUEST_ID),
                correlation_id=str(CORRELATION_ID),
            )
        ).kind == "in_flight"
        assert (
            await store.claim(
                scope="ai.echo",
                idempotency_key="same",
                body_sha256="b" * 64,
                request_id=str(REQUEST_ID),
                correlation_id=str(CORRELATION_ID),
            )
        ).kind == "conflict"

        completed = await store.complete(
            scope="ai.echo",
            idempotency_key="same",
            body_sha256=HASH,
            response=StoredHttpResponse({"ok": True}, 200),
        )
        assert completed.kind == "completed"
        replay = await store.claim(
            scope="ai.echo",
            idempotency_key="same",
            body_sha256=HASH,
            request_id=str(REQUEST_ID),
            correlation_id=str(CORRELATION_ID),
        )
        assert replay.kind == "replay"
        assert replay.response == StoredHttpResponse({"ok": True}, 200)

    run(scenario())


def test_postgres_store_requires_started_pool_without_credentials() -> None:
    store = PostgresOperationalStore("postgresql://localhost/demo")

    async def scenario() -> None:
        assert not await store.check_ready()
        with pytest.raises(RuntimeError, match="POSTGRES_STORE_NOT_STARTED"):
            await store.consume_nonce("ai-api", str(REQUEST_ID))

    run(scenario())
