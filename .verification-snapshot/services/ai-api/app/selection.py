"""Strict contract models for catalog selection and commercial validation."""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StrictInt, field_validator, model_validator

from app.operational_models import ContractModel, OperationalRequest


MAX_SAFE_INTEGER = 9_007_199_254_740_991
CatalogId = Annotated[str, Field(min_length=1, max_length=160)]


class CatalogSelectionError(Exception):
    """Stable domain error for ``/internal/v1/catalog/selection``.

    ``allowlist_product_mismatch`` (422): an allowlisted item pairs a variant
    with a product that does not own it in the published snapshot.
    """

    def __init__(self, code: str, status_code: int = 422) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code


class CatalogSelectionItemBody(ContractModel):
    """A model-generated selection containing identifiers only."""

    product_id: CatalogId
    variant_id: CatalogId
    quantity: StrictInt = Field(gt=0, le=MAX_SAFE_INTEGER)
    reason: str | None = Field(default=None, min_length=1, max_length=500)

    @field_validator("product_id", "variant_id", "reason")
    @classmethod
    def reject_blank_strings(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("selection values must not be blank")
        return value.strip() if value is not None else None


class CatalogSelectionAllowlistEntryBody(ContractModel):
    product_id: CatalogId
    variant_ids: list[CatalogId] = Field(min_length=1, max_length=256)

    @field_validator("product_id")
    @classmethod
    def normalize_product_id(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("allowlist product_id must not be blank")
        return normalized

    @field_validator("variant_ids")
    @classmethod
    def normalize_variant_ids(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() for value in values]
        if any(not value for value in normalized):
            raise ValueError("allowlist variant_ids must not be blank")
        return normalized


class CatalogSelectionRequest(OperationalRequest):
    """Authenticated operation body for commercial line validation."""

    schema_version: Literal["catalog-selection.v1"]
    request_id: UUID
    catalog_snapshot_id: CatalogId | None = None
    items: list[CatalogSelectionItemBody] = Field(min_length=1, max_length=64)
    allowlist: list[CatalogSelectionAllowlistEntryBody] = Field(max_length=256)

    @model_validator(mode="after")
    def validate_request_identity(self) -> "CatalogSelectionRequest":
        if str(self.request_id) != str(self.context.request_id):
            raise ValueError("request_id must match operational context")
        return self

    @field_validator("catalog_snapshot_id")
    @classmethod
    def normalize_snapshot_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("catalog_snapshot_id must not be blank")
        return normalized


__all__ = [
    "CatalogSelectionItemBody",
    "CatalogSelectionAllowlistEntryBody",
    "CatalogSelectionError",
    "CatalogSelectionRequest",
    "MAX_SAFE_INTEGER",
]
