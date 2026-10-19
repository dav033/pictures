"""La lectura de la foto de una guirnalda sobrevive a una edición (hallazgo 32 de la revisión).

Al confirmar, Next manda ``pistas_guirnalda`` y Python arma la guirnalda con lo
que dice la foto (soporte, forma, anfitriona). Una edición que quita el armado
(quitar un color, una mezcla que ya no cabe) lo re-sugiere en la
re-resolución, pero el navegador no tiene la foto: sin la lectura, la receta
(pared, recta) reemplazaba a la guirnalda abrazada al arco. Como los conteos
(``conteos_referencia``, ADR-0031), Python devuelve las lecturas de las
guirnaldas del plan en ``lecturas_guirnalda``, fuera del hash, y Next las
vuelve a mandar en cada re-resolución de una edición.
"""

from __future__ import annotations

import copy
from typing import cast

import pytest

from tests.guirnalda_datos import GUIRNALDA, arco, estructura_del_plan, guirnalda, plan, resolver


def _pista(**extra: object) -> dict[str, object]:
    return {
        "referencia_element_id": "REF_01_E01",
        "soporte": "sobre_estructura",
        "anfitriona_element_id": "REF_01_E02",
        "forma": "curva",
        "racimos_visibles": 10,
        "unidad_racimo": "cuarteto",
        "colores_por_racimo": ["rosado", "blanco"],
        "relleno": {"color": "blanco", "proporcion": 0.1},
        "remates": [],
        "confianza": 0.85,
        **extra,
    }


def _plan() -> dict[str, object]:
    return plan(
        guirnalda(referencia_element_id="REF_01_E01"), arco(referencia_element_id="REF_01_E02")
    )


def _forma(resuelto: dict[str, object]) -> tuple[object, ...]:
    armado = cast(dict[str, object], estructura_del_plan(resuelto)["armado_guirnalda"])
    return armado["origen"], armado["soporte"], armado.get("estructura_id"), armado["forma"]


@pytest.mark.anyio
async def test_la_resolucion_devuelve_las_lecturas_de_sus_guirnaldas_fuera_del_hash() -> None:
    ajena = _pista(referencia_element_id="REF_09_E09")
    confirmado = await resolver(
        _plan(), completar_armados_guirnalda=True, pistas_guirnalda=[_pista(), ajena]
    )
    assert confirmado["lecturas_guirnalda"] == [_pista()], "solo las de guirnaldas del plan"
    firmado = cast(dict[str, object], confirmado["plan"])
    sin_lecturas = await resolver(firmado)
    con_lecturas = await resolver(firmado, pistas_guirnalda=[_pista()])
    assert "lecturas_guirnalda" not in sin_lecturas, "sin pistas, la respuesta de siempre"
    assert con_lecturas["lecturas_guirnalda"] == [_pista()]
    assert con_lecturas["plan_hash"] == sin_lecturas["plan_hash"] == confirmado["plan_hash"]
    assert con_lecturas["compras"] == sin_lecturas["compras"]


@pytest.mark.anyio
async def test_una_edicion_que_quita_el_armado_lo_recupera_con_la_lectura_de_la_foto() -> None:
    confirmado = await resolver(
        _plan(), completar_armados_guirnalda=True, pistas_guirnalda=[_pista()]
    )
    assert _forma(confirmado) == ("referencia", "sobre_estructura", "EST_02_ARCO", "curva")
    # Lo que deja una edición que quita el armado (quitar un color, una mezcla que no cabe).
    editado = copy.deepcopy(cast(dict[str, object], confirmado["plan"]))
    cast(list[dict[str, object]], editado["estructuras"])[0].pop("armado_guirnalda")
    sin_foto = await resolver(
        editado, completar_armados_guirnalda=True, completar_armados_de=[GUIRNALDA]
    )
    assert _forma(sin_foto) == ("sugerido", "pared", None, "recta"), "la receta, sin la foto"
    # Next vuelve a mandar las lecturas que devolvió la confirmación.
    con_foto = await resolver(
        editado,
        completar_armados_guirnalda=True,
        completar_armados_de=[GUIRNALDA],
        pistas_guirnalda=cast(list[dict[str, object]], confirmado["lecturas_guirnalda"]),
    )
    assert _forma(con_foto) == ("referencia", "sobre_estructura", "EST_02_ARCO", "curva")
    assert con_foto["lecturas_guirnalda"] == [_pista()], "y siguen viajando para la próxima"
