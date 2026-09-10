"""Durable async PostgreSQL store for operational replay and idempotency."""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Mapping
from contextlib import AbstractAsyncContextManager
from datetime import datetime, timezone
from typing import Literal, Protocol, cast
from urllib.parse import urlsplit
from uuid import UUID

import asyncpg

from app.operational_store import (
    DEFAULT_IDEMPOTENCY_TTL_SECONDS,
    DEFAULT_NONCE_TTL_SECONDS,
    MAX_IDEMPOTENCY_TTL_SECONDS,
    MAX_NONCE_TTL_SECONDS,
    ClaimResult,
    FinalizeResult,
    IdempotencyRecord,
    NonceConsumeResult,
    StoredHttpResponse,
    _normalize_body,
    _validate_hash,
    _validate_key,
    _validate_scope,
    _validate_ttl,
    _validate_uuid,
)


logger = logging.getLogger("decoracion.ai_api.postgres_store")
DEFAULT_POOL_MIN_SIZE = 1
DEFAULT_POOL_MAX_SIZE = 10
DEFAULT_COMMAND_TIMEOUT_SECONDS = 5.0


class AsyncConnection(Protocol):
    def transaction(self) -> AbstractAsyncContextManager[object]: ...

    async def fetchrow(self, query: str, *args: object) -> Mapping[str, object] | None: ...

    async def fetchval(self, query: str, *args: object) -> object: ...

    async def execute(self, query: str, *args: object) -> str: ...


class AsyncPool(Protocol):
    def acquire(self) -> AbstractAsyncContextManager[AsyncConnection]: ...

    async def close(self) -> None: ...


NONCE_CONSUME_SQL = """
WITH inserted AS (
  INSERT INTO operational_request_nonces (namespace, nonce, expires_at)
  VALUES ($1, $2::uuid, CURRENT_TIMESTAMP + ($3::double precision * INTERVAL '1 second'))
  ON CONFLICT (namespace, nonce) DO UPDATE
    SET expires_at = EXCLUDED.expires_at,
        consumed_at = CURRENT_TIMESTAMP
    WHERE operational_request_nonces.expires_at <= CURRENT_TIMESTAMP
  RETURNING expires_at, TRUE AS accepted
)
SELECT expires_at, accepted
FROM inserted
UNION ALL
SELECT expires_at, FALSE AS accepted
FROM operational_request_nonces
WHERE namespace = $1
  AND nonce = $2::uuid
  AND NOT EXISTS (SELECT 1 FROM inserted)
LIMIT 1
"""

IDEMPOTENCY_DELETE_EXPIRED_SQL = """
DELETE FROM operational_idempotency
WHERE scope = $1
  AND idempotency_key = $2
  AND state <> 'in_progress'
  AND expires_at <= CURRENT_TIMESTAMP
"""

IDEMPOTENCY_INSERT_SQL = """
INSERT INTO operational_idempotency (
  scope, idempotency_key, body_sha256, request_id, correlation_id,
  state, response_body, response_status, response_content_type, expires_at
)
VALUES (
  $1, $2, $3, $4::uuid, $5::uuid,
  'in_progress', NULL, NULL, NULL,
  CURRENT_TIMESTAMP + ($6::double precision * INTERVAL '1 second')
)
ON CONFLICT (scope, idempotency_key) DO NOTHING
RETURNING scope, idempotency_key, body_sha256, request_id, correlation_id,
          state, response_body, response_status, response_content_type, expires_at
"""

IDEMPOTENCY_SELECT_SQL = """
SELECT scope, idempotency_key, body_sha256, request_id, correlation_id,
       state, response_body, response_status, response_content_type, expires_at
FROM operational_idempotency
WHERE scope = $1 AND idempotency_key = $2
FOR UPDATE
"""

IDEMPOTENCY_FINALIZE_SQL = """
UPDATE operational_idempotency
SET state = $3,
    response_body = $4::jsonb,
    response_status = $5,
    response_content_type = $6,
    updated_at = CURRENT_TIMESTAMP
WHERE scope = $1 AND idempotency_key = $2 AND body_sha256 = $7
RETURNING scope, idempotency_key, body_sha256, request_id, correlation_id,
          state, response_body, response_status, response_content_type, expires_at
"""

CLEANUP_SQL = """
WITH idempotency_deleted AS (
  DELETE FROM operational_idempotency
   WHERE state <> 'in_progress' AND expires_at <= CURRENT_TIMESTAMP
  RETURNING 1
), nonce_deleted AS (
  DELETE FROM operational_request_nonces
  WHERE expires_at <= CURRENT_TIMESTAMP
  RETURNING 1
)
SELECT
  (SELECT count(*) FROM idempotency_deleted) AS idempotency_deleted,
  (SELECT count(*) FROM nonce_deleted) AS nonce_deleted
"""


def validate_database_url(value: str) -> str:
    """Validate a PostgreSQL DSN without exposing credentials in errors/logs."""

    if not isinstance(value, str) or not value.strip() or any(char.isspace() for char in value):
        raise ValueError("INVALID_DATABASE_URL")
    candidate = value.strip()
    try:
        parsed = urlsplit(candidate)
        port = parsed.port
    except ValueError as error:
        raise ValueError("INVALID_DATABASE_URL") from error
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise ValueError("INVALID_DATABASE_URL")
    if not parsed.hostname or not parsed.path.strip("/") or parsed.fragment:
        raise ValueError("INVALID_DATABASE_URL")
    if port is not None and not 1 <= port <= 65535:
        raise ValueError("INVALID_DATABASE_URL")
    return candidate


def database_url_from_env() -> str | None:
    """Read and validate DATABASE_URL, returning None when it is not configured."""

    value = os.getenv("DATABASE_URL")
    if value is None or not value.strip():
        return None
    return validate_database_url(value)


def _epoch(value: object) -> float:
    if not isinstance(value, datetime):
        raise RuntimeError("POSTGRES_STORE_INVALID_TIMESTAMP")
    timestamp = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    return timestamp.astimezone(timezone.utc).timestamp()


def _count(value: object) -> int:
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    raise RuntimeError("POSTGRES_STORE_CORRUPT_CLEANUP_RESULT")


def _response_from_row(row: Mapping[str, object]) -> StoredHttpResponse:
    raw_body = row["response_body"]
    if isinstance(raw_body, str):
        try:
            raw_body = json.loads(raw_body)
        except json.JSONDecodeError as error:
            raise RuntimeError("POSTGRES_STORE_CORRUPT_RESPONSE") from error
    if not isinstance(raw_body, dict):
        raise RuntimeError("POSTGRES_STORE_CORRUPT_RESPONSE")
    status = row["response_status"]
    content_type = row["response_content_type"]
    if not isinstance(status, int) or not isinstance(content_type, str):
        raise RuntimeError("POSTGRES_STORE_CORRUPT_RESPONSE")
    return StoredHttpResponse(_normalize_body(raw_body), status, content_type)


def _record_from_row(row: Mapping[str, object]) -> IdempotencyRecord:
    raw_state = row["state"]
    if raw_state not in {"in_progress", "completed", "failed"}:
        raise RuntimeError("POSTGRES_STORE_CORRUPT_RECORD")
    state = cast(Literal["in_progress", "completed", "failed"], raw_state)
    response = None if state == "in_progress" else _response_from_row(row)
    return IdempotencyRecord(
        scope=str(row["scope"]),
        idempotency_key=str(row["idempotency_key"]),
        body_sha256=str(row["body_sha256"]),
        request_id=str(row["request_id"]),
        correlation_id=str(row["correlation_id"]),
        state=state,
        response=response,
        expires_at=_epoch(row["expires_at"]),
    )


class PostgresOperationalStore:
    """Async PostgreSQL implementation of the operational store contract."""

    durable = True

    def __init__(
        self,
        database_url: str,
        *,
        idempotency_ttl_seconds: int = DEFAULT_IDEMPOTENCY_TTL_SECONDS,
        nonce_ttl_seconds: int = DEFAULT_NONCE_TTL_SECONDS,
        max_idempotency_ttl_seconds: int = MAX_IDEMPOTENCY_TTL_SECONDS,
        max_nonce_ttl_seconds: int = MAX_NONCE_TTL_SECONDS,
        pool_min_size: int = DEFAULT_POOL_MIN_SIZE,
        pool_max_size: int = DEFAULT_POOL_MAX_SIZE,
        command_timeout_seconds: float = DEFAULT_COMMAND_TIMEOUT_SECONDS,
        pool: AsyncPool | None = None,
    ) -> None:
        self.database_url = validate_database_url(database_url)
        self._max_idempotency_ttl = _validate_ttl(
            max_idempotency_ttl_seconds, MAX_IDEMPOTENCY_TTL_SECONDS
        )
        self._max_nonce_ttl = _validate_ttl(max_nonce_ttl_seconds, MAX_NONCE_TTL_SECONDS)
        self._idempotency_ttl = _validate_ttl(idempotency_ttl_seconds, self._max_idempotency_ttl)
        self._nonce_ttl = _validate_ttl(nonce_ttl_seconds, self._max_nonce_ttl)
        if isinstance(pool_min_size, bool) or not 1 <= pool_min_size <= 32:
            raise ValueError("INVALID_DATABASE_POOL_SIZE")
        if isinstance(pool_max_size, bool) or not pool_min_size <= pool_max_size <= 64:
            raise ValueError("INVALID_DATABASE_POOL_SIZE")
        if not 0 < command_timeout_seconds <= 60:
            raise ValueError("INVALID_DATABASE_COMMAND_TIMEOUT")
        self._pool_min_size = pool_min_size
        self._pool_max_size = pool_max_size
        self._command_timeout_seconds = command_timeout_seconds
        self._pool = pool
        self._owns_pool = pool is None

    @classmethod
    def from_env(cls) -> "PostgresOperationalStore | None":
        database_url = database_url_from_env()
        return None if database_url is None else cls(database_url)

    async def start(self) -> None:
        if self._pool is not None:
            return
        created_pool = await asyncpg.create_pool(
            dsn=self.database_url,
            min_size=self._pool_min_size,
            max_size=self._pool_max_size,
            command_timeout=self._command_timeout_seconds,
        )
        self._pool = cast(AsyncPool, created_pool)

    async def close(self) -> None:
        pool = self._pool
        self._pool = None
        if pool is not None and self._owns_pool:
            await pool.close()

    async def check_ready(self) -> bool:
        pool = self._pool
        if pool is None:
            return False
        try:
            async with pool.acquire() as connection:
                return (await connection.fetchval("SELECT 1")) == 1
        except Exception as error:
            logger.warning(
                "postgres operational store readiness check failed: %s", type(error).__name__
            )
            return False

    async def consume_nonce(
        self,
        namespace: str,
        nonce: str,
        *,
        ttl_seconds: int | None = None,
        now: float | None = None,
    ) -> NonceConsumeResult:
        del now
        namespace = _validate_scope(namespace)
        nonce = _validate_uuid(nonce)
        ttl = (
            self._nonce_ttl
            if ttl_seconds is None
            else _validate_ttl(ttl_seconds, self._max_nonce_ttl)
        )
        pool = self._require_pool()
        async with pool.acquire() as connection:
            row = await connection.fetchrow(NONCE_CONSUME_SQL, namespace, UUID(nonce), ttl)
        if row is None:
            raise RuntimeError("POSTGRES_STORE_CORRUPT_NONCE_RESULT")
        return NonceConsumeResult(
            "accepted" if bool(row["accepted"]) else "replay",
            _epoch(row["expires_at"]),
        )

    async def claim(
        self,
        *,
        scope: str,
        idempotency_key: str,
        body_sha256: str,
        request_id: str,
        correlation_id: str,
        ttl_seconds: int | None = None,
        now: float | None = None,
    ) -> ClaimResult:
        del now
        scope = _validate_scope(scope)
        idempotency_key = _validate_key(idempotency_key)
        body_sha256 = _validate_hash(body_sha256)
        request_id = _validate_uuid(request_id)
        correlation_id = _validate_uuid(correlation_id)
        ttl = (
            self._idempotency_ttl
            if ttl_seconds is None
            else _validate_ttl(ttl_seconds, self._max_idempotency_ttl)
        )
        pool = self._require_pool()
        async with pool.acquire() as connection:
            async with connection.transaction():
                await connection.execute(IDEMPOTENCY_DELETE_EXPIRED_SQL, scope, idempotency_key)
                inserted = await connection.fetchrow(
                    IDEMPOTENCY_INSERT_SQL,
                    scope,
                    idempotency_key,
                    body_sha256,
                    UUID(request_id),
                    UUID(correlation_id),
                    ttl,
                )
                if inserted is not None:
                    return ClaimResult("new", record=_record_from_row(inserted))
                existing = await connection.fetchrow(IDEMPOTENCY_SELECT_SQL, scope, idempotency_key)
        if existing is None:
            raise RuntimeError("POSTGRES_STORE_CLAIM_RACE")
        record = _record_from_row(existing)
        if record.body_sha256 != body_sha256:
            return ClaimResult("conflict", existing_body_sha256=record.body_sha256)
        if record.state == "in_progress":
            return ClaimResult("in_flight", expires_at=record.expires_at)
        if record.response is None:
            raise RuntimeError("POSTGRES_STORE_CORRUPT_RECORD")
        return ClaimResult("replay", record=record, response=record.response)

    async def complete(
        self,
        *,
        scope: str,
        idempotency_key: str,
        body_sha256: str,
        response: StoredHttpResponse,
    ) -> FinalizeResult:
        return await self._finalize("completed", scope, idempotency_key, body_sha256, response)

    async def fail(
        self,
        *,
        scope: str,
        idempotency_key: str,
        body_sha256: str,
        response: StoredHttpResponse,
    ) -> FinalizeResult:
        return await self._finalize("failed", scope, idempotency_key, body_sha256, response)

    async def _finalize(
        self,
        state: str,
        scope: str,
        idempotency_key: str,
        body_sha256: str,
        response: StoredHttpResponse,
    ) -> FinalizeResult:
        if state not in {"completed", "failed"}:
            raise ValueError("OPERATIONAL_STORE_INVALID_INPUT")
        scope = _validate_scope(scope)
        idempotency_key = _validate_key(idempotency_key)
        body_sha256 = _validate_hash(body_sha256)
        normalized_response = StoredHttpResponse(
            _normalize_body(response.body), response.status, response.content_type
        )
        if not 200 <= normalized_response.status <= 599:
            raise ValueError("OPERATIONAL_STORE_INVALID_INPUT")
        if normalized_response.content_type not in {
            "application/json",
            "application/problem+json",
        }:
            raise ValueError("OPERATIONAL_STORE_INVALID_INPUT")
        encoded_body = json.dumps(normalized_response.body, ensure_ascii=False, allow_nan=False)
        pool = self._require_pool()
        async with pool.acquire() as connection:
            async with connection.transaction():
                existing = await connection.fetchrow(IDEMPOTENCY_SELECT_SQL, scope, idempotency_key)
                if existing is None or str(existing["body_sha256"]) != body_sha256:
                    raise ValueError("OPERATIONAL_STORE_NOT_CLAIMED")
                record = _record_from_row(existing)
                if record.state == "completed":
                    return FinalizeResult("already_completed", record)
                if record.state == "failed":
                    return FinalizeResult("already_failed", record)
                updated = await connection.fetchrow(
                    IDEMPOTENCY_FINALIZE_SQL,
                    scope,
                    idempotency_key,
                    state,
                    encoded_body,
                    normalized_response.status,
                    normalized_response.content_type,
                    body_sha256,
                )
        if updated is None:
            raise RuntimeError("POSTGRES_STORE_FINALIZE_RACE")
        final_state = cast(Literal["completed", "failed"], state)
        return FinalizeResult(final_state, _record_from_row(updated))

    async def cleanup(self) -> tuple[int, int]:
        """Delete expired completed/failed operations and consumed nonces."""

        pool = self._require_pool()
        async with pool.acquire() as connection:
            row = await connection.fetchrow(CLEANUP_SQL)
        if row is None:
            raise RuntimeError("POSTGRES_STORE_CORRUPT_CLEANUP_RESULT")
        return _count(row["idempotency_deleted"]), _count(row["nonce_deleted"])

    def _require_pool(self) -> AsyncPool:
        if self._pool is None:
            raise RuntimeError("POSTGRES_STORE_NOT_STARTED")
        return self._pool


__all__ = ["PostgresOperationalStore", "database_url_from_env", "validate_database_url"]
