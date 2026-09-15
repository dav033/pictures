"""Plan resolver fixes from the real end-to-end run (2026-09-14).

- D3: the same product, size and color was bought in different presentations
  per structure (Azul Rey R-12 as x12 and x20), about 15 % over one
  consolidated purchase. The need is added up across structures and covered
  with the cheapest combination of presentations.
- D2: a venue photo came back as ``3 x 3 x 2.5 m`` "measured from the photo".
  The model does not measure: numeric space measures with ``fuente: "foto"``
  become ``fuente: "supuesto"``.

The TypeScript resolver implements the same rules; golden vectors
``16-compras-consolidadas-presentaciones`` and ``17-espacio-foto-medidas-estimadas``
lock the parity.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import pytest

from app.plan import PlanResolutionRequest, _normalize_space_source, resolve_plan


ROOT = Path(__file__).resolve().parents[3]
VECTORS = ROOT / "contracts" / "domain" / "v1" / "golden" / "plan-resolution"


async def _resolve_vector(name: str) -> dict[str, object]:
    vector = json.loads((VECTORS / name).read_text(encoding="utf-8"))
    request = PlanResolutionRequest.model_validate(
        {
            "context": {
                "schema_version": "operational.v1",
                "request_id": "00000000-0000-4000-8000-000000000016",
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
    return cast(dict[str, object], result["plan_resuelto"])


@pytest.mark.anyio
@pytest.mark.parametrize("optimizer", [None, "false"])
async def test_same_product_size_color_is_bought_once_across_structures(
    monkeypatch: pytest.MonkeyPatch, optimizer: str | None
) -> None:
    # The kill switch only turns off alternatives: consolidation is the quote.
    if optimizer is None:
        monkeypatch.delenv("PLAN_COST_OPTIMIZER_V2", raising=False)
    else:
        monkeypatch.setenv("PLAN_COST_OPTIMIZER_V2", optimizer)
    resolved = await _resolve_vector("16-compras-consolidadas-presentaciones.json")
    purchases = cast(list[dict[str, object]], resolved["compras"])
    by_variant = {str(item["variant_id"]): item for item in purchases}
    # Before: 3 x12 + 2 x20 of blue and 2 x12 + 1 x50 of silver, 72 310 COP.
    assert cast(dict[str, object], resolved["totales"])["total_cop"] == 65515
    assert by_variant["V-AZUL-12-X12"]["estructuras"] == ["EST_01_ARCO", "EST_02_COLUMNAS"]
    assert by_variant["V-AZUL-12-X20"]["paquetes"] == 1
    assert by_variant["V-PLATA-12-X50"]["estructuras"] == ["EST_01_ARCO", "EST_02_COLUMNAS"]
    # Traceability: every structure line points at a purchase and the units per
    # structure do not change.
    units = {
        str(structure["estructura_id"]): sum(
            int(cast(int, line["unidades"]))
            for line in cast(list[dict[str, object]], structure["lineas"])
        )
        for structure in cast(list[dict[str, object]], resolved["estructuras"])
    }
    assert units == {"EST_01_ARCO": 47, "EST_02_COLUMNAS": 78}
    for structure in cast(list[dict[str, object]], resolved["estructuras"]):
        for line in cast(list[dict[str, object]], structure["lineas"]):
            assert structure["estructura_id"] in cast(
                list[str], by_variant[str(line["variant_id"])]["estructuras"]
            )
    if optimizer == "false":
        assert resolved["alternativas"] == []


def test_space_measures_from_a_photo_are_an_estimate() -> None:
    measured = {
        "tipo": "salon_eventos",
        "ancho_m": 3,
        "largo_m": 3,
        "alto_m": 2.5,
        "fuente": "foto",
    }
    assert _normalize_space_source(measured) == {**measured, "fuente": "supuesto"}
    assert _normalize_space_source({"tipo": "salon_eventos", "fuente": "foto"}) == {
        "tipo": "salon_eventos",
        "fuente": "foto",
    }
    assert _normalize_space_source({**measured, "fuente": "cliente"})["fuente"] == "cliente"
    assert _normalize_space_source({"tipo": "jardin", "alto_m": 4, "fuente": "foto"})["fuente"] == (
        "supuesto"
    )


@pytest.mark.anyio
async def test_resolved_plan_never_says_measured_from_the_photo() -> None:
    resolved = await _resolve_vector("17-espacio-foto-medidas-estimadas.json")
    space = cast(dict[str, object], cast(dict[str, object], resolved["plan"])["espacio"])
    assert space == {
        "tipo": "salon_eventos",
        "ancho_m": 3,
        "largo_m": 3,
        "alto_m": 2.5,
        "fuente": "supuesto",
    }
