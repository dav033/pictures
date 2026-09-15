"""Python-owned, read-only commercial catalog retrieval.

This module deliberately owns the SQL predicates that decide which catalog
rows may be shown to an application caller. Next may proxy the response, but
it must not reimplement these checks.
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import AsyncIterator, Mapping, Sequence
from contextlib import AbstractAsyncContextManager, AsyncExitStack, asynccontextmanager
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from math import isfinite
from typing import Annotated, Literal, Protocol, cast

import asyncpg
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, StrictInt, field_validator

from app.operational_models import OperationalRequest
from app.postgres_store import validate_database_url
from app.generated_models import CatalogRecommendationsResult
from app.recommendations import (
    CATALOG_RECOMMENDATIONS_RESULT_SCHEMA_VERSION,
    CatalogRecommendationError,
    CatalogRecommendationsRequest,
)
from app.selection import CatalogSelectionError, CatalogSelectionRequest, MAX_SAFE_INTEGER


logger = logging.getLogger(__name__)

# Neon closes idle connections and suspends compute after about five minutes,
# which is also asyncpg's default idle lifetime (300 s). Idle connections are
# closed well before that cut (E2E 2026-09-14: "Connection terminated").
POOL_MAX_INACTIVE_CONNECTION_LIFETIME_SECONDS = 60.0

CATALOG_SCOPE = "catalog.search"
CATALOG_SCHEMA_VERSION = "catalog-search.v1"
CATALOG_RESULT_SCHEMA_VERSION = "catalog-search-result.v1"
MAX_CATALOG_LIMIT = 50
DEFAULT_CATALOG_LIMIT = 15
TRIGRAM_MIN_SIMILARITY = 0.3
# Distinct search tokens considered by lexical retrieval; bounds per-row work.
MAX_LEXICAL_TERMS = 32
_FILTER_TEXT_MAX_LENGTH = 120
_FILTER_FACET_MAX_LENGTH = 80

CatalogId = Annotated[str, Field(min_length=1, max_length=160)]
FilterText = Annotated[str, Field(min_length=1, max_length=_FILTER_TEXT_MAX_LENGTH)]
FilterFacet = Annotated[str, Field(min_length=1, max_length=_FILTER_FACET_MAX_LENGTH)]
NonNegativeNumber = Annotated[
    FiniteFloat,
    Field(ge=0, le=MAX_SAFE_INTEGER),
]


class SearchFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    available: bool = True
    price_max: NonNegativeNumber | None = None
    categories: list[FilterText] = Field(default_factory=list, max_length=32)
    occasions: list[FilterText] = Field(default_factory=list, max_length=32)
    colors: list[FilterFacet] = Field(default_factory=list, max_length=16)
    finishes: list[FilterFacet] = Field(default_factory=list, max_length=16)
    shapes: list[FilterFacet] = Field(default_factory=list, max_length=16)
    diameters_inches: list[NonNegativeNumber] = Field(default_factory=list, max_length=16)

    @field_validator("categories", "occasions", "colors", "finishes", "shapes")
    @classmethod
    def normalize_text_filters(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() for value in values]
        if any(not value for value in normalized):
            raise ValueError("filter values must not be blank")
        return normalized


class AllowlistEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: CatalogId
    variant_ids: list[CatalogId] = Field(min_length=0, max_length=256)

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


class CatalogSearchRequest(OperationalRequest):
    """Authenticated operation body carried by the operational envelope."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["catalog-search.v1"]
    message: str = Field(min_length=1, max_length=2000)
    filters: SearchFilters
    allowlist: list[AllowlistEntry] = Field(max_length=256)
    limit: StrictInt = Field(ge=1, le=MAX_CATALOG_LIMIT)
    catalog_snapshot_id: CatalogId | None = None

    @field_validator("message")
    @classmethod
    def normalize_message(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("message must not be blank")
        return normalized

    @field_validator("catalog_snapshot_id")
    @classmethod
    def normalize_snapshot_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("catalog_snapshot_id must not be blank")
        return normalized


class CatalogConnection(Protocol):
    async def fetch(self, query: str, *args: object) -> Sequence[Mapping[str, object]]: ...

    async def fetchval(self, query: str, *args: object) -> object: ...


class CatalogPool(Protocol):
    def acquire(self) -> AbstractAsyncContextManager[CatalogConnection]: ...

    async def close(self) -> None: ...


def is_terminated_connection(error: BaseException) -> bool:
    """A connection the server or the network already closed; the statement never ran to completion."""
    if isinstance(
        error,
        (
            asyncpg.exceptions.PostgresConnectionError,
            asyncpg.exceptions.AdminShutdownError,
            ConnectionResetError,
            BrokenPipeError,
        ),
    ):
        return True
    return isinstance(error, asyncpg.exceptions.InterfaceError) and "closed" in str(error).lower()


class _ReconnectingConnection:
    """Runs a read-only catalog statement once more on a fresh connection if its connection was terminated.

    Every statement of this store is a single read without a transaction, so a
    replay has no effect beyond the read itself. The retry is bounded to one per
    statement, and the fresh connection stays held until the caller's block ends.
    """

    def __init__(
        self, pool: "CatalogPool", connection: CatalogConnection, stack: AsyncExitStack
    ) -> None:
        self._pool = pool
        self._connection = connection
        self._stack = stack

    async def _reconnect(self, error: Exception) -> CatalogConnection:
        if not is_terminated_connection(error):
            raise error
        logger.warning(
            "catalog read retried after a terminated connection: %s", type(error).__name__
        )
        self._connection = await self._stack.enter_async_context(self._pool.acquire())
        return self._connection

    async def fetch(self, query: str, *args: object) -> Sequence[Mapping[str, object]]:
        try:
            return await self._connection.fetch(query, *args)
        except Exception as error:
            connection = await self._reconnect(error)
        return await connection.fetch(query, *args)

    async def fetchval(self, query: str, *args: object) -> object:
        try:
            return await self._connection.fetchval(query, *args)
        except Exception as error:
            connection = await self._reconnect(error)
        return await connection.fetchval(query, *args)


class CatalogStore:
    """Async PostgreSQL store for the published commercial catalog."""

    durable = True

    def __init__(
        self,
        database_url: str,
        *,
        pool: CatalogPool | None = None,
        pool_min_size: int = 1,
        pool_max_size: int = 10,
    ) -> None:
        self.database_url = validate_database_url(database_url)
        if not 1 <= pool_min_size <= pool_max_size <= 64:
            raise ValueError("INVALID_CATALOG_POOL_SIZE")
        self._pool_min_size = pool_min_size
        self._pool_max_size = pool_max_size
        self._pool = pool
        self._owns_pool = pool is None

    async def start(self) -> None:
        if self._pool is None:
            self._pool = cast(
                CatalogPool,
                await asyncpg.create_pool(
                    dsn=self.database_url,
                    min_size=self._pool_min_size,
                    max_size=self._pool_max_size,
                    command_timeout=5.0,
                    max_inactive_connection_lifetime=POOL_MAX_INACTIVE_CONNECTION_LIFETIME_SECONDS,
                ),
            )

    async def close(self) -> None:
        pool = self._pool
        self._pool = None
        if pool is not None and self._owns_pool:
            await pool.close()

    async def check_ready(self) -> bool:
        pool = self._pool
        if pool is None:
            return False
        try:
            async with pool.acquire() as connection:
                result = await connection.fetchval(
                    """
                    WITH latest AS (
                      SELECT source_snapshot_id, published_products, published_variants
                        FROM rag_source_snapshots
                       WHERE source_kind = 'products_catalog' AND status = 'published'
                       ORDER BY published_at DESC NULLS LAST,
                                fetched_at DESC,
                                source_snapshot_id DESC
                       LIMIT 1
                    )
                    SELECT to_regclass('public.catalog_products') IS NOT NULL
                       AND to_regclass('public.catalog_variants') IS NOT NULL
                       AND to_regclass('public.rag_source_snapshots') IS NOT NULL
                       AND EXISTS (
                         SELECT 1
                           FROM latest s
                          WHERE s.published_products > 0
                            AND s.published_variants > 0
                            AND (
                              SELECT COUNT(*)
                                FROM catalog_products p
                               WHERE p.status = 'ACTIVE'
                                 AND p.source_snapshot_id = s.source_snapshot_id
                            ) = s.published_products
                            AND (
                              SELECT COUNT(*)
                                FROM catalog_variants v
                               WHERE v.source_snapshot_id = s.source_snapshot_id
                            ) = s.published_variants
                            AND NOT EXISTS (
                              SELECT 1
                                FROM catalog_products p
                               WHERE p.status = 'ACTIVE'
                                 AND p.source_snapshot_id IS DISTINCT FROM s.source_snapshot_id
                            )
                            AND NOT EXISTS (
                              SELECT 1
                                FROM catalog_variants v
                               WHERE v.source_snapshot_id IS DISTINCT FROM s.source_snapshot_id
                            )
                       )
                    """
                )
            return result is True
        except Exception:
            return False

    @asynccontextmanager
    async def _reading(self, pool: CatalogPool) -> AsyncIterator[CatalogConnection]:
        async with AsyncExitStack() as stack:
            connection = await stack.enter_async_context(pool.acquire())
            yield _ReconnectingConnection(pool, connection, stack)

    async def published_snapshot(self, snapshot_id: str) -> str | None:
        """Return the requested published snapshot, without selecting a fallback."""
        pool = self._pool
        if pool is None:
            raise RuntimeError("CATALOG_STORE_NOT_STARTED")
        async with self._reading(pool) as connection:
            value = await connection.fetchval(
                """
                SELECT source_snapshot_id
                  FROM rag_source_snapshots
                 WHERE source_kind = 'products_catalog'
                   AND status = 'published'
                   AND source_snapshot_id = $1
                 LIMIT 1
                """,
                snapshot_id,
            )
        return str(value) if value is not None else None

    async def fetch_plan_rows(
        self,
        snapshot_id: str,
        product_ids: Sequence[str],
        variant_ids: Sequence[str],
        lora_variant_ids: Sequence[str] = (),
    ) -> Sequence[Mapping[str, object]]:
        """Fetch only commercial rows eligible for deterministic plan resolution.

        The snapshot predicate is repeated for both tables. A product or variant
        from another publication is never allowed to enter the domain resolver.
        """
        pool = self._pool
        if pool is None:
            raise RuntimeError("CATALOG_STORE_NOT_STARTED")
        async with self._reading(pool) as connection:
            return await connection.fetch(
                """
                SELECT p.product_id,
                       v.variant_id,
                       v.sku,
                       v.sku_original,
                       v.source_snapshot_id,
                       v.source_variant_id,
                       v.inventory_quantity,
                       v.unidades_inferidas,
                       p.title AS producto_titulo,
                       v.title AS variante_titulo,
                       v.price AS precio,
                       NULLIF(to_jsonb(v)->>'unidades_paq', '')::integer AS unidades_paq,
                       v.available AS disponible,
                       p.available AS producto_disponible,
                       v.codigo_tamano,
                       v.forma,
                       v.diam_pulg,
                       COALESCE(p.derived->'colors', '[]'::jsonb) AS colores_producto,
                       COALESCE(v.derived_colors, ARRAY[]::text[]) AS colores_variante,
                       COALESCE(p.derived->'finishes', '[]'::jsonb) AS acabados_producto,
                       p.description_text AS descripcion,
                       COALESCE(NULLIF(BTRIM(v.image_url), ''),
                                NULLIF(BTRIM(p.image_urls[1]), '')) AS imagen,
                       v.currency
                  FROM catalog_variants v
                  JOIN catalog_products p ON p.product_id = v.product_id
                 WHERE (p.product_id = ANY($1::text[])
                    OR v.variant_id = ANY($2::text[])
                    OR v.variant_id = ANY($3::text[]))
                   AND p.status = 'ACTIVE'
                   AND p.source_snapshot_id = $4
                   AND v.source_snapshot_id = $4
                   AND p.available = TRUE
                   AND v.available = TRUE
                   AND v.currency = 'COP'
                   AND v.price > 0
                   AND NULLIF(to_jsonb(v)->>'unidades_paq', '')::integer > 0
                 ORDER BY v.variant_id
                """,
                sorted(set(product_ids)),
                sorted(set(variant_ids)),
                sorted(set(lora_variant_ids)),
                snapshot_id,
            )

    async def fetch_catalog_identity(
        self,
        snapshot_id: str,
        product_ids: Sequence[str],
        variant_ids: Sequence[str],
    ) -> Sequence[Mapping[str, object]]:
        """Return product/variant ownership rows for one snapshot.

        Identity only: status, availability, currency, and price are ignored so
        an ownership decision never depends on stock. ``catalog_variants``
        keys each variant to exactly one product.
        """
        pool = self._pool
        if pool is None:
            raise RuntimeError("CATALOG_STORE_NOT_STARTED")
        async with self._reading(pool) as connection:
            return await connection.fetch(
                """
                SELECT v.product_id, v.variant_id
                  FROM catalog_variants v
                  JOIN catalog_products p ON p.product_id = v.product_id
                 WHERE v.variant_id = ANY($2::text[])
                   AND v.source_snapshot_id = $1
                   AND p.source_snapshot_id = $1
                UNION ALL
                SELECT p.product_id, NULL::text AS variant_id
                  FROM catalog_products p
                 WHERE p.product_id = ANY($3::text[])
                   AND p.source_snapshot_id = $1
                """,
                snapshot_id,
                sorted(set(variant_ids)),
                sorted(set(product_ids)),
            )

    async def recommend(self, operation: CatalogRecommendationsRequest) -> dict[str, object]:
        """Return commercially eligible alternatives for one reference variant.

        The reference must exist in the requested published snapshot with an
        ACTIVE product. Candidates satisfy the same commercial predicates as
        plan resolution, so every recommended variant can actually be resolved.
        """
        pool = self._pool
        if pool is None:
            raise RuntimeError("CATALOG_STORE_NOT_STARTED")
        async with self._reading(pool) as connection:
            snapshot = await self._selection_snapshot(connection, operation.catalog_snapshot_id)
            if snapshot is None:
                raise CatalogRecommendationError("catalog_snapshot_not_found")
            snapshot_id = str(snapshot)
            references = await connection.fetch(
                """
                SELECT p.product_id,
                       p.derived->>'category' AS category,
                       v.codigo_tamano,
                       v.diam_pulg,
                       v.forma,
                       COALESCE(v.derived_colors, ARRAY[]::text[]) AS derived_colors
                  FROM catalog_variants v
                  JOIN catalog_products p ON p.product_id = v.product_id
                 WHERE v.variant_id = $1
                   AND p.status = 'ACTIVE'
                   AND p.source_snapshot_id = $2
                   AND v.source_snapshot_id = $2
                 LIMIT 1
                """,
                operation.reference_variant_id,
                snapshot_id,
            )
            if not references:
                raise CatalogRecommendationError("reference_variant_not_found")
            reference = references[0]
            query, params = _recommendation_query(operation, snapshot_id, reference)
            rows = await connection.fetch(query, *params)

        result: dict[str, object] = {
            "operation_schema_version": CATALOG_RECOMMENDATIONS_RESULT_SCHEMA_VERSION,
            "catalog_snapshot_id": snapshot_id,
            "reference": {
                "product_id": str(reference["product_id"]),
                "variant_id": operation.reference_variant_id,
                "size_code": _text_or_none(reference.get("codigo_tamano")),
                "diameter_inches": _number_or_none(reference.get("diam_pulg")),
                "shape": _text_or_none(reference.get("forma")),
                "category": _text_or_none(reference.get("category")),
                "colors": _string_list(reference.get("derived_colors")),
            },
            "candidates": _group_recommendations(rows),
        }
        CatalogRecommendationsResult.model_validate(result)
        return result

    async def search(self, operation: CatalogSearchRequest) -> dict[str, object]:
        pool = self._pool
        if pool is None:
            raise RuntimeError("CATALOG_STORE_NOT_STARTED")

        parse_started = time.perf_counter()
        extracted_sku = extract_sku(operation.message)
        parse_ms = round((time.perf_counter() - parse_started) * 1000)
        retrieval_started = time.perf_counter()
        sku_status = "not_sku"

        async with self._reading(pool) as connection:
            snapshot_id = await self._selection_snapshot(connection, operation.catalog_snapshot_id)
            if snapshot_id is None:
                return _empty_result(
                    "NO_MATCH",
                    "not_sku" if extracted_sku is None else "not_found",
                    None,
                    parse_ms,
                    _elapsed_ms(retrieval_started),
                )
            if extracted_sku is not None:
                rows, sku_status = await self._exact_rows(
                    connection, operation, extracted_sku, str(snapshot_id)
                )
                if sku_status == "ambiguous":
                    return _empty_result(
                        "AMBIGUOUS_SKU",
                        "ambiguous",
                        snapshot_id,
                        parse_ms,
                        _elapsed_ms(retrieval_started),
                    )
            else:
                rows = await self._lexical_rows(connection, operation, str(snapshot_id))

        candidates = _group_candidates(rows, operation.limit)
        result_status = "OK" if candidates else "NO_MATCH"
        whitelist = []
        for candidate in candidates:
            variants = cast(list[dict[str, object]], candidate["variants"])
            whitelist.append(
                {
                    "product_id": candidate["product_id"],
                    "variant_ids": [variant["variant_id"] for variant in variants],
                }
            )
        return {
            "operation_schema_version": CATALOG_RESULT_SCHEMA_VERSION,
            "status": result_status,
            "sku_status": sku_status,
            "candidates": candidates,
            "whitelist": whitelist,
            "catalog_snapshot_id": str(snapshot_id) if snapshot_id is not None else None,
            "latency_parse_ms": parse_ms,
            "latency_retrieval_ms": _elapsed_ms(retrieval_started),
        }

    async def select(self, operation: CatalogSelectionRequest) -> dict[str, object]:
        """Validate model-selected identifiers against the published catalog."""
        pool = self._pool
        if pool is None:
            raise RuntimeError("CATALOG_STORE_NOT_STARTED")

        allowlist: dict[str, set[str]] = {}
        for entry in operation.allowlist:
            allowlist.setdefault(entry.product_id, set()).update(entry.variant_ids)
        rejected: list[dict[str, object]] = []
        eligible_indices: list[int] = []
        seen_variant_ids: set[str] = set()
        for index, item in enumerate(operation.items):
            if item.variant_id in seen_variant_ids:
                rejected.append(
                    _rejection(
                        item.product_id, item.variant_id, "variant_id duplicado en la selección"
                    )
                )
                continue
            seen_variant_ids.add(item.variant_id)
            permitted_variants = allowlist.get(item.product_id)
            if permitted_variants is None:
                rejected.append(
                    _rejection(
                        item.product_id,
                        item.variant_id,
                        "product_id no estaba en los resultados recuperados de este turno",
                    )
                )
            elif item.variant_id not in permitted_variants:
                rejected.append(
                    _rejection(
                        item.product_id,
                        item.variant_id,
                        "variant_id no estaba en la whitelist de variantes recuperadas de este turno",
                    )
                )
            else:
                eligible_indices.append(index)

        async with self._reading(pool) as connection:
            snapshot_id = await self._selection_snapshot(connection, operation.catalog_snapshot_id)
            rows: Sequence[Mapping[str, object]] = []
            if snapshot_id is not None and eligible_indices:
                rows = await connection.fetch(
                    """
                    SELECT v.product_id, v.variant_id,
                           COALESCE(v.sku_original, v.sku) AS sku,
                           p.title AS product_title,
                           COALESCE(v.title, p.title) AS title,
                           v.price, p.image_urls[1] AS image_url, p.handle,
                           p.product_type, p.derived->>'category' AS category,
                           COALESCE(p.derived->'colors', '[]'::jsonb) AS product_colors,
                           COALESCE(v.derived_colors, ARRAY[]::text[]) AS variant_colors,
                           p.description_text AS description,
                           NULLIF(to_jsonb(v)->>'unidades_paq', '')::integer AS units_per_package,
                           v.codigo_tamano AS size_code, v.forma AS shape,
                           v.diam_pulg AS diameter_inches,
                           v.available AS variant_available,
                           v.inventory_quantity,
                           p.available AS product_available
                      FROM catalog_variants v
                      JOIN catalog_products p ON p.product_id = v.product_id
                     WHERE v.variant_id = ANY($1::text[])
                       AND v.source_snapshot_id = $2
                       AND p.source_snapshot_id = $2
                       AND p.status = 'ACTIVE'
                       AND v.currency = 'COP'
                       AND v.price > 0
                    """,
                    sorted({operation.items[index].variant_id for index in eligible_indices}),
                    str(snapshot_id),
                )

        row_by_variant = {str(row["variant_id"]): row for row in rows}
        validated: list[dict[str, object]] = []
        total_cop = 0
        for index in eligible_indices:
            item = operation.items[index]
            row = row_by_variant.get(item.variant_id)
            if row is None:
                rejected.append(
                    _rejection(
                        item.product_id,
                        item.variant_id,
                        "variant_id no existe en el snapshot publicado",
                    )
                )
                continue
            if str(row["product_id"]) != item.product_id:
                # Only allowlisted pairs reach this point, so the allowlist
                # itself pairs the variant with a product that does not own it.
                raise CatalogSelectionError("allowlist_product_mismatch", 422)
            if row.get("product_available") is not True or row.get("variant_available") is not True:
                rejected.append(_rejection(item.product_id, item.variant_id, "variante agotada"))
                continue
            inventory = _inventory_quantity(row.get("inventory_quantity"))
            if inventory is not None and inventory > 0 and item.quantity > inventory:
                rejected.append(
                    _rejection(
                        item.product_id,
                        item.variant_id,
                        f"cantidad solicitada ({item.quantity}) excede el inventario disponible ({inventory})",
                    )
                )
                continue
            price = _price_cop(row.get("price"))
            if price is None:
                rejected.append(
                    _rejection(item.product_id, item.variant_id, "precio no disponible")
                )
                continue
            subtotal = price * item.quantity
            if subtotal > MAX_SAFE_INTEGER:
                rejected.append(
                    _rejection(
                        item.product_id, item.variant_id, "subtotal fuera del rango permitido"
                    )
                )
                continue
            if total_cop + subtotal > MAX_SAFE_INTEGER:
                rejected.append(
                    _rejection(item.product_id, item.variant_id, "total fuera del rango permitido")
                )
                continue
            validated.append(
                {
                    "product_id": item.product_id,
                    "variant_id": item.variant_id,
                    "sku": row.get("sku") if isinstance(row.get("sku"), str) else None,
                    "product_title": str(row["product_title"]),
                    "title": str(row["title"]),
                    "unit_price_cop": price,
                    "quantity": item.quantity,
                    "subtotal_cop": subtotal,
                    "image_url": row.get("image_url")
                    if isinstance(row.get("image_url"), str)
                    else None,
                    "handle": row.get("handle") if isinstance(row.get("handle"), str) else None,
                    "product_type": row.get("product_type")
                    if isinstance(row.get("product_type"), str)
                    else None,
                    "category": row.get("category")
                    if isinstance(row.get("category"), str)
                    else None,
                    "colors": _selection_colors(
                        row.get("variant_colors"), row.get("product_colors")
                    ),
                    "description": row.get("description")
                    if isinstance(row.get("description"), str)
                    else None,
                    "units_per_package": _integer_or_none(row.get("units_per_package")),
                    "size_code": row.get("size_code")
                    if isinstance(row.get("size_code"), str)
                    else None,
                    "shape": row.get("shape") if isinstance(row.get("shape"), str) else None,
                    "diameter_inches": _number_or_none(row.get("diameter_inches")),
                }
            )
            total_cop += subtotal

        status = "ok" if not rejected else "partial" if validated else "empty"
        return {
            "operation_schema_version": "catalog-selection-result.v1",
            "status": status,
            "catalog_snapshot_id": str(snapshot_id) if snapshot_id is not None else None,
            "validados": validated,
            "rechazados": rejected,
            "total_cop": total_cop,
        }

    async def _selection_snapshot(
        self, connection: CatalogConnection, requested_snapshot_id: str | None
    ) -> object | None:
        if requested_snapshot_id is not None:
            return await connection.fetchval(
                """
                SELECT source_snapshot_id
                  FROM rag_source_snapshots
                 WHERE source_kind = 'products_catalog'
                   AND status = 'published'
                   AND source_snapshot_id = $1
                 LIMIT 1
                """,
                requested_snapshot_id,
            )
        return await connection.fetchval(
            """
            SELECT source_snapshot_id
              FROM rag_source_snapshots
             WHERE source_kind = 'products_catalog' AND status = 'published'
             ORDER BY published_at DESC NULLS LAST, fetched_at DESC
             LIMIT 1
            """
        )

    async def _exact_rows(
        self,
        connection: CatalogConnection,
        operation: CatalogSearchRequest,
        sku: str,
        snapshot_id: str,
    ) -> tuple[
        Sequence[Mapping[str, object]], Literal["unique", "ambiguous", "not_found", "filtered_out"]
    ]:
        original_values = [sku.upper()]
        canonical_values = [canonicalize_sku(sku)]
        identity_rows, identity_kind = await self._exact_identity_rows(
            connection, snapshot_id, original_values, canonical_values
        )
        if not identity_rows or identity_kind is None:
            return [], "not_found"
        if _sku_result(identity_rows) == "ambiguous":
            return [], "ambiguous"

        base, params = _base_query(operation, snapshot_id)
        sku_position = len(params) + 1
        sku_expression = (
            "UPPER(COALESCE(v.sku_original, v.sku, ''))"
            if identity_kind == "original"
            else "UPPER(COALESCE(v.sku_canonical, v.sku, ''))"
        )
        sku_values = original_values if identity_kind == "original" else canonical_values
        exact_sql = f"""
            SELECT {CATALOG_COLUMNS}, 1.0::float8 AS score
              FROM catalog_products p
              JOIN catalog_variants v ON v.product_id = p.product_id
             {base}
               AND {sku_expression} = ANY(${sku_position}::text[])
             ORDER BY p.product_id, v.diam_pulg ASC NULLS LAST
        """
        exact_rows = await connection.fetch(exact_sql, *params, sku_values)
        if not exact_rows:
            return [], "filtered_out"
        return exact_rows, _sku_result(exact_rows)

    async def _exact_identity_rows(
        self,
        connection: CatalogConnection,
        snapshot_id: str,
        original_values: list[str],
        canonical_values: list[str],
    ) -> tuple[Sequence[Mapping[str, object]], Literal["original", "canonical"] | None]:
        identity_where = """
            WHERE p.status = 'ACTIVE'
              AND p.source_snapshot_id = $1
              AND v.source_snapshot_id = $1
        """
        columns = "v.variant_id, v.sku_ambiguous"
        original_rows = await connection.fetch(
            f"""
            SELECT {columns}
              FROM catalog_products p
              JOIN catalog_variants v ON v.product_id = p.product_id
             {identity_where}
               AND UPPER(COALESCE(v.sku_original, v.sku, '')) = $2
            """,
            snapshot_id,
            original_values[0],
        )
        if original_rows:
            return original_rows, "original"
        canonical_rows = await connection.fetch(
            f"""
            SELECT {columns}
              FROM catalog_products p
              JOIN catalog_variants v ON v.product_id = p.product_id
             {identity_where}
               AND UPPER(COALESCE(v.sku_canonical, v.sku, '')) = $2
            """,
            snapshot_id,
            canonical_values[0],
        )
        return canonical_rows, "canonical" if canonical_rows else None

    async def _lexical_rows(
        self,
        connection: CatalogConnection,
        operation: CatalogSearchRequest,
        snapshot_id: str,
    ) -> Sequence[Mapping[str, object]]:
        """Rank rows that match ANY meaningful query term, or the whole message by trigram.

        Recall only: every commercial predicate stays in ``_base_query``. A
        customer message is prose ("arco de globos rosados"), so requiring every
        token (``plainto_tsquery`` ANDs them) returned NO_MATCH for products that
        exist. Each term goes through ``spanish_unaccent`` (the configuration of
        the generated ``p.search_tsv`` column used by the TypeScript retrieval),
        which drops stop words, removes accents and stems. The full-text score is
        the fraction of distinct meaningful terms a product matches, so a product
        covering more of the request ranks first.
        """
        base, params = _base_query(operation, snapshot_id)
        params.append(lexical_terms(operation.message))
        terms_position = len(params)
        params.append(operation.message.strip().lower())
        similarity_position = len(params)
        params.append(operation.limit * 16)
        limit_position = len(params)
        return await connection.fetch(
            f"""
            WITH query_terms AS (
              SELECT DISTINCT term_query
                FROM unnest(${terms_position}::text[]) AS term
               CROSS JOIN LATERAL plainto_tsquery('spanish_unaccent', term) AS term_query
               WHERE numnode(term_query) > 0
            ), term_total AS (
              SELECT count(*)::float8 AS total FROM query_terms
            )
            SELECT {CATALOG_COLUMNS},
                   GREATEST(
                     COALESCE(
                       (SELECT count(*) FROM query_terms t WHERE p.search_tsv @@ t.term_query)::float8
                         / NULLIF((SELECT total FROM term_total), 0),
                       0
                     ),
                     similarity(LOWER(COALESCE(p.search_text, '')), ${similarity_position})
                   )::float8 AS score
              FROM catalog_products p
              JOIN catalog_variants v ON v.product_id = p.product_id
             {base}
               AND (
                 EXISTS (SELECT 1 FROM query_terms t WHERE p.search_tsv @@ t.term_query)
                 OR similarity(LOWER(COALESCE(p.search_text, '')), ${similarity_position})
                   >= {TRIGRAM_MIN_SIMILARITY}
               )
             ORDER BY score DESC, p.product_id, v.diam_pulg ASC NULLS LAST, v.variant_id
             LIMIT ${limit_position}
            """,
            *params,
        )


CATALOG_COLUMNS = """
    p.product_id, p.title, p.derived, p.available AS product_available,
    p.image_urls[1] AS image,
    v.variant_id, COALESCE(v.sku_original, v.sku) AS sku, v.title AS variant_title,
    v.price, v.available AS variant_available, v.sku_ambiguous, v.codigo_tamano,
    v.diam_pulg, v.forma, v.derived_colors
""".strip()


def extract_sku(value: str) -> str | None:
    text = value.strip()
    if _looks_like_sku(text):
        return text
    b2b = re.search(r"\bB2B[-:][A-Z0-9][A-Z0-9._/-]{4,}\b", text, re.IGNORECASE)
    if b2b:
        return b2b.group(0)
    labeled_b2b = re.search(
        r"\b(?:SKU|REF|COD(?:IGO|IGO)|CÓDIGO)\s*[:#-]?\s*B2B\s+([A-Z0-9][A-Z0-9._/-]{4,})\b",
        text,
        re.IGNORECASE,
    )
    if labeled_b2b is not None:
        return f"B2B-{labeled_b2b.group(1)}"
    labeled = re.search(
        r"\b(?:SKU|REF|COD(?:IGO|IGO)|CÓDIGO)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{5,})\b",
        text,
        re.IGNORECASE,
    )
    if labeled is not None:
        return labeled.group(1)
    return text if re.fullmatch(r"\d{8,}", text) else None


def lexical_terms(message: str) -> list[str]:
    """Distinct word tokens of a search message, in order, bounded.

    Tokens are passed as a bound array and each one becomes its own
    ``plainto_tsquery``, so no tsquery syntax from the message is interpreted.
    Stop words are filtered by PostgreSQL's ``spanish_unaccent`` configuration.
    """
    terms: list[str] = []
    for token in re.findall(r"[^\W_]+", message.casefold()):
        if token not in terms:
            terms.append(token)
        if len(terms) >= MAX_LEXICAL_TERMS:
            break
    return terms


def canonicalize_sku(value: str) -> str:
    normalized = re.sub(r"\s+", " ", value.strip().upper())
    return re.sub(r"^B2B\s*[-:]\s*", "", normalized)


def _looks_like_sku(value: str) -> bool:
    return bool(
        re.fullmatch(r"SKU[-_].*", value, re.IGNORECASE)
        or (re.fullmatch(r"[A-Z0-9._/-]{8,}", value, re.IGNORECASE) and re.search(r"\d", value))
    )


def _base_query(operation: CatalogSearchRequest, snapshot_id: str) -> tuple[str, list[object]]:
    filters = operation.filters
    clauses = ["p.status = 'ACTIVE'", "p.source_snapshot_id = $1", "v.source_snapshot_id = $1"]
    params: list[object] = [snapshot_id]

    if filters.available:
        clauses.extend(["p.available = TRUE", "v.available = TRUE"])
    if filters.price_max is not None:
        params.append(filters.price_max)
        clauses.append(f"v.price <= ${len(params)}")
    if filters.categories:
        params.append(_normalized_values(filters.categories))
        clauses.append(f"p.derived->>'category' = ANY(${len(params)}::text[])")
    if filters.occasions:
        params.append(_normalized_values(filters.occasions))
        clauses.append(f"p.derived->'occasions' ?| ${len(params)}::text[]")
    if filters.shapes:
        params.append(_normalized_values(filters.shapes))
        clauses.append(f"v.forma = ANY(${len(params)}::text[])")
    if filters.diameters_inches:
        params.append(filters.diameters_inches)
        clauses.append(f"v.diam_pulg = ANY(${len(params)}::numeric[])")
        if not filters.shapes:
            clauses.append("v.forma = 'redondo'")
    if filters.finishes:
        params.append(_normalized_values(filters.finishes))
        clauses.append(f"p.derived->'finishes' ?| ${len(params)}::text[]")
    if filters.colors:
        params.append(_normalized_values(filters.colors))
        position = len(params)
        clauses.append(
            "((cardinality(v.derived_colors) > 0 AND v.derived_colors && "
            f"${position}::text[]) OR (cardinality(v.derived_colors) = 0 "
            "AND jsonb_array_length(p.derived->'colors') = 1 "
            f"AND p.derived->'colors' ?| ${position}::text[]))"
        )

    variant_ids = [variant_id for entry in operation.allowlist for variant_id in entry.variant_ids]
    if variant_ids:
        params.append(sorted(set(variant_ids)))
        clauses.append(f"v.variant_id = ANY(${len(params)}::text[])")
    elif operation.allowlist:
        params.append(sorted({entry.product_id for entry in operation.allowlist}))
        clauses.append(f"p.product_id = ANY(${len(params)}::text[])")

    return "WHERE " + " AND ".join(clauses), params


def _recommendation_query(
    operation: CatalogRecommendationsRequest,
    snapshot_id: str,
    reference: Mapping[str, object],
) -> tuple[str, list[object]]:
    """Build the candidate query for recommendations.

    Size code is preferred over diameter; a reference with neither adds no size
    clause. The LoRA restriction is applied before ``LIMIT`` so it cannot starve
    the result.
    """
    reference_product = str(reference["product_id"])
    params: list[object] = [snapshot_id, operation.reference_variant_id]
    clauses = [
        "p.status = 'ACTIVE'",
        "p.source_snapshot_id = $1",
        "v.source_snapshot_id = $1",
        "p.available = TRUE",
        "v.available = TRUE",
        "v.currency = 'COP'",
        "v.price > 0",
        "NULLIF(to_jsonb(v)->>'unidades_paq', '')::integer > 0",
        "v.variant_id <> $2",
    ]
    size_code = _text_or_none(reference.get("codigo_tamano"))
    diameter = reference.get("diam_pulg")
    if size_code is not None:
        params.append(size_code)
        clauses.append(f"v.codigo_tamano = ${len(params)}::text")
    elif diameter is not None:
        params.append(diameter)
        clauses.append(f"v.diam_pulg = ${len(params)}::numeric")
    shape = _text_or_none(reference.get("forma"))
    if shape is not None:
        params.append(shape)
        clauses.append(f"v.forma = ${len(params)}::text")
    params.append(reference_product)
    product_position = len(params)
    category = _text_or_none(reference.get("category"))
    if category is not None:
        params.append(category)
        clauses.append(
            f"(p.product_id = ${product_position}::text "
            f"OR p.derived->>'category' = ${len(params)}::text)"
        )
    else:
        clauses.append(f"p.product_id = ${product_position}::text")
    if operation.lora_variant_ids is not None:
        params.append(sorted(set(operation.lora_variant_ids)))
        clauses.append(f"v.variant_id = ANY(${len(params)}::text[])")
    params.append(operation.limit)
    limit_position = len(params)
    query = f"""
        SELECT {CATALOG_COLUMNS}
          FROM catalog_variants v
          JOIN catalog_products p ON p.product_id = v.product_id
         WHERE {" AND ".join(clauses)}
         ORDER BY CASE WHEN p.product_id = ${product_position}::text THEN 0 ELSE 1 END,
                  p.title ASC, v.price ASC, v.variant_id ASC
         LIMIT ${limit_position}
    """
    return query, params


def _group_recommendations(rows: Sequence[Mapping[str, object]]) -> list[dict[str, object]]:
    """Group candidate rows by product, preserving SQL order.

    A variant whose whole-COP price is not positive is skipped so the result
    stays valid under ``price > 0``; a product left without variants is omitted.
    """
    grouped: dict[str, dict[str, object]] = {}
    for row in rows:
        price = _price_cop(row.get("price"))
        if price is None or price <= 0:
            continue
        product_id = str(row["product_id"])
        candidate = grouped.setdefault(
            product_id,
            {
                "product_id": product_id,
                "title": str(row["title"]),
                "category": _text_or_none(_derived_value(row.get("derived"), "category")),
                "colors": _string_list(_derived_value(row.get("derived"), "colors")),
                "finishes": _string_list(_derived_value(row.get("derived"), "finishes")),
                "occasions": _string_list(_derived_value(row.get("derived"), "occasions")),
                "available": row.get("product_available") is True,
                "image": row.get("image") if isinstance(row.get("image"), str) else None,
                "variants": [],
            },
        )
        cast(list[dict[str, object]], candidate["variants"]).append(
            {
                "variant_id": str(row["variant_id"]),
                "sku": row.get("sku") if isinstance(row.get("sku"), str) else None,
                "title": row.get("variant_title")
                if isinstance(row.get("variant_title"), str)
                else None,
                "price": price,
                "available": row.get("variant_available") is True,
                "size_code": _text_or_none(row.get("codigo_tamano")),
                "diameter_inches": _number_or_none(row.get("diam_pulg")),
                "shape": _text_or_none(row.get("forma")),
                "colors": _string_list(row.get("derived_colors")),
            }
        )
    return list(grouped.values())


def _text_or_none(value: object) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


def _normalized_values(values: Sequence[str]) -> list[str]:
    return sorted({value.strip().lower() for value in values if value.strip()})


def _sku_result(rows: Sequence[Mapping[str, object]]) -> Literal["unique", "ambiguous"]:
    variant_ids = {str(row["variant_id"]) for row in rows}
    return (
        "ambiguous"
        if len(variant_ids) > 1 or any(row.get("sku_ambiguous") is True for row in rows)
        else "unique"
    )


def _group_candidates(rows: Sequence[Mapping[str, object]], limit: int) -> list[dict[str, object]]:
    grouped: dict[str, dict[str, object]] = {}
    for row in rows:
        product_id = str(row["product_id"])
        candidate = grouped.setdefault(
            product_id,
            {
                "product_id": product_id,
                "title": str(row["title"]),
                "category": _derived_value(row.get("derived"), "category"),
                "colors": _string_list(_derived_value(row.get("derived"), "colors")),
                "finishes": _string_list(_derived_value(row.get("derived"), "finishes")),
                "occasions": _string_list(_derived_value(row.get("derived"), "occasions")),
                "available": bool(row["product_available"]),
                "image": row.get("image") if isinstance(row.get("image"), str) else None,
                "score": _number_or_zero(row.get("score")),
                "variants": [],
            },
        )
        candidate["score"] = max(
            _number_or_zero(candidate.get("score")), _number_or_zero(row.get("score"))
        )
        cast(list[dict[str, object]], candidate["variants"]).append(
            {
                "variant_id": str(row["variant_id"]),
                "sku": row.get("sku") if isinstance(row.get("sku"), str) else None,
                "title": row.get("variant_title")
                if isinstance(row.get("variant_title"), str)
                else None,
                "price": _price_cop(row.get("price")) or 0,
                "available": bool(row["variant_available"]),
                "size_code": row.get("codigo_tamano")
                if isinstance(row.get("codigo_tamano"), str)
                else None,
                "diameter_inches": _number_or_none(row.get("diam_pulg")),
                "shape": row.get("forma") if isinstance(row.get("forma"), str) else None,
                "colors": _string_list(row.get("derived_colors")),
            }
        )
    return list(
        sorted(
            grouped.values(),
            key=lambda item: (-_number_or_zero(item.get("score")), str(item["product_id"])),
        )
    )[:limit]


def _derived_value(value: object, key: str) -> object:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return None
    return value.get(key) if isinstance(value, Mapping) else None


def _string_list(value: object) -> list[str]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return []
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str) and item.strip()]


def _number_or_none(value: object) -> float | None:
    if isinstance(value, (Decimal, int, float)) and not isinstance(value, bool):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _number_or_zero(value: object) -> float:
    return _number_or_none(value) or 0.0


def _integer_or_none(value: object) -> int | None:
    number = _number_or_none(value)
    return int(number) if number is not None and number.is_integer() and number > 0 else None


def _inventory_quantity(value: object) -> float | None:
    number = _number_or_none(value)
    return number if number is not None and isfinite(number) and number >= 0 else None


def _price_cop(value: object) -> int | None:
    try:
        price = Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, TypeError, ValueError):
        return None
    return int(price) if price >= 0 else None


def _selection_colors(variant_value: object, product_value: object) -> list[str]:
    variant_colors = _string_list(variant_value)
    if variant_colors:
        return variant_colors
    product_colors = _string_list(product_value)
    return product_colors if len(product_colors) == 1 else []


def _rejection(product_id: str, variant_id: str, reason: str) -> dict[str, object]:
    return {"product_id": product_id, "variant_id": variant_id, "reason": reason}


def _empty_result(
    status: Literal["OK", "NO_MATCH", "AMBIGUOUS_SKU"],
    sku_status: str,
    snapshot_id: object,
    parse_ms: int,
    retrieval_ms: int,
) -> dict[str, object]:
    return {
        "operation_schema_version": CATALOG_RESULT_SCHEMA_VERSION,
        "status": status,
        "sku_status": sku_status,
        "candidates": [],
        "whitelist": [],
        "catalog_snapshot_id": str(snapshot_id) if snapshot_id is not None else None,
        "latency_parse_ms": parse_ms,
        "latency_retrieval_ms": retrieval_ms,
    }


def _elapsed_ms(started: float) -> int:
    return max(0, round((time.perf_counter() - started) * 1000))


__all__ = [
    "CATALOG_SCOPE",
    "CatalogRecommendationsRequest",
    "CatalogSearchRequest",
    "CatalogSelectionRequest",
    "CatalogStore",
    "extract_sku",
]
