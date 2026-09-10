"""Authenticated, provider-free FastAPI boundary for the local AI API."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import importlib
import inspect
import json
import logging
import os
import re
import threading
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from types import ModuleType
from typing import Awaitable, Callable, Literal, TypeVar, cast
from uuid import UUID

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from app.generated_models import InternalRequestSignature, OperationalContext
from app.catalog_embeddings import (
    DEFAULT_EMBEDDING_DIMENSIONS,
    DEFAULT_EMBEDDING_MODEL,
    EmbeddingSettings,
    GeminiEmbeddingProvider,
    embed_with_retry,
    validate_embedding_batch,
)
from app.operational_store import InMemoryOperationalStore, StoredHttpResponse
from app.postgres_store import PostgresOperationalStore


SCHEMA_VERSION = "operational.v1"
DEFAULT_SCOPE = "ai.echo"
DEFAULT_RERANK_SCOPE = "ai.rerank"
DEFAULT_EMBEDDING_SCOPE = "ai.embedding"
MAX_BODY_BYTES = 64 * 1024
_SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
_SCOPE_RE = re.compile(r"^[a-zA-Z0-9._:/-]+$")
_LOCAL_ENVIRONMENTS = {"development", "test", "local"}
MIN_SECRET_BYTES = 32
RERANK_WARMUP_TIMEOUT_SECONDS = 60.0
logger = logging.getLogger("decoracion.ai_api")
T = TypeVar("T")


@dataclass(frozen=True, slots=True)
class Settings:
    """Runtime settings. Tests inject values through ``create_app``."""

    environment: str = "development"
    hmac_secret: str | None = None
    required_scope: str = DEFAULT_SCOPE
    rerank_required_scope: str = DEFAULT_RERANK_SCOPE
    embedding_required_scope: str = DEFAULT_EMBEDDING_SCOPE
    max_clock_skew_seconds: int = 300
    nonce_namespace: str = "ai-api"
    max_body_bytes: int = MAX_BODY_BYTES
    database_url: str | None = None

    @classmethod
    def from_env(cls) -> "Settings":
        environment = os.getenv("APP_ENV", os.getenv("ENVIRONMENT", "development"))
        secret = os.getenv("INTERNAL_HMAC_SECRET")
        return cls(
            environment=environment.strip().lower(),
            hmac_secret=secret.strip() if secret and secret.strip() else None,
            required_scope=os.getenv("INTERNAL_REQUIRED_SCOPE", DEFAULT_SCOPE),
            rerank_required_scope=os.getenv("INTERNAL_RERANK_REQUIRED_SCOPE", DEFAULT_RERANK_SCOPE),
            embedding_required_scope=os.getenv(
                "INTERNAL_EMBEDDING_REQUIRED_SCOPE", DEFAULT_EMBEDDING_SCOPE
            ),
            database_url=os.getenv("DATABASE_URL"),
        )


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class OperationalRequest(ContractModel):
    """Shared envelope for every /internal/v1/* operation: a signed context
    plus an operation-specific body. Each operation subclasses this with its
    own fields instead of reusing EchoRequest's untyped `payload` dict."""

    context: OperationalContext


class EchoRequest(OperationalRequest):
    payload: dict[str, object] = Field(default_factory=dict)


class RerankCandidate(ContractModel):
    id: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=4_000)

    @field_validator("id", "text")
    @classmethod
    def reject_blank_values(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("candidate values must not be blank")
        return stripped


class RerankRequest(OperationalRequest):
    query: str = Field(min_length=1, max_length=1_000)
    candidates: list[RerankCandidate] = Field(default_factory=list, max_length=100)

    @field_validator("query")
    @classmethod
    def reject_blank_query(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("query must not be blank")
        return stripped

    @model_validator(mode="after")
    def reject_duplicate_candidate_ids(self) -> "RerankRequest":
        ids = [candidate.id for candidate in self.candidates]
        if len(ids) != len(set(ids)):
            raise ValueError("candidate ids must be unique")
        return self


class EmbeddingRequest(OperationalRequest):
    text: str = Field(min_length=1, max_length=4_000)
    task_type: Literal["RETRIEVAL_QUERY"] = "RETRIEVAL_QUERY"

    @field_validator("text")
    @classmethod
    def reject_blank_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("embedding text must not be blank")
        return stripped


class InMemoryMetrics:
    """Small process-local counters; no payloads, secrets, or bodies stored."""

    def __init__(self) -> None:
        self._counters: dict[str, int] = {}
        self._lock = threading.Lock()

    def increment(self, name: str) -> None:
        with self._lock:
            self._counters[name] = self._counters.get(name, 0) + 1

    def snapshot(self) -> dict[str, int]:
        with self._lock:
            return dict(self._counters)


EchoHandler = Callable[[EchoRequest], Awaitable[dict[str, object]]]
RerankHandler = Callable[[RerankRequest], Awaitable[dict[str, object]]]
EmbeddingHandler = Callable[[EmbeddingRequest], Awaitable[dict[str, object]]]
OperationalHandler = Callable[[OperationalRequest], Awaitable[dict[str, object]]]


async def _await_result(value: T | Awaitable[T]) -> T:
    if inspect.isawaitable(value):
        return cast(T, await value)
    return value


async def _default_echo_handler(payload: EchoRequest) -> dict[str, object]:
    return {"payload": payload.payload}


_RERANK_WORKER_LIMIT = threading.Semaphore(1)


def _rerank_in_worker(payload: RerankRequest) -> dict[str, object]:
    # Imported lazily: loading sentence-transformers/torch (and, on first use,
    # downloading the ~80MB model) must never happen at module import time --
    # /healthz, /readyz and the echo path stay fast and offline.
    from app.reranker import model_score_fn
    from app.reranker import rerank as rerank_candidates

    pairs = [(candidate.id, candidate.text) for candidate in payload.candidates]
    ordered = rerank_candidates(payload.query, pairs, score_fn=model_score_fn())
    # Nested under "payload", like echo's result -- every /internal/v1/*
    # operation shares the same {schema_version, request_id, correlation_id,
    # payload} envelope, so the Next-side adapter's response schema stays
    # generic across operations instead of needing one shape per route.
    return {
        "payload": {
            "order": [candidate_id for candidate_id, _score in ordered],
            "scores": {candidate_id: score for candidate_id, score in ordered},
        }
    }


async def _default_rerank_handler(payload: RerankRequest) -> dict[str, object]:
    # Cross-encoder inference is CPU-bound and may download model weights on
    # first use. Run it outside the event loop and serialize model work so one
    # small CPU instance cannot be saturated by concurrent requests.
    return await asyncio.to_thread(_run_bounded_rerank, payload)


async def _default_embedding_handler(payload: EmbeddingRequest) -> dict[str, object]:
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise _error("embedding_provider_unavailable", 503)
    settings = EmbeddingSettings(
        model=DEFAULT_EMBEDDING_MODEL,
        dimensions=DEFAULT_EMBEDDING_DIMENSIONS,
        task_type=payload.task_type,
    )
    attempt_count: list[int] = []
    attempts: list[dict[str, object]] = []

    async def record_attempt(attempt: int, result: str, elapsed_ms: int) -> None:
        logger.info(
            "embedding provider attempt",
            extra={
                "request_id": str(payload.context.request_id),
                "correlation_id": str(payload.context.correlation_id),
                "attempt": attempt,
                "result": result,
                "elapsed_ms": elapsed_ms,
            },
        )
        attempts.append({"attempt": attempt, "result": result, "elapsed_ms": elapsed_ms})

    try:
        provider = GeminiEmbeddingProvider(api_key)
        values = await embed_with_retry(
            provider,
            [payload.text],
            settings,
            attempts=attempt_count,
            on_attempt=record_attempt,
        )
        vector = validate_embedding_batch(values, expected_count=1, dimensions=settings.dimensions)[
            0
        ]
    except HTTPException:
        raise
    except Exception:
        # Keep retry metadata in the bounded error body so Next can persist
        # every provider attempt, including terminal failures.
        if attempts and attempts[-1]["result"] == "ok":
            attempts[-1]["result"] = "error"
        raise _error(
            "embedding_provider_unavailable",
            503,
            {"attempts": attempts},
        ) from None
    return {
        "payload": {
            "values": list(vector),
            "model": settings.model,
            "dimensions": settings.dimensions,
            "task_type": settings.task_type,
            "attempts": attempts
            or [
                {
                    "attempt": attempt_count[0] if attempt_count else 1,
                    "result": "ok",
                    "elapsed_ms": 0,
                }
            ],
        }
    }


def _run_bounded_rerank(payload: RerankRequest) -> dict[str, object]:
    with _RERANK_WORKER_LIMIT:
        return _rerank_in_worker(payload)


async def _warm_rerank_model() -> None:
    # Warm the process-local model before readiness when the image opts in.
    # This keeps the first real request inside its normal deadline instead of
    # making it pay the one-time torch/model initialization cost.
    payload = RerankRequest.model_construct(
        query="warmup",
        candidates=[RerankCandidate.model_construct(id="warmup", text="warmup")],
    )
    await asyncio.to_thread(_run_bounded_rerank, payload)


def _error(
    code: str,
    status_code: int,
    details: dict[str, object] | None = None,
) -> HTTPException:
    detail: dict[str, object] = {"code": code}
    if details:
        detail.update(details)
    return HTTPException(status_code=status_code, detail=detail)


def _secret_is_valid(secret: object) -> bool:
    return isinstance(secret, str) and len(secret.encode("utf-8")) >= MIN_SECRET_BYTES


def _invalid_request() -> HTTPException:
    return _error("invalid_request", 422)


def _safe_uuid(value: str | None, fallback: str) -> str:
    if value is None:
        return fallback
    try:
        return str(UUID(value))
    except (AttributeError, TypeError, ValueError):
        return fallback


def _request_ids(request: Request) -> tuple[str, str]:
    request_id = _safe_uuid(request.headers.get("x-request-id"), str(uuid.uuid4()))
    correlation_id = _safe_uuid(request.headers.get("x-correlation-id"), request_id)
    return request_id, correlation_id


def _response_headers(request: Request, *, replay: bool = False) -> dict[str, str]:
    headers = {
        "x-request-id": request.state.request_id,
        "x-correlation-id": request.state.correlation_id,
    }
    if replay:
        headers["x-idempotency-result"] = "replay"
    return headers


def _error_body(
    request: Request,
    code: str,
    details: dict[str, object] | None = None,
) -> dict[str, object]:
    detail: dict[str, object] = {
        "code": code,
        "request_id": request.state.request_id,
        "correlation_id": request.state.correlation_id,
    }
    if details:
        detail.update(details)
    return {
        "detail": detail,
    }


def _error_response(
    request: Request,
    status_code: int,
    code: str,
    details: dict[str, object] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=_error_body(request, code, details),
        headers=_response_headers(request),
    )


def _operation_body_sha256(raw_body: bytes, payload: OperationalRequest) -> str:
    try:
        envelope = json.loads(raw_body)
    except (TypeError, json.JSONDecodeError):
        raise _invalid_request() from None
    if not isinstance(envelope, dict):
        raise _invalid_request()
    if isinstance(payload, EchoRequest):
        operation_body = envelope.get("payload")
    else:
        operation_body = {key: value for key, value in envelope.items() if key != "context"}
    encoded = json.dumps(operation_body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _validate_context(context: OperationalContext) -> None:
    if not _SHA256_RE.fullmatch(str(context.body_sha256)):
        raise _invalid_request()
    if len(context.scopes) > 32 or any(
        not isinstance(scope, str) or not 1 <= len(scope) <= 120 or not _SCOPE_RE.fullmatch(scope)
        for scope in context.scopes
    ):
        raise _invalid_request()
    if context.idempotency_key is not None and not 1 <= len(context.idempotency_key) <= 200:
        raise _invalid_request()


def _validate_signature(signature: InternalRequestSignature) -> None:
    if len(signature.scopes) > 32 or any(
        not isinstance(scope, str) or not 1 <= len(scope) <= 120 or not _SCOPE_RE.fullmatch(scope)
        for scope in signature.scopes
    ):
        raise _error("invalid_signature", 401)
    if not _SHA256_RE.fullmatch(str(signature.signature)):
        raise _error("invalid_signature", 401)


def _parse_model(model: type[ContractModel], raw_body: bytes) -> ContractModel:
    try:
        if hasattr(model, "model_validate_json"):
            return cast(ContractModel, model.model_validate_json(raw_body))
        return cast(ContractModel, model.parse_raw(raw_body))
    except ValidationError as error:
        del error
        raise _invalid_request() from None


def _parse_signature_headers(request: Request) -> InternalRequestSignature:
    scopes_header = request.headers.get("x-internal-scopes", "")
    scopes = [scope.strip() for scope in scopes_header.split(",")] if scopes_header else []
    try:
        signature = InternalRequestSignature(
            schema_version=request.headers.get("x-internal-schema-version", ""),
            timestamp=int(request.headers.get("x-internal-timestamp", "")),
            nonce=request.headers.get("x-internal-nonce", ""),
            signature=request.headers.get("x-internal-signature", ""),
            scopes=scopes,
        )
    except (TypeError, ValueError, ValidationError) as error:
        del error
        raise _error("invalid_signature", 401) from None
    _validate_signature(signature)
    return signature


def signature_material(
    *, method: str, path: str, timestamp: int, nonce: UUID | str, scopes: list[str], body: bytes
) -> bytes:
    """Build operational.v1 canonical bytes signed by HMAC."""

    body_hash = hashlib.sha256(body).hexdigest()
    normalized_scopes = ",".join(sorted(scopes))
    return ".".join(
        [str(timestamp), str(nonce), method.upper(), path, body_hash, normalized_scopes]
    ).encode("utf-8")


def build_signature(
    *,
    secret: str,
    method: str,
    path: str,
    timestamp: int,
    nonce: UUID | str,
    scopes: list[str],
    body: bytes,
) -> str:
    return hmac.new(
        secret.encode("utf-8"),
        signature_material(
            method=method,
            path=path,
            timestamp=timestamp,
            nonce=nonce,
            scopes=scopes,
            body=body,
        ),
        hashlib.sha256,
    ).hexdigest()


def _load_auth_module() -> ModuleType | None:
    try:
        return importlib.import_module("app.auth")
    except ModuleNotFoundError as error:
        if error.name not in {"app", "app.auth"}:
            raise
        return None


async def _consume_nonce(request: Request, nonce: str, settings: Settings) -> None:
    store = getattr(request.app.state, "nonce_store", None)
    if store is None:
        raise _error("nonce_store_unavailable", 503)
    now = float(int(time.time()))
    try:
        consume_nonce = getattr(store, "consume_nonce", None)
        if callable(consume_nonce):
            result = await _await_result(consume_nonce(settings.nonce_namespace, nonce, now=now))
            accepted = result.kind == "accepted"
        else:
            result = await _await_result(store.consume(nonce, now=now))
            accepted = bool(result.accepted)
    except Exception:
        raise _error("nonce_store_error", 503) from None
    if not accepted:
        request.app.state.metrics.increment("auth.nonce_replay")
        raise _error("nonce_replay", 401)


async def _authorize(
    request: Request, raw_body: bytes, settings: Settings, *, required_scope: str
) -> InternalRequestSignature:
    secret = settings.hmac_secret
    if not _secret_is_valid(secret):
        raise _error("auth_unavailable", 503)
    assert isinstance(secret, str)
    signature = _parse_signature_headers(request)
    required_scope = required_scope.strip()
    if required_scope not in signature.scopes:
        raise _error("insufficient_scope", 403)
    if abs(int(time.time()) - int(signature.timestamp)) > settings.max_clock_skew_seconds:
        raise _error("stale_signature", 401)

    auth_module = _load_auth_module()
    if auth_module is not None:
        verifier = getattr(auth_module, "verify_request", None)
        body_hasher = getattr(auth_module, "sha256_body", None)
        if not callable(verifier) or not callable(body_hasher):
            raise _error("auth_backend_invalid", 503)
        signature_mapping = (
            signature.model_dump(mode="json")
            if hasattr(signature, "model_dump")
            else signature.dict()
        )
        signature_mapping["nonce"] = str(signature_mapping["nonce"])
        try:
            authorized = verifier(
                secret=secret,
                signature=signature_mapping,
                method=request.method,
                path=request.url.path,
                body_sha256=body_hasher(raw_body),
                now_seconds=int(time.time()),
                max_skew_seconds=settings.max_clock_skew_seconds,
                required_scopes=[required_scope],
                nonce_store=None,
            )
        except Exception as error:
            del error
            raise _error("auth_backend_error", 503) from None
        if not authorized:
            request.app.state.metrics.increment("auth.invalid_signature")
            raise _error("invalid_signature", 401)
    else:
        expected = build_signature(
            secret=secret,
            method=request.method,
            path=request.url.path,
            timestamp=int(signature.timestamp),
            nonce=str(signature.nonce),
            scopes=list(signature.scopes),
            body=raw_body,
        )
        if not hmac.compare_digest(expected, str(signature.signature)):
            request.app.state.metrics.increment("auth.invalid_signature")
            raise _error("invalid_signature", 401)

    await _consume_nonce(request, str(signature.nonce), settings)
    return signature


def _deadline_seconds(context: OperationalContext) -> float:
    try:
        deadline = datetime.fromisoformat(str(context.deadline_at).replace("Z", "+00:00"))
        if deadline.tzinfo is None:
            raise ValueError
    except ValueError:
        raise _invalid_request() from None
    remaining = (deadline.astimezone(timezone.utc) - datetime.now(timezone.utc)).total_seconds()
    if remaining <= 0:
        raise _error("deadline_exceeded", 408)
    return min(remaining, float(context.deadline_ms) / 1000)


def _stored_response(body: dict[str, object], status: int = 200) -> StoredHttpResponse:
    return StoredHttpResponse(body=body, status=status)


def _detail_code(exception: HTTPException) -> str:
    if isinstance(exception.detail, dict):
        code = exception.detail.get("code")
        if isinstance(code, str):
            return code
    return "internal_error"


def _detail_metadata(exception: HTTPException) -> dict[str, object]:
    if not isinstance(exception.detail, dict):
        return {}
    attempts = exception.detail.get("attempts")
    if not isinstance(attempts, list):
        return {}
    safe_attempts: list[dict[str, object]] = []
    for item in attempts:
        if not isinstance(item, dict):
            continue
        attempt = item.get("attempt")
        result = item.get("result")
        elapsed_ms = item.get("elapsed_ms")
        if (
            isinstance(attempt, int)
            and attempt > 0
            and result in {"ok", "error"}
            and isinstance(elapsed_ms, int)
            and elapsed_ms >= 0
        ):
            safe_attempts.append({"attempt": attempt, "result": result, "elapsed_ms": elapsed_ms})
    return {"attempts": safe_attempts} if safe_attempts else {}


async def _store_failure(
    request: Request,
    *,
    scope: str,
    idempotency_key: str,
    body_sha256: str,
    code: str,
    status: int,
    details: dict[str, object] | None = None,
) -> None:
    store = request.app.state.operational_store
    if store is None:
        return
    try:
        await _await_result(
            store.fail(
                scope=scope,
                idempotency_key=idempotency_key,
                body_sha256=body_sha256,
                response=_stored_response(_error_body(request, code, details), status),
            )
        )
    except Exception:
        request.app.state.metrics.increment("idempotency.finalize_error")
        logger.warning(
            "idempotency finalization failed",
            extra={"request_id": request.state.request_id},
        )


async def _handle_operational_request(
    request: Request,
    *,
    operation: str,
    model: type[OperationalRequest],
    scope: str,
    handler: OperationalHandler,
) -> Response:
    """Shared auth/idempotency/deadline/error-mapping boundary for every
    /internal/v1/* operation. `scope` is the required scope for THIS
    operation -- it is never read from a single app-wide setting, so two
    routes (e.g. echo and rerank) can require different scopes."""

    runtime_settings: Settings = request.app.state.settings
    content_length = request.headers.get("content-length")
    if (
        content_length
        and content_length.isdigit()
        and int(content_length) > runtime_settings.max_body_bytes
    ):
        raise _error("body_too_large", 413)
    raw_body = await request.body()
    if len(raw_body) > runtime_settings.max_body_bytes:
        raise _error("body_too_large", 413)

    await _authorize(request, raw_body, runtime_settings, required_scope=scope)
    payload = cast(OperationalRequest, _parse_model(model, raw_body))
    context = payload.context
    _validate_context(context)
    if str(context.body_sha256) != _operation_body_sha256(raw_body, payload):
        raise _invalid_request()
    if scope not in context.scopes:
        raise _error("insufficient_scope", 403)
    timeout_seconds = _deadline_seconds(context)
    # Idempotency covers the operation payload, not volatile transport
    # fields such as request_id, correlation_id, or deadline_at. The
    # adapter supplies that stable operation hash in the signed context.
    body_sha256 = str(context.body_sha256)
    idempotency_key = context.idempotency_key
    if idempotency_key is not None:
        store = request.app.state.operational_store
        if store is None or not callable(getattr(store, "claim", None)):
            raise _error("idempotency_store_unavailable", 503)
        try:
            claim = await _await_result(
                store.claim(
                    scope=scope,
                    idempotency_key=idempotency_key,
                    body_sha256=body_sha256,
                    request_id=str(context.request_id),
                    correlation_id=str(context.correlation_id),
                )
            )
        except Exception:
            request.app.state.metrics.increment("idempotency.claim_error")
            raise _error("idempotency_store_error", 503) from None
        if claim.kind == "conflict":
            request.app.state.metrics.increment("idempotency.conflict")
            raise _error("idempotency_conflict", 409)
        if claim.kind == "in_flight":
            request.app.state.metrics.increment("idempotency.in_flight")
            raise _error("idempotency_in_flight", 409)
        if claim.kind == "replay":
            request.app.state.metrics.increment("idempotency.replay")
            if claim.response is None:
                raise _error("idempotency_store_error", 503)
            return JSONResponse(
                status_code=claim.response.status,
                content=claim.response.body,
                headers=_response_headers(request, replay=True),
            )

    try:
        result = await asyncio.wait_for(handler(payload), timeout=timeout_seconds)
        response_body = {
            "schema_version": SCHEMA_VERSION,
            "request_id": str(context.request_id),
            "correlation_id": str(context.correlation_id),
            **result,
        }
    except asyncio.TimeoutError:
        request.app.state.metrics.increment(f"{operation}.timeout")
        if idempotency_key is not None:
            await _store_failure(
                request,
                scope=scope,
                idempotency_key=idempotency_key,
                body_sha256=body_sha256,
                code="deadline_exceeded",
                status=408,
            )
        raise _error("deadline_exceeded", 408) from None
    except asyncio.CancelledError:
        if idempotency_key is not None:
            await _store_failure(
                request,
                scope=scope,
                idempotency_key=idempotency_key,
                body_sha256=body_sha256,
                code="client_cancelled",
                status=499,
            )
        request.app.state.metrics.increment(f"{operation}.cancelled")
        return _error_response(request, 499, "client_cancelled")
    except HTTPException as exception:
        details = _detail_metadata(exception)
        if idempotency_key is not None:
            await _store_failure(
                request,
                scope=scope,
                idempotency_key=idempotency_key,
                body_sha256=body_sha256,
                code=_detail_code(exception),
                status=exception.status_code,
                details=details,
            )
        raise
    except Exception as error:
        del error
        if idempotency_key is not None:
            await _store_failure(
                request,
                scope=scope,
                idempotency_key=idempotency_key,
                body_sha256=body_sha256,
                code="internal_error",
                status=500,
            )
        raise _error("internal_error", 500) from None

    if idempotency_key is not None:
        store = request.app.state.operational_store
        try:
            await _await_result(
                store.complete(
                    scope=scope,
                    idempotency_key=idempotency_key,
                    body_sha256=body_sha256,
                    response=_stored_response(response_body),
                )
            )
        except Exception:
            request.app.state.metrics.increment("idempotency.finalize_error")
            await _store_failure(
                request,
                scope=scope,
                idempotency_key=idempotency_key,
                body_sha256=body_sha256,
                code="idempotency_store_error",
                status=503,
            )
            raise _error("idempotency_store_error", 503) from None
    request.app.state.metrics.increment(f"{operation}.completed")
    return JSONResponse(
        status_code=200,
        content=response_body,
        headers=_response_headers(request),
    )


def create_app(
    settings: Settings | None = None,
    nonce_store: object | None = None,
    *,
    operational_store: object | None = None,
    echo_handler: EchoHandler | None = None,
    rerank_handler: RerankHandler | None = None,
    embedding_handler: EmbeddingHandler | None = None,
) -> FastAPI:
    current_settings = settings or Settings.from_env()
    default_store: object | None = None
    if current_settings.database_url:
        try:
            default_store = PostgresOperationalStore(current_settings.database_url)
        except ValueError as error:
            logger.warning("invalid DATABASE_URL configuration: %s", str(error))
    elif current_settings.environment in _LOCAL_ENVIRONMENTS:
        default_store = InMemoryOperationalStore()

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        store = application.state.operational_store
        start = getattr(store, "start", None)
        if callable(start):
            try:
                await _await_result(start())
            except Exception as error:
                application.state.store_startup_error = type(error).__name__
                logger.error("operational store startup failed: %s", type(error).__name__)
        if os.getenv("RERANK_MODEL_WARMUP", "").strip().lower() in {"1", "true", "on"}:
            try:
                await asyncio.wait_for(_warm_rerank_model(), timeout=RERANK_WARMUP_TIMEOUT_SECONDS)
            except Exception as error:
                application.state.rerank_warmup_error = type(error).__name__
                logger.error("rerank model warmup failed: %s", type(error).__name__)
        try:
            yield
        finally:
            close = getattr(store, "close", None)
            if callable(close):
                try:
                    await _await_result(close())
                except Exception as error:
                    logger.error("operational store shutdown failed: %s", type(error).__name__)

    application = FastAPI(title="AI API", version="0.1.0", lifespan=lifespan)
    application.state.settings = current_settings
    if operational_store is None:
        operational_store = default_store
    if nonce_store is None and operational_store is not None:
        nonce_store = operational_store
    application.state.operational_store = operational_store
    application.state.nonce_store = nonce_store
    application.state.metrics = InMemoryMetrics()
    handler = echo_handler or _default_echo_handler
    rerank_handler_fn = rerank_handler or _default_rerank_handler
    embedding_handler_fn = embedding_handler or _default_embedding_handler

    @application.middleware("http")
    async def request_context(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_id, correlation_id = _request_ids(request)
        request.state.request_id = request_id
        request.state.correlation_id = correlation_id
        try:
            response = await call_next(request)
        except asyncio.CancelledError:
            raise
        response.headers.update(_response_headers(request))
        return response

    @application.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exception: HTTPException) -> JSONResponse:
        code = _detail_code(exception)
        request.app.state.metrics.increment(f"errors.{code}")
        return _error_response(request, exception.status_code, code, _detail_metadata(exception))

    @application.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exception: RequestValidationError
    ) -> JSONResponse:
        del exception
        return _error_response(request, 422, "invalid_request")

    @application.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exception: Exception) -> JSONResponse:
        del exception
        request.app.state.metrics.increment("errors.internal_error")
        logger.error("unhandled request error", extra={"request_id": request.state.request_id})
        return _error_response(request, 500, "internal_error")

    @application.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @application.get("/readyz")
    async def readyz(request: Request) -> dict[str, str]:
        runtime_settings: Settings = request.app.state.settings
        store = request.app.state.operational_store
        if not _secret_is_valid(runtime_settings.hmac_secret) or store is None:
            raise _error("not_ready", 503)
        if runtime_settings.environment not in _LOCAL_ENVIRONMENTS and not getattr(
            store, "durable", False
        ):
            raise _error("not_ready", 503)
        check_ready = getattr(store, "check_ready", None)
        if callable(check_ready):
            try:
                ready = await _await_result(check_ready())
            except Exception:
                ready = False
            if not ready:
                raise _error("not_ready", 503)
        if getattr(request.app.state, "rerank_warmup_error", None) is not None:
            raise _error("not_ready", 503)
        return {"status": "ready"}

    @application.post("/internal/v1/echo")
    async def echo(request: Request) -> Response:
        return await _handle_operational_request(
            request,
            operation="echo",
            model=EchoRequest,
            scope=current_settings.required_scope,
            handler=cast(OperationalHandler, handler),
        )

    @application.post("/internal/v1/rerank")
    async def rerank(request: Request) -> Response:
        return await _handle_operational_request(
            request,
            operation="rerank",
            model=RerankRequest,
            scope=current_settings.rerank_required_scope,
            handler=cast(OperationalHandler, rerank_handler_fn),
        )

    @application.post("/internal/v1/embed")
    async def embed(request: Request) -> Response:
        return await _handle_operational_request(
            request,
            operation="embed",
            model=EmbeddingRequest,
            scope=current_settings.embedding_required_scope,
            handler=cast(OperationalHandler, embedding_handler_fn),
        )

    return application


app = create_app()


__all__ = ["Settings", "app", "build_signature", "create_app", "signature_material"]
