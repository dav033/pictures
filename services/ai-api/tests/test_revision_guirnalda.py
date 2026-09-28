"""Regresiones de la revisión adversaria de feat/guirnaldas (armado y lectura de la guirnalda, ADR-0032).

Cada prueba lleva el id del hallazgo (scratchpad/revision/hallazgos.json) y
falla contra el código anterior al arreglo.
"""

from __future__ import annotations

from typing import cast

import pytest

from app.plan import vista_previa_de_armado_guirnalda
from tests.guirnalda_datos import GUIRNALDA, guirnalda, plan, resolver

U = {
    "version": "armado-guirnalda.v1",
    "origen": "decorador",
    "soporte": "pared",
    "forma": "u_invertida",
    "racimo": {"unidad": "cuarteto", "tamano_pulg_base": 12},
    "relleno": None,
    "remates": [],
}
PATRON_ESPEJO = {
    "version": "patron-color.v1",
    "origen": "decorador",
    "globos_por_racimo": 4,
    "base": {"modo": "anillos", "secuencia": [0, 1], "largo": 1},
    "simetria": "espejo",
}


# --- 5: la vista previa quita el espejo como la edición -------------------------------------


@pytest.mark.anyio
@pytest.mark.parametrize("armado", [{**U, "forma": "recta"}, None], ids=["recta", "receta"])
async def test_5_la_vista_previa_de_otra_forma_quita_el_espejo(
    armado: dict[str, object] | None,
) -> None:
    resuelto = await resolver(plan(guirnalda(armado_guirnalda=U, patron_color=PATRON_ESPEJO)))
    firmado = cast(dict[str, object], resuelto["plan"])
    # Antes: 422 patron_invalido (simetria_no_permitida) y el editor no podía guardar.
    vista = vista_previa_de_armado_guirnalda(firmado, GUIRNALDA, armado)
    forma = cast(dict[str, object], vista.armado["armado"])["forma"]
    assert forma == "recta" if armado is not None else forma != "u_invertida"
    # La U sigue admitiendo el espejo.
    en_u = vista_previa_de_armado_guirnalda(firmado, GUIRNALDA, U)
    assert cast(dict[str, object], en_u.armado["armado"])["forma"] == "u_invertida"


# --- 6 = 13: un arco leído en ELEMENTS puede ser la anfitriona de una guirnalda --------------


def test_6_un_arco_de_elements_es_anfitriona_y_la_propia_guirnalda_no() -> None:
    from app.amaterasu.estructuras import guirnalda as registro
    from app.amaterasu.patron_referencia import PALETA

    base = {"soporte": "sobre_estructura", "forma": "curva", "confianza": 0.8}
    lecturas = registro.validar_lecturas(
        {
            "lecturas": [
                {"element_id": "REF_01_E01", **base, "anfitriona_element_id": "REF_01_E02"},
                {"element_id": "REF_01_E02", **base, "anfitriona_element_id": "REF_01_E02"},
            ]
        },
        ["REF_01_E01", "REF_01_E02"],
        PALETA,
        [],
    )
    assert lecturas is not None
    por_id = {str(lectura["element_id"]): lectura for lectura in lecturas}
    # Antes: la anfitriona solo podía salir de OTHER_PIECES y el arco se perdía.
    assert por_id["REF_01_E01"].get("anfitriona_element_id") == "REF_01_E02"
    assert "anfitriona_element_id" not in por_id["REF_01_E02"], "nunca la propia pieza"


def test_6_el_prompt_admite_un_arco_de_elements_como_anfitriona() -> None:
    from app.amaterasu.guirnalda_referencia import SYSTEM_INSTRUCTION

    assert "or an arch or half-arch listed in ELEMENTS" in SYSTEM_INSTRUCTION
