"""Kagutsuchi -- the fal.ai LoRA queue round trip inside image generation.

TypeScript (`src/lib/ia/kagutsuchi/sempertex-lora.ts`) still owns everything
that is not a network call to the provider: which LoRA applications, prompt
composition (`buildLoraEditPrompt`, `ensureLoraTriggers`), which references go
into `/edit` (`referenciasParaLoraEdit`), and guidance/size/seed. This module
makes exactly the submit -> poll -> download sequence
`generarConSempertexLora` used to make directly against fal.ai's queue -- the
SSRF allow-list, the account-rejected classification and the bounded image
download all move here unchanged. Migration context:
docs/architecture/decisions/0026-migrar-las-ias-a-python.md.
"""

from __future__ import annotations

import asyncio
import base64
import os
import re
import ssl
import time
from typing import Callable, Literal
from urllib.parse import urlsplit

import httpx
import truststore
from pydantic import Field

from app.operational_models import ContractModel, OperationalRequest


LORA_GENERATE_SCOPE = "ia.lora_generate"
LORA_GENERATE_SCHEMA_VERSION = "lora-generate.v1"

TEXT_ENDPOINT = "https://queue.fal.run/fal-ai/flux-2/lora"
EDIT_ENDPOINT = "https://queue.fal.run/fal-ai/flux-2/lora/edit"
FAL_QUEUE_HOSTS = {"queue.fal.run", "rest.alpha.fal.ai"}
MAX_FAL_IMAGE_BYTES = 16_000_000
MAX_EDIT_IMAGES = 4
POLL_INTERVAL_SECONDS = 1.5
POLL_DEADLINE_SECONDS = 105.0
MAX_REDIRECTS = 4
REQUEST_TIMEOUT_SECONDS = 30.0
ALLOWED_IMAGE_CONTENT_TYPES = {"image/png", "image/jpeg", "image/webp"}
ACCOUNT_REJECTED_STATUSES = {401, 402, 403}
_NO_BALANCE_PATTERN = re.compile(r"balance|billing|locked|top up|payment|credit|quota exceeded", re.IGNORECASE)
_QUEUE_STATUSES = {"IN_QUEUE", "IN_PROGRESS", "COMPLETED", "FAILED", "CANCELLED"}


class LoraGenerateError(Exception):
    """Stable domain error the HTTP boundary translates (see `_error` in
    main.py). `causa` is only set for account-rejected failures (401/402/403
    -- retrying cannot fix them), and `provider_status`/`provider_detail`
    carry the real fal.ai status/message so the TypeScript wrapper can rebuild
    the exact `ProveedorImagenNoDisponibleError` the direct path throws
    (sempertex-lora.ts) instead of a generic transport error.
    """

    def __init__(
        self,
        code: str,
        status_code: int = 502,
        *,
        causa: Literal["saldo_agotado", "acceso_denegado"] | None = None,
        provider_status: int | None = None,
        provider_detail: str | None = None,
    ) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code
        self.causa = causa
        self.provider_status = provider_status
        self.provider_detail = provider_detail


class LoraSpec(ContractModel):
    path: str = Field(min_length=1, max_length=500)
    scale: float = Field(ge=0, le=4)


class LoraGenerateRequest(OperationalRequest):
    """Authenticated operation body for one fal.ai LoRA generation. `prompt`
    already carries the trigger words and the /edit image guide -- this
    module never decides what the prompt says, only submits it. `mode`
    mirrors which endpoint TypeScript already chose (whether
    `referenciasParaLoraEdit`'s result was empty).
    """

    schema_version: Literal["lora-generate.v1"]
    mode: Literal["text", "edit"]
    prompt: str = Field(min_length=1, max_length=4000)
    loras: list[LoraSpec] = Field(min_length=1, max_length=1)
    guidance_scale: float = Field(ge=1.5, le=5)
    num_inference_steps: int = Field(ge=1, le=100)
    image_width: int = Field(ge=1, le=4096)
    image_height: int = Field(ge=1, le=4096)
    seed: int | None = Field(default=None, ge=0)
    image_data_urls: list[str] = Field(default_factory=list, max_length=MAX_EDIT_IMAGES)


def _record(value: object) -> dict[str, object] | None:
    return value if isinstance(value, dict) else None


def _string_field(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _safe_json(response: httpx.Response) -> object:
    try:
        return response.json()
    except Exception:
        return None


def _is_allowed_queue_url(value: str) -> bool:
    try:
        parts = urlsplit(value)
    except ValueError:
        return False
    return (
        parts.scheme == "https"
        and not parts.username
        and not parts.password
        and parts.port is None
        and parts.hostname in FAL_QUEUE_HOSTS
    )


def _is_allowed_image_url(value: str) -> bool:
    try:
        parts = urlsplit(value)
    except ValueError:
        return False
    if parts.scheme != "https" or parts.username or parts.password or parts.port is not None:
        return False
    hostname = parts.hostname or ""
    return hostname == "fal.media" or hostname.endswith(".fal.media")


def _parse_queue_submission(value: object) -> dict[str, str] | None:
    record = _record(value)
    if record is None:
        return None
    request_id = _string_field(record.get("request_id"))
    status_url = _string_field(record.get("status_url"))
    response_url = _string_field(record.get("response_url"))
    if not (request_id and status_url and response_url):
        return None
    return {"request_id": request_id, "status_url": status_url, "response_url": response_url}


def _parse_queue_status(value: object) -> dict[str, object] | None:
    record = _record(value)
    if record is None:
        return None
    status = record.get("status")
    if status not in _QUEUE_STATUSES:
        return None
    error = record.get("error")
    return {"status": status, "error": error if isinstance(error, str) else None}


def _parse_fal_response(value: object) -> list[dict[str, str | None]] | None:
    record = _record(value)
    if record is None:
        return None
    images = record.get("images")
    if not isinstance(images, list):
        return None
    parsed: list[dict[str, str | None]] = []
    for image in images:
        item = _record(image)
        url = _string_field(item.get("url")) if item else None
        if not url:
            return None
        content_type = item.get("content_type") if item else None
        parsed.append({"url": url, "content_type": content_type if isinstance(content_type, str) else None})
    return parsed


def _fal_error_detail(response: httpx.Response) -> str:
    body = _safe_json(response)
    if not isinstance(body, dict):
        return ""
    error = body.get("error")
    if isinstance(error, str):
        return error
    detail = body.get("detail")
    if isinstance(detail, str):
        return detail
    if isinstance(detail, list):
        import json as _json

        return " ".join(item if isinstance(item, str) else _json.dumps(item) for item in detail)
    return ""


def _fal_error(response: httpx.Response, code: str) -> LoraGenerateError:
    detail = _fal_error_detail(response)[:300]
    if response.status_code in ACCOUNT_REJECTED_STATUSES:
        causa: Literal["saldo_agotado", "acceso_denegado"] = (
            "saldo_agotado" if response.status_code == 402 or _NO_BALANCE_PATTERN.search(detail) else "acceso_denegado"
        )
        return LoraGenerateError(
            f"lora_account_{causa}",
            503,
            causa=causa,
            provider_status=response.status_code,
            provider_detail=detail or None,
        )
    return LoraGenerateError(code, 502, provider_status=response.status_code, provider_detail=detail or None)


def _default_client() -> httpx.AsyncClient:
    # Scoped to this client only (not truststore.inject_into_ssl(), which
    # would patch ssl.SSLContext process-wide): fal.ai is reached over plain
    # httpx, unlike Gemini's google-genai SDK, and this machine's certifi
    # bundle does not carry the corporate root some networks re-sign TLS
    # with -- the OS trust store does. Same reasoning as
    # scripts/eval_rerank.py's `truststore.inject_into_ssl()`.
    ssl_context = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    return httpx.AsyncClient(follow_redirects=False, timeout=REQUEST_TIMEOUT_SECONDS, verify=ssl_context)


async def _fetch_allowed(
    client: httpx.AsyncClient,
    url: str,
    *,
    method: str,
    headers: dict[str, str],
    json_body: dict[str, object] | None,
    is_allowed: Callable[[str], bool],
) -> httpx.Response:
    """Mirrors `fetchFalAllowed` in sempertex-lora.ts: fal.ai redirects are
    followed manually, checking each hop against the same host allow-list
    fal.ai's own image CDN and queue use, up to MAX_REDIRECTS times."""

    current_url = url
    for _ in range(MAX_REDIRECTS):
        response = await client.request(method, current_url, headers=headers, json=json_body)
        if response.status_code < 300 or response.status_code >= 400:
            return response
        location = response.headers.get("location")
        if not location:
            raise LoraGenerateError("lora_redirect_no_location", 502)
        next_url = str(httpx.URL(current_url).join(location))
        if not is_allowed(next_url):
            raise LoraGenerateError("lora_redirect_forbidden_host", 502)
        current_url = next_url
    raise LoraGenerateError("lora_redirect_limit_exceeded", 502)


async def _download_bounded_image(
    client: httpx.AsyncClient,
    url: str,
    is_allowed: Callable[[str], bool],
) -> tuple[bytes, str | None]:
    current_url = url
    for _ in range(MAX_REDIRECTS):
        async with client.stream("GET", current_url) as response:
            if 300 <= response.status_code < 400:
                location = response.headers.get("location")
                if not location:
                    raise LoraGenerateError("lora_redirect_no_location", 502)
                next_url = str(httpx.URL(current_url).join(location))
                if not is_allowed(next_url):
                    raise LoraGenerateError("lora_redirect_forbidden_host", 502)
                current_url = next_url
                continue
            if response.status_code >= 400:
                raise LoraGenerateError("lora_download_rejected", 502, provider_status=response.status_code)
            content_length = response.headers.get("content-length")
            if content_length and content_length.isdigit() and int(content_length) > MAX_FAL_IMAGE_BYTES:
                raise LoraGenerateError("lora_image_too_large", 502)
            chunks = bytearray()
            async for chunk in response.aiter_bytes():
                chunks.extend(chunk)
                if len(chunks) > MAX_FAL_IMAGE_BYTES:
                    raise LoraGenerateError("lora_image_too_large", 502)
            content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower() or None
            return bytes(chunks), content_type
    raise LoraGenerateError("lora_redirect_limit_exceeded", 502)


async def _generar_lora_fal(
    payload: LoraGenerateRequest,
    client_factory: Callable[[], httpx.AsyncClient] | None = None,
) -> dict[str, object]:
    key = os.getenv("FAL_KEY")
    if not key:
        raise LoraGenerateError("lora_unavailable", 503)

    endpoint = EDIT_ENDPOINT if payload.mode == "edit" else TEXT_ENDPOINT
    body: dict[str, object] = {
        "prompt": payload.prompt,
        "loras": [{"path": lora.path, "scale": lora.scale} for lora in payload.loras],
        "guidance_scale": payload.guidance_scale,
        "num_inference_steps": payload.num_inference_steps,
        "image_size": {"width": payload.image_width, "height": payload.image_height},
        "num_images": 1,
        "enable_prompt_expansion": False,
        "enable_safety_checker": True,
        "output_format": "png",
    }
    if payload.seed is not None:
        body["seed"] = payload.seed
    if payload.image_data_urls:
        body["image_urls"] = payload.image_data_urls

    auth_headers = {"Authorization": f"Key {key}"}
    client = (client_factory or _default_client)()
    deadline_at = time.monotonic() + POLL_DEADLINE_SECONDS

    async with client:
        response = await _fetch_allowed(
            client,
            endpoint,
            method="POST",
            headers={**auth_headers, "Content-Type": "application/json"},
            json_body=body,
            is_allowed=_is_allowed_queue_url,
        )
        if response.status_code >= 400:
            raise _fal_error(response, "lora_submit_rejected")
        submission = _parse_queue_submission(_safe_json(response))
        if (
            submission is None
            or not _is_allowed_queue_url(submission["status_url"])
            or not _is_allowed_queue_url(submission["response_url"])
        ):
            raise LoraGenerateError("lora_invalid_submission", 502)
        provider_request_id = submission["request_id"]

        completed = False
        while time.monotonic() < deadline_at:
            status_response = await _fetch_allowed(
                client,
                submission["status_url"],
                method="GET",
                headers=auth_headers,
                json_body=None,
                is_allowed=_is_allowed_queue_url,
            )
            if status_response.status_code >= 400:
                raise _fal_error(status_response, "lora_status_rejected")
            status = _parse_queue_status(_safe_json(status_response))
            if status is None:
                raise LoraGenerateError("lora_invalid_status", 502)
            if status["status"] == "COMPLETED":
                completed = True
                break
            if status["status"] in ("FAILED", "CANCELLED"):
                error_detail = status.get("error")
                raise LoraGenerateError(
                    "lora_generation_failed",
                    502,
                    provider_detail=error_detail[:300] if isinstance(error_detail, str) and error_detail else None,
                )
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
        if not completed:
            raise LoraGenerateError("lora_timeout", 504)

        result_response = await _fetch_allowed(
            client,
            submission["response_url"],
            method="GET",
            headers=auth_headers,
            json_body=None,
            is_allowed=_is_allowed_queue_url,
        )
        if result_response.status_code >= 400:
            raise _fal_error(result_response, "lora_result_rejected")
        images = _parse_fal_response(_safe_json(result_response))
        first = images[0] if images else None
        url = first.get("url") if first else None
        if not first or not url or not _is_allowed_image_url(url):
            raise LoraGenerateError("lora_invalid_image_response", 502)

        image_bytes, header_content_type = await _download_bounded_image(client, url, _is_allowed_image_url)
        declared_content_type = first.get("content_type")
        content_type = (declared_content_type or header_content_type or "").lower()
        if content_type not in ALLOWED_IMAGE_CONTENT_TYPES:
            raise LoraGenerateError("lora_image_type_rejected", 502)

    return {
        "image_base64": base64.b64encode(image_bytes).decode("ascii"),
        "mime": content_type,
        "provider_request_id": provider_request_id,
        "endpoint": "flux-2/lora/edit" if payload.mode == "edit" else "flux-2/lora",
    }


async def generar_lora_fal(
    payload: LoraGenerateRequest,
    client_factory: Callable[[], httpx.AsyncClient] | None = None,
) -> dict[str, object]:
    """Makes the submit -> poll -> download sequence
    `generarConSempertexLora`'s direct path used to make against fal.ai's
    queue. Raises LoraGenerateError on any provider failure, invalid
    response shape or a queue deadline exceeded -- never falls back
    silently."""

    try:
        return await _generar_lora_fal(payload, client_factory)
    except LoraGenerateError:
        raise
    except Exception as error:
        raise LoraGenerateError("lora_network_error", 502) from error


__all__ = [
    "LORA_GENERATE_SCHEMA_VERSION",
    "LORA_GENERATE_SCOPE",
    "LoraGenerateError",
    "LoraGenerateRequest",
    "LoraSpec",
    "generar_lora_fal",
]
