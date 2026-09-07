"""Transport authentication compatible with the operational.v1 TypeScript contract."""

from __future__ import annotations

import hashlib
import hmac
import re
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Iterable, Mapping


CONTRACT_VERSION = "operational.v1"
SIGNATURE_SKEW_SECONDS = 300
MIN_SECRET_BYTES = 32
_SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
_SCOPE_RE = re.compile(r"^[a-zA-Z0-9._:/-]+$")


class AuthenticationError(ValueError):
    """Raised when an internal transport authentication value is invalid."""


def _validate_secret(secret: str) -> None:
    if not isinstance(secret, str):
        raise AuthenticationError("INTERNAL_AUTH_SECRET_INVALID")
    if len(secret.encode("utf-8")) < MIN_SECRET_BYTES:
        raise AuthenticationError("INTERNAL_AUTH_SECRET_TOO_SHORT")


def _validate_scopes(scopes: Iterable[str]) -> list[str]:
    if isinstance(scopes, (str, bytes, bytearray)):
        raise AuthenticationError("INTERNAL_AUTH_SCOPES_INVALID")
    values = list(scopes)
    if len(values) > 32:
        raise AuthenticationError("INTERNAL_AUTH_SCOPES_INVALID")
    normalized: list[str] = []
    for scope in values:
        if not isinstance(scope, str):
            raise AuthenticationError("INTERNAL_AUTH_SCOPES_INVALID")
        value = scope.strip()
        if not 1 <= len(value) <= 120 or not _SCOPE_RE.fullmatch(value):
            raise AuthenticationError("INTERNAL_AUTH_SCOPES_INVALID")
        normalized.append(value)
    return normalized


def _validate_body_sha256(body_sha256: str) -> None:
    if not isinstance(body_sha256, str) or not _SHA256_RE.fullmatch(body_sha256):
        raise AuthenticationError("INTERNAL_AUTH_BODY_SHA256_INVALID")


def _validate_nonce(nonce: object) -> None:
    if not isinstance(nonce, str):
        raise AuthenticationError("INTERNAL_AUTH_NONCE_INVALID")
    if not re.fullmatch(
        r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", nonce
    ):
        raise AuthenticationError("INTERNAL_AUTH_NONCE_INVALID")
    try:
        uuid.UUID(nonce)
    except (AttributeError, ValueError, TypeError) as error:
        raise AuthenticationError("INTERNAL_AUTH_NONCE_INVALID") from error


def _validate_timestamp(timestamp: object) -> None:
    if isinstance(timestamp, bool) or not isinstance(timestamp, int) or timestamp <= 0:
        raise AuthenticationError("INTERNAL_AUTH_TIMESTAMP_INVALID")


def sha256_body(body: str | bytes | bytearray | memoryview) -> str:
    """Return the lowercase SHA-256 digest used by the transport contract."""

    if isinstance(body, str):
        payload = body.encode("utf-8")
    elif isinstance(body, (bytes, bytearray, memoryview)):
        payload = bytes(body)
    else:
        raise AuthenticationError("INTERNAL_AUTH_BODY_INVALID")
    return hashlib.sha256(payload).hexdigest()


def canonical_signature_input(
    *,
    timestamp: int,
    nonce: str,
    method: str,
    path: str,
    body_sha256: str,
    scopes: Iterable[str],
) -> str:
    """Build the exact operational.v1 signing string."""

    _validate_timestamp(timestamp)
    _validate_nonce(nonce)
    if not isinstance(method, str) or not method:
        raise AuthenticationError("INTERNAL_AUTH_METHOD_INVALID")
    if not isinstance(path, str) or not path:
        raise AuthenticationError("INTERNAL_AUTH_PATH_INVALID")
    _validate_body_sha256(body_sha256)
    validated_scopes = _validate_scopes(scopes)
    return ".".join(
        (
            str(timestamp),
            nonce,
            method.upper(),
            path,
            body_sha256,
            ",".join(sorted(validated_scopes)),
        )
    )


def _signature_payload(
    *,
    secret: str,
    timestamp: int,
    nonce: str,
    method: str,
    path: str,
    body_sha256: str,
    scopes: Iterable[str],
) -> str:
    _validate_secret(secret)
    canonical = canonical_signature_input(
        timestamp=timestamp,
        nonce=nonce,
        method=method,
        path=path,
        body_sha256=body_sha256,
        scopes=scopes,
    )
    return hmac.new(secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()


def sign_request(
    *,
    secret: str,
    method: str,
    path: str,
    body_sha256: str,
    scopes: Iterable[str] = (),
    timestamp: int | None = None,
    nonce: str | None = None,
) -> dict[str, object]:
    """Create an InternalRequestSignatureV1-compatible mapping."""

    resolved_timestamp = int(time.time()) if timestamp is None else timestamp
    resolved_nonce = str(uuid.uuid4()) if nonce is None else nonce
    resolved_scopes = _validate_scopes(scopes)
    signature = _signature_payload(
        secret=secret,
        timestamp=resolved_timestamp,
        nonce=resolved_nonce,
        method=method,
        path=path,
        body_sha256=body_sha256,
        scopes=resolved_scopes,
    )
    return {
        "schema_version": CONTRACT_VERSION,
        "timestamp": resolved_timestamp,
        "nonce": resolved_nonce,
        "signature": signature,
        "scopes": resolved_scopes,
    }


@dataclass(frozen=True)
class NonceStoreResult:
    accepted: bool
    reason: str | None = None


class InMemoryNonceStore:
    """Process-local nonce store for transport replay protection."""

    def __init__(self, ttl_seconds: int = SIGNATURE_SKEW_SECONDS) -> None:
        if isinstance(ttl_seconds, bool) or not isinstance(ttl_seconds, int) or ttl_seconds <= 0:
            raise ValueError("NONCE_TTL_INVALID")
        self._ttl_seconds = ttl_seconds
        self._nonces: dict[str, float] = {}
        self._lock = threading.Lock()

    def consume(self, nonce: str, *, now: float | None = None) -> NonceStoreResult:
        _validate_nonce(nonce)
        current = time.time() if now is None else now
        with self._lock:
            expired = [key for key, expires_at in self._nonces.items() if expires_at <= current]
            for key in expired:
                del self._nonces[key]
            if nonce in self._nonces:
                return NonceStoreResult(accepted=False, reason="replay")
            self._nonces[nonce] = current + self._ttl_seconds
        return NonceStoreResult(accepted=True)


def _parse_signature(signature: Mapping[str, object]) -> tuple[int, str, str, list[str]]:
    if not isinstance(signature, Mapping):
        raise AuthenticationError("INTERNAL_AUTH_SIGNATURE_INVALID")
    if set(signature) != {"schema_version", "timestamp", "nonce", "signature", "scopes"}:
        raise AuthenticationError("INTERNAL_AUTH_SIGNATURE_INVALID")
    if signature.get("schema_version") != CONTRACT_VERSION:
        raise AuthenticationError("INTERNAL_AUTH_SIGNATURE_INVALID")
    timestamp = signature.get("timestamp")
    nonce = signature.get("nonce")
    value = signature.get("signature")
    scopes = signature.get("scopes")
    _validate_timestamp(timestamp)
    _validate_nonce(nonce)
    if not isinstance(timestamp, int) or not isinstance(nonce, str):
        raise AuthenticationError("INTERNAL_AUTH_SIGNATURE_INVALID")
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value):
        raise AuthenticationError("INTERNAL_AUTH_SIGNATURE_INVALID")
    if not isinstance(scopes, list):
        raise AuthenticationError("INTERNAL_AUTH_SIGNATURE_INVALID")
    return timestamp, nonce, value, _validate_scopes(scopes)


def verify_request(
    *,
    secret: str,
    signature: Mapping[str, object],
    method: str,
    path: str,
    body_sha256: str,
    now_seconds: int | None = None,
    max_skew_seconds: int = SIGNATURE_SKEW_SECONDS,
    required_scopes: Iterable[str] = (),
    nonce_store: InMemoryNonceStore | None = None,
) -> bool:
    """Verify signature and, when supplied, consume nonce atomically."""

    try:
        _validate_secret(secret)
        timestamp, nonce, received, scopes = _parse_signature(signature)
        now = int(time.time()) if now_seconds is None else now_seconds
        if (
            isinstance(max_skew_seconds, bool)
            or not isinstance(max_skew_seconds, int)
            or max_skew_seconds < 0
            or abs(now - timestamp) > max_skew_seconds
        ):
            return False
        required = _validate_scopes(required_scopes)
        if any(scope not in scopes for scope in required):
            return False
        expected = _signature_payload(
            secret=secret,
            timestamp=timestamp,
            nonce=nonce,
            method=method,
            path=path,
            body_sha256=body_sha256,
            scopes=scopes,
        )
        if not hmac.compare_digest(expected, received):
            return False
        if nonce_store is not None and not nonce_store.consume(nonce, now=float(now)).accepted:
            return False
        return True
    except (AuthenticationError, TypeError, ValueError):
        return False


__all__ = [
    "AuthenticationError",
    "CONTRACT_VERSION",
    "InMemoryNonceStore",
    "MIN_SECRET_BYTES",
    "NonceStoreResult",
    "SIGNATURE_SKEW_SECONDS",
    "canonical_signature_input",
    "sha256_body",
    "sign_request",
    "verify_request",
]
