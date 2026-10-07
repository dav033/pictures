"""Cotización profesional a granel: el decorador cotiza los globos sueltos del plan.

Exactamente las unidades del plan (no paquetes cerrados), a un precio por
globo que parte del paquete ÷ sus unidades (estimado) o del precio de la
unidad cuando el paquete es de una, editable, con globos extra para vender y
el sobrante que dejarían los paquetes. Y la compatibilidad: sin granel ni la
cabecera, el resultado es idéntico al de antes.
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

from app.cotizacion_profesional import (
    CABECERA_MODOS_MATERIALES,
    CotizacionProfesionalRequest,
    cotizar_profesional,
)
from app.main import Settings, build_signature, create_app
from app.operational_store import InMemoryOperationalStore

SECRET = "c" * 32
CONTEXTO = {
    "schema_version": "operational.v1",
    "request_id": "00000000-0000-4000-8000-000000000d00",
    "correlation_id": "ffffffff-ffff-4fff-8fff-fffffffffff1",
    "deadline_at": "2030-01-01T00:00:00Z",
    "deadline_ms": 5000,
    "scopes": ["plan.cotizacion_profesional"],
    "body_sha256": "0" * 64,
}

# Precios reales del catálogo Sempertex: R-12 Fashion x 50 a 23.478, C-12 x 12 a 6.553 y un metalizado x 1 a 955.
ROSADO_12 = {
    "variant_id": "rosado-12",
    "descripcion": "Globo Latex Redondo Fashion Rosado R-12 X 50",
    "paquetes": 1,
    "precio_paquete_catalogo_cop": 23_478,
}
CORAZON_12 = {
    "variant_id": "corazon-12",
    "descripcion": "Globo Latex Corazon Fashion Blanco C-12 X 12",
    "paquetes": 2,
    "precio_paquete_catalogo_cop": 6_553,
}
METALIZADO = {
    "variant_id": "metalizado-3",
    "descripcion": "Globo Metalizado 3 Rosado 16IN X 1",
    "paquetes": 2,
    "precio_paquete_catalogo_cop": 955,
}


def _granel(unidades_plan: int, unidades_paquete: int, **extra: object) -> dict[str, object]:
    return {"unidades_plan": unidades_plan, "unidades_paquete": unidades_paquete, **extra}


def _operacion(**cambios: object) -> dict[str, object]:
    operacion: dict[str, object] = {
        "schema_version": "cotizacion-profesional.v1",
        "materiales": [
            {**ROSADO_12, "granel": _granel(37, 50)},
            {**CORAZON_12, "granel": _granel(20, 12)},
            {**METALIZADO, "granel": _granel(2, 1)},
        ],
        "mano_de_obra": [{"descripcion": "Montaje", "costo_unitario_cop": 20_000, "cantidad": 1}],
        "equipos_transporte": [],
        "indirectos": [],
        "utilidad_porcentaje": 30,
        "modo_materiales": "granel",
    }
    operacion.update(cambios)
    return operacion


def _cotizar(*, anunciar_modos: bool = False, **cambios: object) -> dict[str, object]:
    pedido = CotizacionProfesionalRequest.model_validate(
        {"context": CONTEXTO, **_operacion(**cambios)}
    )
    return cast(dict[str, object], cotizar_profesional(pedido, anunciar_modos=anunciar_modos))


def _materiales(resultado: Mapping[str, object]) -> dict[str, object]:
    return cast(dict[str, object], resultado["materiales"])


def _granel_de(resultado: Mapping[str, object], indice: int) -> dict[str, object]:
    lineas = cast(list[dict[str, object]], _materiales(resultado)["lineas"])
    return cast(dict[str, object], lineas[indice]["granel"])


def test_cotiza_exactamente_los_globos_del_plan_al_precio_por_globo_del_paquete() -> None:
    resultado = _cotizar()
    rosado = _granel_de(resultado, 0)
    # 23.478 ÷ 50 = 469,56 → 470 por globo; 37 globos sueltos, no el paquete de 50.
    assert rosado == {
        "unidades_plan": 37,
        "unidades_extra": 0,
        "unidades": 37,
        "unidades_paquete": 50,
        "precio_unidad_base_cop": 470,
        "precio_unidad_estimado": True,
        "precio_unidad_cop": 470,
        "precio_unidad_editado": False,
        "subtotal_cop": 17_390,
        # Con el paquete de 50 sobrarían 13.
        "sobrante_paquetes": 13,
    }
    corazon = _granel_de(resultado, 1)
    # 6.553 ÷ 12 = 546,08 → 546; 2 paquetes de 12 dejan 4 de sobra.
    assert (corazon["precio_unidad_cop"], corazon["subtotal_cop"]) == (546, 10_920)
    assert corazon["sobrante_paquetes"] == 4


def test_un_paquete_de_una_unidad_es_el_precio_de_catalogo_de_la_unidad() -> None:
    metalizado = _granel_de(_cotizar(), 2)
    assert metalizado["precio_unidad_estimado"] is False
    assert (metalizado["precio_unidad_cop"], metalizado["subtotal_cop"]) == (955, 1_910)
    assert metalizado["sobrante_paquetes"] == 0


def test_a_granel_el_total_de_materiales_es_el_de_los_globos_sueltos() -> None:
    resultado = _cotizar()
    materiales = _materiales(resultado)
    granel = 17_390 + 10_920 + 1_910
    paquetes = 23_478 + 2 * 6_553 + 2 * 955
    assert materiales["modo"] == "granel"
    assert (materiales["total_cop"], materiales["total_paquetes_cop"]) == (granel, paquetes)
    assert materiales["granel"] == {
        "unidades_plan": 59,
        "unidades_extra": 0,
        "unidades": 59,
        "sobrante_paquetes": 17,
        "total_cop": granel,
    }
    # Los gastos y la ganancia van sobre el total a granel.
    assert resultado["total_costos_cop"] == granel + 20_000
    utilidad = cast(int, resultado["utilidad_cop"])
    assert utilidad == round((granel + 20_000) * 0.3)
    assert resultado["precio_sugerido_cop"] == granel + 20_000 + utilidad


def test_por_paquete_el_total_sigue_siendo_el_de_los_paquetes_y_se_informa_el_de_granel() -> None:
    materiales = _materiales(_cotizar(modo_materiales="paquete"))
    assert materiales["modo"] == "paquete"
    assert materiales["total_cop"] == materiales["total_paquetes_cop"] == 23_478 + 13_106 + 1_910
    assert cast(dict[str, object], materiales["granel"])["total_cop"] == 30_220


def test_el_precio_por_globo_del_decorador_y_los_globos_extra() -> None:
    operacion = _operacion()
    materiales = cast(list[dict[str, object]], operacion["materiales"])
    materiales[0] = {
        **ROSADO_12,
        "granel": _granel(37, 50, precio_unidad_cop=400, unidades_extra=10),
    }
    rosado = _granel_de(_cotizar(materiales=materiales), 0)
    assert (rosado["unidades"], rosado["unidades_extra"]) == (47, 10)
    assert (rosado["precio_unidad_base_cop"], rosado["precio_unidad_cop"]) == (470, 400)
    assert rosado["precio_unidad_editado"] is True
    assert rosado["subtotal_cop"] == 400 * 47
    # El sobrante es el de los globos del plan: los extra se venden aparte.
    assert rosado["sobrante_paquetes"] == 13


def test_el_precio_por_globo_parte_del_precio_por_paquete_del_decorador() -> None:
    operacion = _operacion()
    materiales = cast(list[dict[str, object]], operacion["materiales"])
    materiales[0] = {**materiales[0], "precio_paquete_cop": 20_000}
    rosado = _granel_de(_cotizar(materiales=materiales), 0)
    assert (rosado["precio_unidad_base_cop"], rosado["precio_unidad_cop"]) == (400, 400)
    assert rosado["precio_unidad_editado"] is False


def test_sin_granel_el_resultado_es_el_de_siempre() -> None:
    sin_granel = [
        {key: value for key, value in linea.items() if key != "granel"}
        for linea in cast(list[dict[str, object]], _operacion()["materiales"])
    ]
    operacion = _operacion(materiales=sin_granel)
    del operacion["modo_materiales"]
    pedido = CotizacionProfesionalRequest.model_validate({"context": CONTEXTO, **operacion})
    resultado = cotizar_profesional(pedido)
    assert set(_materiales(resultado)) == {"lineas", "total_cop"}
    assert "modos_materiales" not in resultado
    lineas = cast(list[dict[str, object]], _materiales(resultado)["lineas"])
    assert all("granel" not in linea for linea in lineas)


def test_solo_con_la_cabecera_se_anuncian_los_modos() -> None:
    assert _cotizar(anunciar_modos=True)["modos_materiales"] == ["paquete", "granel"]
    assert "modos_materiales" not in _cotizar()


@pytest.mark.parametrize(
    "cambios",
    [
        # Granel en unos materiales y en otros no.
        {"materiales": [{**ROSADO_12, "granel": _granel(37, 50)}, CORAZON_12]},
        # Modo a granel sin los globos sueltos.
        {"materiales": [ROSADO_12]},
        {"materiales": [{**ROSADO_12, "granel": _granel(0, 50)}]},
        {"materiales": [{**ROSADO_12, "granel": _granel(37, 0)}]},
        {"materiales": [{**ROSADO_12, "granel": _granel(37, 50, unidades_extra=-1)}]},
        {"materiales": [{**ROSADO_12, "granel": _granel(37, 50, precio_unidad_cop=-1)}]},
        {"materiales": [{**ROSADO_12, "granel": _granel(37, 50, precio_unidad_cop=10.5)}]},
        {"materiales": [{**ROSADO_12, "granel": _granel(37, 50, color="rosado")}]},
        {"modo_materiales": "suelto"},
    ],
)
def test_rechaza_granel_invalido(cambios: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        CotizacionProfesionalRequest.model_validate({"context": CONTEXTO, **_operacion(**cambios)})


# --- El endpoint ---------------------------------------------------------------------------


def _post(
    operation: Mapping[str, object], nonce: str, *, cabeceras: Mapping[str, str] | None = None
) -> tuple[int, dict[str, object]]:
    scope = "plan.cotizacion_profesional"
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
    path = "/internal/v1/plan/cotizacion-profesional"
    headers = {
        "content-type": "application/json",
        "x-internal-schema-version": "operational.v1",
        "x-internal-timestamp": str(timestamp),
        "x-internal-nonce": nonce,
        "x-internal-scopes": scope,
        "x-internal-signature": build_signature(
            secret=SECRET,
            method="POST",
            path=path,
            timestamp=timestamp,
            nonce=UUID(nonce),
            scopes=[scope],
            body=body,
        ),
        **(cabeceras or {}),
    }
    app = create_app(
        Settings(environment="test", hmac_secret=SECRET),
        operational_store=InMemoryOperationalStore(),
    )
    with TestClient(app) as client:
        response = client.post(path, content=body, headers=headers)
    return response.status_code, cast(dict[str, object], response.json())


def test_el_endpoint_anuncia_los_modos_con_la_cabecera_y_cotiza_a_granel() -> None:
    status, body = _post(
        _operacion(),
        "00000000-0000-4000-8000-000000000d01",
        cabeceras={CABECERA_MODOS_MATERIALES: "granel"},
    )
    assert status == 200
    payload = cast(dict[str, object], body["payload"])
    assert payload["modos_materiales"] == ["paquete", "granel"]
    assert _materiales(payload)["total_cop"] == 30_220


def test_el_endpoint_sin_cabecera_no_anuncia_nada() -> None:
    status, body = _post(_operacion(), "00000000-0000-4000-8000-000000000d02")
    assert status == 200
    assert "modos_materiales" not in cast(dict[str, object], body["payload"])
