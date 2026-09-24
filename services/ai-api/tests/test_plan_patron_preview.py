"""Vista previa del patrón de color para el editor (ADR-0028 §10).

`POST /internal/v1/plan/patron` expande el patrón que manda el editor, o sugiere
el preset con `patron_color: null`, sin catálogo. Expectativas a mano sobre la
columna de `test_plan_patron.py`: 10 cuartetos, 40 globos.
"""

from __future__ import annotations

import hashlib
import json
import time
from collections.abc import Mapping
from typing import cast
from uuid import UUID

from fastapi.testclient import TestClient

from app.main import Settings, build_signature, create_app
from app.operational_store import InMemoryOperationalStore
from app.plan_edicion import PlanPatronRequest, vista_previa_patron

SECRET = "v" * 32
COLUMNA = "EST_01_COLUMNA"
ANILLOS = {
    "version": "patron-color.v1",
    "origen": "decorador",
    "base": {"modo": "anillos", "secuencia": [0, 1, 2], "largo": 1},
}
SIN_AZUL = {
    "version": "patron-color.v1",
    "origen": "decorador",
    "base": {"modo": "espiral", "racimo": [0, 1, 0, 1], "trazo": "espiral"},
}
CONTEXTO = {
    "schema_version": "operational.v1",
    "request_id": "00000000-0000-4000-8000-000000000b00",
    "correlation_id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
    "deadline_at": "2030-01-01T00:00:00Z",
    "deadline_ms": 5000,
    "scopes": ["plan.patron"],
}


def _columna(**extra: object) -> dict[str, object]:
    return {
        "estructura_id": COLUMNA,
        "nombre": "Columna",
        "tipo": "columna",
        "rol_escena": "focal",
        "ubicacion": "lateral_izquierdo",
        "medidas": {"alto_m": 1.8},
        "repeticiones": 2,
        "densidad": "media",
        "mezcla": "clasica",
        "materiales": [
            {"product_id": f"prod-{color}", "color": color, "participacion": parte, "rol_material": "secundario"}
            for color, parte in (("blanco", 0.4), ("negro", 0.3), ("azul", 0.3))
        ],
        "porque": "Columna de prueba.",
        **extra,
    }


def _plan() -> dict[str, object]:
    return {
        "plan_version": "1.0",
        "plan_id": "27272727-2727-4272-8272-272727272727",
        "concepto": {"titulo": "Prueba", "descripcion": "Vista previa.", "paleta": ["blanco"]},
        "espacio": {"tipo": "salon", "fuente": "cliente"},
        "estructuras": [_columna()],
        "supuestos": [],
        "referencia_omitida": [],
    }


def _operacion(patron: Mapping[str, object] | None, estructura_id: str = COLUMNA) -> dict[str, object]:
    return {
        "schema_version": "plan-patron.v1",
        "plan": _plan(),
        "estructura_id": estructura_id,
        "patron_color": None if patron is None else dict(patron),
    }


def _peticion(patron: Mapping[str, object] | None) -> PlanPatronRequest:
    return PlanPatronRequest.model_validate(
        {"context": {**CONTEXTO, "body_sha256": "a" * 64}, **_operacion(patron)}
    )


def _conteo(resultado: Mapping[str, object]) -> list[tuple[int, int]]:
    patron = cast(dict[str, object], resultado["patron"])
    return [
        (cast(int, c["unidades_por_instancia"]), cast(int, c["unidades_total"]))
        for c in cast(list[dict[str, object]], patron["conteo"])
    ]


def test_sin_patron_devuelve_la_sugerencia_sin_aplicar() -> None:
    resultado = vista_previa_patron(_peticion(None))

    patron = cast(dict[str, object], resultado["patron"])
    assert resultado["operation_schema_version"] == "plan-patron-result.v1"
    assert (patron["estructura_id"], patron["aplicado"]) == (COLUMNA, False)
    # 4p - 1 = 0.6, 0.2, 0.2 → la posición que sobra al blanco: [0, 1, 0, 2].
    assert patron["patron"] == {
        "version": "patron-color.v1",
        "origen": "sugerido",
        "base": {"modo": "espiral", "racimo": [0, 1, 0, 2], "trazo": "espiral"},
    }
    # 20/10/10 por columna y el doble con dos repeticiones.
    assert _conteo(resultado) == [(20, 40), (10, 20), (10, 20)]


def test_un_patron_dado_se_expande_como_aplicado() -> None:
    resultado = vista_previa_patron(_peticion(ANILLOS))

    patron = cast(dict[str, object], resultado["patron"])
    # 10 filas 0, 1, 2, 0…: 4, 3 y 3 cuartetos.
    assert (patron["aplicado"], patron["filas"], patron["columnas"]) == (True, 10, 4)
    assert patron["patron"] == ANILLOS
    assert _conteo(resultado) == [(16, 32), (12, 24), (12, 24)]


CONFETI = {
    "version": "patron-color.v1",
    "origen": "referencia",
    "base": {
        "modo": "aleatorio",
        "pesos": [{"material": 0, "peso": 40}, {"material": 1, "peso": 30}, {"material": 2, "peso": 30}],
        "semilla": 7,
    },
    "acentos": [{"material": 2, "cada": 3, "desde": 2, "posiciones": [0]}],
}


def _peticion_reparto(participaciones: list[float], columna: Mapping[str, object]) -> PlanPatronRequest:
    return PlanPatronRequest.model_validate(
        {
            "context": {**CONTEXTO, "body_sha256": "a" * 64},
            "schema_version": "plan-patron.v1",
            "plan": {**_plan(), "estructuras": [dict(columna)]},
            "estructura_id": COLUMNA,
            "patron_color": None,
            "participaciones": participaciones,
        }
    )


def test_el_reparto_del_deslizador_se_dibuja_sin_guardar() -> None:
    # Mientras se arrastra: el mismo `repartir` de la edición sobre el confeti,
    # sin tocar el plan. 40 celdas por 50/25/25 → 20, 10 y 10 por columna.
    resultado = vista_previa_patron(_peticion_reparto([0.5, 0.25, 0.25], _columna(patron_color=CONFETI)))

    patron = cast(dict[str, object], resultado["patron"])
    assert patron["aplicado"] is True
    assert cast(dict[str, object], patron["patron"])["base"] == {
        "modo": "aleatorio",
        "pesos": [{"material": 0, "peso": 50}, {"material": 1, "peso": 25}, {"material": 2, "peso": 25}],
        "semilla": 7,
    }
    assert _conteo(resultado) == [(20, 40), (10, 20), (10, 20)]
    # El acento de la foto se integró al confeti, y la vista previa lo dice.
    assert "acentos" not in cast(dict[str, object], patron["patron"])
    assert any("se integraron al confeti" in aviso for aviso in cast(list[str], patron["avisos"]))


def test_la_vista_previa_dice_que_estilos_ofrece_el_editor() -> None:
    resultado = vista_previa_patron(_peticion(None))

    modos = cast(list[dict[str, object]], resultado["modos_admitidos"])
    assert [modo["modo"] for modo in modos] == ["espiral", "anillos", "bloques", "degradado", "aleatorio", "flor"]
    assert all(modo["direcciones"] == ["longitudinal"] and modo["espejo"] is False for modo in modos)


def test_el_punto_de_partida_de_un_estilo_se_pide_con_modo() -> None:
    # Participación 0.4 / 0.3 / 0.3: los anillos van del blanco al azul.
    peticion = PlanPatronRequest.model_validate(
        {"context": {**CONTEXTO, "body_sha256": "a" * 64}, **_operacion(None), "modo": "anillos"}
    )

    patron = cast(dict[str, object], vista_previa_patron(peticion)["patron"])

    assert patron["aplicado"] is False
    assert cast(dict[str, object], patron["patron"])["base"] == {
        "modo": "anillos",
        "secuencia": [0, 1, 2],
        "largo": 1,
    }


def test_modo_solo_va_sin_patron() -> None:
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        PlanPatronRequest.model_validate(
            {"context": {**CONTEXTO, "body_sha256": "a" * 64}, **_operacion(ANILLOS), "modo": "anillos"}
        )


def test_el_reparto_de_una_pieza_sin_patron_no_tiene_nada_que_dibujar() -> None:
    import pytest

    from app.plan import PlanResolutionError

    with pytest.raises(PlanResolutionError) as error:
        vista_previa_patron(_peticion_reparto([0.5, 0.25, 0.25], _columna()))
    assert (error.value.code, error.value.status_code) == ("sin_patron", 409)


def test_reparto_y_patron_no_van_juntos() -> None:
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        PlanPatronRequest.model_validate(
            {
                "context": {**CONTEXTO, "body_sha256": "a" * 64},
                **_operacion(ANILLOS),
                "participaciones": [0.5, 0.25, 0.25],
            }
        )


def _post(
    operation: Mapping[str, object], nonce: str, *, scope: str = "plan.patron"
) -> tuple[int, dict[str, object]]:
    context = {
        **CONTEXTO,
        "scopes": [scope],
        "body_sha256": hashlib.sha256(
            json.dumps(operation, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest(),
    }
    body = json.dumps({"context": context, **operation}, separators=(",", ":"), ensure_ascii=False).encode()
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
            path="/internal/v1/plan/patron",
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
        response = client.post("/internal/v1/plan/patron", content=body, headers=headers)
    return response.status_code, cast(dict[str, object], response.json())


def test_el_endpoint_devuelve_plan_patron_result() -> None:
    status, body = _post(_operacion(ANILLOS), "00000000-0000-4000-8000-000000000b01")

    assert status == 200
    payload = cast(dict[str, object], body["payload"])
    assert payload["operation_schema_version"] == "plan-patron-result.v1"
    assert _conteo(payload) == [(16, 32), (12, 24), (12, 24)]


def test_un_patron_invalido_responde_422_con_motivo_y_mensaje() -> None:
    status, body = _post(_operacion(SIN_AZUL), "00000000-0000-4000-8000-000000000b02")

    detail = cast(dict[str, object], body["detail"])
    assert (status, detail["code"]) == (422, "patron_invalido")
    assert (detail["estructura_id"], detail["motivo"]) == (COLUMNA, "material_sin_uso")
    assert "azul (3)" in str(detail["mensaje"])


def test_una_estructura_desconocida_responde_404() -> None:
    status, body = _post(_operacion(None, "EST_09_OTRA"), "00000000-0000-4000-8000-000000000b03")

    assert (status, cast(dict[str, object], body["detail"])["code"]) == (404, "estructura_no_encontrada")


def test_un_patron_fuera_del_contrato_responde_invalid_plan() -> None:
    vacio = {**SIN_AZUL, "base": {"modo": "espiral", "racimo": [], "trazo": "espiral"}}

    status, body = _post(_operacion(vacio), "00000000-0000-4000-8000-000000000b04")

    assert (status, cast(dict[str, object], body["detail"])["code"]) == (422, "invalid_plan")


def test_el_endpoint_exige_su_scope_y_el_campo_patron() -> None:
    sin_patron = {key: value for key, value in _operacion(None).items() if key != "patron_color"}

    status_scope, body_scope = _post(
        _operacion(None), "00000000-0000-4000-8000-000000000b05", scope="plan.edit"
    )
    status_cuerpo, body_cuerpo = _post(sin_patron, "00000000-0000-4000-8000-000000000b06")

    assert (status_scope, cast(dict[str, object], body_scope["detail"])["code"]) == (
        403,
        "insufficient_scope",
    )
    # `null` pide la sugerencia; omitir el campo no es lo mismo.
    assert (status_cuerpo, cast(dict[str, object], body_cuerpo["detail"])["code"]) == (
        422,
        "invalid_request",
    )
