"""Vista previa del armado de columnas orgánicas, con su dibujo (ADR-0034, ADR-0035 paso 3).

``POST /internal/v1/plan/armado-columna-organica`` resuelve el armado que manda el editor, o da la receta de la
pieza con ``armado_columna_organica: null``, y devuelve la columna resuelta y el SVG que emite el mismo motor que
colocó los globos. Sin catálogo y sin efectos: el plan dice qué pieza es y ``colores`` solo la pintan.

Es el gemelo de ``test_plan_armado_columna.py`` (la torre de anillos) y de ``test_plan_armado_guirnalda_organica.py``.
Se prueba por el endpoint de verdad (firma HMAC, contexto operacional, ``TestClient``) y no solo por la función,
porque lo que monta esta entrega es el transporte: el scope, el contrato local de la petición y la traducción de
``ArmadoInvalido`` a un error de cliente con ``motivo`` y ``mensaje``. Los números del motor los fijan los vectores
de oro de ``test_columnaorg.py``; aquí no se vuelve a calcular nada.
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

from app.main import Settings, build_signature, create_app
from app.operational_store import InMemoryOperationalStore
from app.plan import MERMA, PlanResolutionError
from app.plan_armado_columna_organica import (
    AVISO_SIN_COLORES,
    PlanArmadoColumnaOrganicaRequest,
    vista_previa_armado_columna_organica,
)
from tests.guirnalda_datos import arco, material, plan
from tests.test_armado_columna_organica import armado as armado_base

SECRET = "o" * 32
COLUMNA = "EST_03_COLUMNA"
ARCO = "EST_02_ARCO"
RUTA = "/internal/v1/plan/armado-columna-organica"
SCOPE = "plan.armado_columna_organica"
COLORES = ["#1d4ed8", "#ffffff"]
CONTEXTO = {
    "schema_version": "operational.v1",
    "request_id": "00000000-0000-4000-8000-000000000d00",
    "correlation_id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
    "deadline_at": "2030-01-01T00:00:00Z",
    "deadline_ms": 5000,
    "scopes": [SCOPE],
}


def columna(**extra: object) -> dict[str, object]:
    """Una columna del plan con un solo color (dorado)."""
    return {
        "estructura_id": COLUMNA,
        "nombre": "Columna",
        "tipo": "columna",
        "estructura_oficial": "columna_asimetrica",
        "rol_escena": "acento",
        "ubicacion": "lateral_derecho",
        "medidas": {"alto_m": 2.0},
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": "organica_fina",
        "materiales": [material("dorado", 1.0, principal=True)],
        "porque": "Columna de prueba.",
        **extra,
    }


def _columna_dos_colores(**extra: object) -> dict[str, object]:
    return columna(
        materiales=[material("azul", 0.6, principal=True), material("blanco", 0.4)], **extra
    )


def _operacion(
    armado: Mapping[str, object] | None,
    *,
    estructura_id: str = COLUMNA,
    estructuras: tuple[dict[str, object], ...] | None = None,
    **extra: object,
) -> dict[str, object]:
    piezas = estructuras if estructuras is not None else (_columna_dos_colores(),)
    return {
        "schema_version": "plan-armado-columna-organica.v1",
        "plan": plan(*piezas),
        "estructura_id": estructura_id,
        "armado_columna_organica": None if armado is None else dict(armado),
        "colores": COLORES,
        **extra,
    }


def _peticion(
    armado: Mapping[str, object] | None, **extra: object
) -> PlanArmadoColumnaOrganicaRequest:
    return PlanArmadoColumnaOrganicaRequest.model_validate(
        {"context": {**CONTEXTO, "body_sha256": "a" * 64}, **_operacion(armado, **extra)}
    )


def _vista(armado: Mapping[str, object] | None = None, **extra: object) -> dict[str, Any]:
    return cast(dict[str, Any], vista_previa_armado_columna_organica(_peticion(armado, **extra)))


# --- La vista previa ---------------------------------------------------------------


def test_sin_armado_devuelve_la_receta_con_el_alto_de_la_pieza() -> None:
    resultado = _vista()

    armado = resultado["armado"]
    assert resultado["operation_schema_version"] == "plan-armado-columna-organica-result.v1"
    assert armado["origen"] == "sugerido"
    # El alto es el del plan (2 m), no el de la columna de referencia del diseñador (2,2 m).
    assert armado["forma"]["altoM"] == 2.0
    # Un color de la paleta por material de la pieza, en su orden y con su participación como peso.
    assert [(c["material"], c["peso"]) for c in armado["colores"]["paleta"]] == [(0, 60), (1, 40)]
    # El globo grande de arriba arranca quitado, como en el diseñador.
    assert armado["corona"]["activa"] is False
    # Los mandos que el contrato no publica no viajan en la receta.
    assert not {"carga", "espejo"} & set(armado["forma"])


def test_la_receta_resuelve_una_columna_con_globos_y_con_svg() -> None:
    resultado = _vista()

    resuelta = resultado["columna"]
    grafica = resultado["grafica"]
    assert resuelta["version"] == "armado-columna-organica.v1"
    assert len(resuelta["globos"]) > 0, "el motor coloca cada globo de la columna"
    assert {globo["material"] for globo in resuelta["globos"]} <= {0, 1}
    # El conteo es el de los globos colocados: nada se cuenta aparte.
    assert sum(linea["cantidad"] for linea in resuelta["conteo"]) == len(resuelta["globos"])
    assert resuelta["alto_m"] > 0
    assert (grafica["ancho"], grafica["alto"]) == (600, 720)
    assert set(grafica) == {"ancho", "alto", "svg"}
    assert grafica["svg"].startswith("<")
    # Derivado: el SVG sale por esta ruta y nunca dentro de la columna que viaja en el plan resuelto.
    assert "grafica" not in resuelta and "svg" not in resuelta


def test_el_dibujo_usa_los_tonos_de_la_pieza() -> None:
    svg = _vista()["grafica"]["svg"].lower()

    assert "1d4ed8".lower() in svg and "ffffff" in svg
    assert "9ca3af" not in svg, "con los tonos resueltos no hace falta el gris neutro"


def test_la_compra_de_la_vista_previa_es_la_que_cobra_el_plan() -> None:
    # La vista previa compra con el margen del plan, no con el 12 % del diseñador.
    from app.armado_columna_organica import EstructuraColumnaOrganica, armado_resuelto

    receta = _vista()["armado"]
    con_el_plan = armado_resuelto(EstructuraColumnaOrganica(True, COLORES), receta, MERMA)

    assert _vista(receta)["columna"]["total_comprar"] == con_el_plan["total_comprar"]


def test_devuelve_las_herramientas_del_motor_y_los_rangos_vivos() -> None:
    resultado = _vista()

    opciones = resultado["opciones"]
    limites = resultado["limites"]
    assert len(opciones["formas"]) == 8 and len(opciones["estilos"]) == 4
    assert {"acabados", "repartos", "tamanos", "alto_m", "grosor_m", "max_materiales"} <= set(
        opciones
    )
    assert limites["altoMin"] <= resultado["armado"]["forma"]["altoM"] <= limites["altoMax"]
    assert "coronaTamanos" in limites and limites["coronaTamanos"], (
        "algún globo cabe sobre la punta"
    )


def test_un_armado_dado_se_resuelve_tal_cual() -> None:
    dado = {**_vista()["armado"], "origen": "decorador"}
    dado["volumen"] = {**dado["volumen"], "relleno": 0.9}

    resultado = _vista(dado)

    assert resultado["armado"] == dado, "un borrador vuelve tal como se dio"
    assert len(resultado["columna"]["globos"]) > 0


def test_el_globo_grande_de_arriba_se_quita_y_se_pone() -> None:
    receta = _vista()["armado"]
    sin = _vista(receta)["columna"]
    con = _vista({**receta, "corona": {"activa": True, "tamano": 24, "material": 1}})["columna"]

    assert len(con["globos"]) == len(sin["globos"]) + 1
    assert con["globos"][-1]["tamano"] == 24 and con["globos"][-1]["material"] == 1
    assert con["total_comprar"] >= sin["total_comprar"]


def test_sin_los_tonos_resueltos_el_dibujo_lo_avisa() -> None:
    peticion = PlanArmadoColumnaOrganicaRequest.model_validate(
        {
            "context": {**CONTEXTO, "body_sha256": "a" * 64},
            **{**_operacion(None), "colores": None},
        }
    )

    avisos = cast(dict[str, Any], vista_previa_armado_columna_organica(peticion))["columna"][
        "avisos"
    ]

    assert AVISO_SIN_COLORES in avisos


def test_un_color_de_la_pieza_que_el_armado_no_toma_se_avisa() -> None:
    receta = _vista()["armado"]
    un_solo_color = {
        **receta,
        "colores": {**receta["colores"], "paleta": receta["colores"]["paleta"][:1]},
        "corona": {**receta["corona"], "material": 0},
    }

    avisos = _vista(un_solo_color)["columna"]["avisos"]

    assert any("no usa el color Blanco" in aviso for aviso in avisos), avisos


def test_un_armado_invalido_responde_con_motivo_y_mensaje() -> None:
    receta = _vista()["armado"]
    malo = {**receta, "corona": {**receta["corona"], "material": 7}}

    with pytest.raises(PlanResolutionError) as caso:
        _vista(malo)

    assert (caso.value.code, caso.value.status_code) == ("armado_invalido", 422)
    detalle = cast(Mapping[str, str], caso.value.details)
    assert (detalle["estructura_id"], detalle["motivo"]) == (COLUMNA, "material_fuera_de_rango")
    assert detalle["mensaje"]


def test_una_pieza_que_no_es_una_columna_no_se_arma_asi() -> None:
    with pytest.raises(PlanResolutionError) as caso:
        _vista(armado_base(), estructura_id=ARCO, estructuras=(_columna_dos_colores(), arco()))

    assert cast(Mapping[str, str], caso.value.details)["motivo"] == "no_es_columna"


def test_una_estructura_desconocida_responde_404() -> None:
    with pytest.raises(PlanResolutionError) as caso:
        _vista(estructura_id="EST_09_OTRA")

    assert (caso.value.code, caso.value.status_code) == ("estructura_no_encontrada", 404)


def test_la_forma_del_armado_se_exige_en_la_frontera() -> None:
    receta = _vista()["armado"]

    with pytest.raises(ValidationError):
        _peticion({**receta, "version": "armado-columna.v1"})
    with pytest.raises(ValidationError):
        _peticion({**receta, "forma": {**receta["forma"], "altoM": 99}})
    with pytest.raises(ValidationError):
        _peticion(None, colores=["azul", "#ffffff"])


# --- El endpoint -------------------------------------------------------------------


def _post(
    operation: Mapping[str, object], nonce: str, *, scope: str = SCOPE
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
            path=RUTA,
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
        response = client.post(RUTA, content=body, headers=headers)
    return response.status_code, cast(dict[str, object], response.json())


def test_el_endpoint_devuelve_una_columna_resuelta_con_globos_y_con_svg() -> None:
    status, body = _post(_operacion(None), "00000000-0000-4000-8000-000000000d01")

    assert status == 200
    payload = cast(dict[str, Any], body["payload"])
    assert payload["operation_schema_version"] == "plan-armado-columna-organica-result.v1"
    assert len(payload["columna"]["globos"]) > 0
    assert set(payload["grafica"]) == {"ancho", "alto", "svg"}
    assert payload["armado"]["origen"] == "sugerido"
    assert "formas" in payload["opciones"] and "altoMin" in payload["limites"]


def test_el_endpoint_responde_422_con_motivo_cuando_el_armado_no_se_sostiene() -> None:
    receta = _vista()["armado"]
    malo = {**receta, "corona": {**receta["corona"], "material": 7}}
    status, body = _post(_operacion(malo), "00000000-0000-4000-8000-000000000d02")

    detail = cast(dict[str, object], body["detail"])
    assert (status, detail["code"]) == (422, "armado_invalido")
    assert (detail["estructura_id"], detail["motivo"]) == (COLUMNA, "material_fuera_de_rango")


def test_el_endpoint_exige_su_propio_scope() -> None:
    status, _ = _post(
        _operacion(None), "00000000-0000-4000-8000-000000000d03", scope="plan.armado_columna"
    )

    assert status == 403
