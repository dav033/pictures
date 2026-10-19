"""Vista previa y edición del armado de bouquets (ADR-0030, segunda entrega).

`POST /internal/v1/plan/armado-bouquet` resuelve el armado que manda el editor,
o sugiere la receta con `armado_bouquet: null`, sin catálogo: el navegador dice
qué es cada globo (`globos`) y las cantidades son las del plan. La acción
`armado` de la edición fija o quita el armado, y un bouquet que pierde el suyo
al editar lo recibe de nuevo en la re-resolución, solo de esa pieza.
"""

from __future__ import annotations

import hashlib
import json
import time
from collections.abc import Mapping
from typing import cast
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import Settings, build_signature, create_app
from app.operational_store import InMemoryOperationalStore
from app.plan import PlanResolutionError, PlanResolutionRequest, resolve_plan
from app.plan_edicion import (
    AVISO_ARMADO_QUITADO,
    AVISO_ARMADO_REHACER,
    EdicionArmado,
    EdicionReparto,
    PlanArmadoRequest,
    editar_plan,
    vista_previa_armado,
)
from tests.test_plan_armado import ROWS, SNAPSHOT, FakePlanStore, _bouquet, _plan

SECRET = "w" * 32
BOUQUET = "EST_01_BOUQUET"
CONTEXTO = {
    "schema_version": "operational.v1",
    "request_id": "00000000-0000-4000-8000-000000000c00",
    "correlation_id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
    "deadline_at": "2030-01-01T00:00:00Z",
    "deadline_ms": 5000,
    "scopes": ["plan.armado_bouquet"],
}
# Lo que el navegador tiene de cada globo de la pieza (sus líneas resueltas).
GLOBOS = [
    {
        "product_id": row["product_id"],
        "variant_id": row["variant_id"],
        "titulo": f"{row['producto_titulo']} — {row['variante_titulo']}",
        "forma": row["forma"],
        "diam_pulg": row["diam_pulg"],
        "tamano_codigo": row["codigo_tamano"],
        "color": cast(list[str], row["colores_variante"])[0],
        "acabado": None,
    }
    for row in ROWS
]
APILADO = {
    "version": "armado-bouquet.v1",
    "origen": "decorador",
    "variante": "helio_apilado",
    "niveles": [
        {"rol": "capa", "unidad": "trio", "cantidad": 1, "posiciones": [1, 0, 1]},
        {"rol": "capa", "unidad": "trio", "cantidad": 1, "posiciones": [0, 1, 0]},
    ],
    "remate": [2],
}


def _operacion(
    armado: Mapping[str, object] | None, estructura_id: str = BOUQUET, **extra: object
) -> dict[str, object]:
    return {
        "schema_version": "plan-armado-bouquet.v1",
        "plan": _plan(_bouquet()),
        "estructura_id": estructura_id,
        "armado_bouquet": None if armado is None else dict(armado),
        "globos": GLOBOS,
        **extra,
    }


def _peticion(armado: Mapping[str, object] | None, **extra: object) -> PlanArmadoRequest:
    return PlanArmadoRequest.model_validate(
        {"context": {**CONTEXTO, "body_sha256": "a" * 64}, **_operacion(armado, **extra)}
    )


def test_sin_armado_devuelve_la_receta_y_las_opciones() -> None:
    resultado = vista_previa_armado(_peticion(None))

    armado = cast(dict[str, object], resultado["armado"])
    assert resultado["operation_schema_version"] == "plan-armado-bouquet-result.v1"
    assert armado["estructura_id"] == BOUQUET
    # 3 + 3 látex de 12" y un corazón: helio apilado, con el remate arriba.
    assert cast(dict[str, object], armado["armado"])["variante"] == "helio_apilado"
    assert [e["codigo"] for e in cast(list[dict[str, object]], armado["leyenda"])] == [1, 2, 3]
    assert str(armado["prompt_gemini"]).startswith("BOUQUET ASSEMBLY")
    assert resultado["variantes_admitidas"] == ["base_aire", "helio_apilado", "helio_escalonado"]
    assert resultado["disposiciones_admitidas"] == []


def test_un_armado_dado_se_resuelve_tal_cual() -> None:
    resultado = vista_previa_armado(_peticion(APILADO))

    armado = cast(dict[str, object], resultado["armado"])
    assert armado["armado"] == APILADO
    # El rosado va primero en cada trío: su código es el 1.
    leyenda = cast(list[dict[str, object]], armado["leyenda"])
    assert (leyenda[0]["color"], leyenda[0]["codigo"]) == ("rosado", 1)


def test_el_decorador_elige_el_estilo() -> None:
    resultado = vista_previa_armado(_peticion(None, variante="helio_escalonado"))
    armado = cast(dict[str, object], cast(dict[str, object], resultado["armado"])["armado"])
    assert armado["variante"] == "helio_escalonado"


def test_variante_solo_va_sin_armado() -> None:
    with pytest.raises(ValidationError):
        _peticion(APILADO, variante="base_aire")


def test_un_armado_que_no_coincide_con_la_compra_se_rechaza_con_opciones() -> None:
    malo = {**APILADO, "niveles": APILADO["niveles"][:1]}  # type: ignore[index]

    with pytest.raises(PlanResolutionError) as error:
        vista_previa_armado(_peticion(malo))

    detalles = error.value.details or {}
    assert (error.value.code, detalles["motivo"]) == ("armado_invalido", "unidades_no_coinciden")
    assert detalles["variantes_admitidas"] == ["base_aire", "helio_apilado", "helio_escalonado"]


def test_un_globo_sin_clasificar_no_tiene_armado_posible() -> None:
    sin_forma = [{**globo, "titulo": "Vela", "forma": None} for globo in GLOBOS]
    with pytest.raises(PlanResolutionError) as error:
        vista_previa_armado(_peticion(None, globos=sin_forma))
    assert (error.value.details or {})["motivo"] == "sin_armado_posible"


def test_una_estructura_desconocida_responde_404() -> None:
    with pytest.raises(PlanResolutionError) as error:
        vista_previa_armado(_peticion(None, estructura_id="EST_09_OTRA"))
    assert (error.value.code, error.value.status_code) == ("estructura_no_encontrada", 404)


# --- La acción `armado` de la edición ---------------------------------------------


def test_la_edicion_fija_y_quita_el_armado() -> None:
    fijado = editar_plan(
        _plan(_bouquet()),
        EdicionArmado(accion="armado", estructura_id=BOUQUET, armado_bouquet=APILADO),
    )
    estructura = cast(list[dict[str, object]], fijado.plan["estructuras"])[0]
    assert estructura["armado_bouquet"] == APILADO and fijado.avisos == ()

    quitado = editar_plan(
        fijado.plan, EdicionArmado(accion="armado", estructura_id=BOUQUET, armado_bouquet=None)
    )
    assert "armado_bouquet" not in cast(list[dict[str, object]], quitado.plan["estructuras"])[0]


def test_la_edicion_rechaza_un_armado_que_no_cuenta_la_compra() -> None:
    malo = {**APILADO, "remate": [2, 2]}
    with pytest.raises(PlanResolutionError) as error:
        editar_plan(
            _plan(_bouquet()),
            EdicionArmado(accion="armado", estructura_id=BOUQUET, armado_bouquet=malo),
        )
    assert error.value.code == "armado_invalido"
    assert (error.value.details or {})["motivo"] == "unidades_no_coinciden"


def test_la_forma_del_armado_se_exige_en_la_frontera() -> None:
    with pytest.raises(ValidationError):
        EdicionArmado(accion="armado", estructura_id=BOUQUET, armado_bouquet={"version": "otra"})


def test_el_aviso_dice_si_el_armado_se_vuelve_a_sugerir() -> None:
    plan = _plan(_bouquet(armado_bouquet=APILADO))
    reparto = EdicionReparto(
        accion="repartir", estructura_id=BOUQUET, participaciones=[0.5, 0.25, 0.25]
    )
    assert editar_plan(plan, reparto).avisos == (AVISO_ARMADO_QUITADO,)
    assert editar_plan(plan, reparto, completar_armados=True).avisos == (AVISO_ARMADO_REHACER,)


# --- Re-resolución tras editar: solo la pieza editada -------------------------------


def _request(plan: Mapping[str, object], **extra: object) -> PlanResolutionRequest:
    return PlanResolutionRequest.model_validate(
        {
            "context": {
                "schema_version": "operational.v1",
                "request_id": "00000000-0000-4000-8000-000000000031",
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


@pytest.mark.anyio
async def test_completar_armados_de_limita_la_sugerencia_a_esa_pieza() -> None:
    otro = _bouquet(estructura_id="EST_02_BOUQUET", nombre="Otro bouquet")
    otro.pop("referencia_element_id")
    plan = _plan(_bouquet(), otro)
    result = await resolve_plan(
        _request(plan, completar_armados=True, completar_armados_de=["EST_02_BOUQUET"]),
        FakePlanStore(),  # type: ignore[arg-type]
    )
    estructuras = cast(
        list[dict[str, object]],
        cast(dict[str, object], cast(dict[str, object], result["plan_resuelto"])["plan"])[
            "estructuras"
        ],
    )
    assert "armado_bouquet" not in estructuras[0]
    assert estructuras[1].get("armado_bouquet") is not None


# --- El endpoint -------------------------------------------------------------------


def _post(
    operation: Mapping[str, object], nonce: str, *, scope: str = "plan.armado_bouquet"
) -> tuple[int, dict[str, object]]:
    context = {
        **CONTEXTO,
        "scopes": [scope],
        "body_sha256": hashlib.sha256(
            json.dumps(operation, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest(),
    }
    body = json.dumps(
        {"context": context, **operation}, separators=(",", ":"), ensure_ascii=False
    ).encode()
    timestamp = int(time.time())
    headers = {
        "content-type": "application/json",
        "x-internal-schema-version": "operational.v1",
        "x-internal-timestamp": str(timestamp),
        "x-internal-nonce": nonce,
        "x-internal-scopes": scope,
        "x-internal-signature": build_signature(
            secret=SECRET,
            method="POST",
            path="/internal/v1/plan/armado-bouquet",
            timestamp=timestamp,
            nonce=UUID(nonce),
            scopes=[scope],
            body=body,
        ),
    }
    app = create_app(
        Settings(environment="test", hmac_secret=SECRET),
        operational_store=InMemoryOperationalStore(),
    )
    with TestClient(app) as client:
        response = client.post("/internal/v1/plan/armado-bouquet", content=body, headers=headers)
    return response.status_code, cast(dict[str, object], response.json())


def test_el_endpoint_devuelve_plan_armado_bouquet_result() -> None:
    status, body = _post(_operacion(APILADO), "00000000-0000-4000-8000-000000000c01")

    assert status == 200
    payload = cast(dict[str, object], body["payload"])
    assert payload["operation_schema_version"] == "plan-armado-bouquet-result.v1"
    assert cast(dict[str, object], payload["armado"])["armado"] == APILADO


def test_un_armado_invalido_responde_422_con_motivo_y_opciones() -> None:
    malo = {**APILADO, "remate": [2, 2]}
    status, body = _post(_operacion(malo), "00000000-0000-4000-8000-000000000c02")

    detail = cast(dict[str, object], body["detail"])
    assert (status, detail["code"]) == (422, "armado_invalido")
    assert (detail["estructura_id"], detail["motivo"]) == (BOUQUET, "unidades_no_coinciden")
    assert detail["variantes_admitidas"] == ["base_aire", "helio_apilado", "helio_escalonado"]
    assert detail["disposiciones_admitidas"] == []


def test_el_endpoint_exige_su_scope() -> None:
    status, body = _post(
        _operacion(None), "00000000-0000-4000-8000-000000000c03", scope="plan.patron"
    )
    assert (status, cast(dict[str, object], body["detail"])["code"]) == (403, "insufficient_scope")
