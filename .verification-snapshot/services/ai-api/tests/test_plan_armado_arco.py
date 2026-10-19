"""Vista previa del armado de arcos, con su dibujo (ADR-0034).

``POST /internal/v1/plan/armado-arco`` resuelve el armado que manda el editor,
o da la receta de la pieza con ``armado_arco: null``, y devuelve el arco
resuelto y el SVG que emite el mismo motor que colocó los globos. Sin catálogo
y sin efectos: el plan dice qué pieza es y ``colores`` solo la pintan.

Se prueba por el endpoint de verdad (firma HMAC, contexto operacional,
``TestClient``) y no solo por la función, porque lo que esta entrega monta es
el transporte: el scope, el contrato local de la petición y la traducción de
``ArmadoInvalido`` a un error de cliente con ``motivo`` y ``mensaje``.
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
from app.plan import PlanResolutionError, armado_arco_de_patron, pieza_del_motor_resuelta
from app.plan_armado_arco import (
    AVISO_SIN_COLORES,
    PATRON_UN_COLOR,
    PlanArmadoArcoRequest,
    vista_previa_armado_arco,
)
from tests.guirnalda_datos import arco, guirnalda, material, plan

SECRET = "w" * 32
ARCO = "EST_02_ARCO"
GUIRNALDA = "EST_01_GUIRNALDA"
RUTA = "/internal/v1/plan/armado-arco"
SCOPE = "plan.armado_arco"
# Azul y blanco: los dos tonos con los que el motor abre su espiral de referencia.
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
        "schema_version": "plan-armado-arco.v1",
        "plan": plan(*piezas),
        "estructura_id": estructura_id,
        "armado_arco": None if armado is None else dict(armado),
        "colores": COLORES,
        **extra,
    }


def _peticion(armado: Mapping[str, object] | None, **extra: object) -> PlanArmadoArcoRequest:
    return PlanArmadoArcoRequest.model_validate(
        {"context": {**CONTEXTO, "body_sha256": "a" * 64}, **_operacion(armado, **extra)}
    )


def _receta_de(armado: Mapping[str, object] | None = None) -> dict[str, object]:
    """El armado con el que Python resolvió la pieza (la receta, si no se le dio uno)."""
    return cast(dict[str, object], vista_previa_armado_arco(_peticion(armado))["armado"])


# --- La vista previa ---------------------------------------------------------------


def test_sin_armado_devuelve_la_receta_con_la_geometria_de_la_pieza() -> None:
    resultado = vista_previa_armado_arco(_peticion(None))

    armado = cast(dict[str, object], resultado["armado"])
    geometria = cast(dict[str, object], armado["geometria"])
    assert resultado["operation_schema_version"] == "plan-armado-arco-result.v1"
    assert (armado["origen"], armado["patron"]) == ("sugerido", "espiral")
    # El ancho y el alto son los del plan (3 × 2,4 m), no los de la imagen de referencia del motor.
    assert (geometria["anchoM"], geometria["altoM"]) == (3.0, 2.4)
    # Los dos colores de la pieza, en su orden.
    assert armado["materiales"] == [0, 1]


def test_un_arco_de_patron_arranca_de_la_receta_de_su_patron() -> None:
    """Con patrón de color, el editor arranca de la receta del patrón: la que la confirmación escribe.

    Sin armado guardado la resolución cobra el arco con la fórmula y la rejilla del patrón (decisión del dueño
    del 2026-10-05); con esa receta guardada, la cuenta y la cotiza el motor con los mismos globos que el editor.
    """
    patron = {
        "version": "patron-color.v1",
        "origen": "decorador",
        "base": {"modo": "anillos", "secuencia": [1, 0], "largo": 1},
    }
    pieza = _arco_dos_colores(mezcla="clasica", patron_color=patron)
    receta = armado_arco_de_patron(pieza)
    assert receta is not None
    assert pieza_del_motor_resuelta(pieza) is None
    cotizado = pieza_del_motor_resuelta({**pieza, "armado_arco": receta})
    assert cotizado is not None

    for guardado in (None, receta):
        # También al pedir la receta de un arco que ya trae su armado guardado.
        con_armado = pieza if guardado is None else {**pieza, "armado_arco": guardado}
        resultado = vista_previa_armado_arco(_peticion(None, estructuras=(con_armado,)))
        assert resultado["armado"] == armado_arco_de_patron(pieza)
        globos = cast(list[object], cast(dict[str, object], resultado["arco"])["globos"])
        assert len(globos) == len(cast(list[object], cotizado[1]["globos"]))


def test_la_receta_resuelve_un_arco_con_globos_y_con_svg() -> None:
    resultado = vista_previa_armado_arco(_peticion(None))

    arco_resuelto = cast(dict[str, object], resultado["arco"])
    globos = cast(list[dict[str, object]], arco_resuelto["globos"])
    grafica = cast(dict[str, object], resultado["grafica"])
    assert arco_resuelto["version"] == "armado-arco.v1"
    assert len(globos) > 0, "el motor coloca cada globo del arco"
    # Cada globo apunta a un material de la pieza y a su sitio en la banda.
    assert all(globo["material"] in (0, 1) for globo in globos)
    assert cast(int, arco_resuelto["total_comprar"]) >= len(globos), "la compra lleva desperdicio"
    assert sum(
        cast(int, linea["cantidad"])
        for linea in cast(list[dict[str, object]], arco_resuelto["conteo"])
    ) == len(globos)
    assert arco_resuelto["ancho_m"] > 0 and arco_resuelto["largo_m"] > 0
    # El dibujo lo emite el mismo motor: la gráfica no recalcula nada.
    assert cast(int, grafica["lienzo"]) > 0
    assert cast(str, grafica["svg"]).count("<g ") >= len(globos)
    # Derivado: el SVG sale por esta ruta y nunca dentro del arco que viaja en el plan resuelto.
    assert "grafica" not in arco_resuelto and "svg" not in arco_resuelto


def test_devuelve_las_herramientas_del_motor_y_los_rangos_vivos() -> None:
    resultado = vista_previa_armado_arco(_peticion(None))

    opciones = cast(dict[str, object], resultado["opciones"])
    limites = cast(dict[str, float], resultado["limites"])
    patrones = cast(list[dict[str, object]], opciones["patrones"])
    assert len(patrones) == 14, "los catorce patrones del diseñador"
    assert {"formas", "tamanos", "ancho_m", "alto_m", "max_materiales"} <= set(opciones)
    espiral = next(p for p in patrones if p["id"] == "espiral")
    assert (espiral["min_colores"], espiral["max_colores"]) == (2, 4)
    assert [c["clave"] for c in cast(list[dict[str, object]], espiral["controles"])] == [
        "ancho",
        "inclinacion",
        "inversion",
        "espejo",
    ]
    # Con este armado puesto: el ancho mínimo sube con el globo y los globos a lo ancho.
    assert limites["anchoMin"] <= 3.0 <= limites["anchoMax"]
    assert limites["altoMin"] <= 2.4 <= limites["altoMax"]


def test_un_armado_dado_se_resuelve_tal_cual() -> None:
    receta = _receta_de()
    dado = {**receta, "origen": "decorador", "patron": "apilado"}

    resultado = vista_previa_armado_arco(_peticion(dado))

    assert resultado["armado"] == dado, "un borrador vuelve tal como se dio"
    assert len(cast(list[object], cast(dict[str, object], resultado["arco"])["globos"])) > 0


def test_una_pieza_de_un_color_recibe_un_arco_solido() -> None:
    # `arco()` trae un solo material (dorado): la espiral no cabe y la receta baja a sólido.
    resultado = vista_previa_armado_arco(
        _peticion(None, estructuras=(arco(),), colores=["#d4af37"])
    )

    armado = cast(dict[str, object], resultado["armado"])
    assert (armado["patron"], armado["materiales"]) == (PATRON_UN_COLOR, [0])
    assert armado["opciones"] == {}, "el sólido no tiene mandos propios"


def test_sin_los_tonos_resueltos_el_dibujo_lo_avisa() -> None:
    # Un plan nombra el color en palabras («azul»), que sin catálogo no es un tono.
    peticion = PlanArmadoArcoRequest.model_validate(
        {
            "context": {**CONTEXTO, "body_sha256": "a" * 64},
            "schema_version": "plan-armado-arco.v1",
            "plan": plan(_arco_dos_colores()),
            "estructura_id": ARCO,
            "armado_arco": None,
        }
    )

    arco_resuelto = cast(dict[str, object], vista_previa_armado_arco(peticion)["arco"])

    assert AVISO_SIN_COLORES in cast(list[str], arco_resuelto["avisos"])


# --- Los rechazos ------------------------------------------------------------------


def test_un_armado_invalido_responde_con_motivo_y_mensaje() -> None:
    # La espiral necesita dos colores; con uno no se puede armar.
    malo = {**_receta_de(), "materiales": [0]}

    with pytest.raises(PlanResolutionError) as error:
        vista_previa_armado_arco(_peticion(malo))

    detalles = error.value.details or {}
    assert (error.value.code, error.value.status_code) == ("armado_invalido", 422)
    assert (detalles["estructura_id"], detalles["motivo"]) == (ARCO, "pocos_materiales")
    assert "Espiral" in str(detalles["mensaje"]), "la frase es la de Python, para el decorador"


def _armado_gigante() -> dict[str, object]:
    """Globos R5 en 10 por 6 m con 8 a lo ancho: 1.613 globos, más de los que el contrato publica."""
    receta = _receta_de()
    return {
        **receta,
        "geometria": {
            **cast(dict[str, object], receta["geometria"]),
            "anchoM": 10,
            "altoM": 6,
            "globosAncho": 8,
        },
        "globo": {**cast(dict[str, object], receta["globo"]), "nominal": 5},
    }


def test_un_arco_con_mas_globos_de_los_permitidos_es_armado_invalido_no_un_500() -> None:
    with pytest.raises(PlanResolutionError) as error:
        vista_previa_armado_arco(_peticion(_armado_gigante()))

    detalles = error.value.details or {}
    assert (error.value.code, error.value.status_code) == ("armado_invalido", 422)
    assert (detalles["estructura_id"], detalles["motivo"]) == (ARCO, "demasiados_globos")
    mensaje = str(detalles["mensaje"])
    assert "1.200" in mensaje and "R5" in mensaje, "dice con qué globo y cuántos caben"
    assert "usa un globo más grande" in mensaje, "y qué hacer: lo calcula Python, no el cliente"


def test_el_endpoint_responde_422_y_no_500_con_un_arco_demasiado_grande() -> None:
    status, body = _post(_operacion(_armado_gigante()), "00000000-0000-4000-8000-000000000e04")

    detail = cast(dict[str, object], body["detail"])
    assert (status, detail["code"]) == (422, "armado_invalido")
    assert detail["motivo"] == "demasiados_globos"


def test_una_pieza_que_no_es_un_arco_no_se_arma_asi() -> None:
    with pytest.raises(PlanResolutionError) as error:
        vista_previa_armado_arco(
            _peticion(
                None,
                estructura_id=GUIRNALDA,
                estructuras=(guirnalda(), _arco_dos_colores()),
            )
        )

    assert (error.value.details or {})["motivo"] == "no_es_arco"


def test_un_color_que_la_pieza_no_lleva_se_rechaza() -> None:
    fuera = {**_receta_de(), "materiales": [0, 5]}

    with pytest.raises(PlanResolutionError) as error:
        vista_previa_armado_arco(_peticion(fuera))

    assert (error.value.details or {})["motivo"] == "material_fuera_de_rango"


def test_una_estructura_desconocida_responde_404() -> None:
    with pytest.raises(PlanResolutionError) as error:
        vista_previa_armado_arco(_peticion(None, estructura_id="EST_09_OTRA"))

    assert (error.value.code, error.value.status_code) == ("estructura_no_encontrada", 404)


def test_un_plan_que_no_cumple_el_contrato_responde_422() -> None:
    with pytest.raises(PlanResolutionError) as error:
        vista_previa_armado_arco(_peticion(None, plan={"plan_version": "1.0"}))

    assert (error.value.code, error.value.status_code) == ("invalid_plan", 422)


def test_la_forma_del_armado_se_exige_en_la_frontera() -> None:
    with pytest.raises(ValidationError):
        _peticion({"version": "otra"})


def test_un_color_que_no_es_hexadecimal_se_rechaza_en_la_frontera() -> None:
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
    payload = cast(dict[str, object], body["payload"])
    arco_resuelto = cast(dict[str, object], payload["arco"])
    grafica = cast(dict[str, object], payload["grafica"])
    assert payload["operation_schema_version"] == "plan-armado-arco-result.v1"
    assert len(cast(list[object], arco_resuelto["globos"])) > 0
    assert cast(str, grafica["svg"]).startswith("<")
    assert set(grafica) == {"lienzo", "svg"}, "solo lo que publica VistaArcoSchema"
    assert cast(dict[str, object], payload["armado"])["origen"] == "sugerido"
    assert "patrones" in cast(dict[str, object], payload["opciones"])
    assert "anchoMin" in cast(dict[str, object], payload["limites"])


def test_el_endpoint_responde_422_con_motivo_cuando_el_armado_no_se_sostiene() -> None:
    malo = {**_receta_de(), "materiales": [0]}
    status, body = _post(_operacion(malo), "00000000-0000-4000-8000-000000000e02")

    detail = cast(dict[str, object], body["detail"])
    assert (status, detail["code"]) == (422, "armado_invalido")
    assert (detail["estructura_id"], detail["motivo"]) == (ARCO, "pocos_materiales")


def test_el_endpoint_exige_su_propio_scope() -> None:
    status, _ = _post(
        _operacion(None), "00000000-0000-4000-8000-000000000e03", scope="plan.armado_guirnalda"
    )

    assert status == 403
