"""Flores de globo como adorno de una pieza: Python cuenta sus globos, elige la talla y los cotiza (2026-10-07)."""

from __future__ import annotations

import json
from typing import cast

import pytest

from app.flores_pieza import ADORNO_FLOR, PETALOS_POR_DEFECTO, PULGADAS_FLOR, partes_de_flores
from app.plan import PlanResolutionError, PlanResolutionRequest, resolve_plan
from app.plan_edicion import EdicionFlores, editar_plan
from tests.test_plan import FakePlanStore, _request, _row


def _globo(
    product_id: str, variant_id: str, color: str, pulgadas: int, *, por_paquete: int, precio: int
) -> dict[str, object]:
    row = _row(variant_id=variant_id)
    row.update(
        {
            "product_id": product_id,
            "sku": variant_id.upper(),
            "sku_original": variant_id.upper(),
            "source_variant_id": f"source-{variant_id}",
            "producto_titulo": f"B2b Globo Latex Redondo {color.title()}",
            "variante_titulo": f"R-{pulgadas} / PAQUETE X {por_paquete}",
            "codigo_tamano": f"R-{pulgadas}",
            "diam_pulg": pulgadas,
            "unidades_paq": por_paquete,
            "precio": precio,
            "colores_producto": [color],
            "colores_variante": [color],
        }
    )
    return row


BLANCO_5_X12 = _globo("prod-blanco", "var-blanco-5-x12", "blanco", 5, por_paquete=12, precio=2000)
BLANCO_5_X50 = _globo("prod-blanco", "var-blanco-5-x50", "blanco", 5, por_paquete=50, precio=6000)
DORADO_5_X20 = _globo("prod-dorado", "var-dorado-5-x20", "dorado", 5, por_paquete=20, precio=6000)
DORADO_9_X20 = _globo("prod-dorado", "var-dorado-9-x20", "dorado", 9, por_paquete=20, precio=8000)

ALLOWLIST: list[dict[str, object]] = [
    {"product_id": "prod-rojo", "variant_ids": ["var-rojo-12"]},
    {"product_id": "prod-blanco", "variant_ids": ["var-blanco-5-x12", "var-blanco-5-x50"]},
    {"product_id": "prod-dorado", "variant_ids": ["var-dorado-5-x20", "var-dorado-9-x20"]},
]

FLORES = {
    "cantidad": 4,
    "petalo": {"product_id": "prod-blanco", "color": "blanco"},
    "centro": {"product_id": "prod-dorado", "color": "dorado"},
}


def _con_flores(
    flores: dict[str, object] | None,
    *,
    repeticiones: int = 1,
    allowlist: list[dict[str, object]] | None = None,
) -> PlanResolutionRequest:
    payload = _request(allowlist=allowlist or ALLOWLIST).model_dump(mode="json", exclude_none=True)
    plan = json.loads(json.dumps(payload["plan"]))
    estructura = cast(dict[str, object], plan["estructuras"][0])
    estructura["repeticiones"] = repeticiones
    if flores is not None:
        estructura["flores"] = flores
    return PlanResolutionRequest.model_validate({**payload, "plan": plan})


def _resuelto(resultado: dict[str, object]) -> dict[str, object]:
    return cast(dict[str, object], resultado["plan_resuelto"])


def _lineas(resuelto: dict[str, object]) -> list[dict[str, object]]:
    return cast(
        list[dict[str, object]], cast(list[dict[str, object]], resuelto["estructuras"])[0]["lineas"]
    )


def test_las_reglas_salen_del_contrato_y_cuentan_por_pieza_y_repeticiones() -> None:
    assert PULGADAS_FLOR == 5
    assert PETALOS_POR_DEFECTO == 3
    partes = partes_de_flores(FLORES, 2)
    assert [(parte.parte, parte.product_id, parte.unidades) for parte in partes] == [
        ("petalo", "prod-blanco", 4 * 3 * 2),
        ("centro", "prod-dorado", 4 * 2),
    ]
    # Sin centro, la flor es solo de pétalos; con `petalos`, los que diga.
    solo = partes_de_flores(
        {"cantidad": 2, "petalos": 5, "petalo": {"product_id": "prod-blanco"}}, 1
    )
    assert [(parte.parte, parte.unidades, parte.color) for parte in solo] == [("petalo", 10, None)]


@pytest.mark.anyio
async def test_las_flores_se_cuentan_y_se_cotizan_como_cualquier_linea() -> None:
    store = FakePlanStore([_row(), BLANCO_5_X12, BLANCO_5_X50, DORADO_5_X20, DORADO_9_X20])
    sin = _resuelto(await resolve_plan(_con_flores(None), store))
    con = _resuelto(await resolve_plan(_con_flores(FLORES), store))

    flores = [linea for linea in _lineas(con) if linea.get("adorno") == ADORNO_FLOR]
    assert {(linea["color"], linea["diam_pulg"]): linea["unidades"] for linea in flores} == {
        ("blanco", 5): 12,
        ("dorado", 5): 4,
    }
    assert all(linea["sustitucion"] is None for linea in flores)
    # El cuerpo no cambia: mismas líneas, misma mezcla real (sin los 5″ de las flores).
    cuerpo = [linea for linea in _lineas(con) if linea.get("adorno") is None]
    assert [(linea["variant_id"], linea["unidades"]) for linea in cuerpo] == [
        (linea["variant_id"], linea["unidades"]) for linea in _lineas(sin)
    ]
    estructura = cast(list[dict[str, object]], con["estructuras"])[0]
    assert (
        estructura["mezcla_real"]
        == cast(list[dict[str, object]], sin["estructuras"])[0]["mezcla_real"]
    )
    assert (
        estructura["total_unidades"]
        == cast(int, cast(list[dict[str, object]], sin["estructuras"])[0]["total_unidades"]) + 16
    )
    # Se compran por paquete: 12 pétalos (+ merma) en el paquete de 12 o el de 50, el más barato que cubre; 4 centros en uno de 20.
    compras = {
        cast(str, compra["variant_id"]): compra
        for compra in cast(list[dict[str, object]], con["compras"])
    }
    assert compras["var-dorado-5-x20"]["design_quantity"] == 4
    assert compras["var-dorado-5-x20"]["paquetes"] == 1
    petalos = [
        compra for variante, compra in compras.items() if variante.startswith("var-blanco-5")
    ]
    assert sum(cast(int, compra["design_quantity"]) for compra in petalos) == 12
    assert (
        cast(dict[str, int], con["totales"])["total_cop"]
        > cast(dict[str, int], sin["totales"])["total_cop"]
    )
    assert "plan.flores" not in json.dumps(con["advertencias"])


@pytest.mark.anyio
async def test_dos_piezas_llevan_cada_una_sus_flores() -> None:
    store = FakePlanStore([_row(), BLANCO_5_X12, BLANCO_5_X50, DORADO_5_X20])
    con = _resuelto(await resolve_plan(_con_flores(FLORES, repeticiones=2), store))
    flores = [linea for linea in _lineas(con) if linea.get("adorno") == ADORNO_FLOR]
    assert sum(cast(int, linea["unidades"]) for linea in flores) == 32


@pytest.mark.anyio
async def test_sin_r5_las_flores_van_en_la_talla_mas_cercana_y_se_avisa() -> None:
    allowlist = [
        {"product_id": "prod-rojo", "variant_ids": ["var-rojo-12"]},
        {"product_id": "prod-blanco", "variant_ids": ["var-blanco-5-x12"]},
        {"product_id": "prod-dorado", "variant_ids": ["var-dorado-9-x20"]},
    ]
    store = FakePlanStore([_row(), BLANCO_5_X12, DORADO_9_X20])
    con = _resuelto(await resolve_plan(_con_flores(FLORES, allowlist=allowlist), store))
    centro = next(
        linea
        for linea in _lineas(con)
        if linea.get("adorno") == ADORNO_FLOR and linea["color"] == "dorado"
    )
    assert centro["diam_pulg"] == 9
    assert cast(dict[str, str], centro["sustitucion"])["pedido"] == "R-5"
    assert any(
        aviso.startswith("flores_talla_sustituida:EST_01_ARCO")
        for aviso in cast(list[str], con["advertencias"])
    )
    assert not con["sin_cobertura"]


@pytest.mark.anyio
async def test_sin_globo_redondo_las_flores_quedan_sin_cobertura_y_se_avisa() -> None:
    allowlist = [
        {"product_id": "prod-rojo", "variant_ids": ["var-rojo-12"]},
        {"product_id": "prod-blanco", "variant_ids": ["var-blanco-5-x12"]},
    ]
    store = FakePlanStore([_row(), BLANCO_5_X12])
    con = _resuelto(await resolve_plan(_con_flores(FLORES, allowlist=allowlist), store))
    assert {"estructura_id": "EST_01_ARCO", "product_id": "prod-dorado", "tamano": "R-5"} in cast(
        list[dict[str, object]], con["sin_cobertura"]
    )
    assert any(
        aviso.startswith("flores_sin_cobertura:EST_01_ARCO")
        for aviso in cast(list[str], con["advertencias"])
    )
    # Los pétalos, que sí hay, se compran igual.
    assert any(
        linea.get("adorno") == ADORNO_FLOR and linea["color"] == "blanco" for linea in _lineas(con)
    )


def test_la_edicion_pone_y_quita_las_flores_sin_tocar_lo_demas() -> None:
    plan = _con_flores(None).plan
    con = editar_plan(
        plan, EdicionFlores(accion="flores", estructura_id="EST_01_ARCO", flores=FLORES)
    ).plan
    estructura = cast(list[dict[str, object]], con["estructuras"])[0]
    assert estructura["flores"] == FLORES
    assert (
        estructura["materiales"]
        == cast(list[dict[str, object]], plan["estructuras"])[0]["materiales"]
    )
    sin = editar_plan(
        con, EdicionFlores(accion="flores", estructura_id="EST_01_ARCO", flores=None)
    ).plan
    assert "flores" not in cast(list[dict[str, object]], sin["estructuras"])[0]


def test_la_edicion_rechaza_flores_que_no_cumplen_el_contrato() -> None:
    plan = _con_flores(None).plan
    with pytest.raises(PlanResolutionError):
        editar_plan(
            plan,
            EdicionFlores(
                accion="flores",
                estructura_id="EST_01_ARCO",
                flores={"cantidad": 0, "petalo": {"product_id": "prod-blanco"}},
            ),
        )
