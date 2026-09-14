from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Sequence, cast
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import MAX_BODY_BYTES, Settings, build_signature, create_app
from app.operational_store import InMemoryOperationalStore
from app.plan import (
    MAX_PLAN_LORA_VARIANTS,
    PlanResolutionError,
    PlanResolutionRequest,
    _candidate,
    _alternatives,
    _declared_pairs,
    _eje,
    _product_variant_mismatches,
    _material_waste_only_savings,
    _optimizar_cobertura,
    _plan_cost_optimizer_enabled,
    resolve_plan,
)
from app.recommendations import MAX_RECOMMENDATIONS_LORA_VARIANTS


ROOT = Path(__file__).parents[3]
SNAPSHOT = "products_catalog:test"
SECRET = "p" * 32


def _identity_rows(
    rows: Sequence[dict[str, object]],
    product_ids: Sequence[str],
    variant_ids: Sequence[str],
) -> list[dict[str, object]]:
    """Mirror the identity SQL: variant owners plus requested known products."""
    identity: list[dict[str, object]] = [
        {"product_id": row["product_id"], "variant_id": row["variant_id"]}
        for row in rows
        if row["variant_id"] in variant_ids
    ]
    known_products = dict.fromkeys(str(row["product_id"]) for row in rows)
    identity.extend(
        {"product_id": product_id, "variant_id": None}
        for product_id in known_products
        if product_id in product_ids
    )
    return identity


class FakePlanStore:
    def __init__(self, rows: Sequence[dict[str, object]], snapshot: str | None = SNAPSHOT) -> None:
        self.rows = list(rows)
        self.snapshot = snapshot
        self.requested_snapshot: str | None = None
        self.requested_ids: tuple[list[str], list[str], list[str]] | None = None
        self.identity_calls: list[tuple[list[str], list[str]]] = []

    async def published_snapshot(self, snapshot_id: str) -> str | None:
        self.requested_snapshot = snapshot_id
        return self.snapshot if snapshot_id == self.snapshot else None

    async def fetch_plan_rows(
        self,
        snapshot_id: str,
        product_ids: Sequence[str],
        variant_ids: Sequence[str],
        lora_variant_ids: Sequence[str] = (),
    ) -> Sequence[dict[str, object]]:
        self.requested_ids = (list(product_ids), list(variant_ids), list(lora_variant_ids))
        assert snapshot_id == SNAPSHOT
        return self.rows

    async def fetch_catalog_identity(
        self,
        snapshot_id: str,
        product_ids: Sequence[str],
        variant_ids: Sequence[str],
    ) -> Sequence[dict[str, object]]:
        assert snapshot_id == SNAPSHOT
        self.identity_calls.append((list(product_ids), list(variant_ids)))
        return _identity_rows(self.rows, product_ids, variant_ids)

    async def check_ready(self) -> bool:
        return True


def _request(
    *, allowlist: list[dict[str, object]] | None = None, lora: list[str] | None = None
) -> PlanResolutionRequest:
    plan = json.loads(
        (ROOT / "contracts" / "domain" / "v1" / "fixtures" / "plan-resuelto-ok.json").read_text(
            encoding="utf-8"
        )
    )["plan"]
    return PlanResolutionRequest.model_validate(
        {
            "context": {
                "schema_version": "operational.v1",
                "request_id": "00000000-0000-4000-8000-000000000001",
                "correlation_id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
                "deadline_at": "2030-01-01T00:00:00Z",
                "deadline_ms": 1000,
                "body_sha256": "a" * 64,
                "scopes": ["plan.resolve"],
            },
            "schema_version": "plan-resolution.v1",
            "plan": plan,
            "allowlist": allowlist or [{"product_id": "prod-rojo", "variant_ids": ["var-rojo-12"]}],
            "catalog_snapshot_id": SNAPSHOT,
            "lora_variant_ids": lora or [],
        }
    )


def _row(*, variant_id: str = "var-rojo-12") -> dict[str, object]:
    return {
        "product_id": "prod-rojo",
        "variant_id": variant_id,
        "sku": "ROJO-12",
        "sku_original": "ROJO-12",
        "source_snapshot_id": SNAPSHOT,
        "source_variant_id": "source-rojo-12",
        "inventory_quantity": 100,
        "unidades_inferidas": False,
        "producto_titulo": "Globo látex rojo",
        "variante_titulo": "R-12",
        "precio": 12000,
        "unidades_paq": 50,
        "disponible": True,
        "producto_disponible": True,
        "codigo_tamano": "R-12",
        "forma": "redondo",
        "diam_pulg": 12,
        "colores_producto": ["rojo"],
        "colores_variante": [],
        "acabados_producto": [],
        "descripcion": "Globo de látex rojo",
        "imagen": "https://cdn.example/rojo-12.jpg",
        "currency": "COP",
    }


def test_plan_cost_optimizer_flag_defaults_on_and_accepts_documented_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("PLAN_COST_OPTIMIZER_V2", raising=False)
    assert _plan_cost_optimizer_enabled() is True

    for value in ("1", "true", "TRUE", "on", "On"):
        monkeypatch.setenv("PLAN_COST_OPTIMIZER_V2", value)
        assert _plan_cost_optimizer_enabled() is True

    for value in ("0", "false", "off", "yes"):
        monkeypatch.setenv("PLAN_COST_OPTIMIZER_V2", value)
        assert _plan_cost_optimizer_enabled() is False


def test_coverage_optimizer_matches_global_package_search() -> None:
    result = _optimizar_cobertura(
        74,
        [
            {"variant_id": "R12-X12", "unidades_paquete": 12, "precio": 8832},
            {"variant_id": "R12-X50", "unidades_paquete": 50, "precio": 28977},
        ],
    )

    assert result is not None
    assert result["costo"] == 46641
    assert result["sobrante"] == 0
    assert result["paquetes"] == 3


def test_material_waste_savings_uses_float_unit_price_and_rounds_once() -> None:
    balloons: list[dict[str, object]] = [
        {"product_id": "P-BAL", "variant_id": variant} for variant in ("V-A", "V-B", "V-C")
    ]
    assert (
        _material_waste_only_savings(
            balloons,
            [],
            [
                {
                    "product_id": "P-BAL",
                    "variant_id": "V-A",
                    "design_quantity": 24,
                    "units_per_package": 50,
                    "package_count": 1,
                    "purchase_cost": 1000,
                },
                {
                    "product_id": "P-BAL",
                    "variant_id": "V-B",
                    "design_quantity": 50,
                    "units_per_package": 10,
                    "package_count": 3,
                    "purchase_cost": 100,
                },
                {
                    "product_id": "P-BAL",
                    "variant_id": "V-C",
                    "design_quantity": 50,
                    "units_per_package": 10,
                    "package_count": 3,
                    "purchase_cost": 100,
                },
            ],
        )
        == 67
    )


def test_material_waste_savings_only_counts_balloon_purchases() -> None:
    # Golden vector 09: MERMA models balloon bursts, so a non-geometric backdrop
    # (1 unit, 1 per package) never saves a waste-only package.
    telon: dict[str, object] = {
        "product_id": "P-TELON",
        "variant_id": "V-TELON",
        "design_quantity": 1,
        "units_per_package": 1,
        "package_count": 1,
        "purchase_cost": 20000,
    }
    balloon: dict[str, object] = {
        "product_id": "P-BAL",
        "variant_id": "V-BAL-R12",
        "design_quantity": 60,
        "units_per_package": 7,
        "package_count": 9,
        "purchase_cost": 13500,
    }
    special = [{"product_id": "P-TELON", "variant_id": "V-TELON"}]
    balloons = [{"product_id": "P-BAL", "variant_id": "V-BAL-R12"}]

    assert _material_waste_only_savings([], special, [telon]) == 0
    assert _material_waste_only_savings([], [], [telon]) == 0
    assert _material_waste_only_savings(balloons, special, [balloon, telon]) == 1500
    # Another package presentation of a balloon product stays eligible.
    other_presentation = {**balloon, "variant_id": "V-BAL-R12-X50"}
    assert _material_waste_only_savings(balloons, special, [other_presentation]) == 1500
    # A special element is excluded even when it shares the balloon product.
    shared_special = {**telon, "product_id": "P-BAL"}
    assert (
        _material_waste_only_savings(
            balloons, [{"product_id": "P-BAL", "variant_id": "V-TELON"}], [shared_special]
        )
        == 0
    )


@pytest.mark.anyio
async def test_waste_reserve_buys_minimum_additional_package_in_variant_order() -> None:
    request = _request()
    plan = json.loads(json.dumps(request.plan))
    structure = cast(dict[str, object], plan["estructuras"][0])
    structure["tipo"] = "columna"
    structure["medidas"] = {"alto_m": 2.8}
    payload = {**request.model_dump(mode="json", exclude_none=True), "plan": plan}
    payload_request = PlanResolutionRequest.model_validate(payload)
    row = _row()
    row["precio"] = 1500
    row["unidades_paq"] = 7

    result = await resolve_plan(payload_request, FakePlanStore([row]))
    resolved = cast(dict[str, object], result["plan_resuelto"])
    purchase = cast(list[dict[str, object]], resolved["compras"])[0]
    totals = cast(dict[str, object], resolved["totales"])
    estimate = cast(dict[str, object], result["material_estimate"])
    estimate_totals = cast(dict[str, object], estimate["totals"])

    assert purchase["additional_package_for_waste"] is True
    assert purchase["paquetes"] == 10
    assert purchase["purchase_quantity"] == 70
    assert purchase["waste_reserve"] == 5
    assert purchase["required_quantity"] == 65
    assert purchase["leftover_inventory"] == 5
    assert purchase["consumption_cost"] == 13929
    assert totals["natural_package_surplus"] == 3
    assert totals["covered_waste_reserve"] == 5
    assert totals["uncovered_waste_reserve"] == 0
    assert totals["additional_waste_packages"] == 10
    assert estimate_totals["additional_waste_packages"] == 10


def test_alternatives_filter_allowlist_geometry_and_non_geometric_cost() -> None:
    base = _candidate(_row(), SNAPSHOT)
    assert base is not None
    alternative_row = _row(variant_id="var-azul-12")
    alternative_row["product_id"] = "prod-azul"
    alternative_row["precio"] = 9000
    alternative_row["colores_producto"] = ["rojo"]
    alternative = _candidate(alternative_row, SNAPSHOT)
    assert alternative is not None

    structures = [
        {
            "lineas": [
                {
                    "color": "rojo",
                    "forma": "redondo",
                    "diam_pulg": 12,
                    "acabado": None,
                    "unidades": 24,
                },
                {
                    "color": None,
                    "forma": None,
                    "diam_pulg": None,
                    "unidades": 1,
                },
            ]
        }
    ]
    purchases = [{"diam_pulg": None, "subtotal": 5000}]
    alternatives = _alternatives(
        {},
        structures,
        purchases,
        {"prod-rojo": [base], "prod-azul": [alternative]},
        {"prod-rojo": {base.variant_id}, "prod-azul": {alternative.variant_id}},
        20000,
    )

    assert [item["familia_id"] for item in alternatives] == ["prod-azul", "prod-rojo"]
    assert alternatives[0]["total_cop"] == 14000
    assert alternatives[0]["ahorro_cop"] == 6000
    assert alternatives[0]["etiqueta"] == "economica"


def _signed_endpoint_request(
    request: PlanResolutionRequest, *, nonce: UUID
) -> tuple[bytes, dict[str, str]]:
    operation = request.model_dump(mode="json", exclude={"context"}, exclude_none=True)
    operation_hash = hashlib.sha256(
        json.dumps(operation, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()
    operation_context = {
        **request.context.model_dump(mode="json", exclude_none=True),
        "body_sha256": operation_hash,
    }
    body = json.dumps(
        {"context": operation_context, **operation},
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode()
    timestamp = int(time.time())
    headers = {
        "content-type": "application/json",
        "x-internal-schema-version": "operational.v1",
        "x-internal-timestamp": str(timestamp),
        "x-internal-nonce": str(nonce),
        "x-internal-scopes": "plan.resolve",
        "x-internal-signature": build_signature(
            secret=SECRET,
            method="POST",
            path="/internal/v1/plan/resolve",
            timestamp=timestamp,
            nonce=nonce,
            scopes=["plan.resolve"],
            body=body,
        ),
    }
    return body, headers


@pytest.mark.anyio
async def test_resolution_pins_snapshot_and_validates_composite_result() -> None:
    store = FakePlanStore([_row()])

    result = await resolve_plan(_request(), store)

    assert store.requested_snapshot == SNAPSHOT
    assert store.requested_ids is not None
    assert store.requested_ids[0] == ["prod-rojo"]
    assert result["operation_schema_version"] == "plan-resolution-result.v1"
    assert result["catalog_snapshot_id"] == SNAPSHOT
    resolved = cast(dict[str, object], result["plan_resuelto"])
    assert resolved["plan_hash"]
    totals = cast(dict[str, object], resolved["totales"])
    assert totals["merma_porcentaje"] == 8.0
    assert (
        cast(dict[str, object], result["material_estimate"])["version"]
        == "design-material-estimate-v1"
    )
    assert cast(dict[str, object], result["quote"])["currency"] == "COP"


@pytest.mark.anyio
async def test_non_allowlisted_variant_is_reported_without_catalog_escape() -> None:
    store = FakePlanStore([_row()])

    result = await resolve_plan(
        _request(allowlist=[{"product_id": "prod-rojo", "variant_ids": ["other-variant"]}]),
        store,
    )

    resolved = cast(dict[str, object], result["plan_resuelto"])
    assert resolved["compras"] == []
    assert resolved["sin_cobertura"]


@pytest.mark.anyio
async def test_lora_allowlist_is_applied_after_snapshot_query() -> None:
    store = FakePlanStore([_row()])

    result = await resolve_plan(_request(lora=["different-variant"]), store)

    assert store.requested_ids is not None
    assert store.requested_ids[2] == ["different-variant"]
    resolved = cast(dict[str, object], result["plan_resuelto"])
    assert resolved["compras"] == []


@pytest.mark.anyio
async def test_admissible_size_substitution_is_explicit_and_color_falls_back_to_product() -> None:
    request = _request()
    plan = json.loads(json.dumps(request.plan))
    plan["estructuras"][0]["mezcla"] = "organica_fina"
    row = _row()
    row["colores_variante"] = ["color-variante-no-canonico"]
    row["colores_producto"] = '["rojo"]'
    result = await resolve_plan(
        PlanResolutionRequest.model_validate(
            {**request.model_dump(mode="json", exclude_none=True), "plan": plan}
        ),
        FakePlanStore([row]),
    )

    resolved = cast(dict[str, object], result["plan_resuelto"])
    substitutions = cast(list[dict[str, object]], resolved["sustituciones"])
    assert {item["pedido"] for item in substitutions} >= {"R-9", "R-18"}
    assert all(item["entregado"] == "R-12" for item in substitutions)
    assert resolved["compras"]


@pytest.mark.anyio
async def test_non_cop_catalog_row_is_rejected_fail_closed() -> None:
    row = _row()
    row["currency"] = "USD"

    result = await resolve_plan(_request(), FakePlanStore([row]))

    resolved = cast(dict[str, object], result["plan_resuelto"])
    assert resolved["compras"] == []
    assert resolved["sin_cobertura"]


def test_resolution_request_requires_snapshot_and_unique_allowlist() -> None:
    with pytest.raises(ValidationError):
        _request(
            allowlist=[{"product_id": "prod-rojo", "variant_ids": ["var-rojo-12", "var-rojo-12"]}]
        )

    with pytest.raises(ValidationError):
        PlanResolutionRequest.model_validate(
            {**_request().model_dump(exclude={"catalog_snapshot_id"})}
        )

    plan_one_one = _request().model_dump(mode="json")
    plan_one_one["plan"]["plan_version"] = "1.1"
    with pytest.raises(ValidationError):
        PlanResolutionRequest.model_validate(plan_one_one)


def _shopify_ids(count: int) -> list[str]:
    # Real LoRA pools carry 14-digit Shopify variant ids.
    return [str(46_594_221_000_000 + index) for index in range(count)]


def test_resolution_request_accepts_lora_pool_up_to_shared_bound() -> None:
    assert MAX_PLAN_LORA_VARIANTS == MAX_RECOMMENDATIONS_LORA_VARIANTS

    # 492 is the training_1 dataset pool that exceeded the previous 256 cap.
    assert len(_request(lora=_shopify_ids(492)).lora_variant_ids) == 492
    at_bound = _request(lora=_shopify_ids(MAX_PLAN_LORA_VARIANTS))
    assert len(at_bound.lora_variant_ids) == MAX_PLAN_LORA_VARIANTS

    with pytest.raises(ValidationError):
        _request(lora=_shopify_ids(MAX_PLAN_LORA_VARIANTS + 1))

    body = json.dumps(at_bound.model_dump(mode="json"), separators=(",", ":"))
    assert len(body.encode("utf-8")) < MAX_BODY_BYTES


@pytest.mark.anyio
async def test_invalid_plan_version_raises_invalid_plan() -> None:
    request = _request()
    request.plan["plan_version"] = "1.1"

    with pytest.raises(PlanResolutionError) as raised:
        await resolve_plan(request, FakePlanStore([_row()]))

    assert raised.value.code == "invalid_plan"
    assert raised.value.status_code == 422


@pytest.mark.anyio
async def test_unknown_published_snapshot_fails_closed() -> None:
    store = FakePlanStore([_row()], snapshot=None)

    with pytest.raises(PlanResolutionError) as raised:
        await resolve_plan(_request(), store)

    assert str(raised.value) == "catalog_snapshot_not_found"
    assert raised.value.status_code == 422


def test_plan_resolution_endpoint_reuses_operational_auth_boundary() -> None:
    request = _request()
    body, headers = _signed_endpoint_request(
        request, nonce=UUID("00000000-0000-4000-8000-000000000010")
    )
    app = create_app(
        Settings(environment="test", hmac_secret=SECRET),
        operational_store=InMemoryOperationalStore(),
        catalog_store=FakePlanStore([_row()]),
    )

    with TestClient(app) as client:
        response = client.post("/internal/v1/plan/resolve", content=body, headers=headers)

    assert response.status_code == 200, response.text
    assert response.json()["payload"]["catalog_snapshot_id"] == SNAPSHOT


def test_plan_resolution_endpoint_reports_unknown_snapshot() -> None:
    request = _request()
    body, headers = _signed_endpoint_request(
        request, nonce=UUID("00000000-0000-4000-8000-000000000011")
    )
    app = create_app(
        Settings(environment="test", hmac_secret=SECRET),
        operational_store=InMemoryOperationalStore(),
        catalog_store=FakePlanStore([_row()], snapshot=None),
    )

    with TestClient(app) as client:
        response = client.post("/internal/v1/plan/resolve", content=body, headers=headers)

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "catalog_snapshot_not_found"


def _azul_row() -> dict[str, object]:
    row = _row(variant_id="var-azul-12")
    row["product_id"] = "prod-azul"
    row["sku"] = "AZUL-12"
    row["sku_original"] = "AZUL-12"
    row["source_variant_id"] = "source-azul-12"
    row["producto_titulo"] = "Globo látex azul"
    row["colores_producto"] = ["azul"]
    return row


def _request_with_structure(
    changes: dict[str, object],
    *,
    allowlist: list[dict[str, object]] | None = None,
) -> PlanResolutionRequest:
    request = _request(allowlist=allowlist)
    payload = request.model_dump(mode="json", exclude_none=True)
    plan = json.loads(json.dumps(payload["plan"]))
    structure = cast(dict[str, object], plan["estructuras"][0])
    structure.update(changes)
    return PlanResolutionRequest.model_validate({**payload, "plan": plan})


def _material(product_id: str, variant_id: str) -> dict[str, object]:
    return {
        "product_id": product_id,
        "variant_id": variant_id,
        "color": "rojo",
        "participacion": 1,
        "rol_material": "principal",
    }


_ROJO_ALLOWLIST: list[dict[str, object]] = [
    {"product_id": "prod-rojo", "variant_ids": ["var-rojo-12"]}
]


def test_product_variant_mismatch_rules_are_strict_for_allowlist_and_tolerant_for_plan() -> None:
    identity = [
        {"product_id": "prod-rojo", "variant_id": "var-rojo-12"},
        {"product_id": "prod-azul", "variant_id": "var-azul-12"},
        {"product_id": "prod-rojo", "variant_id": None},
        {"product_id": "prod-azul", "variant_id": None},
    ]

    assert _product_variant_mismatches(identity, {("prod-rojo", "var-rojo-12")}, set()) == []
    # Allowlist pairs are strict even when the entry product is not a known product.
    assert _product_variant_mismatches(identity, {("var-rojo-12", "var-rojo-12")}, set()) == [
        ("var-rojo-12", "var-rojo-12")
    ]
    assert _product_variant_mismatches(identity, {("prod-azul", "var-rojo-12")}, set()) == [
        ("prod-azul", "var-rojo-12")
    ]
    # Declared pairs tolerate a variant id repeated as product_id.
    assert _product_variant_mismatches(identity, set(), {("var-rojo-12", "var-rojo-12")}) == []
    assert _product_variant_mismatches(identity, set(), {("prod-azul", "var-rojo-12")}) == [
        ("prod-azul", "var-rojo-12")
    ]
    # Unknown variants are not ownership errors.
    assert (
        _product_variant_mismatches(identity, {("prod-rojo", "var-x")}, {("prod-azul", "var-y")})
        == []
    )


def test_declared_pairs_include_materials_and_overrides_but_not_override_targets() -> None:
    plan = {
        "estructuras": [
            {
                "materiales": [
                    {"product_id": "prod-rojo", "variant_id": "var-rojo-12"},
                    {"product_id": "prod-azul"},
                ],
                "variant_overrides": [
                    {
                        "objetivo_variant_id": "var-objetivo",
                        "product_id": "prod-azul",
                        "variant_id": "var-azul-12",
                    }
                ],
            }
        ]
    }

    assert _declared_pairs(plan) == {("prod-rojo", "var-rojo-12"), ("prod-azul", "var-azul-12")}


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("changes", "allowlist"),
    [
        pytest.param(
            {},
            [{"product_id": "prod-azul", "variant_ids": ["var-rojo-12"]}],
            id="allowlist-entry",
        ),
        pytest.param(
            {"materiales": [_material("prod-rojo", "var-azul-12")]},
            _ROJO_ALLOWLIST,
            id="geometric-material",
        ),
        pytest.param(
            {
                "tipo": "backdrop",
                "medidas": {},
                "unidades_declaradas": 1,
                "materiales": [_material("prod-azul", "var-rojo-12")],
            },
            [{"product_id": "prod-azul", "variant_ids": ["var-azul-12"]}],
            id="non-geometric-material",
        ),
        pytest.param(
            {
                "variant_overrides": [
                    {
                        "objetivo_variant_id": "var-rojo-12",
                        "product_id": "prod-rojo",
                        "variant_id": "var-azul-12",
                    }
                ]
            },
            _ROJO_ALLOWLIST,
            id="variant-override",
        ),
    ],
)
async def test_product_variant_mismatch_raises_before_commercial_fetch(
    changes: dict[str, object], allowlist: list[dict[str, object]]
) -> None:
    store = FakePlanStore([_row(), _azul_row()])

    with pytest.raises(PlanResolutionError) as raised:
        await resolve_plan(_request_with_structure(changes, allowlist=allowlist), store)

    assert raised.value.code == "allowlist_product_mismatch"
    assert raised.value.status_code == 422
    assert len(store.identity_calls) == 1
    assert store.requested_ids is None


@pytest.mark.anyio
async def test_unknown_variant_stays_uncovered_instead_of_ownership_error() -> None:
    store = FakePlanStore([_row(), _azul_row()])
    request = _request_with_structure(
        {
            "tipo": "backdrop",
            "medidas": {},
            "unidades_declaradas": 1,
            "materiales": [_material("prod-rojo", "var-desconocida")],
        },
        allowlist=[{"product_id": "prod-rojo", "variant_ids": ["var-rojo-12", "var-desconocida"]}],
    )

    result = await resolve_plan(request, store)

    resolved = cast(dict[str, object], result["plan_resuelto"])
    assert resolved["compras"] == []
    assert resolved["sin_cobertura"]


@pytest.mark.anyio
async def test_variant_id_repeated_as_product_id_is_tolerated_and_canonicalized() -> None:
    store = FakePlanStore([_row(), _azul_row()])
    request = _request_with_structure({"materiales": [_material("var-rojo-12", "var-rojo-12")]})

    result = await resolve_plan(request, store)

    resolved = cast(dict[str, object], result["plan_resuelto"])
    purchases = cast(list[dict[str, object]], resolved["compras"])
    assert [purchase["variant_id"] for purchase in purchases] == ["var-rojo-12"]
    assert purchases[0]["product_id"] == "prod-rojo"


def test_plan_resolution_endpoint_reports_product_variant_mismatch() -> None:
    request = _request(allowlist=[{"product_id": "prod-azul", "variant_ids": ["var-rojo-12"]}])
    body, headers = _signed_endpoint_request(
        request, nonce=UUID("00000000-0000-4000-8000-000000000012")
    )
    app = create_app(
        Settings(environment="test", hmac_secret=SECRET),
        operational_store=InMemoryOperationalStore(),
        catalog_store=FakePlanStore([_row(), _azul_row()]),
    )

    with TestClient(app) as client:
        response = client.post("/internal/v1/plan/resolve", content=body, headers=headers)

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "allowlist_product_mismatch"


@pytest.mark.anyio
async def test_official_structure_is_accepted_and_bound_to_the_plan_hash() -> None:
    plain = await resolve_plan(_request(), FakePlanStore([_row()]))
    official = await resolve_plan(
        _request_with_structure({"estructura_oficial": "arco"}), FakePlanStore([_row()])
    )
    asymmetrical = await resolve_plan(
        _request_with_structure({"estructura_oficial": "arco_asimetrico"}), FakePlanStore([_row()])
    )

    plain_resolved = cast(dict[str, object], plain["plan_resuelto"])
    official_resolved = cast(dict[str, object], official["plan_resuelto"])
    asymmetrical_resolved = cast(dict[str, object], asymmetrical["plan_resuelto"])
    structures = cast(list[dict[str, object]], cast(dict[str, object], official_resolved["plan"])["estructuras"])
    assert structures[0]["estructura_oficial"] == "arco"
    assert official_resolved["plan_hash"] != plain_resolved["plan_hash"]
    # A plain official arch keeps the base geometry; the asymmetrical variant tapers its band.
    assert official_resolved["totales"] == plain_resolved["totales"]
    plain_units = cast(list[dict[str, object]], plain_resolved["estructuras"])[0]["total_unidades"]
    asymmetrical_units = cast(list[dict[str, object]], asymmetrical_resolved["estructuras"])[0]["total_unidades"]
    assert isinstance(plain_units, int) and isinstance(asymmetrical_units, int)
    assert abs(asymmetrical_units - plain_units * 0.7) <= 1


def test_half_arch_axis_is_a_quarter_ellipse_that_uses_the_height() -> None:
    # Regression: the axis used to be ``largo or ancho`` and ignored ``alto``, so a
    # tall 1.2 m x 2.2 m half arch counted fewer balloons than a 1.8 m column.
    tall = _eje("semiarco", {"ancho_m": 1.2, "alto_m": 2.2})
    assert tall == pytest.approx(2.7284, abs=1e-3)
    assert tall > _eje("columna", {"alto_m": 1.8})
    assert _eje("semiarco", {"ancho_m": 1.2, "alto_m": 3.0}) > tall
    # The chat sends largo_m as depth: with width and height the ellipse wins.
    assert _eje("semiarco", {"ancho_m": 1.2, "alto_m": 2.2, "largo_m": 0.5}) == pytest.approx(tall)
    assert _eje("semiarco", {"largo_m": 3.0}) == 3.0
    assert _eje("semiarco", {"ancho_m": 2.4}) == 2.4
    assert _eje("guirnalda", {"largo_m": 2.5, "alto_m": 2.2}) == 2.5


@pytest.mark.parametrize(
    "changes",
    [
        {"estructura_oficial": "columna_asimetrica"},  # tipo arco is not a column
        {"estructura_oficial": "arco_no_denso"},  # densidad media is not airy
        {"estructura_oficial": "pared_densa"},  # tipo arco is not a wall
        {"estructura_oficial": "estructura_inventada"},
    ],
)
def test_incoherent_official_structure_is_rejected_by_the_contract(changes: dict[str, object]) -> None:
    # The coherence table is generated from estructuras-oficiales.ts into the JSON Schema.
    with pytest.raises(ValidationError):
        _request_with_structure(changes)
