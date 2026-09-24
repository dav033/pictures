"""Uzume -- the Gemini Interactions API call inside image generation/composition.

TypeScript (`src/lib/ia/uzume/imagen.ts`) still owns everything that is not a
network call to the provider: which images go in, with what role/allowed_use
label (`lora-gemini-composition.ts` and the caller build the full labeled
`input` array), and what `ImagenPort` does with the result. This module makes
exactly the one call `crearImagenGemini`'s `generar()` used to make directly
with `client.interactions.create(...)` -- nothing here decides what goes into
the prompt or what the image means to the rest of the app. Migration context:
docs/architecture/decisions/0026-migrar-las-ias-a-python.md.

The Interactions API is new enough (dated 2026 in the JS SDK) that it forced
upgrading `google-genai` from 1.21.1 (no `interactions` at all) to 2.24.0,
which in turn required `pydantic>=2.12.5` -- see the ADR for the compatibility
sweep that upgrade required across Watatsumi/Inari/Amaterasu.
"""

from __future__ import annotations

from typing import Callable, Literal, Union

from pydantic import Field

from app.operational_models import ContractModel, OperationalRequest


IMAGE_GENERATE_SCOPE = "ia.image_generate"
IMAGE_GENERATE_SCHEMA_VERSION = "image-generate.v1"
DEFAULT_MODEL = "gemini-3.1-flash-image"
MAX_INPUT_BLOCKS = 60


class ImageGenerateError(Exception):
    """Stable domain error translated by the HTTP boundary. `code` mirrors the
    ErrorIA causas the direct adapter reports (categorizarError in
    src/lib/ia/uzume/imagen.ts) so the TypeScript side can classify a Python
    failure exactly like a direct-provider one."""

    def __init__(self, code: str, status_code: int = 502) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code


class TextInputBlock(ContractModel):
    type: Literal["text"]
    # Guards against absurd input only (the 11MB body cap is the real ceiling):
    # the composition prompt carries the whole blueprint and plan.
    text: str = Field(min_length=1, max_length=400_000)


class ImageInputBlock(ContractModel):
    type: Literal["image"]
    data: str = Field(min_length=1, max_length=15_000_000)
    mime_type: Literal["image/png", "image/jpeg", "image/webp"]


InteractionInputBlock = Union[TextInputBlock, ImageInputBlock]


class ImageGenerateRequest(OperationalRequest):
    """Authenticated operation body for one Gemini Interactions call. `input`
    travels already fully composed (prompt + per-image role/allowed_use
    labels) from TypeScript -- this module never decides what a reference
    image is for, only sends it.
    """

    schema_version: Literal["image-generate.v1"]
    model: str = Field(default=DEFAULT_MODEL, min_length=1, max_length=200)
    input: list[InteractionInputBlock] = Field(min_length=1, max_length=MAX_INPUT_BLOCKS)
    store: bool = True
    previous_interaction_id: str | None = Field(default=None, max_length=200)
    aspect_ratio: Literal["1:1", "2:3", "3:2", "16:9"]
    image_size: Literal["1K", "2K"]


def _usage_dict(usage: object) -> dict[str, int] | None:
    if usage is None:
        return None
    fields = {
        "total_input_tokens": getattr(usage, "total_input_tokens", None),
        "total_output_tokens": getattr(usage, "total_output_tokens", None),
        "total_thought_tokens": getattr(usage, "total_thought_tokens", None),
        "total_cached_tokens": getattr(usage, "total_cached_tokens", None),
        "total_tool_use_tokens": getattr(usage, "total_tool_use_tokens", None),
        "total_tokens": getattr(usage, "total_tokens", None),
    }
    counted = {key: int(value) for key, value in fields.items() if isinstance(value, int)}
    return counted or None


def _extract_image_base64(interaction: object) -> str | None:
    """Mirrors `extraerImagen` in imagen.ts: the top-level `output_image` is
    the documented field, but a fallback scan of `steps` covers the case
    where the model routed the image through a step instead (the same
    defensive shape the JS adapter already had for an untyped response)."""

    output_image = getattr(interaction, "output_image", None)
    data = getattr(output_image, "data", None) if output_image else None
    if isinstance(data, str) and data:
        return data
    for step in getattr(interaction, "steps", None) or []:
        content = getattr(step, "content", None)
        for block in content or []:
            if getattr(block, "type", None) == "image":
                block_data = getattr(block, "data", None)
                if isinstance(block_data, str) and block_data:
                    return block_data
    return None


def _classify_error(message: str) -> tuple[str, int]:
    """Same substring classification as `categorizarError` in imagen.ts, so a
    Python-path failure reaches the client with the same ui-error.v1 code a
    direct-Gemini failure would."""

    m = message.lower()
    if "api key" in m or "permission" in m:
        return "image_generate_unavailable", 503
    if "quota" in m or "429" in m:
        return "image_generate_quota", 429
    if "safety" in m or "blocked" in m:
        return "image_generate_filtered", 422
    if "timeout" in m:
        return "image_generate_timeout", 504
    return "image_generate_provider_error", 502


def _default_client(api_key: str) -> object:
    from google import genai

    return genai.Client(api_key=api_key)


async def crear_interaccion_gemini(
    payload: ImageGenerateRequest,
    client_factory: Callable[[str], object] | None = None,
) -> dict[str, object]:
    """Makes the one Gemini Interactions call `crearImagenGemini`'s
    `generar()` used to make directly from TypeScript. Raises
    ImageGenerateError on any provider failure or a completed interaction
    with no image -- never falls back silently."""

    import os

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise ImageGenerateError("image_generate_unavailable", 503)

    client = (client_factory or _default_client)(api_key)
    body: dict[str, object] = {
        "model": payload.model,
        "input": [block.model_dump(exclude_none=True) for block in payload.input],
        "store": payload.store,
        "response_format": {
            "type": "image",
            "mime_type": "image/jpeg",
            "aspect_ratio": payload.aspect_ratio,
            "image_size": payload.image_size,
        },
    }
    if payload.previous_interaction_id:
        body["previous_interaction_id"] = payload.previous_interaction_id

    try:
        interaction = await client.aio.interactions.create(**body)  # type: ignore[attr-defined]
    except Exception as error:
        code, status = _classify_error(str(error))
        raise ImageGenerateError(code, status) from error

    interaction_status = getattr(interaction, "status", None)
    if interaction_status not in (None, "completed"):
        errors = getattr(interaction, "errors", None) or []
        message = "; ".join(str(getattr(e, "message", e)) for e in errors) or f"interaction status={interaction_status}"
        code, http_status = _classify_error(message)
        raise ImageGenerateError(code, http_status)

    image_base64 = _extract_image_base64(interaction)
    if not image_base64:
        raise ImageGenerateError("image_generate_empty_response", 502)

    return {
        "image_base64": image_base64,
        "model": payload.model,
        "interaction_id": getattr(interaction, "id", None),
        "usage": _usage_dict(getattr(interaction, "usage", None)),
    }


__all__ = [
    "DEFAULT_MODEL",
    "IMAGE_GENERATE_SCHEMA_VERSION",
    "IMAGE_GENERATE_SCOPE",
    "ImageGenerateError",
    "ImageGenerateRequest",
    "crear_interaccion_gemini",
]
