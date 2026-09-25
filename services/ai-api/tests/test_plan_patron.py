"""El patrón de color dentro de la resolución del plan (ADR-0028 §5, §7, §8).

Expectativas a mano. La columna de referencia es clásica (solo R-12), media,
1.8 m: eje 1.8 m, banda 1.3 × 28.04 cm, λ = 3.6 y globo de 0.0618 m² dan
T = ceil(38.25) = 39 globos (el mismo total que fija el vector dorado 13). En
cuartetos son round(39 / 4) = 10 filas, 40 globos.
"""

from __future__ import annotations

import hashlib
import json
import time
from collections.abc import Mapping, Sequence
from typing import Any, cast
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import Settings, build_signature, create_app
from app.operational_store import InMemoryOperationalStore
from app.plan import (
    PlanResolutionError,
    PlanResolutionRequest,
    _despiece_with_plan_sizes,
    patron_resuelto_de_estructura,
    resolve_plan,
    sincronizar_participaciones,
    sugerir_patron_para_estructura,
)
from app.plan_edicion import (
    EdicionMaterial,
    LineaBase,
    LineasBaseEstructura,
    PlanPatronRequest,
    VarianteEdicion,
    editar_plan,
    vista_previa_patron,
)

SNAPSHOT = "products_catalog:patrones"
SECRET = "p" * 32
ESPIRAL = {
    "version": "patron-color.v1",
    "origen": "decorador",
    "base": {"modo": "espiral", "racimo": [0, 1, 0, 2], "trazo": "espiral"},
}


def _row(color: str) -> dict[str, object]:
    return {
        "product_id": f"prod-{color}",
        "variant_id": f"var-{color}-12",
        "sku": f"{color.upper()}-12",
        "sku_original": f"{color.upper()}-12",
        "source_snapshot_id": SNAPSHOT,
        "source_variant_id": f"source-{color}-12",
        "inventory_quantity": 500,
        "unidades_inferidas": False,
        "producto_titulo": f"Globo látex {color}",
        "variante_titulo": "R-12",
        "precio": 10000,
        "unidades_paq": 50,
        "disponible": True,
        "producto_disponible": True,
        "codigo_tamano": "R-12",
        "forma": "redondo",
        "diam_pulg": 12,
        "colores_producto": [color],
        "colores_variante": [color],
        "acabados_producto": [],
        "descripcion": f"Globo de látex {color}",
        "imagen": f"https://cdn.example/{color}-12.jpg",
        "currency": "COP",
    }


class FakePlanStore:
    def __init__(self, rows: Sequence[dict[str, object]]) -> None:
        self.rows = list(rows)

    async def published_snapshot(self, snapshot_id: str) -> str | None:
        return SNAPSHOT if snapshot_id == SNAPSHOT else None

    async def fetch_plan_rows(
        self,
        snapshot_id: str,
        product_ids: Sequence[str],
        variant_ids: Sequence[str],
        lora_variant_ids: Sequence[str] = (),
    ) -> Sequence[dict[str, object]]:
        return self.rows

    async def fetch_catalog_identity(
        self, snapshot_id: str, product_ids: Sequence[str], variant_ids: Sequence[str]
    ) -> Sequence[dict[str, object]]:
        identity: list[dict[str, object]] = [
            {"product_id": row["product_id"], "variant_id": row["variant_id"]} for row in self.rows
        ]
        identity.extend(
            {"product_id": product_id, "variant_id": None}
            for product_id in dict.fromkeys(str(row["product_id"]) for row in self.rows)
        )
        return identity

    async def check_ready(self) -> bool:
        return True


def _columna(
    colores: Sequence[str] = ("blanco", "negro", "azul"),
    partes: Sequence[float] = (0.4, 0.3, 0.3),
    **extra: object,
) -> dict[str, object]:
    return {
        "estructura_id": "EST_01_COLUMNA",
        "nombre": "Columna",
        "tipo": "columna",
        "rol_escena": "focal",
        "ubicacion": "lateral_izquierdo",
        "medidas": {"alto_m": 1.8},
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": "clasica",
        "materiales": [
            {
                "product_id": f"prod-{color}",
                "color": color,
                "participacion": parte,
                "rol_material": "principal" if indice == 0 else "secundario",
            }
            for indice, (color, parte) in enumerate(zip(colores, partes, strict=True))
        ],
        "porque": "Columna de prueba.",
        **extra,
    }


def _plan(*estructuras: dict[str, object]) -> dict[str, object]:
    return {
        "plan_version": "1.0",
        "plan_id": "29292929-2929-4292-8292-292929292929",
        "concepto": {"titulo": "Prueba", "descripcion": "Patrones.", "paleta": ["blanco"]},
        "espacio": {"tipo": "salon", "fuente": "cliente"},
        "estructuras": list(estructuras),
        "supuestos": [],
        "referencia_omitida": [],
    }


def _request(plan: Mapping[str, object], **extra: object) -> PlanResolutionRequest:
    colores = sorted(
        {
            str(material["color"])
            for estructura in cast(list[dict[str, object]], plan["estructuras"])
            for material in cast(list[dict[str, object]], estructura["materiales"])
        }
    )
    return PlanResolutionRequest.model_validate(
        {
            "context": {
                "schema_version": "operational.v1",
                "request_id": "00000000-0000-4000-8000-000000000029",
                "correlation_id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
                "deadline_at": "2030-01-01T00:00:00Z",
                "deadline_ms": 1000,
                "body_sha256": "a" * 64,
                "scopes": ["plan.resolve"],
            },
            "schema_version": "plan-resolution.v1",
            "plan": plan,
            "allowlist": [
                {"product_id": f"prod-{color}", "variant_ids": [f"var-{color}-12"]}
                for color in colores
            ],
            "catalog_snapshot_id": SNAPSHOT,
            **extra,
        }
    )


async def _resolve(plan: Mapping[str, object], **extra: object) -> dict[str, object]:
    request = _request(plan, **extra)
    colores = {entry.product_id.removeprefix("prod-") for entry in request.allowlist}
    result = await resolve_plan(request, FakePlanStore([_row(color) for color in sorted(colores)]))
    return cast(dict[str, object], result["plan_resuelto"])


def _por_color(resolved: Mapping[str, object]) -> dict[str, int]:
    totals: dict[str, int] = {}
    for structure in cast(list[dict[str, object]], resolved["estructuras"]):
        for line in cast(list[dict[str, object]], structure["lineas"]):
            color = str(line["color"])
            totals[color] = totals.get(color, 0) + cast(int, line["unidades"])
    return totals


def _materiales(resolved: Mapping[str, object]) -> list[dict[str, object]]:
    plan = cast(dict[str, object], resolved["plan"])
    return cast(list[dict[str, object]], cast(list[dict[str, object]], plan["estructuras"])[0]["materiales"])


def _patron_del_plan(resolved: Mapping[str, object]) -> dict[str, object]:
    plan = cast(dict[str, object], resolved["plan"])
    return cast(dict[str, object], cast(list[dict[str, object]], plan["estructuras"])[0]["patron_color"])


# --- Sin patrón nada cambia ------------------------------------------------------


@pytest.mark.anyio
async def test_sin_patron_la_resolucion_es_la_de_siempre() -> None:
    plan = _plan(_columna())

    antes = await _resolve(plan)
    explicito = await _resolve(plan, completar_patrones=False, pistas_patron=[])

    # 39 · (0.4, 0.3, 0.3) = 15.6, 11.7, 11.7 -> 15, 11, 11 y las dos que faltan
    # a los restos 0.7: 15, 12, 12.
    assert _por_color(antes) == {"blanco": 15, "negro": 12, "azul": 12}
    assert "patrones_color" not in antes
    assert explicito == antes


# --- El patrón manda sobre el conteo ------------------------------------------------


@pytest.mark.anyio
async def test_el_patron_decide_el_conteo_por_color_y_entra_en_el_hash() -> None:
    sin_patron = await _resolve(_plan(_columna()))

    resolved = await _resolve(_plan(_columna(patron_color=ESPIRAL)))

    # 10 cuartetos blanco-negro-blanco-azul: 20/10/10 y 40 globos en total.
    assert _por_color(resolved) == {"blanco": 20, "negro": 10, "azul": 10}
    estructura = cast(list[dict[str, object]], resolved["estructuras"])[0]
    assert estructura["total_unidades"] == 40
    assert [material["participacion"] for material in _materiales(resolved)] == [0.5, 0.25, 0.25]
    assert resolved["plan_hash"] != sin_patron["plan_hash"]
    patrones = cast(list[dict[str, object]], resolved["patrones_color"])
    assert [(p["estructura_id"], p["aplicado"], p["filas"], p["columnas"]) for p in patrones] == [
        ("EST_01_COLUMNA", True, 10, 4)
    ]
    assert [c["unidades_total"] for c in cast(list[dict[str, object]], patrones[0]["conteo"])] == [
        20, 10, 10,
    ]


@pytest.mark.anyio
async def test_patrones_color_queda_fuera_del_hash() -> None:
    resolved = await _resolve(_plan(_columna(patron_color=ESPIRAL)))
    snapshot = {
        "catalog_snapshot_id": SNAPSHOT,
        "estructuras": resolved["estructuras"],
        "compras": resolved["compras"],
        "total_cop": cast(dict[str, object], resolved["totales"])["total_cop"],
    }
    canonical = json.dumps(
        {"plan": resolved["plan"], "snapshot": snapshot},
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )

    assert resolved["plan_hash"] == hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@pytest.mark.anyio
async def test_resolver_el_plan_resuelto_otra_vez_es_un_punto_fijo() -> None:
    primera = await _resolve(_plan(_columna(patron_color=ESPIRAL)))

    segunda = await _resolve(cast(dict[str, object], primera["plan"]))

    assert segunda["plan"] == primera["plan"]
    assert segunda["plan_hash"] == primera["plan_hash"]


@pytest.mark.anyio
async def test_varios_tamanos_conservan_el_total_y_reparten_por_la_rejilla() -> None:
    # Arco orgánico fino 3 × 2.4 m, media: T = 119, 30 cuartetos. Degradé suave
    # de tres paradas: 30/60/30 celdas de 120 -> Hamilton(119) = 30, 59, 30. Los
    # tamaños salen de la mezcla: 24.99, 21.42, 64.26, 5.95, 2.38 -> 25, 22, 64,
    # 6, 2. El relleno parte de floor(tamaño · 1/4, 1/2, 1/4) y reparte las
    # cuatro unidades que faltan por resto (0.5 primero, diámetro mayor antes).
    estructura = {
        "tipo": "arco",
        "medidas": {"ancho_m": 3, "alto_m": 2.4},
        "densidad": "media",
        "mezcla": "organica_fina",
        "repeticiones": 1,
        "materiales": [{"color": c, "participacion": 1 / 3} for c in ("blanco", "rosado", "fucsia")],
        "patron_color": {
            "version": "patron-color.v1",
            "origen": "decorador",
            "base": {"modo": "degradado", "paradas": [0, 1, 2], "transicion": "suave"},
        },
    }

    _eje, demandas, _sin_ubicar = _despiece_with_plan_sizes({}, estructura)

    assert [(d["pulgadas"], d["material_index"], d["cantidad"]) for d in demandas] == [
        (5, 0, 6), (5, 1, 12), (5, 2, 7),
        (9, 0, 5), (9, 1, 11), (9, 2, 6),
        (12, 0, 16), (12, 1, 32), (12, 2, 16),
        (18, 0, 2), (18, 1, 3), (18, 2, 1),
        (24, 0, 1), (24, 1, 1),
    ]


def test_varios_tamanos_compran_cada_color_de_la_grafica() -> None:
    # Centro de mesa orgánico fino de 0.4 × 0.5 m, media: T = 10 en round(10 / 4) = 3
    # cuartetos, M = 12 posiciones. Blanco salvo cinco globos pintados, uno de cada
    # color: celdas 7/1/1/1/1/1 -> 10 · c / 12 = 5.83 y cinco 0.83 -> 5, 0, 0, 0, 0, 0
    # y las cinco que faltan a los restos empatados, por posición: 6, 1, 1, 1, 1, 0.
    # El dorado está en la gráfica y es una compra: toma un globo del blanco -> 5/1/1/1/1/1.
    colores = ("blanco", "negro", "azul", "rojo", "verde", "dorado")
    patron = {
        "version": "patron-color.v1",
        "origen": "decorador",
        "base": {"modo": "espiral", "racimo": [0, 0, 0, 0], "trazo": "espiral"},
        "pintados": [
            {"fila": 0, "columna": 1, "material": 1},
            {"fila": 0, "columna": 2, "material": 2},
            {"fila": 0, "columna": 3, "material": 3},
            {"fila": 1, "columna": 0, "material": 4},
            {"fila": 1, "columna": 1, "material": 5},
        ],
    }
    estructura = _columna(
        colores,
        [1 / 6] * 6,
        estructura_id="EST_01_CENTRO_MESA",
        tipo="centro_mesa",
        ubicacion="mesas_invitados",
        medidas={"ancho_m": 0.4, "alto_m": 0.5},
        mezcla="organica_fina",
        patron_color=patron,
    )

    _eje, demandas, _sin_ubicar = _despiece_with_plan_sizes({}, estructura)
    plan = sincronizar_participaciones(_plan(estructura))
    resuelto = patron_resuelto_de_estructura(_plan(estructura), "EST_01_CENTRO_MESA", patron)

    # Tamaños 2.1, 1.8, 5.4, 0.5, 0.2 -> 2, 1, 5, 0, 0 y las dos que faltan a los
    # restos 0.8 (R-9) y 0.5 (R-18): 2, 2, 5, 1, 0. El relleno siembra con las cuotas
    # del conteo (5/10 y 1/10), así sus pisos no pasan del margen de cada color, y
    # reparte lo que falta por resto (0.5 primero, diámetro mayor antes).
    assert [(d["pulgadas"], d["material_index"], d["cantidad"]) for d in demandas] == [
        (5, 0, 1), (5, 5, 1),
        (9, 0, 1), (9, 4, 1),
        (12, 0, 2), (12, 1, 1), (12, 2, 1), (12, 3, 1),
        (18, 0, 1),
    ]
    materiales = cast(list[dict[str, object]], cast(list[dict[str, object]], plan["estructuras"])[0]["materiales"])
    assert [material["participacion"] for material in materiales] == [0.5, 0.1, 0.1, 0.1, 0.1, 0.1]
    conteo = cast(list[dict[str, object]], resuelto["conteo"])
    assert [c["unidades_por_instancia"] for c in conteo] == [5, 1, 1, 1, 1, 1]
    assert cast(list[str], resuelto["avisos"])[-1].startswith(
        "La gráfica tiene 12 posiciones y la mezcla de varios tamaños da 10 globos por pieza"
    )


# --- completar_patrones (§7) -------------------------------------------------------


@pytest.mark.anyio
async def test_completar_patrones_asigna_el_preset_y_queda_fijo() -> None:
    resolved = await _resolve(_plan(_columna()), completar_patrones=True)

    # 4p - 1 = 0.6, 0.2, 0.2: la posición que sobra va al blanco -> {A:2, B:1, C:1}.
    assert _patron_del_plan(resolved) == {
        "version": "patron-color.v1",
        "origen": "sugerido",
        "base": {"modo": "espiral", "racimo": [0, 1, 0, 2], "trazo": "espiral"},
    }
    assert _por_color(resolved) == {"blanco": 20, "negro": 10, "azul": 10}
    # Sin volver a pedir completar, el plan que salió se resuelve igual.
    otra_vez = await _resolve(cast(dict[str, object], resolved["plan"]))
    assert otra_vez["plan_hash"] == resolved["plan_hash"]


def _pista(colores: Sequence[str], confianza: float = 0.8, modo: str = "anillos") -> dict[str, object]:
    return {"referencia_element_id": "ref-col", "modo": modo, "colores": list(colores), "confianza": confianza}


@pytest.mark.anyio
async def test_completar_patrones_usa_la_pista_de_la_foto() -> None:
    plan = _plan(_columna(referencia_element_id="ref-col"))

    resolved = await _resolve(
        plan, completar_patrones=True, pistas_patron=[_pista(["Azul", "blanco", "negro"])]
    )

    assert _patron_del_plan(resolved) == {
        "version": "patron-color.v1",
        "origen": "referencia",
        "base": {"modo": "anillos", "secuencia": [2, 0, 1], "largo": 1},
    }
    # 10 filas azul, blanco, negro, azul...: azul 4 filas, blanco y negro 3.
    assert _por_color(resolved) == {"azul": 16, "blanco": 12, "negro": 12}


@pytest.mark.anyio
async def test_la_pista_se_lee_por_el_tono_mas_cercano() -> None:
    # rosado -> lila con ΔE 24.04 (≤ 25).
    plan = _plan(_columna(("lila", "blanco"), (0.6, 0.4), referencia_element_id="ref-col"))

    resolved = await _resolve(
        plan,
        completar_patrones=True,
        pistas_patron=[_pista(["rosado", "blanco"], modo="espiral")],
    )

    assert cast(dict[str, object], _patron_del_plan(resolved)["base"])["racimo"] == [0, 1, 0, 1]
    assert _patron_del_plan(resolved)["origen"] == "referencia"
    assert _por_color(resolved) == {"lila": 20, "blanco": 20}


@pytest.mark.anyio
async def test_una_pista_dudosa_o_de_otro_elemento_cae_al_preset() -> None:
    plan = _plan(_columna(referencia_element_id="ref-col"))
    dudosa = [_pista(["azul", "blanco", "negro"], confianza=0.3)]
    ajena = [{**_pista(["azul", "blanco", "negro"]), "referencia_element_id": "otra"}]

    for pistas in (dudosa, ajena):
        resolved = await _resolve(plan, completar_patrones=True, pistas_patron=pistas)
        assert _patron_del_plan(resolved)["origen"] == "sugerido"


@pytest.mark.anyio
async def test_completar_no_toca_un_patron_ya_declarado() -> None:
    anillos = {
        "version": "patron-color.v1",
        "origen": "decorador",
        "base": {"modo": "anillos", "secuencia": [0, 1, 2], "largo": 2},
    }

    resolved = await _resolve(_plan(_columna(patron_color=anillos)), completar_patrones=True)

    assert _patron_del_plan(resolved) == anillos


# --- Errores ---------------------------------------------------------------------


SIN_AZUL = {
    "version": "patron-color.v1",
    "origen": "decorador",
    "base": {"modo": "espiral", "racimo": [0, 1, 0, 1], "trazo": "espiral"},
}


@pytest.mark.anyio
async def test_patron_invalido_es_un_error_de_dominio_con_detalles() -> None:
    with pytest.raises(PlanResolutionError) as raised:
        await _resolve(_plan(_columna(patron_color=SIN_AZUL)))

    assert (raised.value.code, raised.value.status_code) == ("patron_invalido", 422)
    details = cast(dict[str, object], raised.value.details)
    assert (details["estructura_id"], details["motivo"]) == ("EST_01_COLUMNA", "material_sin_uso")
    assert "azul (3)" in str(details["mensaje"])


# --- Lo que se compra nombra el patrón (§9: reemplazar) -----------------------------


def _row_tamano(color: str, pulgadas: int) -> dict[str, object]:
    return {
        **_row(color),
        "variant_id": f"var-{color}-{pulgadas}",
        "sku": f"{color.upper()}-{pulgadas}",
        "sku_original": f"{color.upper()}-{pulgadas}",
        "source_variant_id": f"source-{color}-{pulgadas}",
        "variante_titulo": f"R-{pulgadas}",
        "codigo_tamano": f"R-{pulgadas}",
        "diam_pulg": pulgadas,
    }


async def _resolver_catalogo(
    plan: Mapping[str, object], filas: Sequence[dict[str, object]]
) -> dict[str, object]:
    """Resuelve contra ``filas`` con todas sus variantes admitidas."""
    variantes: dict[str, list[str]] = {}
    for fila in filas:
        variantes.setdefault(str(fila["product_id"]), []).append(str(fila["variant_id"]))
    request = _request(
        plan,
        allowlist=[
            {"product_id": producto, "variant_ids": ids} for producto, ids in variantes.items()
        ],
    )
    result = await resolve_plan(request, FakePlanStore(filas))
    return cast(dict[str, object], result["plan_resuelto"])


def _conteo_por_color(resolved: Mapping[str, object]) -> dict[str, int]:
    patron = cast(list[dict[str, object]], resolved["patrones_color"])[0]
    return {
        str(fila["color"]): cast(int, fila["unidades_total"])
        for fila in cast(list[dict[str, object]], patron["conteo"])
    }


@pytest.mark.anyio
async def test_reemplazar_un_color_con_patron_nombra_el_patron_con_lo_que_se_compra() -> None:
    # Columna en espiral blanco-negro-blanco-azul (10 cuartetos: 20/10/10). El
    # decorador cambia el azul por rojo desde la tarjeta: la edición lo deja en
    # variant_overrides y la compra lleva rojo. El conteo, la descripción y las
    # frases del prompt tienen que decir rojo, no el azul que se quitó.
    filas = [_row(color) for color in ("blanco", "negro", "azul", "rojo")]
    base = await _resolver_catalogo(_plan(_columna(patron_color=ESPIRAL)), filas)
    estructura = cast(list[dict[str, object]], base["estructuras"])[0]
    editado = editar_plan(
        cast(dict[str, object], base["plan"]),
        EdicionMaterial(
            accion="reemplazar",
            estructura_id="EST_01_COLUMNA",
            objetivo_variant_id="var-azul-12",
            variante=VarianteEdicion(product_id="prod-rojo", variant_id="var-rojo-12", color="rojo"),
        ),
        [
            LineasBaseEstructura(
                estructura_id="EST_01_COLUMNA",
                lineas=[
                    LineaBase(
                        product_id=str(linea["product_id"]),
                        variant_id=str(linea["variant_id"]),
                        color=cast(str, linea["color"]),
                    )
                    for linea in cast(list[dict[str, object]], estructura["lineas"])
                ],
            )
        ],
        ["rojo"],
    )

    resuelto = await _resolver_catalogo(editado.plan, filas)

    assert _por_color(resuelto) == {"blanco": 20, "negro": 10, "rojo": 10}
    assert _conteo_por_color(resuelto) == _por_color(resuelto)
    patron = cast(list[dict[str, object]], resuelto["patrones_color"])[0]
    assert "(white, black, white, red around each cluster)" in str(patron["prompt_gemini"])
    assert patron["prompt_lora"] == "wrapped in a spiral of white, black and red stripes winding from base to top"
    assert "rojo (3)" in str(patron["descripcion"])
    textos = " ".join([str(patron["descripcion"]), *cast(list[str], patron["instrucciones"])])
    assert "azul" not in textos and "blue" not in str(patron["prompt_gemini"])
    assert not any("se cambió por" in aviso for aviso in cast(list[str], patron["avisos"]))
    # La receta declarada no cambia: la compra la decide el reemplazo.
    assert [m["color"] for m in _materiales(resuelto)] == ["blanco", "negro", "azul"]


@pytest.mark.anyio
@pytest.mark.parametrize("caso", ["un_tamano", "todos_a_rojo", "cada_tamano_a_otro_color"])
async def test_reemplazar_parte_de_un_color_con_patron_lo_avisa(caso: str) -> None:
    # Con varios tamaños cada color se compra en varias líneas. Si solo una pasa
    # a rojo, el número 3 de la gráfica sería dos colores: sigue llamándose azul
    # y el patrón lo avisa. Si todas pasan a rojo, el 3 es rojo. Si todas se
    # cambian pero no a un mismo color, tampoco hay un nombre para el 3.
    tamanos = (5, 9, 12, 18, 24)
    filas = [
        _row_tamano(color, pulgadas)
        for color in ("blanco", "negro", "azul", "rojo", "verde")
        for pulgadas in tamanos
    ]
    columna = _columna(mezcla="organica_fina", patron_color=ESPIRAL)
    base = await _resolver_catalogo(_plan(columna), filas)
    lineas_base = cast(list[dict[str, object]], cast(list[dict[str, object]], base["estructuras"])[0]["lineas"])
    azules = [str(linea["variant_id"]) for linea in lineas_base if linea["color"] == "azul"]
    assert len(azules) > 1 and "var-azul-12" in azules
    destinos = {
        "un_tamano": {"var-azul-12": "rojo"},
        "todos_a_rojo": {objetivo: "rojo" for objetivo in azules},
        "cada_tamano_a_otro_color": {
            objetivo: "rojo" if objetivo == "var-azul-12" else "verde" for objetivo in azules
        },
    }[caso]
    plan = cast(dict[str, object], base["plan"])
    estructura = cast(list[dict[str, object]], plan["estructuras"])[0]
    estructura["variant_overrides"] = [
        {
            "objetivo_variant_id": objetivo,
            "product_id": f"prod-{color}",
            "variant_id": objetivo.replace("azul", color),
            "color": color,
        }
        for objetivo, color in destinos.items()
    ]

    resuelto = await _resolver_catalogo(plan, filas)

    compradas = _por_color(resuelto)
    patron = cast(list[dict[str, object]], resuelto["patrones_color"])[0]
    colores_conteo = [fila["color"] for fila in cast(list[dict[str, object]], patron["conteo"])]
    avisos = cast(list[str], patron["avisos"])
    if caso == "todos_a_rojo":
        assert "azul" not in compradas
        assert colores_conteo == ["blanco", "negro", "rojo"]
        assert _conteo_por_color(resuelto) == compradas
        assert not any("se cambió por" in aviso for aviso in avisos)
    elif caso == "un_tamano":
        assert {"azul", "rojo"} <= set(compradas)
        assert colores_conteo == ["blanco", "negro", "azul"]
        assert (
            "Solo una parte del color azul (3) se cambió por rojo: la gráfica, el conteo y los"
            " textos lo siguen nombrando como antes. Cambia también sus otros tamaños para que"
            " todo ese color sea rojo."
        ) in avisos
    else:
        assert "azul" not in compradas and {"rojo", "verde"} <= set(compradas)
        assert colores_conteo == ["blanco", "negro", "azul"]
        cambio = next(aviso for aviso in avisos if "se cambió por" in aviso)
        assert cambio.startswith("El color azul (3) se cambió por ")
        assert "rojo" in cambio and "verde" in cambio and "según el tamaño" in cambio


# --- La vista previa nombra lo que se compra, como la resolución (§8, §10) -----------

_CONTEXTO_VISTA = {
    "schema_version": "operational.v1",
    "request_id": "00000000-0000-4000-8000-000000000c00",
    "correlation_id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
    "deadline_at": "2030-01-01T00:00:00Z",
    "deadline_ms": 5000,
    "body_sha256": "a" * 64,
    "scopes": ["plan.patron"],
}
_CAMPOS_LINEA = ("product_id", "variant_id", "color", "acabado", "unidades", "diam_pulg")


def _lineas_del_navegador(resolved: Mapping[str, object]) -> list[dict[str, object]]:
    """Las líneas de la pieza como las tiene el navegador, en la forma de plan-patron.v1."""
    estructura = cast(list[dict[str, object]], resolved["estructuras"])[0]
    return [
        {campo: linea.get(campo) for campo in _CAMPOS_LINEA}
        for linea in cast(list[dict[str, object]], estructura["lineas"])
    ]


def _vista_previa(
    resolved: Mapping[str, object],
    lineas: Sequence[Mapping[str, object]] | None,
    **peticion: object,
) -> dict[str, object]:
    """Vista previa de la pieza del plan resuelto (por defecto, con su propio patrón)."""
    plan = cast(dict[str, object], resolved["plan"])
    estructura = cast(list[dict[str, object]], plan["estructuras"])[0]
    cuerpo: dict[str, object] = {
        "context": _CONTEXTO_VISTA,
        "schema_version": "plan-patron.v1",
        "plan": plan,
        "estructura_id": estructura["estructura_id"],
        "patron_color": estructura.get("patron_color"),
        **peticion,
    }
    if lineas is not None:
        cuerpo["lineas"] = [dict(linea) for linea in lineas]
    resultado = vista_previa_patron(PlanPatronRequest.model_validate(cuerpo))
    return cast(dict[str, object], resultado["patron"])


async def _reemplazada(
    plan: Mapping[str, object],
    filas: Sequence[dict[str, object]],
    objetivo: str,
    color: str,
) -> dict[str, object]:
    """El plan resuelto tras reemplazar ``objetivo`` por la variante de 12" de ``color``."""
    base = await _resolver_catalogo(plan, filas)
    estructura = cast(list[dict[str, object]], base["estructuras"])[0]
    editado = editar_plan(
        cast(dict[str, object], base["plan"]),
        EdicionMaterial(
            accion="reemplazar",
            estructura_id=str(estructura["estructura_id"]),
            objetivo_variant_id=objetivo,
            variante=VarianteEdicion(
                product_id=f"prod-{color}", variant_id=f"var-{color}-12", color=color
            ),
        ),
        [
            LineasBaseEstructura(
                estructura_id=str(estructura["estructura_id"]),
                lineas=[
                    LineaBase(
                        product_id=str(linea["product_id"]),
                        variant_id=str(linea["variant_id"]),
                        color=cast(str, linea["color"]),
                    )
                    for linea in cast(list[dict[str, object]], estructura["lineas"])
                ],
            )
        ],
        [color],
    )
    return await _resolver_catalogo(editado.plan, filas)


def _colores_conteo(patron: Mapping[str, object]) -> list[object]:
    return [fila["color"] for fila in cast(list[dict[str, object]], patron["conteo"])]


@pytest.mark.anyio
async def test_la_vista_previa_nombra_el_reemplazo_como_la_resolucion() -> None:
    # La tarjeta dice rojo (la resolución nombra lo que se compra); el editor,
    # con las líneas que tiene el navegador, tiene que decir lo mismo: el
    # patrón resuelto entero (conteo, textos, prompts y avisos) es idéntico.
    filas = [_row(color) for color in ("blanco", "negro", "azul", "rojo")]
    resuelto = await _reemplazada(
        _plan(_columna(patron_color=ESPIRAL)), filas, "var-azul-12", "rojo"
    )
    esperado = cast(list[dict[str, object]], resuelto["patrones_color"])[0]
    assert _colores_conteo(esperado) == ["blanco", "negro", "rojo"]

    assert _vista_previa(resuelto, _lineas_del_navegador(resuelto)) == esperado
    # Sin las líneas la vista previa no sabe qué se compra: nombra lo declarado.
    assert _colores_conteo(_vista_previa(resuelto, None)) == ["blanco", "negro", "azul"]


@pytest.mark.anyio
@pytest.mark.parametrize("caso", ["un_tamano", "todos_a_rojo", "cada_tamano_a_otro_color"])
async def test_la_vista_previa_de_un_reemplazo_por_tamano_es_la_de_la_resolucion(
    caso: str,
) -> None:
    # Mezcla de varios tamaños: cada color se compra en varias líneas y el
    # reemplazo puede tocar una, todas o todas con colores distintos. La vista
    # previa nombra (o avisa) exactamente como la resolución.
    tamanos = (5, 9, 12, 18, 24)
    filas = [
        _row_tamano(color, pulgadas)
        for color in ("blanco", "negro", "azul", "rojo", "verde")
        for pulgadas in tamanos
    ]
    base = await _resolver_catalogo(_plan(_columna(mezcla="organica_fina", patron_color=ESPIRAL)), filas)
    azules = [
        str(linea["variant_id"])
        for linea in cast(list[dict[str, object]], cast(list[dict[str, object]], base["estructuras"])[0]["lineas"])
        if linea["color"] == "azul"
    ]
    destinos = {
        "un_tamano": {"var-azul-12": "rojo"},
        "todos_a_rojo": {objetivo: "rojo" for objetivo in azules},
        "cada_tamano_a_otro_color": {
            objetivo: "rojo" if objetivo == "var-azul-12" else "verde" for objetivo in azules
        },
    }[caso]
    plan = cast(dict[str, object], base["plan"])
    cast(list[dict[str, object]], plan["estructuras"])[0]["variant_overrides"] = [
        {
            "objetivo_variant_id": objetivo,
            "product_id": f"prod-{color}",
            "variant_id": objetivo.replace("azul", color),
            "color": color,
        }
        for objetivo, color in destinos.items()
    ]
    resuelto = await _resolver_catalogo(plan, filas)
    esperado = cast(list[dict[str, object]], resuelto["patrones_color"])[0]

    assert _vista_previa(resuelto, _lineas_del_navegador(resuelto)) == esperado
    if caso == "todos_a_rojo":
        assert _colores_conteo(esperado) == ["blanco", "negro", "rojo"]
    else:
        assert any("se cambió por" in aviso for aviso in cast(list[str], esperado["avisos"]))


def _row_x12(color: str) -> dict[str, object]:
    """La misma variante de 12" en bolsa de 12, más barata para pocas unidades."""
    return {
        **_row(color),
        "variant_id": f"var-{color}-12-x12",
        "sku": f"{color.upper()}-12-X12",
        "sku_original": f"{color.upper()}-12-X12",
        "source_variant_id": f"source-{color}-12-x12",
        "variante_titulo": "R-12 x12",
        "precio": 3000,
        "unidades_paq": 12,
    }


@pytest.mark.anyio
async def test_la_vista_previa_lee_las_lineas_tras_elegir_las_bolsas_de_todo_el_plan() -> None:
    # Tres columnas iguales: 60 blancos, 30 negros y 30 del color 3. La compra
    # de todo el plan elige bolsas (x50, x12): el blanco sale en dos líneas y
    # el rojo del reemplazo en otra bolsa que la que eligió el decorador. Las
    # líneas siguen diciendo qué compra cada color.
    filas = [
        *(_row(color) for color in ("blanco", "negro", "azul", "rojo")),
        *(_row_x12(color) for color in ("blanco", "negro", "rojo")),
    ]
    resuelto = await _reemplazada(
        _plan(_columna(patron_color=ESPIRAL, repeticiones=3)), filas, "var-azul-12", "rojo"
    )
    lineas = _lineas_del_navegador(resuelto)
    assert len([linea for linea in lineas if linea["color"] == "blanco"]) > 1
    assert [linea["variant_id"] for linea in lineas if linea["color"] == "rojo"] != ["var-rojo-12"]
    esperado = cast(list[dict[str, object]], resuelto["patrones_color"])[0]
    assert _colores_conteo(esperado) == ["blanco", "negro", "rojo"]

    assert _vista_previa(resuelto, lineas) == esperado


@pytest.mark.anyio
async def test_un_reemplazo_por_el_color_de_otro_material_solo_renombra_el_reemplazado() -> None:
    # El azul pasa a blanco: el blanco (1) compra lo mismo que el reemplazo,
    # pero no es un reemplazo y no se renombra.
    filas = [_row(color) for color in ("blanco", "negro", "azul")]
    resuelto = await _reemplazada(
        _plan(_columna(patron_color=ESPIRAL)), filas, "var-azul-12", "blanco"
    )
    esperado = cast(list[dict[str, object]], resuelto["patrones_color"])[0]
    assert _colores_conteo(esperado) == ["blanco", "negro", "blanco"]

    assert _vista_previa(resuelto, _lineas_del_navegador(resuelto)) == esperado


def _azul_familia(fila: dict[str, object]) -> dict[str, object]:
    """El azul solo es azul por su familia: la variante es azul rey y la línea lo dice."""
    if fila["product_id"] != "prod-azul":
        return fila
    return {**fila, "colores_producto": ["azul"], "colores_variante": ["azul rey"]}


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("mezcla", "color_override"),
    [("clasica", "azul rey"), ("organica_fina", "azul rey"), ("organica_fina", None)],
    ids=["un_tamano", "varios_tamanos", "varios_tamanos_sin_color"],
)
async def test_un_reemplazo_por_el_producto_de_un_color_reetiquetado_no_lo_renombra(
    mezcla: str, color_override: str | None
) -> None:
    # El azul (3) se compra como "azul rey" (_line_color reetiqueta el color de
    # familia) y el negro de 12" pasa a ese mismo globo. La resolución solo
    # renombra al negro; las líneas del azul no dicen si son su compra propia
    # reetiquetada o un reemplazo por su mismo producto, así que la vista
    # previa lo nombra como lo declara, sin avisos, igual que la resolución.
    tamanos = (5, 9, 12, 18, 24) if mezcla == "organica_fina" else (12,)
    filas = [
        _azul_familia(_row_tamano(color, pulgadas))
        for color in ("blanco", "negro", "azul")
        for pulgadas in tamanos
    ]
    base = await _resolver_catalogo(_plan(_columna(mezcla=mezcla, patron_color=ESPIRAL)), filas)
    plan = cast(dict[str, object], base["plan"])
    cast(list[dict[str, object]], plan["estructuras"])[0]["variant_overrides"] = [
        {
            "objetivo_variant_id": "var-negro-12",
            "product_id": "prod-azul",
            "variant_id": "var-azul-12",
            **({"color": color_override} if color_override else {}),
        }
    ]
    resuelto = await _resolver_catalogo(plan, filas)
    lineas = _lineas_del_navegador(resuelto)
    assert {linea["color"] for linea in lineas if linea["product_id"] == "prod-azul"} == {"azul rey"}
    esperado = cast(list[dict[str, object]], resuelto["patrones_color"])[0]
    assert _colores_conteo(esperado)[2] == "azul"
    assert not any("azul (3)" in aviso for aviso in cast(list[str], esperado["avisos"]))

    assert _vista_previa(resuelto, lineas) == esperado


_CONFETI = {
    "version": "patron-color.v1",
    "origen": "sugerido",
    "base": {
        "modo": "aleatorio",
        "pesos": [{"material": 0, "peso": 40}, {"material": 1, "peso": 30}, {"material": 2, "peso": 30}],
        "semilla": 7,
    },
}


@pytest.mark.anyio
@pytest.mark.parametrize(
    "peticion",
    [
        {"patron_color": None, "participaciones": [0.5, 0.25, 0.25]},
        {"patron_color": None},
        {"patron_color": None, "modo": "anillos"},
    ],
    ids=["deslizador", "sugerencia", "estilo"],
)
async def test_el_deslizador_la_sugerencia_y_un_estilo_nombran_lo_que_se_compra(
    peticion: dict[str, object],
) -> None:
    filas = [_row(color) for color in ("blanco", "negro", "azul", "rojo")]
    resuelto = await _reemplazada(
        _plan(_columna(patron_color=_CONFETI)), filas, "var-azul-12", "rojo"
    )

    patron = _vista_previa(resuelto, _lineas_del_navegador(resuelto), **peticion)

    assert _colores_conteo(patron) == ["blanco", "negro", "rojo"]
    textos = " ".join([str(patron["descripcion"]), *cast(list[str], patron["instrucciones"])])
    assert "azul" not in textos and "blue" not in str(patron["prompt_gemini"])


@pytest.mark.anyio
@pytest.mark.parametrize("cambio", ["una_linea_menos", "una_linea_de_mas", "otras_unidades"])
async def test_lineas_que_no_son_las_del_plan_no_nombran(cambio: str) -> None:
    # Las líneas solo nombran: si no corresponden a lo que el plan compra (otra
    # resolución, una demanda sin cobertura), la vista previa nombra lo
    # declarado, como sin líneas, en vez de adivinar.
    filas = [_row(color) for color in ("blanco", "negro", "azul", "rojo")]
    resuelto = await _reemplazada(
        _plan(_columna(patron_color=ESPIRAL)), filas, "var-azul-12", "rojo"
    )
    lineas = _lineas_del_navegador(resuelto)
    if cambio == "una_linea_menos":
        lineas = lineas[1:]
    elif cambio == "una_linea_de_mas":
        lineas = [*lineas, dict(lineas[-1])]
    else:
        lineas[0] = {**lineas[0], "unidades": cast(int, lineas[0]["unidades"]) - 1}

    assert _vista_previa(resuelto, lineas) == _vista_previa(resuelto, None)


@pytest.mark.anyio
async def test_las_lineas_nunca_cuentan() -> None:
    # Las unidades de las líneas solo sirven para leerlas: el conteo sale de la
    # rejilla del borrador. Unos anillos sobre la misma pieza cuentan 16/12/12.
    filas = [_row(color) for color in ("blanco", "negro", "azul", "rojo")]
    resuelto = await _reemplazada(
        _plan(_columna(patron_color=ESPIRAL)), filas, "var-azul-12", "rojo"
    )
    anillos = {
        "version": "patron-color.v1",
        "origen": "decorador",
        "base": {"modo": "anillos", "secuencia": [0, 1, 2], "largo": 1},
    }

    patron = _vista_previa(resuelto, _lineas_del_navegador(resuelto), patron_color=anillos)

    conteo = cast(list[dict[str, object]], patron["conteo"])
    assert [(fila["color"], fila["unidades_por_instancia"]) for fila in conteo] == [
        ("blanco", 16), ("negro", 12), ("rojo", 12),
    ]


@pytest.mark.anyio
async def test_la_resolucion_calcula_fuera_del_event_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    # Completar el plan (expandir sus patrones) y resolverlo es CPU puro: con
    # ocho paredes grandes pasaba de un segundo con el event loop parado. Solo
    # las idas al catálogo quedan en el loop.
    import threading

    import app.plan as plan

    hilos: dict[str, str] = {}
    completar, construir = plan._complete_plan, plan._build_resolved

    def espia_completar(*args: Any, **kwargs: Any) -> dict[str, object]:
        hilos["completar"] = threading.current_thread().name
        return completar(*args, **kwargs)

    def espia_construir(*args: Any, **kwargs: Any) -> dict[str, object]:
        hilos["resolver"] = threading.current_thread().name
        return construir(*args, **kwargs)

    monkeypatch.setattr(plan, "_complete_plan", espia_completar)
    monkeypatch.setattr(plan, "_build_resolved", espia_construir)

    resolved = await _resolve(_plan(_columna(patron_color=ESPIRAL)))

    assert _por_color(resolved) == {"blanco": 20, "negro": 10, "azul": 10}
    assert set(hilos) == {"completar", "resolver"}
    assert all(nombre.startswith("plan-cpu") for nombre in hilos.values())
    assert threading.current_thread().name not in hilos.values()


def _signed(request: PlanResolutionRequest, nonce: UUID) -> tuple[bytes, dict[str, str]]:
    operation = request.model_dump(mode="json", exclude={"context"}, exclude_none=True)
    operation_hash = hashlib.sha256(
        json.dumps(operation, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()
    context = {**request.context.model_dump(mode="json", exclude_none=True), "body_sha256": operation_hash}
    body = json.dumps({"context": context, **operation}, separators=(",", ":"), ensure_ascii=False).encode()
    timestamp = int(time.time())
    return body, {
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


def _resolver_por_http(nonce: str) -> tuple[int, dict[str, object]]:
    request = _request(_plan(_columna(patron_color=SIN_AZUL)))
    body, headers = _signed(request, UUID(nonce))
    app = create_app(
        Settings(environment="test", hmac_secret=SECRET),
        operational_store=InMemoryOperationalStore(),
        catalog_store=FakePlanStore([_row(c) for c in ("azul", "blanco", "negro")]),
    )
    with TestClient(app) as client:
        response = client.post("/internal/v1/plan/resolve", content=body, headers=headers)
    return response.status_code, cast(dict[str, object], response.json()["detail"])


def test_el_endpoint_responde_patron_invalido() -> None:
    status, detail = _resolver_por_http("00000000-0000-4000-8000-000000000291")

    assert (status, detail["code"]) == (422, "patron_invalido")


def test_el_endpoint_devuelve_el_motivo_y_el_mensaje_del_patron() -> None:
    status, detail = _resolver_por_http("00000000-0000-4000-8000-000000000292")

    assert status == 422
    assert (detail["estructura_id"], detail["motivo"]) == ("EST_01_COLUMNA", "material_sin_uso")
    assert "azul (3)" in str(detail["mensaje"])


@pytest.mark.parametrize(
    "pistas",
    [
        [_pista(["azul"])] * 17,  # más de 16
        [{**_pista(["azul"]), "extra": 1}],  # campo desconocido
        [_pista(["azul"], confianza=1.5)],
        [_pista(["  "])],  # color en blanco
        [{**_pista(["azul"]), "confianza": "0.9"}],  # estricto: sin coerción
        [{**_pista(["azul"]), "modo": "ninguno"}],  # "ninguno" no viaja al plan
    ],
)
def test_las_pistas_se_validan_en_la_frontera(pistas: list[dict[str, object]]) -> None:
    with pytest.raises(ValidationError):
        _request(_plan(_columna()), completar_patrones=True, pistas_patron=pistas)


# --- Funciones para edición y vista previa ------------------------------------------


def test_vista_previa_sugiere_sin_tocar_el_plan() -> None:
    plan = _plan(_columna(patron_color=SIN_AZUL))  # el patrón actual se ignora al sugerir

    sugerido = patron_resuelto_de_estructura(plan, "EST_01_COLUMNA", None)

    assert sugerido["aplicado"] is False
    assert cast(dict[str, object], sugerido["patron"])["origen"] == "sugerido"
    assert [c["unidades_por_instancia"] for c in cast(list[dict[str, object]], sugerido["conteo"])] == [
        20, 10, 10,
    ]


def test_vista_previa_de_un_patron_dado_da_el_conteo_de_la_resolucion() -> None:
    anillos = {
        "version": "patron-color.v1",
        "origen": "decorador",
        "base": {"modo": "anillos", "secuencia": [0, 1, 2], "largo": 1},
    }

    resuelto = patron_resuelto_de_estructura(_plan(_columna()), "EST_01_COLUMNA", anillos)

    # 10 filas 0, 1, 2, 0...: 4, 3 y 3 cuartetos.
    assert resuelto["aplicado"] is True
    assert [c["unidades_por_instancia"] for c in cast(list[dict[str, object]], resuelto["conteo"])] == [
        16, 12, 12,
    ]


@pytest.mark.parametrize(
    ("estructura_id", "patron", "code", "status"),
    [
        ("EST_09_OTRA", None, "estructura_no_encontrada", 404),
        ("EST_01_COLUMNA", SIN_AZUL, "patron_invalido", 422),
        (
            "EST_01_COLUMNA",
            {"version": "patron-color.v1", "origen": "decorador", "base": {"modo": "espiral", "racimo": [], "trazo": "espiral"}},
            "invalid_plan",
            422,
        ),
    ],
)
def test_vista_previa_errores(
    estructura_id: str, patron: dict[str, object] | None, code: str, status: int
) -> None:
    with pytest.raises(PlanResolutionError) as raised:
        patron_resuelto_de_estructura(_plan(_columna()), estructura_id, patron)

    assert (raised.value.code, raised.value.status_code) == (code, status)


def test_vista_previa_de_una_pieza_sin_patron_explica_el_motivo() -> None:
    kit = {**_columna(), "estructura_id": "EST_02_KIT", "tipo": "kit", "medidas": {}}

    with pytest.raises(PlanResolutionError) as raised:
        patron_resuelto_de_estructura(_plan(_columna(), kit), "EST_02_KIT", None)

    assert cast(dict[str, object], raised.value.details)["motivo"] == "tipo_sin_patron"


def test_sincronizar_solo_reescribe_participacion() -> None:
    sin_medidas = {**_columna(patron_color=ESPIRAL), "medidas": {}}
    otra = {**_columna(), "estructura_id": "EST_02_COLUMNA"}
    plan = _plan(sin_medidas, otra)

    synced = sincronizar_participaciones(plan)

    estructuras = cast(list[dict[str, object]], synced["estructuras"])
    # Sin alto la columna toma 1.8 m por defecto (interior): 40 globos, 20/10/10.
    assert [m["participacion"] for m in cast(list[dict[str, object]], estructuras[0]["materiales"])] == [
        0.5, 0.25, 0.25,
    ]
    assert estructuras[0]["medidas"] == {}
    assert estructuras[1] == otra
    assert synced["supuestos"] == []


def test_sugerir_para_una_estructura() -> None:
    kit = {**_columna(), "estructura_id": "EST_02_KIT", "tipo": "kit", "medidas": {}}
    plan = _plan(_columna(), kit)

    assert sugerir_patron_para_estructura(plan, "EST_01_COLUMNA") == {
        "version": "patron-color.v1",
        "origen": "sugerido",
        "base": {"modo": "espiral", "racimo": [0, 1, 0, 2], "trazo": "espiral"},
    }
    assert sugerir_patron_para_estructura(plan, "EST_02_KIT") is None
    with pytest.raises(PlanResolutionError) as raised:
        sugerir_patron_para_estructura(plan, "EST_09_OTRA")
    assert raised.value.code == "estructura_no_encontrada"
