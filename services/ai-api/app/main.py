"""Authenticated, provider-free FastAPI boundary for the local AI API."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import importlib
import inspect
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
from typing import Awaitable, Callable, TypeVar, cast
from uuid import UUID

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.generated_models import InternalRequestSignature, OperationalContext
from app.operational_store import InMemoryOperationalStore, StoredHttpResponse
from app.postgres_store import PostgresOperationalStore


SCHEMA_VERSION = "operational.v1"
DEFAULT_SCOPE = "ai.echo"
MAX_BODY_BYTES = 64 * 1024
_SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
_SCOPE_RE = re.compile(r"^[a-zA-Z0-9._:/-]+$")
_LOCAL_ENVIRONMENTS = {"development", "test", "local"}
MIN_SECRET_BYTES = 32
logger = logging.getLogger("decoracion.ai_api")
T = TypeVar("T")


@dataclass(frozen=True, slots=True)
class Settings:
    """Runtime settings. Tests inject values through ``create_app``."""

    environment: str = "development"
    hmac_secret: str | None = None
    required_scope: str = DEFAULT_SCOPE
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
            database_url=os.getenv("DATABASE_URL"),
        )


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EchoRequest(ContractModel):
    context: OperationalContext
    payload: dict[str, object] = Field(default_factory=dict)


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


async def _await_result(value: T | Awaitable[T]) -> T:
    if inspect.isawaitable(value):
        return cast(T, await value)
    return value


async def _default_echo_handler(payload: EchoRequest) -> dict[str, object]:
    return {"payload": payload.payload}


def _error(code: str, status_code: int) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code})


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


def _error_body(request: Request, code: str) -> dict[str, object]:
    return {
        "detail": {
            "code": code,
            "request_id": request.state.request_id,
            "correlation_id": request.state.correlation_id,
        }
    }


def _error_response(request: Request, status_code: int, code: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=_error_body(request, code),
        headers=_response_headers(request),
    )


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
    request: Request, raw_body: bytes, settings: Settings
) -> InternalRequestSignature:
    secret = settings.hmac_secret
    if not _secret_is_valid(secret):
        raise _error("auth_unavailable", 503)
    assert isinstance(secret, str)
    signature = _parse_signature_headers(request)
    required_scope = settings.required_scope.strip()
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


async def _store_failure(
    request: Request,
    *,
    scope: str,
    idempotency_key: str,
    body_sha256: str,
    code: str,
    status: int,
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
                response=_stored_response(_error_body(request, code), status),
            )
        )
    except Exception:
        request.app.state.metrics.increment("idempotency.finalize_error")
        logger.warning(
            "idempotency finalization failed",
            extra={"request_id": request.state.request_id},
        )


def create_app(
    settings: Settings | None = None,
    nonce_store: object | None = None,
    *,
    operational_store: object | None = None,
    echo_handler: EchoHandler | None = None,
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
        return _error_response(request, exception.status_code, code)

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
        return {"status": "ready"}

    @application.post("/internal/v1/echo")
    async def echo(request: Request) -> Response:
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

        await _authorize(request, raw_body, runtime_settings)
        payload = _parse_model(EchoRequest, raw_body)
        context = payload.context
        _validate_context(context)
        if runtime_settings.required_scope not in context.scopes:
            raise _error("insufficient_scope", 403)
        timeout_seconds = _deadline_seconds(context)
        # Idempotency covers the operation payload, not volatile transport
        # fields such as request_id, correlation_id, or deadline_at. The
        # adapter supplies that stable operation hash in the signed context.
        body_sha256 = str(context.body_sha256)
        scope = runtime_settings.required_scope
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
            request.app.state.metrics.increment("echo.timeout")
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
            request.app.state.metrics.increment("echo.cancelled")
            return _error_response(request, 499, "client_cancelled")
        except HTTPException as exception:
            if idempotency_key is not None:
                await _store_failure(
                    request,
                    scope=scope,
                    idempotency_key=idempotency_key,
                    body_sha256=body_sha256,
                    code=_detail_code(exception),
                    status=exception.status_code,
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
                raise _error("idempotency_store_error", 503) from None
        request.app.state.metrics.increment("echo.completed")
        return JSONResponse(
            status_code=200,
            content=response_body,
            headers=_response_headers(request),
        )

    return application


app = create_app()


__all__ = ["Settings", "app", "build_signature", "create_app", "signature_material"]
