"""Plan resolver fixes from the reference-image audit (2026-09-14).

- Alta #1: figures, bouquets and kits were quoted with one balloon. A declared
  material is a purchase, so the split of ``unidades_declaradas`` never leaves
  a material at zero units.
- Alta #3: dominant colors of the reference photo were lost silently. The plan
  carries ``colores_referencia`` per structure and the resolver records every
  missing color in ``sustituciones``.

Both rules belong to this resolver alone (ADR-0023 step 5); the golden vectors
``14-figura-cuatro-materiales`` and ``15-colores-referencia`` lock their numbers
against regression in ``test_plan_regresion.py``.
"""

from __future__ import annotations

import json
import math
import random
from collections.abc import Sequence
from pathlib import Path
from typing import cast

import pytest

from app.plan import (
    PlanResolutionRequest,
    _distribute_units,
    _reference_color_substitutions,
    resolve_plan,
)


ROOT = Path(__file__).resolve().parents[3]
VECTORS = ROOT / "contracts" / "domain" / "v1" / "golden" / "plan-resolution"


def _materials(*shares: float) -> list[dict[str, object]]:
    return [{"participacion": share} for share in shares]


def test_distribute_units_never_leaves_a_declared_material_at_zero() -> None:
    # F13: two ~2 m figures with four materials were declared with one unit.
    assert _distribute_units(1, _materials(0.4, 0.3, 0.2, 0.1)) == [1, 1, 1, 1]
    # F24: the yellow of an orange/yellow bouquet disappeared.
    assert _distribute_units(6, _materials(0.7, 0.1, 0.1, 0.1)) == [3, 1, 1, 1]
    assert all(units >= 1 for units in _distribute_units(24, _materials(0.94, 0.02, 0.02, 0.02)))


@pytest.mark.parametrize(
    ("total", "shares", "expected"),
    [
        (10, (0.7, 0.3), [7, 3]),
        (10, (0.5, 0.5), [5, 5]),
        (48, (0.25, 0.25, 0.25, 0.25), [12, 12, 12, 12]),
        (1, (1.0,), [1]),
        (0, (), []),
        # Ties and small totals: the pre-audit split already bought both materials.
        (10, (0.55, 0.45), [6, 4]),
    ],
)
def test_distribute_units_keeps_the_largest_remainder_split(
    total: int, shares: tuple[float, ...], expected: list[int]
) -> None:
    assert _distribute_units(total, _materials(*shares)) == expected


def _pre_audit_split(total: int, shares: Sequence[float]) -> list[int]:
    quotas = [total * share for share in shares]
    floors = [math.floor(quota) for quota in quotas]
    remaining = total - sum(floors)
    for index in sorted(
        range(len(quotas)), key=lambda item: (-(quotas[item] - floors[item]), item)
    ):
        if remaining <= 0:
            break
        floors[index] += 1
        remaining -= 1
    return floors


def test_distribute_units_only_changes_plans_that_left_a_material_at_zero() -> None:
    # plan_hash covers the resolved lines: a different split of a plan that
    # already bought every material breaks approved plans at generation time.
    rng = random.Random(20260914)
    for _ in range(5000):
        count = rng.randint(1, 4)
        raw = [rng.randint(1, 20) for _ in range(count)]
        shares = [round(value / sum(raw), 2) for value in raw]
        total = rng.randint(count, 60)
        before = _pre_audit_split(total, shares)
        after = _distribute_units(total, _materials(*shares))
        assert all(units >= 1 for units in after), (total, shares, after)
        assert sum(after) == sum(before), (total, shares, before, after)
        if min(before) >= 1:
            assert after == before, (total, shares, before, after)


def test_reference_colors_missing_from_the_lines_are_substitutions() -> None:
    # F06 + F03: the column of the second photo inherited the lilac palette.
    missing = _reference_color_substitutions(
        "EST_02_COLUMNA", ["cafe", "azul", "plateado"], ["lila", "lila", "Plateado"]
    )
    assert [item["pedido"] for item in missing] == ["cafe", "azul"]
    assert missing[0] == {
        "estructura_id": "EST_02_COLUMNA",
        "pedido": "cafe",
        "entregado": "lila, plateado",
        "motivo": "La foto de referencia muestra cafe y esta pieza no lo lleva: se armó con lila y plateado.",
    }


def test_reference_colors_are_quiet_when_covered_absent_or_uncovered() -> None:
    assert (
        _reference_color_substitutions("EST_01_ARCO", ["lila", "blanco"], ["blanco", "lila"]) == []
    )
    assert _reference_color_substitutions("EST_01_ARCO", None, ["blanco"]) == []
    # No resolved line: the resolver reports the structure as uncovered instead.
    assert _reference_color_substitutions("EST_01_ARCO", ["lila"], []) == []


@pytest.mark.anyio
async def test_resolution_records_lost_photo_colors_per_structure() -> None:
    vector = json.loads((VECTORS / "15-colores-referencia.json").read_text(encoding="utf-8"))
    request = PlanResolutionRequest.model_validate(
        {
            "context": {
                "schema_version": "operational.v1",
                "request_id": "00000000-0000-4000-8000-000000000015",
                "correlation_id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
                "deadline_at": "2030-01-01T00:00:00Z",
                "deadline_ms": 1000,
                "body_sha256": "a" * 64,
                "scopes": ["plan.resolve"],
            },
            "schema_version": "plan-resolution.v1",
            "plan": vector["plan"],
            "allowlist": vector["allowlist"],
            "catalog_snapshot_id": vector["catalog_snapshot_id"],
            "lora_variant_ids": [],
        }
    )

    class Store:
        async def published_snapshot(self, snapshot_id: str) -> str | None:
            return snapshot_id

        async def fetch_plan_rows(
            self, snapshot_id: str, product_ids: object, variant_ids: object, lora: object = ()
        ) -> list[dict[str, object]]:
            return cast(list[dict[str, object]], vector["catalog_rows"])

        async def fetch_catalog_identity(
            self, snapshot_id: str, product_ids: object, variant_ids: object
        ) -> list[dict[str, object]]:
            return [
                {"product_id": row["product_id"], "variant_id": row["variant_id"]}
                for row in vector["catalog_rows"]
            ]

    result = await resolve_plan(request, Store())
    resolved = cast(dict[str, object], result["plan_resuelto"])
    substitutions = cast(list[dict[str, object]], resolved["sustituciones"])
    assert [(item["estructura_id"], item["pedido"]) for item in substitutions] == [
        ("EST_02_COLUMNA", "cafe"),
        ("EST_02_COLUMNA", "azul"),
        ("EST_03_BOUQUET", "dorado"),
    ]
    assert resolved["sin_cobertura"] == []
