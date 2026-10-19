"""La edición ``armado_arco_organico`` del plan: guardar el arco orgánico y el semiarco desde su editor.

El bloque del arco orgánico ya dibujaba el armado y su editor estaba montado, pero la tarjeta no ofrecía
«Editar arco» porque la acción no existía en ``plan_edicion.py``: un arco orgánico, un arco asimétrico y
**todo semiarco** (que es este armado con ``forma.corte`` menor que 1) se veían sin poder cambiarse. Gemelo de
``test_plan_edicion_armado_columna_organica.py``: fija o quita el armado, lo comprueba contra la pieza sin
catálogo con la puerta del motor y rechaza con ``armado_invalido`` lo que no se sostiene; reparto, mezcla y
propiedades no se editan en un arco armado; quitar un color revalida la paleta; y el plan editado se cuenta
con el motor.
"""

from __future__ import annotations

import asyncio
import copy
from collections.abc import Mapping
from typing import Any, cast

import pytest
from pydantic import TypeAdapter, ValidationError

from app.armado_arco_organico import EstructuraArcoOrganico, armado_resuelto
from app.plan import MERMA, PlanResolutionError
from app.plan_armado_arco_organico import (
    PlanArmadoArcoOrganicoRequest,
    vista_previa_armado_arco_organico,
)
from app.plan_edicion import (
    Edicion,
    LineaBase,
    LineasBaseEstructura,
    editar_plan,
)
from app.plan_edicion_arco_organico import (
    AVISO_COLOR_NUEVO,
    AVISO_COLORES,
    AVISO_PALETA_NUEVA,
)
from tests.guirnalda_datos import arco, guirnalda, material, plan, resolver
from tests.test_plan_edicion_armado_arco import ARMADO as ARMADO_CLASICO

ARCO = "EST_02_ARCO"
SEMIARCO = "EST_04_SEMIARCO"
_EDICION = TypeAdapter(Edicion)


def _arco(**extra: object) -> dict[str, object]:
    """Un arco orgánico dorado y blanco: los colores que el catálogo de prueba vende (R5 a R24)."""
    return arco(
        estructura_oficial="arco_asimetrico",
        materiales=[material("dorado", 0.5, principal=True), material("blanco", 0.5)],
        **extra,
    )


def _semiarco(**extra: object) -> dict[str, object]:
    return {
        **_arco(),
        "estructura_id": SEMIARCO,
        "nombre": "Semiarco",
        "tipo": "semiarco",
        "estructura_oficial": "semiarco",
        "ubicacion": "lateral_izquierdo",
        "medidas": {"ancho_m": 1.5, "alto_m": 2.2},
        **extra,
    }


def _receta(pieza: Mapping[str, object]) -> dict[str, Any]:
    """La receta del motor para la pieza, como la que abre el editor."""
    peticion = PlanArmadoArcoOrganicoRequest.model_validate(
        {
            "context": {
                "schema_version": "operational.v1",
                "request_id": "00000000-0000-4000-8000-000000000e01",
                "correlation_id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
                "deadline_at": "2030-01-01T00:00:00Z",
                "deadline_ms": 5000,
                "scopes": ["plan.armado_arco_organico"],
                "body_sha256": "a" * 64,
            },
            "schema_version": "plan-armado-arco-organico.v1",
            "plan": plan(dict(pieza)),
            "estructura_id": pieza["estructura_id"],
            "armado_arco_organico": None,
            "colores": ["#d4af37", "#ffffff"],
        }
    )
    vista = cast(dict[str, Any], vista_previa_armado_arco_organico(peticion))
    return {**cast(dict[str, Any], vista["armado"]), "origen": "decorador"}


ARMADO = _receta(_arco())


def _dos_colores(armado: Mapping[str, Any]) -> dict[str, Any]:
    """El armado con la paleta de los dos colores de la pieza (0 y 1)."""
    paleta = cast(list[dict[str, Any]], armado["colores"]["paleta"])
    base = paleta[0]
    return {
        **armado,
        "colores": {
            **armado["colores"],
            "paleta": [{**base, "material": 0}, {**base, "material": 1}],
        },
    }


def _edicion(armado: Mapping[str, object] | None, estructura_id: str = ARCO) -> Edicion:
    return _EDICION.validate_python(
        {
            "accion": "armado_arco_organico",
            "estructura_id": estructura_id,
            "armado_arco_organico": armado,
        }
    )


def _pieza(plan_: Mapping[str, object], estructura_id: str) -> dict[str, Any]:
    return next(
        cast(dict[str, Any], item)
        for item in cast(list[dict[str, Any]], plan_["estructuras"])
        if item["estructura_id"] == estructura_id
    )


# --- Fijar y quitar -----------------------------------------------------------------------


def test_fijar_un_armado_lo_escribe_en_la_pieza_y_no_toca_las_demas() -> None:
    base = plan(_arco(), guirnalda())
    otra = copy.deepcopy(_pieza(base, "EST_01_GUIRNALDA"))

    editado = editar_plan(base, _edicion(ARMADO)).plan

    assert _pieza(editado, ARCO)["armado_arco_organico"] == ARMADO
    assert _pieza(editado, "EST_01_GUIRNALDA") == otra


def test_quitar_el_armado_devuelve_la_pieza_al_camino_de_siempre() -> None:
    con = editar_plan(plan(_arco()), _edicion(ARMADO)).plan

    sin = editar_plan(con, _edicion(None)).plan

    assert "armado_arco_organico" not in _pieza(sin, ARCO)


def test_un_semiarco_se_guarda_por_la_misma_accion_y_queda_cortado() -> None:
    receta = _receta(_semiarco())
    assert receta["forma"]["corte"] < 1, "la receta de un semiarco ya viene cortada"
    otro = {**receta, "forma": {**receta["forma"], "espejo": not receta["forma"]["espejo"]}}

    editado = editar_plan(plan(_semiarco()), _edicion(otro, SEMIARCO)).plan

    assert _pieza(editado, SEMIARCO)["armado_arco_organico"] == otro


def test_las_medidas_de_la_pieza_las_pone_el_motor() -> None:
    grande = {**ARMADO, "forma": {**ARMADO["forma"], "anchoM": 4.2}}

    editado = editar_plan(plan(_arco()), _edicion(grande)).plan

    motor = armado_resuelto(EstructuraArcoOrganico(True, ["#000001", "#000002"]), grande, MERMA)
    medidas = _pieza(editado, ARCO)["medidas"]
    assert medidas["ancho_m"] == round(motor["ancho_m"], 2)
    assert medidas["alto_m"] == round(motor["alto_m"], 2)


def test_una_pieza_que_no_es_arco_se_rechaza_con_la_frase_del_motor() -> None:
    with pytest.raises(PlanResolutionError) as caso:
        editar_plan(plan(_arco(), guirnalda()), _edicion(ARMADO, "EST_01_GUIRNALDA"))

    assert (caso.value.code, caso.value.status_code) == ("armado_invalido", 422)
    assert cast(Mapping[str, str], caso.value.details)["motivo"] == "no_es_arco"


def test_un_aro_circular_no_se_arma_con_este_motor() -> None:
    aro = {**_arco(), "estructura_oficial": "aro_circular"}

    with pytest.raises(PlanResolutionError) as caso:
        editar_plan(plan(aro), _edicion(ARMADO))

    assert cast(Mapping[str, str], caso.value.details)["motivo"] == "no_es_arco"


def test_un_color_que_la_pieza_no_lleva_se_rechaza() -> None:
    paleta = cast(list[dict[str, Any]], ARMADO["colores"]["paleta"])
    malo = {
        **ARMADO,
        "colores": {**ARMADO["colores"], "paleta": [{**paleta[0], "material": 5}]},
    }

    with pytest.raises(PlanResolutionError) as caso:
        editar_plan(plan(_arco()), _edicion(malo))

    assert cast(Mapping[str, str], caso.value.details)["motivo"] == "material_fuera_de_rango"


def test_la_forma_del_armado_se_exige_en_la_frontera() -> None:
    with pytest.raises(ValidationError):
        _edicion({**ARMADO, "forma": {**ARMADO["forma"], "corte": 0.1}})


def test_encima_del_arco_clasico_no_se_pone_y_quitarlo_siempre_se_puede() -> None:
    con_clasico = plan(_arco(armado_arco=copy.deepcopy(ARMADO_CLASICO)))

    with pytest.raises(PlanResolutionError) as caso:
        editar_plan(con_clasico, _edicion(ARMADO))

    assert (caso.value.code, caso.value.status_code) == ("armado_arco_presente", 409)
    # Quitar el orgánico siempre se puede, y en un semiarco el clásico no estorba: ahí no cuenta nunca.
    assert editar_plan(con_clasico, _edicion(None)).plan
    semi = plan(_semiarco(armado_arco=copy.deepcopy(ARMADO_CLASICO)))
    receta = _receta(_semiarco())
    assert _pieza(editar_plan(semi, _edicion(receta, SEMIARCO)).plan, SEMIARCO)[
        "armado_arco_organico"
    ]


# --- Lo que el armado impide y lo que revisa --------------------------------------------------


def test_con_armado_el_reparto_la_mezcla_y_las_propiedades_no_se_editan() -> None:
    con_armado = editar_plan(plan(_arco()), _edicion(ARMADO)).plan
    ediciones = [
        {"accion": "repartir", "estructura_id": ARCO, "participaciones": [0.7, 0.3]},
        {"accion": "mezcla", "estructura_id": ARCO, "mezcla": "clasica"},
        {"accion": "propiedades", "estructura_id": ARCO, "densidad": "lujosa"},
        {"accion": "propiedades", "estructura_id": ARCO, "medidas": {"ancho_m": 5}},
    ]

    for cruda in ediciones:
        with pytest.raises(PlanResolutionError) as caso:
            editar_plan(con_armado, _EDICION.validate_python(cruda))
        assert (caso.value.code, caso.value.status_code) == ("armado_arco_organico_activo", 409)


def _quitar(plan_: Mapping[str, object], color: str) -> Edicion:
    return _EDICION.validate_python(
        {"accion": "quitar", "estructura_id": ARCO, "objetivo_variant_id": f"var-{color}-12"}
    )


def _lineas_base() -> list[LineasBaseEstructura]:
    return [
        LineasBaseEstructura(
            estructura_id=ARCO,
            lineas=[
                LineaBase(product_id=f"prod-{c}", variant_id=f"var-{c}-12", color=c)
                for c in ("dorado", "blanco")
            ],
        )
    ]


def test_quitar_un_color_corre_los_indices_de_la_paleta_y_lo_avisa() -> None:
    con_armado = editar_plan(plan(_arco()), _edicion(_dos_colores(ARMADO))).plan

    editado = editar_plan(con_armado, _quitar(con_armado, "dorado"), _lineas_base())

    paleta = _pieza(editado.plan, ARCO)["armado_arco_organico"]["colores"]["paleta"]
    assert [color["material"] for color in paleta] == [0]
    assert AVISO_COLORES in editado.avisos


def test_quitar_el_unico_color_de_la_paleta_la_deja_con_el_primero_de_la_pieza() -> None:
    solo_blanco = {
        **ARMADO,
        "colores": {
            **ARMADO["colores"],
            "paleta": [{**ARMADO["colores"]["paleta"][0], "material": 1}],
        },
    }
    con_armado = editar_plan(plan(_arco()), _edicion(solo_blanco)).plan

    editado = editar_plan(con_armado, _quitar(con_armado, "blanco"), _lineas_base())

    paleta = _pieza(editado.plan, ARCO)["armado_arco_organico"]["colores"]["paleta"]
    assert [color["material"] for color in paleta] == [0]
    assert AVISO_PALETA_NUEVA in editado.avisos


def test_agregar_un_color_conserva_el_armado_y_lo_avisa() -> None:
    con_armado = editar_plan(plan(_arco()), _edicion(_dos_colores(ARMADO))).plan
    agregar = _EDICION.validate_python(
        {
            "accion": "agregar",
            "estructura_id": ARCO,
            "variante": {"product_id": "prod-rosado", "variant_id": "var-rosado-12"},
        }
    )

    editado = editar_plan(con_armado, agregar, _lineas_base(), ["rosado"])

    assert _pieza(editado.plan, ARCO)["armado_arco_organico"] == _dos_colores(ARMADO)
    assert AVISO_COLOR_NUEVO in editado.avisos


# --- El plan editado se cuenta con el motor ---------------------------------------------------


def test_el_plan_editado_se_resuelve_con_el_conteo_del_motor_y_cambia_la_firma() -> None:
    base = plan(_arco())
    antes = cast(dict[str, Any], asyncio.run(resolver(base)))
    grande = {**_dos_colores(ARMADO), "forma": {**ARMADO["forma"], "anchoM": 4.2}}

    editado = editar_plan(base, _edicion(grande)).plan
    despues = cast(dict[str, Any], asyncio.run(resolver(editado)))

    assert despues["plan_hash"] != antes["plan_hash"], "es otra decoración: cambia la firma"
    resuelta = despues["armados_arco_organico"][0]
    conteo = sum(linea["cantidad"] for linea in resuelta["conteo"])
    assert despues["estructuras"][0]["total_unidades"] == conteo, "cuenta el motor"
