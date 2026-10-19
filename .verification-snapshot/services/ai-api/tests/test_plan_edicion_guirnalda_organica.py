"""Lo que editar el plan le hace a una guirnalda armada con el motor (ADR-0034).

Son las mismas dos reglas que ya tiene el arco (``test_plan_edicion_armado_arco.py``), para la otra pieza que
trae un armado por índice de material:

- el reparto y la mezcla no se editan (la compra sale del armado del motor);
- cambiar los colores de la pieza revalida el armado: nunca queda una paleta que apunte a un color que ya no
  existe, y lo que se corrige se dice.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import cast

import pytest
from pydantic import TypeAdapter, ValidationError

from app.plan import PlanResolutionError
from app.plan_armado_guirnalda_organica import (
    PlanArmadoGuirnaldaOrganicaRequest,
    vista_previa_armado_guirnalda_organica,
)
from app.plan_edicion import Edicion, LineaBase, LineasBaseEstructura, PlanEditado, editar_plan
from tests.guirnalda_datos import GUIRNALDA, arco, guirnalda, material, plan

_EDICION: TypeAdapter[Edicion] = TypeAdapter(Edicion)
_CONTEXTO = {
    "schema_version": "operational.v1",
    "request_id": "00000000-0000-4000-8000-000000000f01",
    "correlation_id": "ffffffff-ffff-4fff-8fff-fffffffffff1",
    "deadline_at": "2030-01-01T00:00:00Z",
    "deadline_ms": 5000,
    "scopes": ["plan.armado_guirnalda_organica"],
    "body_sha256": "a" * 64,
}


def _material(color: str, parte: float) -> dict[str, object]:
    return {**material(color, parte), "variant_id": f"var-{color}-12"}


def _pieza_tres() -> dict[str, object]:
    return guirnalda(
        materiales=[_material("rosado", 0.4), _material("blanco", 0.35), _material("dorado", 0.25)]
    )


def _armado_de(pieza: dict[str, object]) -> dict[str, object]:
    """La receta del motor para la pieza: un color de la paleta por material."""
    peticion = PlanArmadoGuirnaldaOrganicaRequest.model_validate(
        {
            "context": _CONTEXTO,
            "schema_version": "plan-armado-guirnalda-organica.v1",
            "plan": plan(pieza),
            "estructura_id": GUIRNALDA,
            "armado_guirnalda_organica": None,
            "colores": ["#f8a3bc", "#ffffff", "#c5a253"],
        }
    )
    return cast(dict[str, object], vista_previa_armado_guirnalda_organica(peticion)["armado"])


def _plan_con(paleta_materiales: list[int]) -> dict[str, object]:
    """Un plan cuya guirnalda trae un armado con esos materiales en su paleta (pesos y acabados de la receta)."""
    pieza = _pieza_tres()
    armado = _armado_de(pieza)
    colores = cast(dict[str, object], armado["colores"])
    receta = cast(list[dict[str, object]], colores["paleta"])
    paleta = [
        {**receta[min(i, len(receta) - 1)], "material": indice}
        for i, indice in enumerate(paleta_materiales)
    ]
    return plan(
        {**pieza, "armado_guirnalda_organica": {**armado, "colores": {**colores, "paleta": paleta}}}
    )


def _pieza(plan_: Mapping[str, object]) -> dict[str, object]:
    return cast(dict[str, object], cast(list[object], plan_["estructuras"])[0])


def _paleta(plan_: Mapping[str, object]) -> list[int]:
    armado = cast(dict[str, object], _pieza(plan_)["armado_guirnalda_organica"])
    return [
        cast(int, c["material"])
        for c in cast(list[dict[str, object]], cast(dict[str, object], armado["colores"])["paleta"])
    ]


def _quitar(plan_: Mapping[str, object], color: str) -> PlanEditado:
    edicion = _EDICION.validate_python(
        {"accion": "quitar", "estructura_id": GUIRNALDA, "objetivo_variant_id": f"var-{color}-12"}
    )
    linea = LineasBaseEstructura(
        estructura_id=GUIRNALDA,
        lineas=[LineaBase(product_id=f"prod-{color}", variant_id=f"var-{color}-12", color=color)],
    )
    return editar_plan(plan_, edicion, [linea])


def test_con_armado_de_guirnalda_el_reparto_y_la_mezcla_no_se_editan() -> None:
    con_armado = _plan_con([0, 1])
    reparto = _EDICION.validate_python(
        {"accion": "repartir", "estructura_id": GUIRNALDA, "participaciones": [0.5, 0.3, 0.2]}
    )
    mezcla = _EDICION.validate_python(
        {"accion": "mezcla", "estructura_id": GUIRNALDA, "mezcla": "clasica"}
    )

    for edicion in (reparto, mezcla):
        with pytest.raises(PlanResolutionError) as caso:
            editar_plan(con_armado, edicion)
        assert (caso.value.code, caso.value.status_code) == (
            "armado_guirnalda_organica_activo",
            409,
        )
    # Sin armado, como siempre.
    assert editar_plan(plan(_pieza_tres()), mezcla).plan


def test_quitar_un_color_corre_los_indices_de_la_paleta_y_lo_avisa() -> None:
    # La paleta usa rosado (0) y dorado (2). Quitar el blanco (1) deja a dorado en la posición 1.
    resultado = _quitar(_plan_con([0, 2]), "blanco")

    assert _paleta(resultado.plan) == [0, 1], "el dorado ahora es el índice 1"
    assert any("color" in aviso.lower() and "paleta" in aviso.lower() for aviso in resultado.avisos)
    armado = cast(dict[str, object], _pieza(resultado.plan)["armado_guirnalda_organica"])
    assert armado["origen"] == "decorador"


def test_quitar_el_color_que_usa_la_paleta_nunca_deja_un_indice_inexistente() -> None:
    resultado = _quitar(_plan_con([1]), "blanco")

    cuantos = len(cast(list[object], _pieza(resultado.plan)["materiales"]))
    paleta = _paleta(resultado.plan)
    assert paleta and all(0 <= indice < cuantos for indice in paleta)
    assert any("primer color" in aviso for aviso in resultado.avisos), resultado.avisos


def test_quitar_un_color_que_la_paleta_no_usa_y_viene_despues_no_mueve_nada() -> None:
    con_armado = _plan_con([0, 1])

    resultado = _quitar(con_armado, "dorado")

    assert _paleta(resultado.plan) == [0, 1]
    assert (
        _pieza(resultado.plan)["armado_guirnalda_organica"]
        == _pieza(con_armado)["armado_guirnalda_organica"]
    )
    assert not any("paleta" in aviso.lower() for aviso in resultado.avisos)


def test_una_guirnalda_sin_armado_no_se_revisa_al_quitar_un_color() -> None:
    resultado = _quitar(plan(_pieza_tres()), "blanco")

    assert "armado_guirnalda_organica" not in _pieza(resultado.plan)
    assert not any("paleta" in aviso.lower() for aviso in resultado.avisos)


# --- Fijar y quitar el armado (ADR-0035, paso 3) ---------------------------------------------------


def _edicion(armado: Mapping[str, object] | None, estructura_id: str = GUIRNALDA) -> Edicion:
    return _EDICION.validate_python(
        {
            "accion": "armado_guirnalda_organica",
            "estructura_id": estructura_id,
            "armado_guirnalda_organica": armado,
        }
    )


def _dos_colores() -> dict[str, object]:
    return guirnalda(materiales=[_material("rosado", 0.6), _material("blanco", 0.4)])


def test_fijar_un_armado_lo_escribe_en_la_pieza_y_pone_el_largo_del_motor() -> None:
    receta = _armado_de(_dos_colores())

    resultado = editar_plan(plan(_dos_colores(), arco()), _edicion(receta))

    pieza = _pieza(resultado.plan)
    assert pieza["armado_guirnalda_organica"] == receta
    # La pieza mide lo que el motor dice que mide: es lo único que el plan, la tarjeta y la imagen comparten.
    largo = cast(dict[str, object], pieza["medidas"])["largo_m"]
    assert isinstance(largo, float) and largo > 0
    # Las demás piezas no se tocan.
    otra = cast(list[dict[str, object]], resultado.plan["estructuras"])[1]
    assert "armado_guirnalda_organica" not in otra


def test_quitar_el_armado_devuelve_la_pieza_al_camino_de_siempre() -> None:
    con_armado = editar_plan(plan(_dos_colores()), _edicion(_armado_de(_dos_colores()))).plan

    sin_armado = editar_plan(con_armado, _edicion(None)).plan

    assert "armado_guirnalda_organica" not in _pieza(sin_armado)


def test_un_color_de_la_pieza_que_la_paleta_no_toma_se_avisa_al_guardar() -> None:
    receta = _armado_de(_dos_colores())
    colores = cast(dict[str, object], receta["colores"])
    solo_el_primero = {
        **receta,
        "colores": {**colores, "paleta": cast(list[object], colores["paleta"])[:1]},
    }

    avisos = editar_plan(plan(_dos_colores()), _edicion(solo_el_primero)).avisos

    assert any("no usa el color" in aviso and "no se comprarán" in aviso for aviso in avisos), (
        avisos
    )


def test_un_color_que_la_pieza_no_lleva_se_rechaza_con_la_frase_del_motor() -> None:
    receta = _armado_de(_dos_colores())
    colores = cast(dict[str, object], receta["colores"])
    paleta = [{**c, "material": 5} for c in cast(list[dict[str, object]], colores["paleta"])]

    with pytest.raises(PlanResolutionError) as caso:
        editar_plan(
            plan(_dos_colores()), _edicion({**receta, "colores": {**colores, "paleta": paleta}})
        )

    assert (caso.value.code, caso.value.status_code) == ("armado_invalido", 422)
    assert caso.value.details["motivo"] == "material_fuera_de_rango"
    assert "no lleva" in str(caso.value.details["mensaje"])


def test_un_armado_en_una_pieza_que_no_es_guirnalda_se_rechaza() -> None:
    receta = _armado_de(_dos_colores())

    with pytest.raises(PlanResolutionError) as caso:
        editar_plan(plan(arco(), _dos_colores()), _edicion(receta, "EST_02_ARCO"))

    assert (caso.value.code, caso.value.status_code) == ("armado_invalido", 422)
    assert caso.value.details["motivo"] == "no_es_guirnalda"


def test_la_forma_del_armado_se_exige_en_la_frontera() -> None:
    receta = _armado_de(_dos_colores())

    with pytest.raises(ValidationError):
        _edicion({**receta, "campo_nuevo": 1})
    with pytest.raises(ValidationError):
        _edicion({**receta, "forma": {**cast(dict[str, object], receta["forma"]), "largoM": 99}})
    with pytest.raises(ValidationError):
        _EDICION.validate_python(
            {"accion": "armado_guirnalda_organica", "estructura_id": GUIRNALDA}
        )


def test_una_estructura_que_no_existe_es_404() -> None:
    with pytest.raises(PlanResolutionError) as caso:
        editar_plan(plan(_dos_colores()), _edicion(_armado_de(_dos_colores()), "EST_99_NO_EXISTE"))

    assert (caso.value.code, caso.value.status_code) == ("estructura_no_encontrada", 404)
