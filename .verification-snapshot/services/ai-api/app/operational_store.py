"""Process-local operational replay/idempotency store for local Stage 4 tests."""

from __future__ import annotations

import json
import re
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Callable, Literal


DEFAULT_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60
MAX_IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60
DEFAULT_NONCE_TTL_SECONDS = 5 * 60
MAX_NONCE_TTL_SECONDS = 24 * 60 * 60
_HASH_RE = re.compile(r"^[a-f0-9]{64}$")
_SCOPE_RE = re.compile(r"^[a-zA-Z0-9._:/-]+$")

IdempotencyState = Literal["in_progress", "completed", "failed"]
ClaimKind = Literal["new", "replay", "conflict", "in_flight"]


@dataclass(frozen=True, slots=True)
class StoredHttpResponse:
    body: dict[str, object]
    status: int
    content_type: str = "application/json"


@dataclass(frozen=True, slots=True)
class IdempotencyRecord:
    scope: str
    idempotency_key: str
    body_sha256: str
    request_id: str
    correlation_id: str
    state: IdempotencyState
    response: StoredHttpResponse | None
    expires_at: float


@dataclass(frozen=True, slots=True)
class ClaimResult:
    kind: ClaimKind
    record: IdempotencyRecord | None = None
    response: StoredHttpResponse | None = None
    existing_body_sha256: str | None = None
    expires_at: float | None = None


@dataclass(frozen=True, slots=True)
class NonceConsumeResult:
    kind: Literal["accepted", "replay"]
    expires_at: float


@dataclass(frozen=True, slots=True)
class NonceCompatibilityResult:
    accepted: bool
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class FinalizeResult:
    kind: Literal["completed", "failed", "already_completed", "already_failed"]
    record: IdempotencyRecord


def _validate_scope(value: str) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= 120 or not _SCOPE_RE.fullmatch(value):
        raise ValueError("OPERATIONAL_STORE_INVALID_INPUT")
    if value != value.strip():
        raise ValueError("OPERATIONAL_STORE_INVALID_INPUT")
    return value


def _validate_key(value: str) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= 200 or value != value.strip():
        raise ValueError("OPERATIONAL_STORE_INVALID_INPUT")
    return value


def _validate_hash(value: str) -> str:
    if not isinstance(value, str) or not _HASH_RE.fullmatch(value):
        raise ValueError("OPERATIONAL_STORE_INVALID_INPUT")
    return value


def _validate_uuid(value: str) -> str:
    try:
        parsed = uuid.UUID(value)
    except (AttributeError, ValueError, TypeError) as error:
        raise ValueError("OPERATIONAL_STORE_INVALID_INPUT") from error
    return str(parsed)


def _validate_ttl(value: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 < value <= maximum:
        raise ValueError("OPERATIONAL_STORE_INVALID_INPUT")
    return value


def _normalize_body(body: dict[str, object]) -> dict[str, object]:
    if not isinstance(body, dict):
        raise ValueError("OPERATIONAL_STORE_INVALID_INPUT")
    try:
        normalized = json.loads(json.dumps(body, ensure_ascii=False, allow_nan=False))
    except (TypeError, ValueError) as error:
        raise ValueError("OPERATIONAL_STORE_INVALID_INPUT") from error
    if not isinstance(normalized, dict):
        raise ValueError("OPERATIONAL_STORE_INVALID_INPUT")
    return normalized


class InMemoryOperationalStore:
    """Thread-safe local store; never considered durable or production-ready."""

    durable = False

    def __init__(
        self,
        *,
        idempotency_ttl_seconds: int = DEFAULT_IDEMPOTENCY_TTL_SECONDS,
        nonce_ttl_seconds: int = DEFAULT_NONCE_TTL_SECONDS,
        max_idempotency_ttl_seconds: int = MAX_IDEMPOTENCY_TTL_SECONDS,
        max_nonce_ttl_seconds: int = MAX_NONCE_TTL_SECONDS,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._max_idempotency_ttl = _validate_ttl(
            max_idempotency_ttl_seconds, MAX_IDEMPOTENCY_TTL_SECONDS
        )
        self._max_nonce_ttl = _validate_ttl(max_nonce_ttl_seconds, MAX_NONCE_TTL_SECONDS)
        self._idempotency_ttl = _validate_ttl(idempotency_ttl_seconds, self._max_idempotency_ttl)
        self._nonce_ttl = _validate_ttl(nonce_ttl_seconds, self._max_nonce_ttl)
        self._clock = clock
        self._nonces: dict[tuple[str, str], float] = {}
        self._records: dict[tuple[str, str], IdempotencyRecord] = {}
        self._lock = threading.RLock()

    def consume_nonce(
        self,
        namespace: str,
        nonce: str,
        *,
        ttl_seconds: int | None = None,
        now: float | None = None,
    ) -> NonceConsumeResult:
        namespace = _validate_scope(namespace)
        nonce = _validate_uuid(nonce)
        ttl = (
            self._nonce_ttl
            if ttl_seconds is None
            else _validate_ttl(ttl_seconds, self._max_nonce_ttl)
        )
        current = self._clock() if now is None else now
        key = (namespace, nonce)
        with self._lock:
            self._cleanup_nonces(current)
            expires_at = self._nonces.get(key)
            if expires_at is not None:
                return NonceConsumeResult("replay", expires_at)
            expires_at = current + ttl
            self._nonces[key] = expires_at
            return NonceConsumeResult("accepted", expires_at)

    def consume(self, nonce: str, *, now: float | None = None) -> NonceCompatibilityResult:
        """Compatibility adapter for ``app.auth.verify_request``."""

        result = self.consume_nonce("internal", nonce, now=now)
        return NonceCompatibilityResult(result.kind == "accepted", result.kind)

    def claim(
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
        current = self._clock() if now is None else now
        key = (scope, idempotency_key)
        with self._lock:
            self._cleanup_records(current)
            existing = self._records.get(key)
            if existing is not None:
                if existing.body_sha256 != body_sha256:
                    return ClaimResult("conflict", existing_body_sha256=existing.body_sha256)
                if existing.state == "in_progress":
                    return ClaimResult("in_flight", expires_at=existing.expires_at)
                if existing.response is None:
                    raise RuntimeError("OPERATIONAL_STORE_CORRUPT_RECORD")
                return ClaimResult("replay", record=existing, response=existing.response)

            record = IdempotencyRecord(
                scope=scope,
                idempotency_key=idempotency_key,
                body_sha256=body_sha256,
                request_id=request_id,
                correlation_id=correlation_id,
                state="in_progress",
                response=None,
                expires_at=current + ttl,
            )
            self._records[key] = record
            return ClaimResult("new", record=record)

    def complete(
        self,
        *,
        scope: str,
        idempotency_key: str,
        body_sha256: str,
        response: StoredHttpResponse,
    ) -> FinalizeResult:
        return self._finalize("completed", scope, idempotency_key, body_sha256, response)

    def fail(
        self,
        *,
        scope: str,
        idempotency_key: str,
        body_sha256: str,
        response: StoredHttpResponse,
    ) -> FinalizeResult:
        return self._finalize("failed", scope, idempotency_key, body_sha256, response)

    def _finalize(
        self,
        state: Literal["completed", "failed"],
        scope: str,
        idempotency_key: str,
        body_sha256: str,
        response: StoredHttpResponse,
    ) -> FinalizeResult:
        scope = _validate_scope(scope)
        idempotency_key = _validate_key(idempotency_key)
        body_sha256 = _validate_hash(body_sha256)
        response = StoredHttpResponse(
            _normalize_body(response.body), response.status, response.content_type
        )
        if not 200 <= response.status <= 599:
            raise ValueError("OPERATIONAL_STORE_INVALID_INPUT")
        if response.content_type not in {"application/json", "application/problem+json"}:
            raise ValueError("OPERATIONAL_STORE_INVALID_INPUT")
        key = (scope, idempotency_key)
        with self._lock:
            record = self._records.get(key)
            if record is None or record.body_sha256 != body_sha256:
                raise ValueError("OPERATIONAL_STORE_NOT_CLAIMED")
            if record.state == "completed":
                return FinalizeResult("already_completed", record)
            if record.state == "failed":
                return FinalizeResult("already_failed", record)
            updated = IdempotencyRecord(
                scope=record.scope,
                idempotency_key=record.idempotency_key,
                body_sha256=record.body_sha256,
                request_id=record.request_id,
                correlation_id=record.correlation_id,
                state=state,
                response=response,
                expires_at=record.expires_at,
            )
            self._records[key] = updated
            return FinalizeResult(state, updated)

    def _cleanup_nonces(self, now: float) -> None:
        expired = [key for key, expires_at in self._nonces.items() if expires_at <= now]
        for key in expired:
            del self._nonces[key]

    def _cleanup_records(self, now: float) -> None:
        expired = [
            key
            for key, record in self._records.items()
            if record.state != "in_progress" and record.expires_at <= now
        ]
        for key in expired:
            del self._records[key]


__all__ = [
    "ClaimResult",
    "FinalizeResult",
    "InMemoryOperationalStore",
    "IdempotencyRecord",
    "NonceCompatibilityResult",
    "NonceConsumeResult",
    "StoredHttpResponse",
]
