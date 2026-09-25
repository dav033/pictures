"""El armado de bouquets dentro de la resolución del plan (ADR-0030).

Un bouquet de 7 globos: 3 R-12 blanco, 3 R-12 rosado y un corazón metalizado de
18". ``_distribute_units(7, [3/7, 3/7, 1/7])`` compra exactamente 3, 3 y 1; el
armado solo los acomoda, así que el precio es el mismo con y sin él.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from typing import cast

import pytest

from app.plan import PlanResolutionError, PlanResolutionRequest, resolve_plan
from app.plan_edicion import EdicionReparto, editar_plan

SNAPSHOT = "products_catalog:armado"
PARTES = (0.428571, 0.428571, 0.142858)


def _row(
    clave: str, titulo: str, variante: str, *, forma: str | None, diam: float | None, codigo: str
) -> dict[str, object]:
    return {
        "product_id": f"prod-{clave}",
        "variant_id": f"var-{clave}",
        "sku": clave.upper(),
        "sku_original": clave.upper(),
        "source_snapshot_id": SNAPSHOT,
        "source_variant_id": f"source-{clave}",
        "inventory_quantity": 500,
        "unidades_inferidas": False,
        "producto_titulo": titulo,
        "variante_titulo": variante,
        "precio": 10000,
        "unidades_paq": 1 if forma is None else 50,
        "disponible": True,
        "producto_disponible": True,
        "codigo_tamano": codigo,
        "forma": forma,
        "diam_pulg": diam,
        "colores_producto": [clave.split("-")[-1]],
        "colores_variante": [clave.split("-")[-1]],
        "acabados_producto": [],
        "descripcion": titulo,
        "imagen": f"https://cdn.example/{clave}.jpg",
        "currency": "COP",
    }


ROWS = [
    _row("r12-blanco", "Globo látex blanco", "R-12", forma="redondo", diam=12, codigo="R-12"),
    _row("r12-rosado", "Globo látex rosado", "R-12", forma="redondo", diam=12, codigo="R-12"),
    _row(
        "foil-dorado",
        "B2b Globo Metalizado Corazon Dorado Mate",
        "18 IN / PAQUETE X 1",
        forma=None,
        diam=None,
        codigo="18 IN",
    ),
]


class FakePlanStore:
    async def published_snapshot(self, snapshot_id: str) -> str | None:
        return SNAPSHOT if snapshot_id == SNAPSHOT else None

    async def fetch_plan_rows(
        self, snapshot_id: str, product_ids: object, variant_ids: object, lora: object = ()
    ) -> list[dict[str, object]]:
        return ROWS

    async def fetch_catalog_identity(
        self, snapshot_id: str, product_ids: object, variant_ids: object
    ) -> list[dict[str, object]]:
        return [{"product_id": r["product_id"], "variant_id": r["variant_id"]} for r in ROWS] + [
            {"product_id": r["product_id"], "variant_id": None} for r in ROWS
        ]

    async def check_ready(self) -> bool:
        return True


def _bouquet(**extra: object) -> dict[str, object]:
    materiales = [
        ("r12-blanco", "blanco"),
        ("r12-rosado", "rosado"),
        ("foil-dorado", "dorado"),
    ]
    return {
        "estructura_id": "EST_01_BOUQUET",
        "nombre": "Bouquet de globos",
        "tipo": "kit",
        "estructura_oficial": "bouquet",
        "rol_escena": "acento",
        "ubicacion": "sobre_mesa_principal",
        "medidas": {},
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": "clasica",
        "unidades_declaradas": 7,
        "referencia_element_id": "REF_01_E01",
        "materiales": [
            {
                "product_id": f"prod-{clave}",
                "variant_id": f"var-{clave}",
                "color": color,
                "participacion": parte,
                "rol_material": "principal" if indice == 0 else "secundario",
            }
            for indice, ((clave, color), parte) in enumerate(zip(materiales, PARTES, strict=True))
        ],
        "porque": "Bouquet de prueba.",
        **extra,
    }


def _plan(*estructuras: dict[str, object]) -> dict[str, object]:
    return {
        "plan_version": "1.0",
        "plan_id": "30303030-3030-4303-8303-303030303030",
        "concepto": {"titulo": "Prueba", "descripcion": "Bouquets.", "paleta": ["blanco"]},
        "espacio": {"tipo": "salon", "fuente": "cliente"},
        "estructuras": list(estructuras),
        "supuestos": [],
        "referencia_omitida": [],
    }


def _request(plan: Mapping[str, object], **extra: object) -> PlanResolutionRequest:
    return PlanResolutionRequest.model_validate(
        {
            "context": {
                "schema_version": "operational.v1",
                "request_id": "00000000-0000-4000-8000-000000000030",
                "correlation_id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
                "deadline_at": "2030-01-01T00:00:00Z",
                "deadline_ms": 1000,
                "body_sha256": "a" * 64,
                "scopes": ["plan.resolve"],
            },
            "schema_version": "plan-resolution.v1",
            "plan": plan,
            "allowlist": [
                {"product_id": row["product_id"], "variant_ids": [row["variant_id"]]}
                for row in ROWS
            ],
            "catalog_snapshot_id": SNAPSHOT,
            **extra,
        }
    )


async def _resolve(plan: Mapping[str, object], **extra: object) -> dict[str, object]:
    result = await resolve_plan(_request(plan, **extra), FakePlanStore())  # type: ignore[arg-type]
    return cast(dict[str, object], result["plan_resuelto"])


def _lineas(resolved: Mapping[str, object]) -> list[tuple[str, int]]:
    estructuras = cast(list[dict[str, object]], resolved["estructuras"])
    return [
        (str(linea["variant_id"]), cast(int, linea["unidades"]))
        for linea in cast(list[dict[str, object]], estructuras[0]["lineas"])
    ]


def _armado(resolved: Mapping[str, object]) -> dict[str, object] | None:
    plan = cast(dict[str, object], resolved["plan"])
    estructura = cast(list[dict[str, object]], plan["estructuras"])[0]
    return cast(dict[str, object] | None, estructura.get("armado_bouquet"))


@pytest.mark.anyio
async def test_sin_la_bandera_nada_cambia() -> None:
    base = await _resolve(_plan(_bouquet()))
    explicito = await _resolve(_plan(_bouquet()), completar_armados=False)
    assert base["plan_hash"] == explicito["plan_hash"]
    assert _armado(base) is None and "armados_bouquet" not in base


@pytest.mark.anyio
async def test_completar_arma_el_bouquet_sin_cambiar_la_compra() -> None:
    base = await _resolve(_plan(_bouquet()))
    armado = await _resolve(_plan(_bouquet()), completar_armados=True)
    assert (
        _lineas(armado)
        == _lineas(base)
        == [
            ("var-r12-blanco", 3),
            ("var-r12-rosado", 3),
            ("var-foil-dorado", 1),
        ]
    )
    totales = cast(dict[str, object], armado["totales"])
    assert totales["total_cop"] == cast(dict[str, object], base["totales"])["total_cop"]
    assert _armado(armado) is not None and cast(dict[str, object], _armado(armado))["variante"] == (
        "helio_apilado"
    )
    assert armado["plan_hash"] != base["plan_hash"], "el armado es parte del plan firmado"
    resueltos = cast(list[dict[str, object]], armado["armados_bouquet"])
    assert [e["codigo"] for e in cast(list[dict[str, object]], resueltos[0]["leyenda"])] == [
        1,
        2,
        3,
    ]


@pytest.mark.anyio
async def test_armados_bouquet_queda_fuera_del_hash_y_es_punto_fijo() -> None:
    primera = await _resolve(_plan(_bouquet()), completar_armados=True)
    snapshot = {
        "catalog_snapshot_id": SNAPSHOT,
        "estructuras": primera["estructuras"],
        "compras": primera["compras"],
        "total_cop": cast(dict[str, object], primera["totales"])["total_cop"],
    }
    canonical = json.dumps(
        {"plan": primera["plan"], "snapshot": snapshot},
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    assert primera["plan_hash"] == hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    segunda = await _resolve(cast(dict[str, object], primera["plan"]))
    assert segunda["plan_hash"] == primera["plan_hash"]
    assert segunda["armados_bouquet"] == primera["armados_bouquet"]


@pytest.mark.anyio
async def test_la_lectura_de_la_foto_decide_la_variante() -> None:
    pista = {
        "referencia_element_id": "REF_01_E01",
        "variante": "helio_escalonado",
        "niveles": [],
        "confianza": 0.9,
    }
    resolved = await _resolve(_plan(_bouquet()), completar_armados=True, pistas_armado=[pista])
    armado = cast(dict[str, object], _armado(resolved))
    assert (armado["variante"], armado["origen"]) == ("helio_escalonado", "referencia")


@pytest.mark.anyio
async def test_un_kit_que_no_es_bouquet_no_recibe_armado() -> None:
    kit = _bouquet(estructura_oficial=None, nombre="Kit de globos")
    kit.pop("estructura_oficial")
    base = await _resolve(_plan(kit))
    completado = await _resolve(_plan(kit), completar_armados=True)
    assert completado["plan_hash"] == base["plan_hash"]
    assert "armados_bouquet" not in completado


@pytest.mark.anyio
async def test_un_armado_que_no_coincide_con_la_compra_se_rechaza() -> None:
    malo = {
        "version": "armado-bouquet.v1",
        "origen": "decorador",
        "variante": "helio_escalonado",
        "niveles": [{"rol": "alrededor", "unidad": "suelto", "cantidad": 2, "posiciones": [0]}],
    }
    with pytest.raises(PlanResolutionError) as error:
        await _resolve(_plan(_bouquet(armado_bouquet=malo)))
    assert error.value.code == "armado_invalido"


@pytest.mark.anyio
async def test_editar_los_globos_quita_el_armado_con_aviso() -> None:
    resolved = await _resolve(_plan(_bouquet()), completar_armados=True)
    edicion = EdicionReparto(
        accion="repartir", estructura_id="EST_01_BOUQUET", participaciones=[0.5, 0.25, 0.25]
    )
    editado = editar_plan(cast(dict[str, object], resolved["plan"]), edicion)
    estructura = cast(list[dict[str, object]], editado.plan["estructuras"])[0]
    assert "armado_bouquet" not in estructura
    assert any("armado del bouquet" in aviso for aviso in editado.avisos)
