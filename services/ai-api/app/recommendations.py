"""Strict contract models for Python-owned editor recommendations.

The stable domain error contract for ``/internal/v1/catalog/recommendations``:

| Code | HTTP status | Meaning |
| --- | ---: | --- |
| ``catalog_snapshot_not_found`` | 422 | The requested catalog snapshot is not published. |
| ``reference_variant_not_found`` | 422 | The reference variant has no ACTIVE product in that snapshot. |
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field, StrictInt, field_validator

from app.operational_models import OperationalRequest


CATALOG_RECOMMENDATIONS_SCOPE = "catalog.recommendations"
CATALOG_RECOMMENDATIONS_SCHEMA_VERSION = "catalog-recommendations.v1"
CATALOG_RECOMMENDATIONS_RESULT_SCHEMA_VERSION = "catalog-recommendations-result.v1"
MAX_RECOMMENDATIONS_LIMIT = 100
MAX_RECOMMENDATIONS_LORA_VARIANTS = 2048

CatalogId = Annotated[str, Field(min_length=1, max_length=160)]


class CatalogRecommendationError(Exception):
    """Stable domain error translated by the HTTP boundary."""

    def __init__(self, code: str, status_code: int = 422) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code


class CatalogRecommendationsRequest(OperationalRequest):
    """Authenticated operation body for recommendations inside one snapshot."""

    schema_version: Literal["catalog-recommendations.v1"]
    catalog_snapshot_id: CatalogId
    reference_variant_id: CatalogId
    lora_variant_ids: list[CatalogId] | None = Field(
        default=None, min_length=1, max_length=MAX_RECOMMENDATIONS_LORA_VARIANTS
    )
    limit: StrictInt = Field(ge=1, le=MAX_RECOMMENDATIONS_LIMIT)

    @field_validator("catalog_snapshot_id", "reference_variant_id")
    @classmethod
    def normalize_identifier(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("identifiers must not be blank")
        return normalized

    @field_validator("lora_variant_ids")
    @classmethod
    def normalize_lora_variant_ids(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return None
        normalized = [value.strip() for value in values]
        if any(not value for value in normalized):
            raise ValueError("lora_variant_ids must not contain blanks")
        if len(normalized) != len(set(normalized)):
            raise ValueError("lora_variant_ids must be unique")
        return normalized


__all__ = [
    "CATALOG_RECOMMENDATIONS_RESULT_SCHEMA_VERSION",
    "CATALOG_RECOMMENDATIONS_SCHEMA_VERSION",
    "CATALOG_RECOMMENDATIONS_SCOPE",
    "CatalogRecommendationError",
    "CatalogRecommendationsRequest",
    "MAX_RECOMMENDATIONS_LIMIT",
    "MAX_RECOMMENDATIONS_LORA_VARIANTS",
]
