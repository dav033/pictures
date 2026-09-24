"""Gemini embedding provider shared by offline indexing and online queries."""

from __future__ import annotations

import asyncio
import hashlib
import math
import time
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Awaitable, Callable, Protocol


EMBEDDING_TASK_TYPE = "RETRIEVAL_DOCUMENT"
QUERY_EMBEDDING_TASK_TYPE = "RETRIEVAL_QUERY"
EMBEDDING_TASK_TYPES = {EMBEDDING_TASK_TYPE, QUERY_EMBEDDING_TASK_TYPE}
DEFAULT_EMBEDDING_MODEL = "gemini-embedding-2"
DEFAULT_EMBEDDING_DIMENSIONS = 768


@dataclass(frozen=True, slots=True)
class EmbeddingSettings:
    model: str = DEFAULT_EMBEDDING_MODEL
    dimensions: int = DEFAULT_EMBEDDING_DIMENSIONS
    task_type: str = EMBEDDING_TASK_TYPE
    max_attempts: int = 3
    retry_delay_seconds: float = 1.0

    def __post_init__(self) -> None:
        if not self.model.strip():
            raise ValueError("EMBEDDING_MODEL_REQUIRED")
        if self.model != DEFAULT_EMBEDDING_MODEL:
            raise ValueError("EMBEDDING_MODEL_MUST_BE_GEMINI_EMBEDDING_2")
        if self.dimensions != DEFAULT_EMBEDDING_DIMENSIONS:
            raise ValueError("EMBEDDING_DIMENSIONS_MUST_BE_768")
        if self.task_type not in EMBEDDING_TASK_TYPES:
            raise ValueError("EMBEDDING_TASK_TYPE_INVALID")
        if self.max_attempts < 1:
            raise ValueError("EMBEDDING_MAX_ATTEMPTS_INVALID")
        if self.retry_delay_seconds < 0:
            raise ValueError("EMBEDDING_RETRY_DELAY_INVALID")


class EmbeddingProvider(Protocol):
    async def embed(
        self, texts: Sequence[str], settings: EmbeddingSettings
    ) -> Sequence[Sequence[float]]:
        """Return one vector per input text, preserving input order."""


class GeminiEmbeddingProvider:
    """Thin async wrapper around the Google GenAI embedding API."""

    def __init__(self, api_key: str) -> None:
        if not api_key.strip():
            raise ValueError("GEMINI_API_KEY_REQUIRED")
        self._api_key = api_key
        self._client: object | None = None

    def _get_client(self) -> object:
        if self._client is None:
            from google import genai

            self._client = genai.Client(api_key=self._api_key)
        return self._client

    async def embed(
        self, texts: Sequence[str], settings: EmbeddingSettings
    ) -> Sequence[Sequence[float]]:
        if not texts:
            return ()

        from google.genai import types

        client = self._get_client()
        response = await client.aio.models.embed_content(  # type: ignore[attr-defined]
            model=settings.model,
            contents=list(texts),
            config=types.EmbedContentConfig(
                task_type=settings.task_type,
                output_dimensionality=settings.dimensions,
            ),
        )
        embeddings = getattr(response, "embeddings", None)
        if embeddings is None:
            raise RuntimeError("EMBEDDING_PROVIDER_EMPTY_RESPONSE")
        return tuple(tuple(float(value) for value in (item.values or ())) for item in embeddings)


def source_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def validate_embedding_batch(
    embeddings: Sequence[Sequence[float]],
    expected_count: int,
    dimensions: int,
) -> tuple[tuple[float, ...], ...]:
    if len(embeddings) != expected_count:
        raise ValueError(
            f"EMBEDDING_COUNT_MISMATCH: expected={expected_count} actual={len(embeddings)}"
        )

    validated: list[tuple[float, ...]] = []
    for index, values in enumerate(embeddings):
        vector = tuple(float(value) for value in values)
        if len(vector) != dimensions:
            raise ValueError(
                f"EMBEDDING_DIMENSION_MISMATCH: index={index} expected={dimensions} actual={len(vector)}"
            )
        if not all(math.isfinite(value) for value in vector):
            raise ValueError(f"EMBEDDING_NON_FINITE: index={index}")
        validated.append(vector)
    return tuple(validated)


def vector_literal(values: Sequence[float]) -> str:
    """Format a validated vector for asyncpg's pgvector parameter cast."""

    if not values or not all(math.isfinite(float(value)) for value in values):
        raise ValueError("EMBEDDING_VECTOR_INVALID")
    return "[" + ",".join(repr(float(value)) for value in values) + "]"


def is_retryable_provider_error(error: BaseException) -> bool:
    status = getattr(error, "status_code", getattr(error, "code", None))
    if isinstance(status, int):
        return status in {408, 429} or status >= 500
    if error.__class__.__module__.split(".", 1)[0] == "httpx":
        import httpx

        return isinstance(error, (httpx.NetworkError, httpx.TimeoutException))
    return isinstance(error, (TimeoutError, ConnectionError, OSError, asyncio.TimeoutError))


async def embed_with_retry(
    provider: EmbeddingProvider,
    texts: Sequence[str],
    settings: EmbeddingSettings,
    attempts: list[int] | None = None,
    on_attempt: Callable[[int, str, int], Awaitable[None]] | None = None,
) -> Sequence[Sequence[float]]:
    """Retry only transient provider failures; never retry invalid requests."""

    for attempt in range(settings.max_attempts):
        if attempts is not None:
            attempts[:] = [attempt + 1]
        started_at = time.monotonic()
        try:
            result = await provider.embed(texts, settings)
        except Exception as error:
            if on_attempt is not None:
                await on_attempt(
                    attempt + 1,
                    "error",
                    max(0, int((time.monotonic() - started_at) * 1000)),
                )
            if attempt + 1 >= settings.max_attempts or not is_retryable_provider_error(error):
                raise
            await asyncio.sleep(settings.retry_delay_seconds * (2**attempt))
        else:
            if on_attempt is not None:
                await on_attempt(
                    attempt + 1,
                    "ok",
                    max(0, int((time.monotonic() - started_at) * 1000)),
                )
            return result

    raise AssertionError("unreachable")
