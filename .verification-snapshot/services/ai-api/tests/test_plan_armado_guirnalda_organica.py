"""Vista previa de la guirnalda orgánica, con su dibujo (ADR-0034).

``POST /internal/v1/plan/armado-guirnalda-organica`` resuelve el armado que
manda el editor, o da la receta de la pieza con
``armado_guirnalda_organica: null``, y devuelve la guirnalda resuelta y el SVG
que emite el mismo motor que colocó los globos. Sin catálogo y sin efectos: el
plan dice qué pieza es y ``colores`` solo la pintan.

**Convive con ``/internal/v1/plan/armado-guirnalda``** (ADR-0032: racimos,
relleno y remates), que no se toca: hay una prueba de que las dos rutas
responden sobre la misma pieza sin estorbarse.

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
from app.plan import PlanResolutionError
from app.plan_armado_guirnalda_organica import (
    ACABADO_POR_DEFECTO,
    AVISO_SIN_COLORES,
    ROL_POR_DEFECTO,
    PlanArmadoGuirnaldaOrganicaRequest,
    vista_previa_armado_guirnalda_organica,
)
from tests.guirnalda_datos import arco, guirnalda, material, plan

SECRET = "w" * 32
GUIRNALDA = "EST_01_GUIRNALDA"
ARCO = "EST_02_ARCO"
RUTA = "/internal/v1/plan/armado-guirnalda-organica"
SCOPE = "plan.armado_guirnalda_organica"
# Rosado y blanco: los tonos Sempertex de los dos materiales de la guirnalda de prueba.
COLORES = ["#f8a3bc", "#ffffff"]
CONTEXTO = {
    "schema_version": "operational.v1",
    "request_id": "00000000-0000-4000-8000-000000000f00",
    "correlation_id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
    "deadline_at": "2030-01-01T00:00:00Z",
    "deadline_ms": 5000,
    "scopes": [SCOPE],
}


def _operacion(
    armado: Mapping[str, object] | None,
    *,
    estructura_id: str = GUIRNALDA,
    estructuras: tuple[dict[str, object], ...] | None = None,
    **extra: object,
) -> dict[str, object]:
    piezas = estructuras if estructuras is not None else (guirnalda(),)
    return {
        "schema_version": "plan-armado-guirnalda-organica.v1",
        "plan": plan(*piezas),
        "estructura_id": estructura_id,
        "armado_guirnalda_organica": None if armado is None else dict(armado),
        "colores": COLORES,
        **extra,
    }


def _peticion(
    armado: Mapping[str, object] | None, **extra: object
) -> PlanArmadoGuirnaldaOrganicaRequest:
    return PlanArmadoGuirnaldaOrganicaRequest.model_validate(
        {"context": {**CONTEXTO, "body_sha256": "a" * 64}, **_operacion(armado, **extra)}
    )


def _receta_de(armado: Mapping[str, object] | None = None, **extra: object) -> dict[str, object]:
    """El armado con el que Python resolvió la pieza (la receta, si no se le dio uno)."""
    return cast(
        dict[str, object],
        vista_previa_armado_guirnalda_organica(_peticion(armado, **extra))["armado"],
    )


# --- La vista previa ---------------------------------------------------------------


def test_sin_armado_devuelve_la_receta_con_el_largo_y_la_paleta_de_la_pieza() -> None:
    resultado = vista_previa_armado_guirnalda_organica(_peticion(None))

    armado = cast(dict[str, object], resultado["armado"])
    forma = cast(dict[str, object], armado["forma"])
    colores = cast(dict[str, object], armado["colores"])
    paleta = cast(list[dict[str, object]], colores["paleta"])
    assert resultado["operation_schema_version"] == "plan-armado-guirnalda-organica-result.v1"
    assert armado["origen"] == "sugerido"
    # El largo es el del plan (2,5 m), no el de la guirnalda de referencia del motor (3 m).
    assert forma["largoM"] == 2.5
    # `espejo` es un mando interno del motor: la receta no lo escribe (el contrato es estricto).
    assert "espejo" not in forma
    # Un color por material de la pieza, en su orden, con su participación como peso (0,6 y 0,4).
    assert [c["material"] for c in paleta] == [0, 1]
    assert [c["peso"] for c in paleta] == [60, 40]
    assert {c["acabado"] for c in paleta} == {ACABADO_POR_DEFECTO}
    assert {c["rol"] for c in paleta} == {ROL_POR_DEFECTO}
    # La mezcla de tamaños va con la pulgada en texto y sin los tamaños que no se usan.
    mezcla = cast(dict[str, float], cast(dict[str, object], armado["tamanos"])["mezcla"])
    assert set(mezcla) == {"5", "12", "18", "24"} and all(peso > 0 for peso in mezcla.values())


def test_la_receta_resuelve_una_guirnalda_con_globos_y_con_svg() -> None:
    resultado = vista_previa_armado_guirnalda_organica(_peticion(None))

    tira = cast(dict[str, object], resultado["guirnalda"])
    globos = cast(list[dict[str, object]], tira["globos"])
    grafica = cast(dict[str, object], resultado["grafica"])
    assert tira["version"] == "armado-guirnalda-organica.v1"
    assert len(globos) > 0, "el motor coloca cada globo de la tira"
    assert all(globo["material"] in (0, 1) for globo in globos)
    assert cast(int, tira["capas"]) >= 1
    # Con el motor bien puesto ningún globo queda sin tocar a otro.
    assert tira["sueltos"] == 0
    assert sum(
        cast(int, linea["cantidad"]) for linea in cast(list[dict[str, object]], tira["conteo"])
    ) == len(globos)
    assert cast(int, tira["total_comprar"]) >= len(globos), "la compra lleva desperdicio"
    assert tira["largo_m"] > 0 and tira["grosor_centro_m"] > 0
    # La compra va por material y tamaño, con la pulgada en texto (la clave del contrato).
    for fila in cast(list[dict[str, object]], tira["compra"]):
        por_tamano = cast(dict[str, int], fila["por_tamano"])
        assert por_tamano and all(isinstance(clave, str) for clave in por_tamano)
        assert sum(por_tamano.values()) == fila["cantidad"]
    # El dibujo lo emite el mismo motor: la gráfica no recalcula nada, y su lienzo no es cuadrado.
    assert (grafica["ancho"], grafica["alto"]) == (760, 440)
    # Un globo se pinta con varias elipses (cuerpo, brillo y sombra), así que esto es el suelo de
    # «todos los globos se dibujaron», no su número exacto.
    assert cast(str, grafica["svg"]).count("<ellipse") >= len(globos)
    # Derivado: el SVG sale por esta ruta y nunca dentro de la guirnalda del plan resuelto.
    assert "grafica" not in tira and "svg" not in tira


def test_los_globos_vienen_en_metros_y_el_svg_los_escala() -> None:
    """Las posiciones son las del mundo del motor (metros), no píxeles del lienzo.

    Queda escrito en una prueba porque importa para quien dibuje: el lienzo mide 760 × 440 y un globo
    cae en 1,98 × 2,57 con radio 0,16. El SVG que emite el motor ya viene escalado a su lienzo, así
    que el cliente lo muestra y no vuelve a convertir nada. Si algún día el motor pasara a devolver
    píxeles, esto lo avisa.
    """
    resultado = vista_previa_armado_guirnalda_organica(_peticion(None))

    tira = cast(dict[str, object], resultado["guirnalda"])
    globos = cast(list[dict[str, float]], tira["globos"])
    ancho_m = cast(float, tira["ancho_m"])
    assert ancho_m < cast(int, cast(dict[str, object], resultado["grafica"])["ancho"])
    # Holgado: los salientes se escapan de la banda, pero nada se va a la escala del lienzo.
    assert all(abs(globo["x"]) <= 2 * ancho_m for globo in globos)
    assert all(0 < globo["r"] <= ancho_m for globo in globos)


def test_devuelve_las_herramientas_del_motor_y_los_rangos_vivos() -> None:
    resultado = vista_previa_armado_guirnalda_organica(_peticion(None))

    opciones = cast(dict[str, object], resultado["opciones"])
    limites = cast(dict[str, float], resultado["limites"])
    assert [a["valor"] for a in cast(list[dict[str, object]], opciones["acabados"])] == [
        "mate",
        "cromado",
        "confeti",
        "transparente",
    ]
    assert [r["valor"] for r in cast(list[dict[str, object]], opciones["repartos"])] == [
        "azar",
        "tramos",
        "racimos",
    ]
    assert opciones["roles"] == ["normal", "acento"]
    assert {"tamanos", "largo_m", "grosor_m", "altura_m", "max_materiales"} <= set(opciones)
    # Con este armado puesto: el largo mínimo sube con el grosor de la banda.
    assert limites["largoMin"] <= 2.5 <= limites["largoMax"]
    assert limites["grosorCentroMin"] <= 0.62 <= limites["grosorCentroMax"]


def test_un_armado_dado_se_resuelve_tal_cual() -> None:
    receta = _receta_de()
    dado = {**receta, "origen": "decorador"}
    dado["colores"] = {
        **cast(dict[str, object], receta["colores"]),
        "reparto": "racimos",
        "mezcla": 0.2,
    }

    resultado = vista_previa_armado_guirnalda_organica(_peticion(dado))

    assert resultado["armado"] == dado, "un borrador vuelve tal como se dio"
    assert len(cast(list[object], cast(dict[str, object], resultado["guirnalda"])["globos"])) > 0


def test_el_acabado_del_plan_se_respeta_cuando_el_motor_lo_conoce() -> None:
    # «cromado» es uno de los acabados del motor; «perlado» es del catálogo y aquí no se traduce.
    pieza = guirnalda(
        materiales=[
            {**material("dorado", 0.5, principal=True), "acabado": "cromado"},
            {**material("rosado", 0.5), "acabado": "perlado"},
        ]
    )

    paleta = cast(
        list[dict[str, object]],
        cast(dict[str, object], _receta_de(estructuras=(pieza,))["colores"])["paleta"],
    )

    assert [c["acabado"] for c in paleta] == ["cromado", ACABADO_POR_DEFECTO]


def test_sin_los_tonos_resueltos_el_dibujo_lo_avisa() -> None:
    # Un plan nombra el color en palabras («rosado»), que sin catálogo no es un tono.
    peticion = PlanArmadoGuirnaldaOrganicaRequest.model_validate(
        {
            "context": {**CONTEXTO, "body_sha256": "a" * 64},
            "schema_version": "plan-armado-guirnalda-organica.v1",
            "plan": plan(guirnalda()),
            "estructura_id": GUIRNALDA,
            "armado_guirnalda_organica": None,
        }
    )

    tira = cast(dict[str, object], vista_previa_armado_guirnalda_organica(peticion)["guirnalda"])

    assert AVISO_SIN_COLORES in cast(list[str], tira["avisos"])


def test_la_compra_de_la_vista_previa_es_la_que_cobra_el_plan() -> None:
    """Lo que la vista previa dice que hay que comprar es lo que el plan cobra: el mismo margen (`MERMA`).

    La vista previa usaba el margen del diseñador (12 %) y el plan compra con el suyo (8 %): el editor mostraba
    una lista de compra que la resolución nunca iba a cobrar.
    """
    from app.plan import _resolver_con_el_motor  # noqa: PLC0415 - privado a propósito: es la puerta de la resolución

    armado = _receta_de()
    pieza = guirnalda()
    vista = cast(
        dict[str, object], vista_previa_armado_guirnalda_organica(_peticion(armado))["guirnalda"]
    )
    del_plan = _resolver_con_el_motor("guirnalda", armado, pieza)

    assert vista["compra"] == del_plan["compra"]
    assert vista["total_comprar"] == del_plan["total_comprar"]


def test_un_color_de_la_pieza_que_la_paleta_no_toma_se_avisa_antes_de_guardar() -> None:
    receta = _receta_de()
    colores = cast(dict[str, object], receta["colores"])
    solo_el_primero = {
        **receta,
        "colores": {**colores, "paleta": cast(list[object], colores["paleta"])[:1]},
    }

    avisos = cast(
        list[str],
        cast(
            dict[str, object],
            vista_previa_armado_guirnalda_organica(_peticion(solo_el_primero))["guirnalda"],
        )["avisos"],
    )

    assert any("no usa el color" in aviso and "no se comprarán" in aviso for aviso in avisos), (
        avisos
    )
    # Una paleta que toma los dos colores de la pieza no avisa nada de eso.
    completos = cast(
        list[str],
        cast(
            dict[str, object],
            vista_previa_armado_guirnalda_organica(_peticion(receta))["guirnalda"],
        )["avisos"],
    )
    assert not any("no usa el color" in aviso for aviso in completos), completos


# --- Los rechazos ------------------------------------------------------------------


def test_un_armado_invalido_responde_con_motivo_y_mensaje() -> None:
    # Una mezcla de tamaños toda en cero no dice de qué tamaño son los globos.
    receta = _receta_de()
    malo = {
        **receta,
        "tamanos": {**cast(dict[str, object], receta["tamanos"]), "mezcla": {"12": 0}},
    }

    with pytest.raises(PlanResolutionError) as error:
        vista_previa_armado_guirnalda_organica(_peticion(malo))

    detalles = error.value.details or {}
    assert (error.value.code, error.value.status_code) == ("armado_invalido", 422)
    assert (detalles["estructura_id"], detalles["motivo"]) == (GUIRNALDA, "sin_mezcla")
    assert "tamanos" in str(detalles["mensaje"]), "la frase es la de Python, para el decorador"


def test_una_pieza_que_no_es_una_guirnalda_no_se_arma_asi() -> None:
    with pytest.raises(PlanResolutionError) as error:
        vista_previa_armado_guirnalda_organica(
            _peticion(
                None,
                estructura_id=ARCO,
                estructuras=(guirnalda(), arco()),
                colores=["#d4af37"],
            )
        )

    assert (error.value.details or {})["motivo"] == "no_es_guirnalda"


def test_un_color_que_la_pieza_no_lleva_se_rechaza() -> None:
    receta = _receta_de()
    colores = cast(dict[str, object], receta["colores"])
    paleta = cast(list[dict[str, object]], colores["paleta"])
    fuera = {
        **receta,
        "colores": {**colores, "paleta": [paleta[0], {**paleta[1], "material": 5}]},
    }

    with pytest.raises(PlanResolutionError) as error:
        vista_previa_armado_guirnalda_organica(_peticion(fuera))

    assert (error.value.details or {})["motivo"] == "material_fuera_de_rango"


def test_una_estructura_desconocida_responde_404() -> None:
    with pytest.raises(PlanResolutionError) as error:
        vista_previa_armado_guirnalda_organica(_peticion(None, estructura_id="EST_09_OTRA"))

    assert (error.value.code, error.value.status_code) == ("estructura_no_encontrada", 404)


def test_un_plan_que_no_cumple_el_contrato_responde_422() -> None:
    with pytest.raises(PlanResolutionError) as error:
        vista_previa_armado_guirnalda_organica(_peticion(None, plan={"plan_version": "1.0"}))

    assert (error.value.code, error.value.status_code) == ("invalid_plan", 422)


def test_la_forma_del_armado_se_exige_en_la_frontera() -> None:
    with pytest.raises(ValidationError):
        _peticion({"version": "otra"})


def test_un_color_que_no_es_hexadecimal_se_rechaza_en_la_frontera() -> None:
    with pytest.raises(ValidationError):
        _peticion(None, colores=["rosado", "#ffffff"])


# --- El endpoint -------------------------------------------------------------------


def _post(
    operation: Mapping[str, object],
    nonce: str,
    *,
    scope: str = SCOPE,
    ruta: str = RUTA,
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
            path=ruta,
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
        response = client.post(ruta, content=body, headers=headers)
    return response.status_code, cast(dict[str, object], response.json())


def test_el_endpoint_devuelve_una_guirnalda_resuelta_con_globos_y_con_svg() -> None:
    status, body = _post(_operacion(None), "00000000-0000-4000-8000-000000000f01")

    assert status == 200
    payload = cast(dict[str, object], body["payload"])
    tira = cast(dict[str, object], payload["guirnalda"])
    grafica = cast(dict[str, object], payload["grafica"])
    assert payload["operation_schema_version"] == "plan-armado-guirnalda-organica-result.v1"
    assert len(cast(list[object], tira["globos"])) > 0
    assert cast(str, grafica["svg"]).startswith("<")
    assert set(grafica) == {"ancho", "alto", "svg"}, "el lienzo no es cuadrado y no lleva documento"
    assert cast(dict[str, object], payload["armado"])["origen"] == "sugerido"
    assert "acabados" in cast(dict[str, object], payload["opciones"])
    assert "largoMin" in cast(dict[str, object], payload["limites"])


def test_el_endpoint_responde_422_con_motivo_cuando_el_armado_no_se_sostiene() -> None:
    receta = _receta_de()
    malo = {
        **receta,
        "tamanos": {**cast(dict[str, object], receta["tamanos"]), "mezcla": {"12": 0}},
    }
    status, body = _post(_operacion(malo), "00000000-0000-4000-8000-000000000f02")

    detail = cast(dict[str, object], body["detail"])
    assert (status, detail["code"]) == (422, "armado_invalido")
    assert (detail["estructura_id"], detail["motivo"]) == (GUIRNALDA, "sin_mezcla")


def test_el_endpoint_exige_su_propio_scope() -> None:
    # El de la guirnalda por racimos (ADR-0032) no abre esta ruta.
    status, _ = _post(
        _operacion(None), "00000000-0000-4000-8000-000000000f03", scope="plan.armado_guirnalda"
    )

    assert status == 403


def test_la_ruta_por_racimos_sigue_viva_y_es_otra() -> None:
    """ADR-0032 y ADR-0034 conviven sobre la misma pieza: dos rutas, dos scopes, dos contratos."""
    organica, cuerpo_organica = _post(_operacion(None), "00000000-0000-4000-8000-000000000f04")
    racimos, cuerpo_racimos = _post(
        {
            "schema_version": "plan-armado-guirnalda.v1",
            "plan": plan(guirnalda()),
            "estructura_id": GUIRNALDA,
            "armado_guirnalda": None,
        },
        "00000000-0000-4000-8000-000000000f05",
        scope="plan.armado_guirnalda",
        ruta="/internal/v1/plan/armado-guirnalda",
    )

    assert (organica, racimos) == (200, 200)
    assert (
        cast(dict[str, object], cuerpo_organica["payload"])["operation_schema_version"]
        == "plan-armado-guirnalda-organica-result.v1"
    )
    assert (
        cast(dict[str, object], cuerpo_racimos["payload"])["operation_schema_version"]
        == "plan-armado-guirnalda-result.v1"
    )
