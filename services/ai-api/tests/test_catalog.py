from __future__ import annotations

import hashlib
import json
import time
from contextlib import AbstractAsyncContextManager
from decimal import Decimal
from pathlib import Path
from typing import cast
from uuid import UUID

import pytest
from pydantic import ValidationError
from fastapi.testclient import TestClient

from app import generated_models
from app.catalog import (
    CatalogStore,
    CatalogSearchRequest,
    CatalogSelectionRequest,
    MAX_LEXICAL_TERMS,
    _group_candidates,
    _nearest_present_color,
    extract_sku,
    lexical_terms,
)
from app.generated_models import CatalogRecommendationsResult
from app.main import Settings, build_signature, create_app
from app.operational_store import InMemoryOperationalStore
from app.recommendations import CatalogRecommendationError, CatalogRecommendationsRequest
from app.selection import CatalogSelectionError


SECRET = "c" * 32


class FakeCatalogStore:
    async def search(self, operation: CatalogSearchRequest) -> dict[str, object]:
        return {
            "operation_schema_version": "catalog-search-result.v1",
            "status": "NO_MATCH",
            "sku_status": "not_sku",
            "candidates": [],
            "whitelist": [],
            "catalog_snapshot_id": "products_catalog:test",
            "latency_parse_ms": 0,
            "latency_retrieval_ms": 0,
        }

    async def select(self, operation: CatalogSelectionRequest) -> dict[str, object]:
        return {
            "operation_schema_version": "catalog-selection-result.v1",
            "status": "empty",
            "catalog_snapshot_id": "products_catalog:test",
            "validados": [],
            "rechazados": [],
            "total_cop": 0,
        }

    async def check_ready(self) -> bool:
        return True


class FakeSelectionConnection:
    def __init__(
        self,
        *,
        price: Decimal = Decimal("1500"),
        inventory_quantity: int | None = 3,
        variant_available: bool = True,
        product_available: bool = True,
    ) -> None:
        self.price = price
        self.inventory_quantity = inventory_quantity
        self.variant_available = variant_available
        self.product_available = product_available
        self.fetchval_calls: list[tuple[str, tuple[object, ...]]] = []
        self.fetch_calls: list[tuple[str, tuple[object, ...]]] = []

    async def fetchval(self, _query: str, *_args: object) -> object:
        self.fetchval_calls.append((_query, _args))
        return _args[0] if _args else "products_catalog:test"

    async def fetch(self, _query: str, *_args: object) -> list[dict[str, object]]:
        self.fetch_calls.append((_query, _args))
        return [
            {
                "product_id": "P-1",
                "variant_id": "V-1",
                "sku": "SKU-1",
                "product_title": "Globos rojos",
                "title": "Globos rojos - R12",
                "price": self.price,
                "image_url": "https://cdn.example/p-1.jpg",
                "handle": "globos-rojos",
                "product_type": "Globo",
                "category": "globo_latex",
                "product_colors": ["rojo"],
                "variant_colors": [],
                "description": "Descripción",
                "units_per_package": 10,
                "size_code": "R12",
                "shape": "redondo",
                "diameter_inches": Decimal("12"),
                "variant_available": self.variant_available,
                "inventory_quantity": self.inventory_quantity,
                "product_available": self.product_available,
            }
        ]


class FakeSelectionPool:
    def __init__(self, **connection_options: object) -> None:
        self.connection = FakeSelectionConnection(**connection_options)

    def acquire(self) -> AbstractAsyncContextManager[FakeSelectionConnection]:
        connection = self.connection

        class Acquire:
            async def __aenter__(self) -> FakeSelectionConnection:
                return connection

            async def __aexit__(self, *_args: object) -> None:
                return None

        return Acquire()


def _request(**overrides: object) -> CatalogSearchRequest:
    value: dict[str, object] = {
        "context": {
            "schema_version": "operational.v1",
            "request_id": "00000000-0000-0000-0000-000000000000",
            "correlation_id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
            "deadline_at": "2030-01-01T00:00:00Z",
            "deadline_ms": 1000,
            "body_sha256": "a" * 64,
            "scopes": ["catalog.search"],
        },
        "schema_version": "catalog-search.v1",
        "message": "globos rojos",
        "filters": {"available": True},
        "allowlist": [],
        "limit": 15,
    }
    value.update(overrides)
    return CatalogSearchRequest.model_validate(value)


def _selection_request(
    *,
    items: list[dict[str, object]] | None = None,
    allowlist: list[dict[str, object]] | None = None,
    catalog_snapshot_id: str | None = None,
) -> CatalogSelectionRequest:
    value: dict[str, object] = {
        "context": {
            "schema_version": "operational.v1",
            "request_id": "00000000-0000-4000-8000-000000000001",
            "correlation_id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
            "deadline_at": "2030-01-01T00:00:00Z",
            "deadline_ms": 1000,
            "body_sha256": "a" * 64,
            "scopes": ["catalog.selection"],
        },
        "schema_version": "catalog-selection.v1",
        "request_id": "00000000-0000-4000-8000-000000000001",
        "items": items or [{"product_id": "P-1", "variant_id": "V-1", "quantity": 1}],
        "allowlist": allowlist or [{"product_id": "P-1", "variant_ids": ["V-1"]}],
    }
    if catalog_snapshot_id is not None:
        value["catalog_snapshot_id"] = catalog_snapshot_id
    return CatalogSelectionRequest.model_validate(value)


def test_catalog_request_is_strict_and_bounded() -> None:
    request = _request()
    assert request.filters.available
    assert request.limit == 15

    with pytest.raises(ValidationError):
        _request(unknown_field=True)
    with pytest.raises(ValidationError):
        _request(limit=51)


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("SKU-ABC-12345", "SKU-ABC-12345"),
        ("Necesito la referencia B2B-20000723", "B2B-20000723"),
        ("busca código: 20000723", "20000723"),
        ("globos rojos para una boda", None),
        ("R-12", None),
    ],
)
def test_extract_sku_preserves_exact_customer_reference(message: str, expected: str | None) -> None:
    assert extract_sku(message) == expected


def test_lexical_terms_are_distinct_bounded_words_without_query_syntax() -> None:
    assert lexical_terms("Arco de GLOBOS rosados & !látex | 'blanco' arco_de <-> globos") == [
        "arco",
        "de",
        "globos",
        "rosados",
        "látex",
        "blanco",
    ]
    assert lexical_terms("  ¿?  ") == []
    many = " ".join(f"t{index}" for index in range(MAX_LEXICAL_TERMS + 10))
    assert lexical_terms(many) == [f"t{index}" for index in range(MAX_LEXICAL_TERMS)]


@pytest.mark.anyio
@pytest.mark.parametrize(
    "message",
    ["globo latex rosado blanco", "Quiero un arco de globos rosados"],
)
async def test_catalog_lexical_search_matches_any_meaningful_term(message: str) -> None:
    pool = FakeSelectionPool()
    store = CatalogStore("postgresql://demo:demo@localhost/demo", pool=pool)

    await store.search(
        _request(
            message=message,
            filters={"available": True, "colors": ["rosa"], "diameters_inches": [12]},
        )
    )

    # A requested color filter first checks which colors the snapshot actually
    # stocks (_resolve_colors), so it can resolve one that is not sold to the
    # nearest one that is; the fake connection has none, so "rosa" passes
    # through unresolved and the main query below is unchanged.
    assert len(pool.connection.fetch_calls) == 2
    presence_query, presence_args = pool.connection.fetch_calls[0]
    assert "SELECT DISTINCT color" in presence_query
    assert presence_args == ("products_catalog:test",)
    query, args = pool.connection.fetch_calls[1]
    normalized = " ".join(query.split())
    # Regression: plainto_tsquery over the whole message ANDed every word.
    assert "plainto_tsquery('simple'" not in normalized
    assert "FROM unnest($4::text[]) AS term" in normalized
    assert (
        "CROSS JOIN LATERAL plainto_tsquery('spanish_unaccent', term) AS term_query" in normalized
    )
    assert "WHERE numnode(term_query) > 0" in normalized
    assert "EXISTS (SELECT 1 FROM query_terms t WHERE p.search_tsv @@ t.term_query)" in normalized
    assert "similarity(LOWER(COALESCE(p.search_text, '')), $5) >= 0.3" in normalized
    assert (
        "ORDER BY score DESC, p.product_id, v.diam_pulg ASC NULLS LAST, v.variant_id" in normalized
    )
    assert normalized.endswith("LIMIT $6")
    # Commercial predicates are unchanged and still bind before the terms.
    for predicate in (
        "p.status = 'ACTIVE'",
        "p.available = TRUE",
        "v.available = TRUE",
        "v.diam_pulg = ANY($2::numeric[])",
        "v.forma = 'redondo'",
        "v.derived_colors && $3::text[]",
    ):
        assert predicate in normalized
    assert args[0] == "products_catalog:test"
    assert args[1] == [12]
    assert args[2] == ["rosa"]
    assert args[3] == lexical_terms(message)
    assert args[4] == message.strip().lower()
    assert args[5] == 15 * 16
    assert len(args) == 6


class FakeColorResolutionConnection:
    """Distinguishes the two queries a color filter now triggers: which colors
    the snapshot stocks (`SELECT DISTINCT color`), and the candidate rows for
    whichever colors `_resolve_colors` decided to search."""

    def __init__(self, present_colors: list[str], candidate_rows: list[dict[str, object]]) -> None:
        self.present_colors = present_colors
        self.candidate_rows = candidate_rows
        self.fetch_calls: list[tuple[str, tuple[object, ...]]] = []

    async def fetchval(self, _query: str, *args: object) -> object:
        return args[0] if args else "products_catalog:test"

    async def fetch(self, query: str, *args: object) -> list[dict[str, object]]:
        self.fetch_calls.append((query, args))
        if "SELECT DISTINCT color" in query:
            return [{"color": color} for color in self.present_colors]
        return self.candidate_rows


class FakeColorResolutionPool:
    def __init__(self, present_colors: list[str], candidate_rows: list[dict[str, object]]) -> None:
        self.connection = FakeColorResolutionConnection(present_colors, candidate_rows)

    def acquire(self) -> AbstractAsyncContextManager[FakeColorResolutionConnection]:
        connection = self.connection

        class Acquire:
            async def __aenter__(self) -> FakeColorResolutionConnection:
                return connection

            async def __aexit__(self, *_args: object) -> None:
                return None

        return Acquire()


def _red_balloon_row(color: str = "rojo") -> dict[str, object]:
    return {
        "product_id": "P-ROJO",
        "title": "Globo latex rojo",
        "derived": {"category": "globo_latex", "colors": [color], "finishes": [], "occasions": []},
        "product_available": True,
        "image": None,
        "variant_id": "V-ROJO-12",
        "sku": "SKU-ROJO-12",
        "variant_title": "R-12",
        "price": 4000,
        "variant_available": True,
        "sku_ambiguous": False,
        "codigo_tamano": "R-12",
        "diam_pulg": 12,
        "forma": "redondo",
        "derived_colors": [color],
        "score": 1.0,
    }


@pytest.mark.anyio
async def test_catalog_search_resolves_a_color_the_snapshot_lacks_to_the_nearest_stocked_one() -> None:
    """Bug: a photo's dominant color ("burdeos") has no exact catalog product
    and the search returned nothing for it, so the color silently vanished
    from the plan. The catalog now resolves it to the nearest color it truly
    stocks, by chromatic distance (x-tonos-colores-catalogo, owned by
    similitud-color.ts) rather than a hand-kept synonym table, and reports the
    substitution instead of dropping the request.
    """
    pool = FakeColorResolutionPool(present_colors=["rojo"], candidate_rows=[_red_balloon_row("rojo")])
    store = CatalogStore("postgresql://demo:demo@localhost/demo", pool=pool)

    result = await store.search(
        _request(message="globo latex burdeos", filters={"available": True, "colors": ["burdeos"]})
    )

    assert result["color_substitutions"] == [{"pedido": "burdeos", "entregado": "rojo"}]
    assert result["status"] == "OK"
    candidates = cast(list[dict[str, object]], result["candidates"])
    assert [candidate["product_id"] for candidate in candidates] == ["P-ROJO"]
    # The main query searched for the resolved color, never the literal word
    # the snapshot does not sell.
    _presence_query, _presence_args = pool.connection.fetch_calls[0]
    _main_query, main_args = pool.connection.fetch_calls[1]
    assert main_args[1] == ["rojo"]


@pytest.mark.anyio
async def test_catalog_search_keeps_an_exact_color_request_untouched() -> None:
    pool = FakeColorResolutionPool(present_colors=["rojo"], candidate_rows=[_red_balloon_row("rojo")])
    store = CatalogStore("postgresql://demo:demo@localhost/demo", pool=pool)

    result = await store.search(
        _request(message="globo latex rojo", filters={"available": True, "colors": ["rojo"]})
    )

    assert result["color_substitutions"] == []
    assert result["status"] == "OK"


@pytest.mark.anyio
async def test_catalog_search_reports_no_substitution_when_nothing_close_is_stocked() -> None:
    """The snapshot has nothing at all: the requested color passes through
    unresolved so the search still reports NO_MATCH honestly."""
    pool = FakeColorResolutionPool(present_colors=[], candidate_rows=[])
    store = CatalogStore("postgresql://demo:demo@localhost/demo", pool=pool)

    result = await store.search(
        _request(message="globo latex burdeos", filters={"available": True, "colors": ["burdeos"]})
    )

    assert result["color_substitutions"] == []
    assert result["status"] == "NO_MATCH"


@pytest.mark.anyio
async def test_catalog_search_does_not_invent_a_substitute_for_a_color_the_table_does_not_know() -> None:
    """Regresion encontrada corriendo el servicio contra el catalogo real.

    El analizador de fotos se inventa nombres de color: "frambuesa" no esta en la
    tabla de tonos, asi que puntua igual (`_UNRELATED_DISTANCE`) contra TODOS los
    colores en stock y el desempate alfabetico elegia el primero -- una foto
    frambuesa se resolvia a amarillo. Sustituir exige una distancia; sin ella no
    hay nada que medir y la peticion se deja intacta.
    """
    pool = FakeColorResolutionPool(present_colors=["amarillo", "azul", "rojo"], candidate_rows=[])
    store = CatalogStore("postgresql://demo:demo@localhost/demo", pool=pool)

    result = await store.search(
        _request(message="globo latex frambuesa", filters={"available": True, "colors": ["frambuesa"]})
    )

    assert result["color_substitutions"] == []
    assert result["status"] == "NO_MATCH"


def test_nearest_present_color_needs_a_measurable_distance() -> None:
    en_stock = ["amarillo", "azul", "blanco", "rojo", "verde"]
    # Burdeos SI tiene tono (350) y rojo esta a 10 grados: se sustituye.
    assert _nearest_present_color("burdeos", en_stock) == "rojo"
    # Frambuesa no esta en la tabla: ningun candidato esta relacionado.
    assert _nearest_present_color("frambuesa", en_stock) is None
    # Sin nada en stock tampoco hay a que parecerse.
    assert _nearest_present_color("burdeos", []) is None


def test_group_candidates_only_contains_rows_returned_by_sql() -> None:
    rows = [
        {
            "product_id": "P-1",
            "title": "Globos rojos",
            "derived": '{"category":"latex","colors":["rojo"],"finishes":[],"occasions":[]}',
            "product_available": True,
            "image": "https://cdn.example/p-1.jpg",
            "variant_id": "V-1",
            "sku": "SKU-1",
            "variant_title": "R-12",
            "price": 1000,
            "variant_available": True,
            "codigo_tamano": "R-12",
            "diam_pulg": 12,
            "forma": "redondo",
            "derived_colors": '["rojo"]',
            "score": 0.9,
        }
    ]

    result = _group_candidates(rows, 15)

    assert result[0]["product_id"] == "P-1"
    assert result[0]["variants"] == [
        {
            "variant_id": "V-1",
            "sku": "SKU-1",
            "title": "R-12",
            "price": 1000.0,
            "available": True,
            "size_code": "R-12",
            "diameter_inches": 12.0,
            "shape": "redondo",
            "colors": ["rojo"],
        }
    ]


def test_catalog_endpoint_uses_python_contract_boundary() -> None:
    operation = {
        "schema_version": "catalog-search.v1",
        "message": "globos rojos",
        "filters": {"available": True},
        "allowlist": [],
        "limit": 15,
    }
    body_hash = hashlib.sha256(
        json.dumps(operation, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()
    body = json.dumps(
        {
            "context": {
                "schema_version": "operational.v1",
                "request_id": "00000000-0000-4000-8000-000000000001",
                "correlation_id": "00000000-0000-4000-8000-000000000002",
                "deadline_at": "2030-01-01T00:00:00Z",
                "deadline_ms": 1000,
                "body_sha256": body_hash,
                "scopes": ["catalog.search"],
            },
            **operation,
        },
        separators=(",", ":"),
    ).encode()
    timestamp = int(time.time())
    nonce = UUID("00000000-0000-4000-8000-000000000003")
    headers = {
        "content-type": "application/json",
        "x-internal-schema-version": "operational.v1",
        "x-internal-timestamp": str(timestamp),
        "x-internal-nonce": str(nonce),
        "x-internal-scopes": "catalog.search",
        "x-internal-signature": build_signature(
            secret=SECRET,
            method="POST",
            path="/internal/v1/catalog/search",
            timestamp=timestamp,
            nonce=nonce,
            scopes=["catalog.search"],
            body=body,
        ),
    }
    app = create_app(
        Settings(environment="test", hmac_secret=SECRET),
        operational_store=InMemoryOperationalStore(),
        catalog_store=FakeCatalogStore(),
    )

    with TestClient(app) as client:
        response = client.post("/internal/v1/catalog/search", content=body, headers=headers)

    assert response.status_code == 200
    assert response.json()["schema_version"] == "operational.v1"
    assert response.json()["payload"]["operation_schema_version"] == "catalog-search-result.v1"
    assert response.json()["payload"]["status"] == "NO_MATCH"


def test_catalog_selection_endpoint_uses_python_contract_boundary() -> None:
    operation = {
        "schema_version": "catalog-selection.v1",
        "request_id": "00000000-0000-4000-8000-000000000001",
        "items": [{"product_id": "P-1", "variant_id": "V-1", "quantity": 2}],
        "allowlist": [{"product_id": "P-1", "variant_ids": ["V-1"]}],
    }
    body_hash = hashlib.sha256(
        json.dumps(operation, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()
    body = json.dumps(
        {
            "context": {
                "schema_version": "operational.v1",
                "request_id": "00000000-0000-4000-8000-000000000001",
                "correlation_id": "00000000-0000-4000-8000-000000000002",
                "deadline_at": "2030-01-01T00:00:00Z",
                "deadline_ms": 1000,
                "body_sha256": body_hash,
                "scopes": ["catalog.selection"],
            },
            **operation,
        },
        separators=(",", ":"),
    ).encode()
    timestamp = int(time.time())
    nonce = UUID("00000000-0000-4000-8000-000000000004")
    headers = {
        "content-type": "application/json",
        "x-internal-schema-version": "operational.v1",
        "x-internal-timestamp": str(timestamp),
        "x-internal-nonce": str(nonce),
        "x-internal-scopes": "catalog.selection",
        "x-internal-signature": build_signature(
            secret=SECRET,
            method="POST",
            path="/internal/v1/catalog/selection",
            timestamp=timestamp,
            nonce=nonce,
            scopes=["catalog.selection"],
            body=body,
        ),
    }
    app = create_app(
        Settings(environment="test", hmac_secret=SECRET),
        operational_store=InMemoryOperationalStore(),
        catalog_store=FakeCatalogStore(),
    )

    with TestClient(app) as client:
        response = client.post("/internal/v1/catalog/selection", content=body, headers=headers)

    assert response.status_code == 200
    response_body = response.json()
    assert set(response_body) == {"schema_version", "request_id", "correlation_id", "payload"}
    assert response_body["schema_version"] == "operational.v1"
    assert response_body["request_id"] == operation["request_id"]
    assert response_body["correlation_id"] == "00000000-0000-4000-8000-000000000002"
    assert response_body["payload"]["operation_schema_version"] == "catalog-selection-result.v1"
    assert response_body["payload"]["status"] == "empty"


class FakeSkuConnection:
    def __init__(self, identity_rows: list[dict[str, object]]) -> None:
        self.identity_rows = identity_rows
        self.fetch_calls: list[tuple[str, tuple[object, ...]]] = []

    async def fetchval(self, _query: str, *_args: object) -> object:
        return "products_catalog:test"

    async def fetch(self, query: str, *_args: object) -> list[dict[str, object]]:
        self.fetch_calls.append((query, _args))
        if "SELECT v.variant_id, v.sku_ambiguous" in query:
            return self.identity_rows
        return []


class FakeSkuPool:
    def __init__(self, identity_rows: list[dict[str, object]]) -> None:
        self.connection = FakeSkuConnection(identity_rows)

    def acquire(self) -> AbstractAsyncContextManager[FakeSkuConnection]:
        connection = self.connection

        class Acquire:
            async def __aenter__(self) -> FakeSkuConnection:
                return connection

            async def __aexit__(self, *_args: object) -> None:
                return None

        return Acquire()


@pytest.mark.anyio
async def test_catalog_operations_pin_the_requested_published_snapshot() -> None:
    pool = FakeSelectionPool()
    store = CatalogStore("postgresql://demo:demo@localhost/demo", pool=pool)
    snapshot_id = "products_catalog:requested"

    search_result = await store.search(_request(catalog_snapshot_id=snapshot_id))
    selection_result = await store.select(_selection_request(catalog_snapshot_id=snapshot_id))

    assert search_result["catalog_snapshot_id"] == snapshot_id
    assert selection_result["catalog_snapshot_id"] == snapshot_id
    assert pool.connection.fetchval_calls[0][1] == (snapshot_id,)
    assert pool.connection.fetchval_calls[1][1] == (snapshot_id,)


@pytest.mark.anyio
async def test_catalog_search_reports_ambiguous_sku_before_applying_filters() -> None:
    pool = FakeSkuPool(
        [
            {"variant_id": "V-1", "sku_ambiguous": False},
            {"variant_id": "V-2", "sku_ambiguous": False},
        ]
    )
    store = CatalogStore("postgresql://demo:demo@localhost/demo", pool=pool)

    result = await store.search(_request(message="SKU-DUPLICADO", filters={"available": True}))

    assert result["status"] == "AMBIGUOUS_SKU"
    assert result["sku_status"] == "ambiguous"
    assert result["candidates"] == []
    assert len(pool.connection.fetch_calls) == 1


@pytest.mark.anyio
async def test_catalog_search_distinguishes_sku_filtered_out_from_not_found() -> None:
    pool = FakeSkuPool([{"variant_id": "V-1", "sku_ambiguous": False}])
    store = CatalogStore("postgresql://demo:demo@localhost/demo", pool=pool)

    result = await store.search(_request(message="SKU-AGOTADO", filters={"available": True}))

    assert result["status"] == "NO_MATCH"
    assert result["sku_status"] == "filtered_out"
    assert result["candidates"] == []
    assert any("v.available = TRUE" in query for query, _args in pool.connection.fetch_calls)
    assert len(pool.connection.fetch_calls) == 2
    assert not any("sku_canonical" in query for query, _args in pool.connection.fetch_calls)


@pytest.mark.anyio
async def test_catalog_selection_validates_whitelist_and_calculates_authoritative_total() -> None:
    store = CatalogStore("postgresql://demo:demo@localhost/demo", pool=FakeSelectionPool())
    request = CatalogSelectionRequest.model_validate(
        {
            "context": {
                "schema_version": "operational.v1",
                "request_id": "00000000-0000-4000-8000-000000000001",
                "correlation_id": "00000000-0000-4000-8000-000000000002",
                "deadline_at": "2030-01-01T00:00:00Z",
                "deadline_ms": 1000,
                "body_sha256": "a" * 64,
                "scopes": ["catalog.selection"],
            },
            "schema_version": "catalog-selection.v1",
            "request_id": "00000000-0000-4000-8000-000000000001",
            "items": [
                {"product_id": "P-1", "variant_id": "V-1", "quantity": 2},
                {"product_id": "P-2", "variant_id": "V-2", "quantity": 1},
            ],
            "allowlist": [{"product_id": "P-1", "variant_ids": ["V-1"]}],
        }
    )

    result = await store.select(request)

    assert result["status"] == "partial"
    assert result["total_cop"] == 3000
    assert result["validados"][0]["unit_price_cop"] == 1500
    assert result["rechazados"] == [
        {
            "product_id": "P-2",
            "variant_id": "V-2",
            "reason": "product_id no estaba en los resultados recuperados de este turno",
        }
    ]


@pytest.mark.anyio
async def test_catalog_selection_rejects_variant_outside_the_whitelist() -> None:
    pool = FakeSelectionPool()
    store = CatalogStore("postgresql://demo:demo@localhost/demo", pool=pool)

    result = await store.select(
        _selection_request(
            items=[{"product_id": "P-1", "variant_id": "V-2", "quantity": 1}],
            allowlist=[{"product_id": "P-1", "variant_ids": ["V-1"]}],
        )
    )

    assert result["status"] == "empty"
    assert result["validados"] == []
    assert result["total_cop"] == 0
    assert result["rechazados"] == [
        {
            "product_id": "P-1",
            "variant_id": "V-2",
            "reason": "variant_id no estaba en la whitelist de variantes recuperadas de este turno",
        }
    ]
    assert pool.connection.fetch_calls == []


@pytest.mark.anyio
async def test_catalog_selection_rejects_quantity_above_inventory() -> None:
    pool = FakeSelectionPool(inventory_quantity=3)
    store = CatalogStore("postgresql://demo:demo@localhost/demo", pool=pool)

    result = await store.select(
        _selection_request(items=[{"product_id": "P-1", "variant_id": "V-1", "quantity": 4}])
    )

    assert result["status"] == "empty"
    assert result["validados"] == []
    assert result["total_cop"] == 0
    assert result["rechazados"] == [
        {
            "product_id": "P-1",
            "variant_id": "V-1",
            "reason": "cantidad solicitada (4) excede el inventario disponible (3.0)",
        }
    ]


@pytest.mark.anyio
async def test_catalog_selection_rejects_duplicate_variant_lines() -> None:
    pool = FakeSelectionPool()
    store = CatalogStore("postgresql://demo:demo@localhost/demo", pool=pool)

    result = await store.select(
        _selection_request(
            items=[
                {"product_id": "P-1", "variant_id": "V-1", "quantity": 2},
                {"product_id": "P-1", "variant_id": "V-1", "quantity": 3},
            ]
        )
    )

    assert result["status"] == "partial"
    assert result["validados"] and result["validados"][0]["quantity"] == 2
    assert result["total_cop"] == 3000
    assert result["rechazados"] == [
        {
            "product_id": "P-1",
            "variant_id": "V-1",
            "reason": "variant_id duplicado en la selección",
        }
    ]


@pytest.mark.anyio
async def test_catalog_selection_rounds_prices_to_whole_cop_before_arithmetic() -> None:
    pool = FakeSelectionPool(price=Decimal("1250.50"))
    store = CatalogStore("postgresql://demo:demo@localhost/demo", pool=pool)

    result = await store.select(
        _selection_request(items=[{"product_id": "P-1", "variant_id": "V-1", "quantity": 3}])
    )

    assert result["status"] == "ok"
    assert result["validados"][0]["unit_price_cop"] == 1251
    assert result["validados"][0]["subtotal_cop"] == 3753
    assert result["total_cop"] == 3753


ROOT = Path(__file__).resolve().parents[3]
FIXTURES = ROOT / "contracts" / "domain" / "v1" / "fixtures"
RECOMMENDATION_SNAPSHOT = "products_catalog:fixture"


def _signed_operation(
    path: str, operation: dict[str, object], scopes: list[str], nonce: UUID
) -> tuple[bytes, dict[str, str]]:
    body_hash = hashlib.sha256(
        json.dumps(operation, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()
    body = json.dumps(
        {
            "context": {
                "schema_version": "operational.v1",
                "request_id": "00000000-0000-4000-8000-000000000001",
                "correlation_id": "00000000-0000-4000-8000-000000000002",
                "deadline_at": "2030-01-01T00:00:00Z",
                "deadline_ms": 1000,
                "body_sha256": body_hash,
                "scopes": scopes,
            },
            **operation,
        },
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode()
    timestamp = int(time.time())
    headers = {
        "content-type": "application/json",
        "x-internal-schema-version": "operational.v1",
        "x-internal-timestamp": str(timestamp),
        "x-internal-nonce": str(nonce),
        "x-internal-scopes": ",".join(scopes),
        "x-internal-signature": build_signature(
            secret=SECRET,
            method="POST",
            path=path,
            timestamp=timestamp,
            nonce=nonce,
            scopes=scopes,
            body=body,
        ),
    }
    return body, headers


def _fixture(name: str) -> dict[str, object]:
    value: object = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    assert isinstance(value, dict)
    return value


@pytest.mark.anyio
async def test_catalog_selection_rejects_allowlist_pairing_variant_with_foreign_product() -> None:
    pool = FakeSelectionPool()
    store = CatalogStore("postgresql://demo:demo@localhost/demo", pool=pool)

    with pytest.raises(CatalogSelectionError) as raised:
        await store.select(
            _selection_request(
                items=[{"product_id": "P-2", "variant_id": "V-1", "quantity": 1}],
                allowlist=[{"product_id": "P-2", "variant_ids": ["V-1"]}],
            )
        )

    assert raised.value.code == "allowlist_product_mismatch"
    assert raised.value.status_code == 422


class RaisingSelectionStore(FakeCatalogStore):
    async def select(self, operation: CatalogSelectionRequest) -> dict[str, object]:
        raise CatalogSelectionError("allowlist_product_mismatch", 422)


def test_catalog_selection_endpoint_translates_product_variant_mismatch() -> None:
    operation: dict[str, object] = {
        "schema_version": "catalog-selection.v1",
        "request_id": "00000000-0000-4000-8000-000000000001",
        "items": [{"product_id": "P-2", "variant_id": "V-1", "quantity": 1}],
        "allowlist": [{"product_id": "P-2", "variant_ids": ["V-1"]}],
    }
    body, headers = _signed_operation(
        "/internal/v1/catalog/selection",
        operation,
        ["catalog.selection"],
        UUID("00000000-0000-4000-8000-000000000021"),
    )
    app = create_app(
        Settings(environment="test", hmac_secret=SECRET),
        operational_store=InMemoryOperationalStore(),
        catalog_store=RaisingSelectionStore(),
    )

    with TestClient(app) as client:
        response = client.post("/internal/v1/catalog/selection", content=body, headers=headers)

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "allowlist_product_mismatch"


def _recommendation_request(**overrides: object) -> CatalogRecommendationsRequest:
    value: dict[str, object] = {
        "context": {
            "schema_version": "operational.v1",
            "request_id": "00000000-0000-4000-8000-000000000001",
            "correlation_id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
            "deadline_at": "2030-01-01T00:00:00Z",
            "deadline_ms": 1000,
            "body_sha256": "a" * 64,
            "scopes": ["catalog.recommendations"],
        },
        "schema_version": "catalog-recommendations.v1",
        "catalog_snapshot_id": RECOMMENDATION_SNAPSHOT,
        "reference_variant_id": "var-rojo-12",
        "limit": 100,
    }
    value.update(overrides)
    return CatalogRecommendationsRequest.model_validate(value)


def _candidate_row(
    product_id: str, variant_id: str, *, title: str, price: Decimal
) -> dict[str, object]:
    return {
        "product_id": product_id,
        "title": title,
        "derived": '{"category":"globo_latex","colors":["rojo"],"finishes":[],"occasions":[]}',
        "product_available": True,
        "image": None,
        "variant_id": variant_id,
        "sku": f"SKU-{variant_id}",
        "variant_title": "R-12",
        "price": price,
        "variant_available": True,
        "sku_ambiguous": False,
        "codigo_tamano": "R-12",
        "diam_pulg": Decimal("12"),
        "forma": "redondo",
        "derived_colors": ["rojo"],
    }


class FakeRecommendationConnection:
    def __init__(
        self,
        *,
        snapshot: str | None = RECOMMENDATION_SNAPSHOT,
        reference: dict[str, object] | None = None,
        candidates: list[dict[str, object]] | None = None,
    ) -> None:
        self.snapshot = snapshot
        self.reference = reference
        self.candidates = candidates or []
        self.fetch_calls: list[tuple[str, tuple[object, ...]]] = []

    async def fetchval(self, _query: str, *args: object) -> object:
        return self.snapshot if args and args[0] == self.snapshot else None

    async def fetch(self, query: str, *args: object) -> list[dict[str, object]]:
        self.fetch_calls.append((query, args))
        if "AS derived_colors" in query:
            return [self.reference] if self.reference is not None else []
        return self.candidates


class FakeRecommendationPool:
    def __init__(self, connection: FakeRecommendationConnection) -> None:
        self.connection = connection

    def acquire(self) -> AbstractAsyncContextManager[FakeRecommendationConnection]:
        connection = self.connection

        class Acquire:
            async def __aenter__(self) -> FakeRecommendationConnection:
                return connection

            async def __aexit__(self, *_args: object) -> None:
                return None

        return Acquire()


def _reference(**overrides: object) -> dict[str, object]:
    value: dict[str, object] = {
        "product_id": "prod-rojo",
        "category": "globo_latex",
        "codigo_tamano": "R-12",
        "diam_pulg": Decimal("12"),
        "forma": "redondo",
        "derived_colors": ["rojo"],
    }
    value.update(overrides)
    return value


def _normalized_sql(query: str) -> str:
    return " ".join(query.split())


def _recommendation_store(connection: FakeRecommendationConnection) -> CatalogStore:
    return CatalogStore(
        "postgresql://demo:demo@localhost/demo", pool=FakeRecommendationPool(connection)
    )


@pytest.mark.anyio
async def test_catalog_recommendations_apply_commercial_predicates_before_limit() -> None:
    connection = FakeRecommendationConnection(reference=_reference())

    await _recommendation_store(connection).recommend(
        _recommendation_request(lora_variant_ids=["var-b", "var-a"], limit=40)
    )

    reference_query, reference_args = connection.fetch_calls[0]
    assert reference_args == ("var-rojo-12", RECOMMENDATION_SNAPSHOT)
    reference_sql = _normalized_sql(reference_query)
    assert "p.status = 'ACTIVE'" in reference_sql
    assert "p.source_snapshot_id = $2 AND v.source_snapshot_id = $2" in reference_sql
    assert "available" not in reference_sql

    query, args = connection.fetch_calls[1]
    sql = _normalized_sql(query)
    for predicate in (
        "p.status = 'ACTIVE'",
        "p.source_snapshot_id = $1",
        "v.source_snapshot_id = $1",
        "p.available = TRUE",
        "v.available = TRUE",
        "v.currency = 'COP'",
        "v.price > 0",
        "NULLIF(to_jsonb(v)->>'unidades_paq', '')::integer > 0",
        "v.variant_id <> $2",
        "v.codigo_tamano = $3::text",
        "v.forma = $4::text",
        "(p.product_id = $5::text OR p.derived->>'category' = $6::text)",
        "v.variant_id = ANY($7::text[])",
        "LIMIT $8",
    ):
        assert predicate in sql, predicate
    assert "diam_pulg =" not in sql
    assert sql.index("v.variant_id = ANY($7::text[])") < sql.index("LIMIT $8")
    assert args == (
        RECOMMENDATION_SNAPSHOT,
        "var-rojo-12",
        "R-12",
        "redondo",
        "prod-rojo",
        "globo_latex",
        ["var-a", "var-b"],
        40,
    )


@pytest.mark.anyio
async def test_catalog_recommendations_fall_back_to_diameter_and_same_product() -> None:
    connection = FakeRecommendationConnection(
        reference=_reference(codigo_tamano=None, forma=None, category=None)
    )

    await _recommendation_store(connection).recommend(_recommendation_request())

    query, args = connection.fetch_calls[1]
    sql = _normalized_sql(query)
    assert "v.diam_pulg = $3::numeric" in sql
    assert "codigo_tamano =" not in sql
    assert "v.forma =" not in sql
    assert "p.product_id = $4::text" in sql
    assert "derived->>'category' =" not in sql
    assert "ANY(" not in sql
    assert args == (RECOMMENDATION_SNAPSHOT, "var-rojo-12", Decimal("12"), "prod-rojo", 100)


@pytest.mark.anyio
async def test_catalog_recommendations_group_in_sql_order_and_validate_result() -> None:
    rows = [
        _candidate_row("prod-rojo", "var-rojo-12-x50", title="Rojo", price=Decimal("28977")),
        _candidate_row("prod-azul", "var-azul-12", title="Azul", price=Decimal("8831.6")),
        _candidate_row("prod-verde", "var-verde-12", title="Verde", price=Decimal("0.4")),
        _candidate_row("prod-azul", "var-azul-12-x50", title="Azul", price=Decimal("29500")),
    ]
    connection = FakeRecommendationConnection(reference=_reference(), candidates=rows)

    result = await _recommendation_store(connection).recommend(_recommendation_request())

    CatalogRecommendationsResult.model_validate(result)
    assert result["catalog_snapshot_id"] == RECOMMENDATION_SNAPSHOT
    assert result["reference"] == {
        "product_id": "prod-rojo",
        "variant_id": "var-rojo-12",
        "size_code": "R-12",
        "diameter_inches": 12.0,
        "shape": "redondo",
        "category": "globo_latex",
        "colors": ["rojo"],
    }
    candidates = cast(list[dict[str, object]], result["candidates"])
    assert [candidate["product_id"] for candidate in candidates] == ["prod-rojo", "prod-azul"]
    azul_variants = cast(list[dict[str, object]], candidates[1]["variants"])
    assert [variant["variant_id"] for variant in azul_variants] == [
        "var-azul-12",
        "var-azul-12-x50",
    ]
    assert azul_variants[0]["price"] == 8832


@pytest.mark.anyio
async def test_catalog_recommendations_report_missing_snapshot_and_reference() -> None:
    missing_snapshot = FakeRecommendationConnection(snapshot=None, reference=_reference())
    with pytest.raises(CatalogRecommendationError) as snapshot_error:
        await _recommendation_store(missing_snapshot).recommend(_recommendation_request())
    assert snapshot_error.value.code == "catalog_snapshot_not_found"
    assert snapshot_error.value.status_code == 422
    assert missing_snapshot.fetch_calls == []

    missing_reference = FakeRecommendationConnection(reference=None)
    with pytest.raises(CatalogRecommendationError) as reference_error:
        await _recommendation_store(missing_reference).recommend(_recommendation_request())
    assert reference_error.value.code == "reference_variant_not_found"
    assert reference_error.value.status_code == 422
    assert len(missing_reference.fetch_calls) == 1


def test_catalog_recommendations_request_is_strict_and_bounded() -> None:
    with pytest.raises(ValidationError):
        _recommendation_request(lora_variant_ids=[])
    with pytest.raises(ValidationError):
        _recommendation_request(lora_variant_ids=["var-a", "var-a"])
    with pytest.raises(ValidationError):
        _recommendation_request(limit=101)
    with pytest.raises(ValidationError):
        _recommendation_request(reference_variant_id="  ")
    with pytest.raises(ValidationError):
        _recommendation_request(unexpected=True)


def test_catalog_recommendations_fixtures_match_python_models() -> None:
    request_fixture = _fixture("catalog-recommendations-request.json")
    result_fixture = _fixture("catalog-recommendations-result.json")

    generated_models.CatalogRecommendationsRequest.model_validate(request_fixture)
    CatalogRecommendationsResult.model_validate(result_fixture)
    parsed = _recommendation_request(**request_fixture)
    assert parsed.model_dump(mode="json", exclude={"context"}, exclude_none=True) == request_fixture


class RecommendingCatalogStore(FakeCatalogStore):
    def __init__(self, error: CatalogRecommendationError | None = None) -> None:
        self.error = error

    async def recommend(self, operation: CatalogRecommendationsRequest) -> dict[str, object]:
        if self.error is not None:
            raise self.error
        result = _fixture("catalog-recommendations-result.json")
        assert result["catalog_snapshot_id"] == operation.catalog_snapshot_id
        return result


def _post_recommendations(
    store: FakeCatalogStore, scopes: list[str], nonce: UUID
) -> tuple[int, dict[str, object]]:
    body, headers = _signed_operation(
        "/internal/v1/catalog/recommendations",
        _fixture("catalog-recommendations-request.json"),
        scopes,
        nonce,
    )
    app = create_app(
        Settings(environment="test", hmac_secret=SECRET),
        operational_store=InMemoryOperationalStore(),
        catalog_store=store,
    )
    with TestClient(app) as client:
        response = client.post(
            "/internal/v1/catalog/recommendations", content=body, headers=headers
        )
    return response.status_code, response.json()


def test_catalog_recommendations_endpoint_uses_signed_python_contract() -> None:
    status, body = _post_recommendations(
        RecommendingCatalogStore(),
        ["catalog.recommendations"],
        UUID("00000000-0000-4000-8000-000000000031"),
    )

    assert status == 200, body
    assert body["payload"] == _fixture("catalog-recommendations-result.json")


def test_catalog_recommendations_endpoint_requires_its_own_scope() -> None:
    status, body = _post_recommendations(
        RecommendingCatalogStore(),
        ["catalog.search"],
        UUID("00000000-0000-4000-8000-000000000032"),
    )

    assert status == 403
    assert cast(dict[str, object], body["detail"])["code"] == "insufficient_scope"


@pytest.mark.parametrize("code", ["catalog_snapshot_not_found", "reference_variant_not_found"])
def test_catalog_recommendations_endpoint_translates_domain_errors(code: str) -> None:
    status, body = _post_recommendations(
        RecommendingCatalogStore(CatalogRecommendationError(code)),
        ["catalog.recommendations"],
        UUID("00000000-0000-4000-8000-000000000033"),
    )

    assert status == 422
    assert cast(dict[str, object], body["detail"])["code"] == code
