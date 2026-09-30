"""Cotización profesional: los costos del decorador sobre los materiales del plan.

El caso de referencia es la hoja «LLENO» de la plantilla de cotización de
Sempertex (bouquet de flores moradas, cotización 128): 107.750 de materiales,
24.000 de mano de obra, 50.000 de transporte y 25.000 de indirectos dan
206.750 de costos; con 30 % de utilidad, 268.775 al cliente.
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

from app.cotizacion_profesional import CotizacionProfesionalRequest, cotizar_profesional
from app.main import Settings, build_signature, create_app
from app.operational_store import InMemoryOperationalStore

SECRET = "c" * 32
CONTEXTO = {
    "schema_version": "operational.v1",
    "request_id": "00000000-0000-4000-8000-000000000c00",
    "correlation_id": "ffffffff-ffff-4fff-8fff-fffffffffff0",
    "deadline_at": "2030-01-01T00:00:00Z",
    "deadline_ms": 5000,
    "scopes": ["plan.cotizacion_profesional"],
    "body_sha256": "0" * 64,
}

MATERIALES_PLANTILLA = [
    ("R-5 SILK AMATISTA X 50", 16900, 1),
    ("R-9 PASTEL MATE LILA X 50", 14350, 1),
    ("T-260 SILK DORADO X 20", 10250, 1),
    ("R-5 SILK DORADO X 20", 6850, 1),
    ("R-9 SILK AMATISTA X 12", 7000, 1),
    ("T-260 FASHION FUCSIA X 20", 7850, 1),
    ("R-5 FASHION FUCSIA X 12", 3500, 1),
    ("R-5 SILK PERLA CREMA X 12", 6850, 1),
    ("R-9 SILK PERLA CREMA X 12", 10600, 1),
    ("BURBUJA 24 X 1", 6000, 2),
    ('FOIL 18" X 1', 5800, 2),
]


def _operacion(**cambios: object) -> dict[str, object]:
    operacion: dict[str, object] = {
        "schema_version": "cotizacion-profesional.v1",
        "materiales": [
            {
                "variant_id": f"v{indice}",
                "descripcion": descripcion,
                "paquetes": paquetes,
                "precio_paquete_catalogo_cop": precio,
            }
            for indice, (descripcion, precio, paquetes) in enumerate(MATERIALES_PLANTILLA)
        ],
        "mano_de_obra": [
            {
                "descripcion": "Hora de mano de obra propia",
                "costo_unitario_cop": 12000,
                "cantidad": 2,
            }
        ],
        "equipos_transporte": [
            {"descripcion": "Transporte ida", "costo_unitario_cop": 40000, "cantidad": 1},
            {"descripcion": "Transporte regreso", "costo_unitario_cop": 10000, "cantidad": 1},
        ],
        "indirectos": [
            {"descripcion": "Publicidad x mes", "costo_unitario_cop": 5000, "cantidad": 1},
            {"descripcion": "Gastos de oficina", "costo_unitario_cop": 10000, "cantidad": 1},
            {"descripcion": "Personal administrativo", "costo_unitario_cop": 10000, "cantidad": 1},
        ],
        "utilidad_porcentaje": 30,
    }
    operacion.update(cambios)
    return operacion


def _cotizar(**cambios: object) -> dict[str, object]:
    pedido = CotizacionProfesionalRequest.model_validate(
        {"context": CONTEXTO, **_operacion(**cambios)}
    )
    return cotizar_profesional(pedido)


def _total(resultado: Mapping[str, object], seccion: str) -> int:
    return cast(int, cast(dict[str, object], resultado[seccion])["total_cop"])


def test_la_hoja_llena_de_la_plantilla_da_su_total() -> None:
    resultado = _cotizar()
    assert _total(resultado, "materiales") == 107_750
    assert _total(resultado, "mano_de_obra") == 24_000
    assert _total(resultado, "equipos_transporte") == 50_000
    assert _total(resultado, "indirectos") == 25_000
    assert resultado["total_costos_cop"] == 206_750
    assert resultado["utilidad_cop"] == 62_025
    assert resultado["precio_sugerido_cop"] == 268_775
    # La utilidad es un recargo sobre el costo; el margen real sobre el precio es menor.
    assert resultado["margen_porcentaje"] == 23.08


def test_sin_costos_ni_utilidad_el_precio_es_el_de_los_materiales() -> None:
    resultado = _cotizar(
        mano_de_obra=[], equipos_transporte=[], indirectos=[], utilidad_porcentaje=None
    )
    assert resultado["total_costos_cop"] == 107_750
    assert (resultado["utilidad_porcentaje"], resultado["utilidad_cop"]) == (None, 0)
    assert resultado["precio_sugerido_cop"] == 107_750
    assert resultado["margen_porcentaje"] == 0.0


def test_el_precio_por_bolsa_del_decorador_reemplaza_el_del_catalogo() -> None:
    operacion = _operacion()
    materiales = cast(list[dict[str, object]], operacion["materiales"])
    materiales[9] = {**materiales[9], "precio_paquete_cop": 5000}
    resultado = _cotizar(materiales=materiales)
    linea = cast(
        list[dict[str, object]], cast(dict[str, object], resultado["materiales"])["lineas"]
    )[9]
    assert linea["precio_paquete_catalogo_cop"] == 6000
    assert (linea["precio_paquete_cop"], linea["precio_editado"], linea["subtotal_cop"]) == (
        5000,
        True,
        10_000,
    )
    assert _total(resultado, "materiales") == 107_750 - 2_000
    sin_cambio = cast(
        list[dict[str, object]], cast(dict[str, object], resultado["materiales"])["lineas"]
    )[0]
    assert sin_cambio["precio_editado"] is False


def test_un_precio_igual_al_del_catalogo_no_cuenta_como_editado() -> None:
    operacion = _operacion()
    materiales = cast(list[dict[str, object]], operacion["materiales"])
    materiales[0] = {**materiales[0], "precio_paquete_cop": 16900}
    linea = cast(
        list[dict[str, object]],
        cast(dict[str, object], _cotizar(materiales=materiales)["materiales"])["lineas"],
    )[0]
    assert linea["precio_editado"] is False


def test_cantidades_con_decimales_se_redondean_a_pesos_por_linea() -> None:
    resultado = _cotizar(
        mano_de_obra=[
            # 12.345 × 1,5 = 18.517,5 → 18.518; 333 × 0,5 = 166,5 → 167.
            {"descripcion": "Horas", "costo_unitario_cop": 12345, "cantidad": 1.5},
            {"descripcion": "Ayudante", "costo_unitario_cop": 333, "cantidad": 0.5},
        ],
        equipos_transporte=[],
        indirectos=[],
        utilidad_porcentaje=12.5,
    )
    assert _total(resultado, "mano_de_obra") == 18_518 + 167
    costos = 107_750 + 18_685
    assert resultado["total_costos_cop"] == costos
    # 126.435 × 12,5 % = 15.804,375 → 15.804.
    assert resultado["utilidad_cop"] == 15_804
    assert resultado["precio_sugerido_cop"] == costos + 15_804


@pytest.mark.parametrize(
    "cambios",
    [
        {"materiales": []},
        {"utilidad_porcentaje": -1},
        {"utilidad_porcentaje": 1000.01},
        {"utilidad_porcentaje": 10.001},
        {"mano_de_obra": [{"descripcion": "Horas", "costo_unitario_cop": 1000, "cantidad": 0}]},
        {"mano_de_obra": [{"descripcion": "Horas", "costo_unitario_cop": 1000, "cantidad": 1.234}]},
        {"mano_de_obra": [{"descripcion": "Horas", "costo_unitario_cop": -5, "cantidad": 1}]},
        {"mano_de_obra": [{"descripcion": "Horas", "costo_unitario_cop": 10.5, "cantidad": 1}]},
        {"mano_de_obra": [{"descripcion": "", "costo_unitario_cop": 1000, "cantidad": 1}]},
        {
            "indirectos": [
                {"descripcion": "Oficina", "costo_unitario_cop": 1000, "cantidad": 1, "extra": 1}
            ]
        },
        {"alquileres": []},
    ],
)
def test_rechaza_entradas_invalidas(cambios: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        CotizacionProfesionalRequest.model_validate({"context": CONTEXTO, **_operacion(**cambios)})


def test_rechaza_una_variante_repetida() -> None:
    operacion = _operacion()
    materiales = cast(list[dict[str, object]], operacion["materiales"])
    with pytest.raises(ValidationError):
        CotizacionProfesionalRequest.model_validate(
            {"context": CONTEXTO, **_operacion(materiales=[materiales[0], materiales[0]])}
        )


# --- El endpoint ---------------------------------------------------------------------------


def _post(
    operation: Mapping[str, object], nonce: str, *, scope: str = "plan.cotizacion_profesional"
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
    }
    app = create_app(
        Settings(environment="test", hmac_secret=SECRET),
        operational_store=InMemoryOperationalStore(),
    )
    with TestClient(app) as client:
        response = client.post(path, content=body, headers=headers)
    return response.status_code, cast(dict[str, object], response.json())


def test_el_endpoint_devuelve_cotizacion_profesional_result() -> None:
    status, body = _post(_operacion(), "00000000-0000-4000-8000-000000000c01")
    assert status == 200
    payload = cast(dict[str, object], body["payload"])
    assert payload["operation_schema_version"] == "cotizacion-profesional-result.v1"
    assert payload["currency"] == "COP"
    assert payload["precio_sugerido_cop"] == 268_775


def test_el_endpoint_responde_422_a_una_entrada_invalida() -> None:
    status, body = _post(_operacion(utilidad_porcentaje=-3), "00000000-0000-4000-8000-000000000c02")
    assert (status, cast(dict[str, object], body["detail"])["code"]) == (422, "invalid_request")


def test_el_endpoint_exige_su_scope() -> None:
    status, body = _post(_operacion(), "00000000-0000-4000-8000-000000000c03", scope="plan.edit")
    assert (status, cast(dict[str, object], body["detail"])["code"]) == (403, "insufficient_scope")
