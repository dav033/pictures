import asyncio

import httpx
import pytest

from app.catalog_embeddings import (
    DEFAULT_EMBEDDING_MODEL,
    EmbeddingSettings,
    embed_with_retry,
    is_retryable_provider_error,
    source_hash,
    validate_embedding_batch,
    vector_literal,
)


def test_embedding_settings_keep_the_catalog_contract() -> None:
    settings = EmbeddingSettings()

    assert settings.model == DEFAULT_EMBEDDING_MODEL
    assert settings.dimensions == 768
    assert settings.task_type == "RETRIEVAL_DOCUMENT"


def test_embedding_settings_reject_other_dimensions() -> None:
    with pytest.raises(ValueError, match="768"):
        EmbeddingSettings(dimensions=1536)


def test_embedding_settings_reject_other_models() -> None:
    with pytest.raises(ValueError, match="GEMINI_EMBEDDING_2"):
        EmbeddingSettings(model="another-embedding-model")


def test_validate_embedding_batch_checks_count_dimensions_and_finiteness() -> None:
    values = validate_embedding_batch(((0.1, 0.2),), expected_count=1, dimensions=2)

    assert values == ((0.1, 0.2),)
    with pytest.raises(ValueError, match="COUNT"):
        validate_embedding_batch((), expected_count=1, dimensions=2)
    with pytest.raises(ValueError, match="DIMENSION"):
        validate_embedding_batch(((0.1,),), expected_count=1, dimensions=2)
    with pytest.raises(ValueError, match="NON_FINITE"):
        validate_embedding_batch(((float("nan"), 0.2),), expected_count=1, dimensions=2)


def test_source_hash_and_vector_literal_are_deterministic() -> None:
    assert source_hash("ramo de rosas") == source_hash("ramo de rosas")
    assert vector_literal((0.1, -2.0)) == "[0.1,-2.0]"


def test_embed_with_retry_retries_transient_errors_only() -> None:
    class TransientError(Exception):
        status_code = 503

    class Provider:
        def __init__(self) -> None:
            self.calls = 0

        async def embed(self, _texts: list[str], _settings: EmbeddingSettings) -> list[list[float]]:
            self.calls += 1
            if self.calls == 1:
                raise TransientError()
            return [[0.1]]

    provider = Provider()
    result = asyncio.run(
        embed_with_retry(
            provider,
            ["texto"],
            EmbeddingSettings(dimensions=768, retry_delay_seconds=0),
        )
    )

    assert result == [[0.1]]
    assert provider.calls == 2


def test_httpx_timeout_is_retryable() -> None:
    assert is_retryable_provider_error(httpx.ReadTimeout("transient"))
