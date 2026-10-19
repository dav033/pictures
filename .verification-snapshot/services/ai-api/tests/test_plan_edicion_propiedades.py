"""La edición ``propiedades``: el editor de las piezas que ningún motor arma («Editar pared», «Editar aro»…).

Cambia en **una** edición lo que la fórmula de ``plan.py`` lee de la pieza —la densidad y las medidas— y la forma
elegida (``formas-pieza.ts``), así que la propuesta se re-resuelve y se firma una vez. Aquí se prueba que se
escribe lo que se pide y nada más, que la densidad es una de las que admite la oficial, que una pieza armada
por un motor no las cambia y que el plan editado cuenta con los campos nuevos (más densa nunca lleva menos
globos; más grande, tampoco).
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import Any, cast

import pytest
from pydantic import TypeAdapter, ValidationError

from app.plan import PlanResolutionError
from app.plan_edicion import Edicion, editar_plan
from tests.guirnalda_datos import arco, material, plan, resolver

PARED = "EST_03_PARED"
ARO = "EST_05_ARO"
_EDICION = TypeAdapter(Edicion)


def pared(**extra: object) -> dict[str, object]:
    return {
        "estructura_id": PARED,
        "nombre": "Pared de globos",
        "tipo": "pared",
        "estructura_oficial": "pared_densa",
        "rol_escena": "soporte",
        "ubicacion": "fondo_pared",
        "medidas": {"ancho_m": 2.0, "alto_m": 2.0},
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": "organica_fina",
        "materiales": [material("rosado", 0.6, principal=True), material("blanco", 0.4)],
        "porque": "Pared de prueba.",
        **extra,
    }


def aro(**extra: object) -> dict[str, object]:
    return {
        **arco(),
        "estructura_id": ARO,
        "nombre": "Aro",
        "estructura_oficial": "aro_circular",
        "medidas": {"ancho_m": 2.0, "alto_m": 2.0},
        **extra,
    }


def _edicion(estructura_id: str = PARED, **campos: object) -> Edicion:
    return _EDICION.validate_python(
        {"accion": "propiedades", "estructura_id": estructura_id, **campos}
    )


def _pieza(plan_: Mapping[str, object], estructura_id: str = PARED) -> dict[str, Any]:
    return next(
        cast(dict[str, Any], item)
        for item in cast(list[dict[str, Any]], plan_["estructuras"])
        if item["estructura_id"] == estructura_id
    )


def _total(plan_: Mapping[str, object], estructura_id: str = PARED) -> int:
    resuelto = cast(dict[str, Any], asyncio.run(resolver(plan_)))
    return int(
        next(
            e["total_unidades"]
            for e in resuelto["estructuras"]
            if e["estructura_id"] == estructura_id
        )
    )


def test_forma_densidad_y_medidas_en_una_sola_edicion() -> None:
    editado = editar_plan(
        plan(pared()),
        _edicion(forma="rombos", densidad="lujosa", medidas={"ancho_m": 3.0}),
    ).plan

    pieza = _pieza(editado)
    assert pieza["forma"] == "rombos"
    assert pieza["densidad"] == "lujosa"
    assert pieza["medidas"] == {"ancho_m": 3.0, "alto_m": 2.0}, "el alto que no vino se conserva"


def test_lo_que_no_viene_no_se_toca_y_forma_nula_la_quita() -> None:
    con_forma = editar_plan(plan(pared()), _edicion(forma="rombos")).plan
    assert _pieza(con_forma)["densidad"] == "media"

    sin_forma = editar_plan(con_forma, _edicion(forma=None)).plan

    assert "forma" not in _pieza(sin_forma)


def test_una_edicion_vacia_no_existe() -> None:
    with pytest.raises(ValidationError):
        _edicion()
    with pytest.raises(ValidationError):
        _edicion(medidas={})
    with pytest.raises(ValidationError):
        _edicion(medidas={"ancho_m": 0})


def test_la_densidad_es_una_de_las_que_admite_la_oficial() -> None:
    with pytest.raises(PlanResolutionError) as caso:
        editar_plan(plan(pared()), _edicion(densidad="sencilla"))

    assert (caso.value.code, caso.value.status_code) == ("densidad_invalida", 422)
    detalles = cast(Mapping[str, object], caso.value.details)
    assert detalles["densidades_admitidas"] == ["media", "lujosa"]


def test_una_forma_que_no_es_de_la_pieza_se_rechaza() -> None:
    with pytest.raises(PlanResolutionError) as caso:
        editar_plan(plan(pared()), _edicion(forma="media-luna", densidad="lujosa"))

    assert caso.value.code == "forma_invalida"


def test_mas_densa_y_mas_grande_nunca_lleva_menos_globos() -> None:
    base = plan(pared())
    antes = _total(base)

    lujosa = _total(editar_plan(base, _edicion(densidad="lujosa")).plan)
    grande = _total(editar_plan(base, _edicion(medidas={"ancho_m": 3.0})).plan)

    assert lujosa > antes
    assert grande > antes


def test_el_aro_cuenta_con_su_diametro() -> None:
    base = plan(aro())

    mas_grande = editar_plan(base, _edicion(ARO, medidas={"ancho_m": 2.6, "alto_m": 2.6})).plan

    assert _total(mas_grande, ARO) > _total(base, ARO)


def test_un_armado_viejo_en_una_pieza_sin_motor_no_estorba() -> None:
    # Un aro con un `armado_arco_organico` guardado de antes: no cuenta (OFICIALES_SIN_MOTOR), así que su
    # densidad y sus medidas se siguen editando.
    from tests.test_plan_edicion_armado_arco_organico import ARMADO

    viejo = plan(aro(armado_arco_organico=ARMADO))

    editado = editar_plan(viejo, _edicion(ARO, densidad="lujosa")).plan

    assert _pieza(editado, ARO)["densidad"] == "lujosa"
