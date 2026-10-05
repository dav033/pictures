"""La guía de escena: los globos de cada pieza del plan como discos en metros (``app/guia_escena.py``).

- **Las piezas del motor** salen de la misma puerta que la resolución: un disco por globo colocado (la columna
  clásica suma su remate), en el color del globo inflado de la referencia que se compra.
- **Las piezas sin motor** salen de su dibujo esquemático, con los mismos globos que pinta.
- **El marco** es local: metros, origen abajo al centro, ``y`` hacia arriba.
- **El transporte**: firma, scope propio, contrato de la petición y tope de discos.
"""

from __future__ import annotations

import hashlib
import json
import time
from collections.abc import Mapping
from typing import Any, cast
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

import app.guia_escena as modulo
from app.armado_estructura import ArmadoEstructuraRequest, completar
from app.color_catalogo import referencia_de
from app.dibujo_estructura import globos_de
from app.guia_escena import (
    HEX_PALETA,
    MAX_DISCOS,
    PlanGuiaEscenaRequest,
    guia_escena,
    hex_del_material,
)
from app.main import Settings, build_signature, create_app
from app.operational_store import InMemoryOperationalStore
from app.plan import PlanResolutionError, pieza_del_motor_resuelta
from tests.guirnalda_datos import material, plan

SECRET = "e" * 32
RUTA = "/internal/v1/plan/guia-escena"
SCOPE = "plan.guia_escena"
CONTEXTO: dict[str, object] = {
    "schema_version": "operational.v1",
    "request_id": "00000000-0000-4000-8000-000000000e00",
    "correlation_id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
    "deadline_at": "2030-01-01T00:00:00Z",
    "deadline_ms": 5000,
}
MEZCLA_REAL: tuple[dict[str, object], ...] = (
    {"diam_pulg": 12, "forma": "redondo", "unidades": 80, "pct": 61.54},
    {"diam_pulg": 5, "forma": "redondo", "unidades": 50, "pct": 38.46},
)


def _pieza(
    estructura_id: str,
    tipo: str,
    oficial: str | None,
    medidas: Mapping[str, float],
    *,
    mezcla: str = "organica_fina",
    ubicacion: str = "fondo_pared",
    colores: tuple[str, str] = ("dorado", "blanco"),
) -> dict[str, object]:
    pieza: dict[str, object] = {
        "estructura_id": estructura_id,
        "nombre": estructura_id,
        "tipo": tipo,
        "rol_escena": "focal",
        "ubicacion": ubicacion,
        "medidas": dict(medidas),
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": mezcla,
        "materiales": [material(colores[0], 0.5, principal=True), material(colores[1], 0.5)],
        "porque": "Pieza de prueba.",
    }
    if oficial is not None:
        pieza["estructura_oficial"] = oficial
    return pieza


def _con_armados(*piezas: dict[str, object]) -> dict[str, object]:
    """El plan con el armado que la confirmación le pone a cada pieza de motor (la receta)."""
    crudo = plan(*piezas)
    peticion = ArmadoEstructuraRequest.model_validate(
        {
            "context": {
                **CONTEXTO,
                "body_sha256": "a" * 64,
                "scopes": ["omoikane.armado_estructura"],
            },
            "schema_version": "omoikane-armado-estructura.v1",
            "accion": "completar",
            "plan": crudo,
        }
    )
    for armado in cast(list[dict[str, Any]], completar(peticion)["armados"]):
        for estructura in cast(list[dict[str, object]], crudo["estructuras"]):
            if estructura["estructura_id"] == armado["estructura_id"]:
                estructura[str(armado["clave"])] = armado["armado"]
    return crudo


ARCO = _pieza("EST_01_ARCO", "arco", "arco", {"ancho_m": 3, "alto_m": 2.4}, mezcla="clasica")
COLUMNA = _pieza(
    "EST_02_COLUMNA",
    "columna",
    "columna",
    {"alto_m": 1.8},
    mezcla="clasica",
    ubicacion="lateral_izquierdo",
)
COLUMNA_ORGANICA = _pieza(
    "EST_03_COLUMNA_ORG", "columna", "columna", {"alto_m": 1.8}, ubicacion="lateral_derecho"
)
GUIRNALDA = _pieza("EST_04_GUIRNALDA", "guirnalda", "guirnalda", {"largo_m": 2.5})
PARED = _pieza(
    "EST_05_PARED",
    "pared",
    "pared_organica",
    {"ancho_m": 2.4, "alto_m": 2.2},
    colores=("rosado", "blanco"),
)


@pytest.fixture(scope="module")
def plan_motores() -> dict[str, object]:
    return _con_armados(ARCO, COLUMNA, COLUMNA_ORGANICA, GUIRNALDA)


def _operacion(plan_: Mapping[str, object], **extra: object) -> dict[str, object]:
    return {
        "schema_version": "plan-guia-escena.v1",
        "plan": dict(plan_),
        "mezclas": [{"estructura_id": PARED["estructura_id"], "mezcla_real": list(MEZCLA_REAL)}],
        **extra,
    }


def _peticion(plan_: Mapping[str, object], **extra: object) -> PlanGuiaEscenaRequest:
    return PlanGuiaEscenaRequest.model_validate(
        {
            "context": {**CONTEXTO, "body_sha256": "a" * 64, "scopes": [SCOPE]},
            **_operacion(plan_, **extra),
        }
    )


def _piezas(resultado: Mapping[str, object]) -> dict[str, dict[str, Any]]:
    return {str(p["estructura_id"]): p for p in cast(list[dict[str, Any]], resultado["piezas"])}


def _globo_inflado(color: str) -> str:
    referencia = referencia_de(color, None)
    assert referencia is not None
    return str(referencia["hexGlobo"]).lower()


# --- Las piezas del motor -------------------------------------------------------------------


def test_cada_globo_que_coloco_el_motor_es_un_disco(plan_motores: dict[str, object]) -> None:
    resultado = guia_escena(_peticion(plan_motores))
    piezas = _piezas(resultado)

    assert set(piezas) == {
        "EST_01_ARCO",
        "EST_02_COLUMNA",
        "EST_03_COLUMNA_ORG",
        "EST_04_GUIRNALDA",
    }
    for estructura in cast(list[dict[str, object]], plan_motores["estructuras"]):
        del_motor = pieza_del_motor_resuelta(estructura)
        assert del_motor is not None, estructura["estructura_id"]
        clase, pieza = del_motor
        esperados = len(cast(list[object], pieza["globos"]))
        if clase == "columna":
            # El remate va sobre el cuerpo y el motor no lo coloca en `globos`.
            remate = cast(Mapping[str, Any], pieza["remate"])
            esperados += sum(int(linea["cantidad"]) for linea in remate["globos"])
        discos = piezas[str(estructura["estructura_id"])]["discos"]
        assert len(discos) == esperados, estructura["estructura_id"]
        assert piezas[str(estructura["estructura_id"])]["fuente"] == "motor"
    assert resultado["total_discos"] == sum(len(p["discos"]) for p in piezas.values())
    assert resultado["omitidas"] == []


def test_el_color_es_el_del_globo_inflado_de_la_referencia_que_se_compra(
    plan_motores: dict[str, object],
) -> None:
    esperados = {_globo_inflado("dorado"), _globo_inflado("blanco")}
    for pieza in _piezas(guia_escena(_peticion(plan_motores))).values():
        assert {disco["hex"] for disco in pieza["discos"]} <= esperados, pieza["estructura_id"]
    # No es la tinta con la que dibuja el esquema: el dorado inflado es otro tono.
    referencia = referencia_de("dorado", None)
    assert (
        referencia is not None and referencia["hexGlobo"].lower() != referencia["hexTinta"].lower()
    )


def test_el_marco_es_local_en_metros_abajo_al_centro(plan_motores: dict[str, object]) -> None:
    for pieza in _piezas(guia_escena(_peticion(plan_motores))).values():
        discos = pieza["discos"]
        izquierda = min(d["x_m"] - d["r_m"] for d in discos)
        derecha = max(d["x_m"] + d["r_m"] for d in discos)
        abajo = min(d["y_m"] - d["r_m"] for d in discos)
        arriba = max(d["y_m"] + d["r_m"] for d in discos)
        assert abajo == pytest.approx(0, abs=1e-3), pieza["estructura_id"]
        assert izquierda == pytest.approx(-derecha, abs=1e-3), pieza["estructura_id"]
        assert derecha - izquierda == pytest.approx(pieza["ancho_m"], abs=1e-3)
        assert arriba - abajo == pytest.approx(pieza["alto_m"], abs=1e-3)
        # Metros de verdad: ninguna de estas piezas pasa de unos metros ni tiene globos de más de un metro.
        assert 0.2 < pieza["ancho_m"] < 6 and 0.2 < pieza["alto_m"] < 6
        assert all(0.01 < d["r_m"] < 0.5 for d in discos)


def test_el_arco_clasico_pasa_de_pixeles_a_metros_con_su_propio_ancho(
    plan_motores: dict[str, object],
) -> None:
    arco = _piezas(guia_escena(_peticion(plan_motores)))["EST_01_ARCO"]

    # 3 × 2,4 m en el plan; el motor lo dibuja en píxeles de su lienzo con `y` hacia abajo.
    assert arco["ancho_m"] == pytest.approx(3.0, abs=1e-3)
    assert arco["alto_m"] == pytest.approx(2.4, rel=0.05)
    # Con `y` hacia arriba, el arco tiene patas: los globos más bajos están en los dos extremos.
    bajos = [d for d in arco["discos"] if d["y_m"] - d["r_m"] < 0.2]
    assert min(d["x_m"] for d in bajos) < -1 and max(d["x_m"] for d in bajos) > 1


# --- Las piezas sin motor ----------------------------------------------------------------------


def test_una_pieza_sin_motor_sale_de_su_dibujo_esquematico() -> None:
    plan_ = plan(PARED)
    pieza = _piezas(guia_escena(_peticion(plan_)))["EST_05_PARED"]
    globos = globos_de(PARED, MEZCLA_REAL)

    assert pieza["fuente"] == "dibujo"
    assert globos is not None and len(pieza["discos"]) == len(globos)
    assert {d["hex"] for d in pieza["discos"]} <= {
        _globo_inflado("rosado"),
        _globo_inflado("blanco"),
    }


def test_una_pieza_sin_motor_ni_dibujo_se_omite_con_su_motivo() -> None:
    backdrop = _pieza("EST_06_BACKDROP", "backdrop", None, {"ancho_m": 2, "alto_m": 2})
    resultado = guia_escena(_peticion(plan(PARED, backdrop)))

    assert resultado["omitidas"] == [{"estructura_id": "EST_06_BACKDROP", "motivo": "sin_dibujo"}]
    assert set(_piezas(resultado)) == {"EST_05_PARED"}


def test_un_color_fuera_de_la_lamina_toma_el_tono_de_la_paleta_del_plan() -> None:
    assert referencia_de("champagne", None) is None
    assert hex_del_material({"color": "champagne"}) == HEX_PALETA["champagne"]
    # Una referencia del fabricante también es el globo inflado, no la tinta.
    assert (
        hex_del_material({"color": "dorado", "acabado": "mate"})
        == str(cast(dict[str, Any], referencia_de("dorado", "mate"))["hexGlobo"]).lower()
    )
    # Sin nombre que reconocer, el gris neutro del motor: no se inventa un tono.
    assert hex_del_material({"color": "color-inexistente"}) == "#9ca3af"


def test_el_tope_de_discos_rechaza_la_escena(
    plan_motores: dict[str, object], monkeypatch: pytest.MonkeyPatch
) -> None:
    assert MAX_DISCOS == 3000
    monkeypatch.setattr(modulo, "MAX_DISCOS", 10)
    with pytest.raises(PlanResolutionError) as error:
        guia_escena(_peticion(plan_motores))
    assert error.value.code == "guia_demasiados_globos"
    assert error.value.status_code == 422


def test_la_peticion_se_valida_contra_el_contrato(plan_motores: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        _peticion(plan_motores, sobrante=True)
    with pytest.raises(ValidationError):
        _peticion(
            plan_motores,
            mezclas=[{"estructura_id": "EST_05_PARED", "mezcla_real": [{"diam_pulg": 12}]}],
        )


def test_un_plan_que_no_cumple_su_contrato_no_se_guia() -> None:
    roto = plan(PARED)
    roto["estructuras"] = [{"estructura_id": "EST_X"}]
    with pytest.raises(PlanResolutionError) as error:
        guia_escena(_peticion(roto))
    assert error.value.code == "invalid_plan"


# --- El endpoint -------------------------------------------------------------------------------


def _post(
    operation: Mapping[str, object], nonce: str, *, scope: str = SCOPE, firmar: bool = True
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
    }
    if firmar:
        headers["x-internal-signature"] = build_signature(
            secret=SECRET,
            method="POST",
            path=RUTA,
            timestamp=timestamp,
            nonce=UUID(nonce),
            scopes=[scope],
            body=body,
        )
    app = create_app(
        Settings(environment="test", hmac_secret=SECRET),
        operational_store=InMemoryOperationalStore(),
    )
    with TestClient(app) as client:
        response = client.post(RUTA, content=body, headers=headers)
    return response.status_code, cast(dict[str, object], response.json())


def test_el_endpoint_devuelve_los_discos_de_cada_pieza(plan_motores: dict[str, object]) -> None:
    status, body = _post(_operacion(plan_motores), "00000000-0000-4000-8000-000000000e01")

    assert status == 200
    payload = cast(dict[str, Any], body["payload"])
    assert payload["operation_schema_version"] == "plan-guia-escena-result.v1"
    assert payload == guia_escena(_peticion(plan_motores))


def test_el_endpoint_exige_firma_y_su_propio_scope(plan_motores: dict[str, object]) -> None:
    sin_firma, _ = _post(
        _operacion(plan_motores), "00000000-0000-4000-8000-000000000e02", firmar=False
    )
    otro_scope, _ = _post(
        _operacion(plan_motores),
        "00000000-0000-4000-8000-000000000e03",
        scope="plan.dibujo_estructura",
    )

    assert sin_firma == 401
    assert otro_scope == 403


def test_el_endpoint_rechaza_un_cuerpo_fuera_de_contrato(plan_motores: dict[str, object]) -> None:
    status, _ = _post(
        _operacion(plan_motores, schema_version="plan-guia-escena.v0"),
        "00000000-0000-4000-8000-000000000e04",
    )

    assert status == 422


def test_el_endpoint_traduce_el_tope_a_un_error_estable(
    plan_motores: dict[str, object], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(modulo, "MAX_DISCOS", 10)
    status, body = _post(_operacion(plan_motores), "00000000-0000-4000-8000-000000000e05")

    assert status == 422
    assert "guia_demasiados_globos" in json.dumps(body)
