#!/usr/bin/env python3
"""Resolve official parity cases with Python's domain code and a local snapshot only."""

from __future__ import annotations

import asyncio
import json
import sys
import uuid
from pathlib import Path
from typing import Mapping, Sequence

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "ai-api"))

from app.plan import PlanResolutionRequest, resolve_plan  # noqa: E402


class SnapshotStore:
    """Read-only adapter over the checked-in crosswalk; it never opens a database connection."""

    def __init__(self, snapshot: str, rows: Sequence[Mapping[str, object]]) -> None:
        self.snapshot = snapshot
        self.rows = list(rows)

    async def published_snapshot(self, snapshot_id: str) -> str | None:
        return self.snapshot if snapshot_id == self.snapshot else None

    async def fetch_catalog_identity(
        self,
        snapshot_id: str,
        product_ids: Sequence[str],
        variant_ids: Sequence[str],
    ) -> Sequence[Mapping[str, object]]:
        if snapshot_id != self.snapshot:
            return []
        requested_products = set(product_ids)
        requested_variants = set(variant_ids)
        return [
            {"product_id": row["product_id"], "variant_id": row["variant_id"]}
            for row in self.rows
            if row["product_id"] in requested_products
            and row["variant_id"] in requested_variants
        ]

    async def fetch_plan_rows(
        self,
        snapshot_id: str,
        product_ids: Sequence[str],
        variant_ids: Sequence[str],
    ) -> Sequence[Mapping[str, object]]:
        if snapshot_id != self.snapshot:
            return []
        requested_products = set(product_ids)
        requested_variants = set(variant_ids)
        return [
            row
            for row in self.rows
            if row["product_id"] in requested_products
            or row["variant_id"] in requested_variants
        ]

    async def check_ready(self) -> bool:
        return True


def _catalog_rows(payload: Mapping[str, object]) -> list[dict[str, object]]:
    snapshot = payload.get("snapshot")
    entries = payload.get("entries")
    formats = payload.get("formats")
    if (
        not isinstance(snapshot, str)
        or not isinstance(entries, dict)
        or not isinstance(formats, dict)
    ):
        raise ValueError("payload requires snapshot, entries and formats")

    rows_by_variant: dict[str, dict[str, object]] = {}
    shape_by_type = {
        "redondo": "redondo",
        "link": "link",
        "tubito": "modelar",
        "corazon": "corazon",
    }
    for key, raw_entry in entries.items():
        if (
            not isinstance(key, str)
            or not isinstance(raw_entry, dict)
            or "|" not in key
        ):
            raise ValueError("crosswalk entry has an invalid shape")
        size_code, color_code = key.split("|", 1)
        raw_format = formats.get(size_code)
        if not isinstance(raw_format, dict):
            raise ValueError(f"crosswalk format is missing: {size_code}")
        product_id = raw_entry.get("productId")
        product_title = raw_entry.get("titulo")
        color = raw_entry.get("color")
        variants = raw_entry.get("variantes")
        if (
            not isinstance(product_id, str)
            or not isinstance(product_title, str)
            or not isinstance(variants, list)
        ):
            raise ValueError(f"crosswalk product is invalid: {key}")
        color_values = [color] if isinstance(color, str) and color else []
        format_type = raw_format.get("type")
        shape = shape_by_type.get(format_type) if isinstance(format_type, str) else None
        diameter = raw_format.get("diameterInches")
        if shape is None or not isinstance(diameter, (float, int)):
            raise ValueError(f"crosswalk format metadata is invalid: {size_code}")

        for raw_variant in variants:
            if not isinstance(raw_variant, dict):
                raise ValueError(f"crosswalk variant is invalid: {key}")
            variant_id = raw_variant.get("variantId")
            variant_title = raw_variant.get("titulo")
            units = raw_variant.get("unidadesPaq")
            price = raw_variant.get("precio")
            if (
                not isinstance(variant_id, str)
                or not isinstance(variant_title, str)
                or not isinstance(units, int)
                or not isinstance(price, int)
            ):
                raise ValueError(f"crosswalk variant fields are invalid: {key}")
            row: dict[str, object] = {
                "product_id": product_id,
                "variant_id": variant_id,
                "sku": None,
                "sku_original": None,
                "source_snapshot_id": snapshot,
                "source_variant_id": variant_id,
                "inventory_quantity": None,
                "unidades_inferidas": False,
                "producto_titulo": product_title,
                "variante_titulo": variant_title,
                "precio": price,
                "unidades_paq": units,
                "disponible": True,
                "producto_disponible": True,
                "codigo_tamano": size_code,
                "forma": shape,
                "diam_pulg": diameter,
                "colores_producto": color_values,
                "colores_variante": [],
                "acabados_producto": [],
                "descripcion": f"{product_title} ({color_code})",
                "imagen": None,
                "currency": "COP",
            }
            previous = rows_by_variant.get(variant_id)
            if previous is not None and previous != row:
                raise ValueError(
                    f"variant has conflicting crosswalk rows: {variant_id}"
                )
            rows_by_variant[variant_id] = row
    return list(rows_by_variant.values())


def _selected_product(
    color_code: str,
    entries: Mapping[str, object],
    rows: Sequence[Mapping[str, object]],
) -> str:
    preferred = entries.get(f"R-12|{color_code}")
    if isinstance(preferred, dict):
        preferred_product_id = preferred.get("productId")
        if isinstance(preferred_product_id, str):
            return preferred_product_id

    size_coverage: dict[str, set[str]] = {}
    for row in rows:
        product_id = row.get("product_id")
        size_code = row.get("codigo_tamano")
        if isinstance(product_id, str) and isinstance(size_code, str):
            size_coverage.setdefault(product_id, set()).add(size_code)
    candidates: set[str] = set()
    for key, raw_entry in entries.items():
        if not key.endswith(f"|{color_code}") or not isinstance(raw_entry, dict):
            continue
        product_id = raw_entry.get("productId")
        if isinstance(product_id, str):
            candidates.add(product_id)
    if not candidates:
        raise ValueError(f"no local catalogue product for colour {color_code}")
    return min(
        candidates,
        key=lambda product_id: (-len(size_coverage.get(product_id, set())), product_id),
    )


def _case_request(
    case: Mapping[str, object],
    payload: Mapping[str, object],
    rows: Sequence[Mapping[str, object]],
) -> PlanResolutionRequest:
    raw_entries = payload.get("entries")
    if not isinstance(raw_entries, dict):
        raise ValueError("payload requires crosswalk entries")
    entries: dict[str, object] = {}
    for key, value in raw_entries.items():
        if not isinstance(key, str):
            raise ValueError("crosswalk entry key must be a string")
        entries[key] = value
    colors = case.get("colors")
    if not isinstance(colors, list) or not colors:
        raise ValueError("official parity case must contain colours")

    materials: list[dict[str, object]] = []
    product_ids: set[str] = set()
    for color in colors:
        if not isinstance(color, dict):
            raise ValueError("official parity colour has an invalid shape")
        code = color.get("code")
        name = color.get("name")
        participation = color.get("participation")
        if (
            not isinstance(code, str)
            or not isinstance(name, str)
            or not isinstance(participation, (float, int))
            or isinstance(participation, bool)
        ):
            raise ValueError(
                "official parity colour is missing code, name or participation"
            )
        product_id = _selected_product(code, entries, rows)
        product_ids.add(product_id)
        materials.append(
            {
                "product_id": product_id,
                "color": name,
                "participacion": participation,
                "rol_material": "principal",
            }
        )

    variants_by_product: dict[str, list[str]] = {}
    for row in rows:
        row_product_id = row.get("product_id")
        variant_id = row.get("variant_id")
        if (
            isinstance(row_product_id, str)
            and row_product_id in product_ids
            and isinstance(variant_id, str)
        ):
            variants_by_product.setdefault(row_product_id, []).append(variant_id)
    allowlist = [
        {
            "product_id": product_id,
            "variant_ids": sorted(set(variants_by_product.get(product_id, []))),
        }
        for product_id in sorted(product_ids)
    ]
    if any(not entry["variant_ids"] for entry in allowlist):
        raise ValueError("selected product has no local variants")

    case_id = case.get("id")
    official = case.get("official")
    type_name = case.get("type")
    location = case.get("location")
    raw_measures = case.get("measures")
    density = case.get("density")
    mix = case.get("mix")
    if not isinstance(case_id, str) or not case_id:
        raise ValueError("official parity case requires an id")
    if not isinstance(official, str) or not official:
        raise ValueError("official parity case requires an official structure")
    if not isinstance(type_name, str) or not type_name:
        raise ValueError("official parity case requires a type")
    if not isinstance(location, str) or not location:
        raise ValueError("official parity case requires a location")
    if not isinstance(density, str) or not density:
        raise ValueError("official parity case requires a density")
    if not isinstance(mix, str) or not mix:
        raise ValueError("official parity case is missing its identifiers or defaults")
    if not isinstance(raw_measures, dict):
        raise ValueError("official parity case measures must be an object")
    measures: dict[str, int | float] = {}
    for key, value in raw_measures.items():
        if (
            not isinstance(key, str)
            or not isinstance(value, (int, float))
            or isinstance(value, bool)
        ):
            raise ValueError("official parity case measure must be numeric")
        measures[key] = value
    snapshot = payload.get("snapshot")
    if not isinstance(snapshot, str):
        raise ValueError("payload requires a catalog snapshot")

    structure: dict[str, object] = {
        "estructura_id": f"EST_01_{official.upper()}",
        "estructura_oficial": official,
        "nombre": str(case.get("name") or official),
        "tipo": type_name,
        "rol_escena": "focal",
        "ubicacion": location,
        "medidas": {
            key.replace("M", "_m").lower(): value for key, value in measures.items()
        },
        "repeticiones": 1,
        "densidad": density,
        "mezcla": mix,
        "materiales": materials,
        "porque": "Caso offline de paridad REQ-007.",
    }
    units = case.get("declaredUnits")
    if isinstance(units, int) and units > 0:
        structure["unidades_declaradas"] = units

    fixture = json.loads(
        (
            ROOT
            / "contracts"
            / "domain"
            / "v1"
            / "fixtures"
            / "plan-decoracion-ok.json"
        ).read_text(encoding="utf-8")
    )
    plan = dict(fixture)
    plan["plan_id"] = str(
        uuid.uuid5(uuid.NAMESPACE_URL, f"req014-parity-plan:{case_id}")
    )
    plan["concepto"] = dict(fixture["concepto"])
    plan["concepto"]["titulo"] = str(case.get("name") or case_id)
    plan["concepto"]["paleta"] = [material["color"] for material in materials]
    plan["estructuras"] = [structure]

    request_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"req014-parity-request:{case_id}"))
    return PlanResolutionRequest.model_validate(
        {
            "context": {
                "schema_version": "operational.v1",
                "request_id": request_id,
                "correlation_id": str(
                    uuid.uuid5(
                        uuid.NAMESPACE_URL, f"req014-parity-correlation:{case_id}"
                    )
                ),
                "deadline_at": "2030-01-01T00:00:00Z",
                "deadline_ms": 30_000,
                "body_sha256": "a" * 64,
                "scopes": ["plan.resolve"],
            },
            "schema_version": "plan-resolution.v1",
            "plan": plan,
            "allowlist": allowlist,
            "catalog_snapshot_id": snapshot,
        }
    )


async def _resolve(payload: Mapping[str, object]) -> list[dict[str, object]]:
    rows = _catalog_rows(payload)
    store = SnapshotStore(str(payload["snapshot"]), rows)
    cases = payload.get("cases")
    if not isinstance(cases, list):
        raise ValueError("payload requires an official cases list")

    output: list[dict[str, object]] = []
    for raw_case in cases:
        if not isinstance(raw_case, dict):
            raise ValueError("official parity case must be an object")
        case_id = raw_case.get("id")
        if not isinstance(case_id, str):
            raise ValueError("official parity case requires an id")
        request = _case_request(raw_case, payload, rows)
        response = await resolve_plan(request, store)
        resolved = response["plan_resuelto"]
        structure = resolved["estructuras"][0]
        lines = structure["lineas"]
        output.append(
            {
                "id": case_id,
                "total": resolved["totales"]["total_unidades"],
                "sizeMix": resolved["totales"]["globos_por_tamano"],
                "colors": sorted(
                    {
                        str(line.get("color", "")).strip().lower()
                        for line in lines
                        if line.get("color")
                    }
                ),
                "axisM": structure.get("eje_m"),
                "priceCop": resolved["totales"]["purchase_cost"],
                "uncovered": resolved.get("sin_cobertura", []),
                "substitutions": resolved.get("sustituciones", []),
                "warnings": resolved.get("advertencias", []),
            }
        )
    return output


def main() -> None:
    payload = json.load(sys.stdin)
    if not isinstance(payload, dict):
        raise ValueError("input payload must be an object")
    result = asyncio.run(_resolve(payload))
    json.dump(result, sys.stdout, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
