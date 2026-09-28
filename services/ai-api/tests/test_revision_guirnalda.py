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
