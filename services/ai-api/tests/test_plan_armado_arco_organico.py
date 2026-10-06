"""Vista previa del armado de arcos orgánicos, con su dibujo (ADR-0034, ADR-0035).

``POST /internal/v1/plan/armado-arco-organico`` resuelve el armado que manda el editor, o da la receta de la
pieza con ``armado_arco_organico: null``, y devuelve el arco resuelto y el SVG que emite el mismo motor que
colocó los globos. Sin catálogo y sin efectos: el plan dice qué pieza es y ``colores`` solo la pintan.

Es el gemelo de ``test_plan_armado_arco.py`` (la rejilla de patrones) y de
``test_plan_armado_columna_organica.py``. Se prueba por el endpoint de verdad (firma HMAC, contexto operacional,
``TestClient``) y no solo por la función, porque lo que monta esta entrega es el transporte: el scope, el
contrato local de la petición y la traducción de ``ArmadoInvalido`` a un error de cliente con ``motivo`` y
``mensaje``. Los números del motor los fijan los vectores de oro de ``test_arco.py``; aquí no se vuelve a
calcular nada.
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

from app.armado_estructura import CORTE_MEDIO_ARCO_FUERTE, FORMA_SEMIARCO
from app.main import Settings, build_signature, create_app
from app.operational_store import InMemoryOperationalStore
from app.organico.formas import FORMAS_LISTAS
from app.plan import MERMA, PlanResolutionError
from app.plan_armado_arco_organico import (
    AVISO_SIN_COLORES,
    PlanArmadoArcoOrganicoRequest,
    vista_previa_armado_arco_organico,
)
from tests.guirnalda_datos import arco, guirnalda, material, plan

SECRET = "o" * 32
ARCO = "EST_02_ARCO"
GUIRNALDA = "EST_01_GUIRNALDA"
RUTA = "/internal/v1/plan/armado-arco-organico"
SCOPE = "plan.armado_arco_organico"
COLORES = ["#1d4ed8", "#ffffff"]
CONTEXTO = {
    "schema_version": "operational.v1",
    "request_id": "00000000-0000-4000-8000-000000000e00",
    "correlation_id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
    "deadline_at": "2030-01-01T00:00:00Z",
    "deadline_ms": 5000,
    "scopes": [SCOPE],
}


def _arco_dos_colores(**extra: object) -> dict[str, object]:
    """El arco de prueba con dos colores: 3 m de ancho y 2,4 m de alto los declara la pieza."""
    return arco(
        materiales=[material("azul", 0.6, principal=True), material("blanco", 0.4)], **extra
    )


def _operacion(
    armado: Mapping[str, object] | None,
    *,
    estructura_id: str = ARCO,
    estructuras: tuple[dict[str, object], ...] | None = None,
    **extra: object,
) -> dict[str, object]:
    piezas = estructuras if estructuras is not None else (_arco_dos_colores(),)
    return {
        "schema_version": "plan-armado-arco-organico.v1",
        "plan": plan(*piezas),
        "estructura_id": estructura_id,
        "armado_arco_organico": None if armado is None else dict(armado),
        "colores": COLORES,
        **extra,
    }


def _peticion(
    armado: Mapping[str, object] | None, **extra: object
) -> PlanArmadoArcoOrganicoRequest:
    return PlanArmadoArcoOrganicoRequest.model_validate(
        {"context": {**CONTEXTO, "body_sha256": "a" * 64}, **_operacion(armado, **extra)}
    )


def _vista(armado: Mapping[str, object] | None = None, **extra: object) -> dict[str, Any]:
    return cast(dict[str, Any], vista_previa_armado_arco_organico(_peticion(armado, **extra)))


# --- La vista previa ---------------------------------------------------------------


def test_sin_armado_devuelve_la_receta_con_las_medidas_de_la_pieza() -> None:
    resultado = _vista()

    armado = resultado["armado"]
    assert resultado["operation_schema_version"] == "plan-armado-arco-organico-result.v1"
    assert armado["origen"] == "sugerido"
    # El ancho y el alto son los del plan (3 × 2,4 m), no los del arco de referencia (4 × 2,6 m).
    assert (armado["forma"]["anchoM"], armado["forma"]["altoM"]) == (3.0, 2.4)
    # Un color de la paleta por material de la pieza, en su orden y con su participación como peso.
    assert [(c["material"], c["peso"]) for c in armado["colores"]["paleta"]] == [(0, 60), (1, 40)]
    # A diferencia de la columna, el contrato del arco publica la forma entera: un medio arco se arma con
    # `corte` y `espejo`, así que la receta los lleva.
    assert {"carga", "espejo", "corte"} <= set(armado["forma"])


def test_la_receta_resuelve_un_arco_con_globos_y_con_svg() -> None:
    resultado = _vista()

    resuelto = resultado["arco"]
    grafica = resultado["grafica"]
    assert resuelto["version"] == "armado-arco-organico.v1"
    assert len(resuelto["globos"]) > 0, "el motor coloca cada globo del arco"
    assert {globo["material"] for globo in resuelto["globos"]} <= {0, 1}
    # El conteo es el de los globos colocados: nada se cuenta aparte.
    assert sum(linea["cantidad"] for linea in resuelto["conteo"]) == len(resuelto["globos"])
    assert resuelto["largo_m"] > 0
    # El lienzo del motor del arco es cuadrado, al contrario que el de la columna (600 × 720).
    assert (grafica["ancho"], grafica["alto"]) == (600, 600)
    assert set(grafica) == {"ancho", "alto", "svg"}
    assert grafica["svg"].startswith("<")
    # Derivado: el SVG sale por esta ruta y nunca dentro del arco que viaja en el plan resuelto.
    assert "grafica" not in resuelto and "svg" not in resuelto


def test_el_dibujo_usa_los_tonos_de_la_pieza() -> None:
    svg = _vista()["grafica"]["svg"].lower()

    assert "1d4ed8".lower() in svg and "ffffff" in svg
    assert "9ca3af" not in svg, "con los tonos resueltos no hace falta el gris neutro"


def test_la_compra_de_la_vista_previa_es_la_que_cobra_el_plan() -> None:
    # La vista previa compra con el margen del plan, no con el 12 % del diseñador.
    from app.armado_arco_organico import EstructuraArcoOrganico, armado_resuelto

    receta = _vista()["armado"]
    con_el_plan = armado_resuelto(EstructuraArcoOrganico(True, COLORES), receta, MERMA)

    assert _vista(receta)["arco"]["total_comprar"] == con_el_plan["total_comprar"]


def test_devuelve_las_herramientas_del_motor_y_los_rangos_vivos() -> None:
    resultado = _vista()

    opciones = resultado["opciones"]
    limites = resultado["limites"]
    assert len(opciones["formas"]) == 15 and len(opciones["estilos"]) == 4
    assert {
        "acabados",
        "repartos",
        "tamanos",
        "ancho_m",
        "alto_m",
        "grosor_m",
        "max_materiales",
    } <= set(opciones)
    assert limites["altoMin"] <= resultado["armado"]["forma"]["altoM"] <= limites["altoMax"]
    assert limites["tamanos"], "algún tamaño de globo cabe en esa banda"


def test_un_armado_dado_se_resuelve_tal_cual() -> None:
    dado = {**_vista()["armado"], "origen": "decorador"}
    dado["volumen"] = {**dado["volumen"], "relleno": 0.9}

    resultado = _vista(dado)

    assert resultado["armado"] == dado, "un borrador vuelve tal como se dio"
    assert len(resultado["arco"]["globos"]) > 0


def test_un_medio_arco_se_arma_por_aqui_cortando_la_banda() -> None:
    receta = _vista()["armado"]
    entero = _vista(receta)["arco"]
    medio = _vista({**receta, "forma": {**receta["forma"], "corte": 0.6, "espejo": True}})["arco"]

    assert medio["largo_m"] < entero["largo_m"], "la banda se corta antes de bajar por la otra pata"
    assert 0 < len(medio["globos"]) < len(entero["globos"])


def test_sin_los_tonos_resueltos_el_dibujo_lo_avisa() -> None:
    peticion = PlanArmadoArcoOrganicoRequest.model_validate(
        {
            "context": {**CONTEXTO, "body_sha256": "a" * 64},
            **{**_operacion(None), "colores": None},
        }
    )

    avisos = cast(dict[str, Any], vista_previa_armado_arco_organico(peticion))["arco"]["avisos"]

    assert AVISO_SIN_COLORES in avisos


def test_un_color_de_la_pieza_que_el_armado_no_toma_se_avisa() -> None:
    receta = _vista()["armado"]
    un_solo_color = {
        **receta,
        "colores": {**receta["colores"], "paleta": receta["colores"]["paleta"][:1]},
    }

    avisos = _vista(un_solo_color)["arco"]["avisos"]

    assert any("no usa el color Blanco" in aviso for aviso in avisos), avisos


def test_un_armado_invalido_responde_con_motivo_y_mensaje() -> None:
    receta = _vista()["armado"]
    paleta = receta["colores"]["paleta"]
    malo = {
        **receta,
        "colores": {**receta["colores"], "paleta": [{**paleta[0], "material": 7}, *paleta[1:]]},
    }

    with pytest.raises(PlanResolutionError) as caso:
        _vista(malo)

    assert (caso.value.code, caso.value.status_code) == ("armado_invalido", 422)
    detalle = cast(Mapping[str, str], caso.value.details)
    assert (detalle["estructura_id"], detalle["motivo"]) == (ARCO, "material_fuera_de_rango")
    assert detalle["mensaje"]


def test_una_pieza_que_no_es_un_arco_no_se_arma_asi() -> None:
    receta = _vista()["armado"]

    with pytest.raises(PlanResolutionError) as caso:
        _vista(
            receta,
            estructura_id=GUIRNALDA,
            estructuras=(_arco_dos_colores(), guirnalda()),
        )

    assert cast(Mapping[str, str], caso.value.details)["motivo"] == "no_es_arco"


def test_una_estructura_desconocida_responde_404() -> None:
    with pytest.raises(PlanResolutionError) as caso:
        _vista(estructura_id="EST_09_OTRA")

    assert (caso.value.code, caso.value.status_code) == ("estructura_no_encontrada", 404)


def test_la_forma_del_armado_se_exige_en_la_frontera() -> None:
    receta = _vista()["armado"]

    with pytest.raises(ValidationError):
        _peticion({**receta, "version": "armado-arco.v1"})
    with pytest.raises(ValidationError):
        _peticion({**receta, "forma": {**receta["forma"], "anchoM": 99}})
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


def test_el_endpoint_devuelve_un_arco_resuelto_con_globos_y_con_svg() -> None:
    status, body = _post(_operacion(None), "00000000-0000-4000-8000-000000000e01")

    assert status == 200
    payload = cast(dict[str, Any], body["payload"])
    assert payload["operation_schema_version"] == "plan-armado-arco-organico-result.v1"
    assert len(payload["arco"]["globos"]) > 0
    assert set(payload["grafica"]) == {"ancho", "alto", "svg"}
    assert payload["armado"]["origen"] == "sugerido"
    assert "formas" in payload["opciones"] and "altoMin" in payload["limites"]


def test_el_endpoint_responde_422_con_motivo_cuando_el_armado_no_se_sostiene() -> None:
    receta = _vista()["armado"]
    paleta = receta["colores"]["paleta"]
    malo = {
        **receta,
        "colores": {**receta["colores"], "paleta": [{**paleta[0], "material": 7}, *paleta[1:]]},
    }
    status, body = _post(_operacion(malo), "00000000-0000-4000-8000-000000000e02")

    detail = cast(dict[str, object], body["detail"])
    assert (status, detail["code"]) == (422, "armado_invalido")
    assert (detail["estructura_id"], detail["motivo"]) == (ARCO, "material_fuera_de_rango")


def test_el_endpoint_exige_su_propio_scope() -> None:
    status, _ = _post(
        _operacion(None), "00000000-0000-4000-8000-000000000e03", scope="plan.armado_arco"
    )

    assert status == 403


def test_la_vista_previa_tambien_dibuja_un_semiarco() -> None:
    """Un medio arco **es** esta pieza con ``forma.corte`` menor que 1, así que el dibujo sale de aquí.

    La puerta pregunta a la estructura si se arma con este motor (``es_arco``), y antes solo decía sí a un
    ``arco``: el editor pedía el dibujo de un medio arco y la vista previa contestaba ``no_es_arco`` (422),
    con lo que la pieza se quedaba sin gráfica aunque su armado estuviera en el plan (2026-10-04).
    """
    medio = _arco_dos_colores(
        estructura_id="EST_02_SEMIARCO",
        nombre="Semiarco",
        tipo="semiarco",
        estructura_oficial="semiarco",
    )
    resultado = _vista(estructura_id="EST_02_SEMIARCO", estructuras=(medio,))

    assert resultado["operation_schema_version"] == "plan-armado-arco-organico-result.v1"
    assert len(cast(list[object], resultado["arco"]["globos"])) > 0
    assert cast(str, resultado["grafica"]["svg"]) != ""
    # Y la receta de un semiarco sale cortada, con el mismo corte que la del plan (`armado_estructura`, forma
    # lista `FORMA_SEMIARCO`). Antes esta ruta devolvía el arco completo (corte 1) y el editor la usa para
    # «Volver a la receta»: guardarla convertía el medio arco en un arco entero (2026-10-04, editor de armado).
    # Desde UI-1c (2026-10-05) el plan corta el medio arco sin inclinación leída en `CORTE_MEDIO_ARCO_FUERTE`,
    # por debajo del corte de la forma lista: la vista previa tiene que dar el mismo.
    corte_del_plan = min(
        float(next(f.forma["corte"] for f in FORMAS_LISTAS if f.id == FORMA_SEMIARCO)),
        CORTE_MEDIO_ARCO_FUERTE,
    )
    assert resultado["armado"]["forma"]["corte"] == corte_del_plan < 1
