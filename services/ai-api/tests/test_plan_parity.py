"""Regression lock for the Python plan resolver over the shared golden vectors.

Each vector under ``contracts/domain/v1/golden/plan-resolution`` carries two
expectations: ``expected`` is what the TypeScript resolver produces (locked by
``scripts/test-paridad-plan-python.ts``) and ``expected_python`` is the
``plan-resolution-result.v1`` payload this service produces. This module locks
the second one.

Comparing the two backends against each other happens on the TypeScript side,
where the production mapper turns this payload into the same shapes the UI
consumes (``npm run plan:test-paridad-python``). Doing it there also keeps JSON
number representation out of the way: 12 and 12.0 are the same JavaScript
number.

Regenerate ``expected_python`` after an intentional resolver change with
``PARIDAD_ACTUALIZAR=1 pytest tests/test_plan_parity.py``; that run rewrites the
vectors and reports every case as skipped instead of asserting.
"""

from __future__ import annotations

import json
import os
from collections.abc import Mapping, Sequence
from pathlib import Path

import pytest

from app.plan import PlanResolutionRequest, resolve_plan


ROOT = Path(__file__).resolve().parents[3]
VECTORS_DIRECTORY = ROOT / "contracts" / "domain" / "v1" / "golden" / "plan-resolution"
REQUEST_ID = "00000000-0000-4000-8000-000000000101"
CORRELATION_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff"


def _mapping(value: object, location: str) -> dict[str, object]:
    if not isinstance(value, dict) or any(not isinstance(key, str) for key in value):
        raise ValueError(f"{location} must be a JSON object")
    return {key: item for key, item in value.items() if isinstance(key, str)}


def _list(value: object, location: str) -> list[object]:
    if not isinstance(value, list):
        raise ValueError(f"{location} must be a JSON array")
    return value


def _text(value: object, location: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{location} must be a non-empty string")
    return value


def _validate_catalog_rows(value: object, location: str) -> list[dict[str, object]]:
    rows = [
        _mapping(item, f"{location}[{index}]") for index, item in enumerate(_list(value, location))
    ]
    required_text = (
        "product_id",
        "variant_id",
        "source_snapshot_id",
        "producto_titulo",
        "currency",
    )
    nullable_text = (
        "sku",
        "sku_original",
        "source_variant_id",
        "variante_titulo",
        "codigo_tamano",
        "forma",
        "descripcion",
        "imagen",
    )
    array_text = ("colores_producto", "colores_variante", "acabados_producto")
    for index, row in enumerate(rows):
        prefix = f"{location}[{index}]"
        for field in required_text:
            _text(row.get(field), f"{prefix}.{field}")
        if row["currency"] != "COP":
            raise ValueError(f"{prefix}.currency must be COP")
        for field in nullable_text:
            value = row.get(field)
            if value is not None and not isinstance(value, str):
                raise ValueError(f"{prefix}.{field} must be a string or null")
        for field in array_text:
            if any(
                not isinstance(item, str) for item in _list(row.get(field), f"{prefix}.{field}")
            ):
                raise ValueError(f"{prefix}.{field} must contain only strings")
        for field in ("disponible", "producto_disponible"):
            if row.get(field) is not True:
                raise ValueError(f"{prefix}.{field} must be true")
        price = row.get("precio")
        if isinstance(price, bool) or not isinstance(price, (int, float)) or price <= 0:
            raise ValueError(f"{prefix}.precio must be a positive number")
        units = row.get("unidades_paq")
        if isinstance(units, bool) or not isinstance(units, int) or units <= 0:
            raise ValueError(f"{prefix}.unidades_paq must be a positive integer")
        inventory = row.get("inventory_quantity")
        if inventory is not None and (
            isinstance(inventory, bool) or not isinstance(inventory, int)
        ):
            raise ValueError(f"{prefix}.inventory_quantity must be an integer or null")
        inferred = row.get("unidades_inferidas")
        if inferred is not None and not isinstance(inferred, bool):
            raise ValueError(f"{prefix}.unidades_inferidas must be a boolean or null")
        diameter = row.get("diam_pulg")
        if diameter is not None and (
            isinstance(diameter, bool) or not isinstance(diameter, (int, float))
        ):
            raise ValueError(f"{prefix}.diam_pulg must be a number or null")
    return rows


def _load_vectors() -> list[dict[str, object]]:
    vectors: list[dict[str, object]] = []
    for path in sorted(VECTORS_DIRECTORY.glob("*.json")):
        raw: object = json.loads(path.read_text(encoding="utf-8"))
        vector = _mapping(raw, str(path))
        _text(vector.get("name"), f"{path}.name")
        _text(vector.get("catalog_snapshot_id"), f"{path}.catalog_snapshot_id")
        _validate_catalog_rows(vector.get("catalog_rows"), f"{path}.catalog_rows")
        _list(vector.get("allowlist"), f"{path}.allowlist")
        _mapping(vector.get("plan"), f"{path}.plan")
        _mapping(vector.get("expected"), f"{path}.expected")
        vector["__path__"] = str(path)
        vectors.append(vector)
    if not vectors:
        raise ValueError(f"No golden vectors found in {VECTORS_DIRECTORY}")
    return vectors


VECTORS = _load_vectors()


class FakePlanStore:
    def __init__(self, rows: Sequence[dict[str, object]], snapshot: str) -> None:
        self.rows = list(rows)
        self.snapshot = snapshot

    async def published_snapshot(self, snapshot_id: str) -> str | None:
        return self.snapshot if snapshot_id == self.snapshot else None

    async def fetch_plan_rows(
        self,
        snapshot_id: str,
        product_ids: Sequence[str],
        variant_ids: Sequence[str],
        lora_variant_ids: Sequence[str] = (),
    ) -> Sequence[dict[str, object]]:
        if snapshot_id != self.snapshot:
            raise AssertionError(f"unexpected snapshot {snapshot_id!r}")
        return self.rows

    async def fetch_catalog_identity(
        self,
        snapshot_id: str,
        product_ids: Sequence[str],
        variant_ids: Sequence[str],
    ) -> Sequence[dict[str, object]]:
        if snapshot_id != self.snapshot:
            raise AssertionError(f"unexpected snapshot {snapshot_id!r}")
        identity: list[dict[str, object]] = [
            {"product_id": row["product_id"], "variant_id": row["variant_id"]} for row in self.rows
        ]
        identity.extend(
            {"product_id": product_id, "variant_id": None}
            for product_id in dict.fromkeys(str(row["product_id"]) for row in self.rows)
        )
        return identity


def _request(vector: Mapping[str, object]) -> PlanResolutionRequest:
    snapshot = _text(vector["catalog_snapshot_id"], "catalog_snapshot_id")
    plan = _mapping(vector["plan"], "plan")
    allowlist = _list(vector["allowlist"], "allowlist")
    lora_value = vector.get("lora_variant_ids")
    lora = (
        []
        if lora_value is None
        else [_text(item, "lora_variant_ids[]") for item in _list(lora_value, "lora_variant_ids")]
    )
    return PlanResolutionRequest.model_validate(
        {
            "context": {
                "schema_version": "operational.v1",
                "request_id": REQUEST_ID,
                "correlation_id": CORRELATION_ID,
                "deadline_at": "2030-01-01T00:00:00Z",
                "deadline_ms": 1000,
                "body_sha256": "a" * 64,
                "scopes": ["plan.resolve"],
            },
            "schema_version": "plan-resolution.v1",
            "plan": plan,
            "allowlist": allowlist,
            "catalog_snapshot_id": snapshot,
            "lora_variant_ids": lora,
        }
    )


def _json_object(value: object) -> dict[str, object] | None:
    if not isinstance(value, dict) or any(not isinstance(key, str) for key in value):
        return None
    return {key: item for key, item in value.items() if isinstance(key, str)}


_MISSING = object()


def _format_value(value: object) -> str:
    if value is _MISSING:
        return "<missing>"
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)


def _differences(expected: object, actual: object, path: str) -> list[tuple[str, object, object]]:
    if type(expected) is not type(actual):
        return [(path, expected, actual)]
    expected_object = _json_object(expected)
    actual_object = _json_object(actual)
    if expected_object is not None and actual_object is not None:
        differences: list[tuple[str, object, object]] = []
        for key in sorted(set(expected_object) | set(actual_object)):
            if key not in expected_object:
                differences.append((f"{path}.{key}", _MISSING, actual_object[key]))
            elif key not in actual_object:
                differences.append((f"{path}.{key}", expected_object[key], _MISSING))
            else:
                differences.extend(
                    _differences(expected_object[key], actual_object[key], f"{path}.{key}")
                )
        return differences
    if isinstance(expected, list) and isinstance(actual, list):
        differences = []
        if len(expected) != len(actual):
            differences.append((f"{path}.length", len(expected), len(actual)))
        for index, (expected_item, actual_item) in enumerate(zip(expected, actual, strict=False)):
            differences.extend(_differences(expected_item, actual_item, f"{path}[{index}]"))
        return differences
    return [] if expected == actual else [(path, expected, actual)]


def _write_expected_python(vector: Mapping[str, object], result: Mapping[str, object]) -> None:
    path = Path(_text(vector["__path__"], "__path__"))
    stored: dict[str, object] = json.loads(path.read_text(encoding="utf-8"))
    stored["expected_python"] = result
    path.write_text(
        json.dumps(stored, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


@pytest.mark.anyio
@pytest.mark.parametrize("vector", VECTORS, ids=lambda vector: str(vector["name"]))
async def test_python_resolver_matches_golden_vector(vector: dict[str, object]) -> None:
    rows = _validate_catalog_rows(vector["catalog_rows"], f"{vector['name']}.catalog_rows")
    snapshot = _text(vector["catalog_snapshot_id"], f"{vector['name']}.catalog_snapshot_id")
    result = await resolve_plan(_request(vector), FakePlanStore(rows, snapshot))

    if os.environ.get("PARIDAD_ACTUALIZAR") == "1":
        _write_expected_python(vector, result)
        pytest.skip(f"{vector['name']}: expected_python regenerado")

    expected = vector.get("expected_python")
    if expected is None:
        pytest.fail(
            f"{vector['name']}: falta expected_python; regeneralo con "
            "PARIDAD_ACTUALIZAR=1 pytest tests/test_plan_parity.py"
        )
    differences = _differences(
        _mapping(expected, f"{vector['name']}.expected_python"),
        dict(result),
        "expected_python",
    )
    if differences:
        details = "\n".join(
            f"- {path}: expected {_format_value(expected_value)}, actual {_format_value(actual_value)}"
            for path, expected_value, actual_value in differences[:40]
        )
        pytest.fail(f"{vector['name']}: {len(differences)} field difference(s)\n{details}")
