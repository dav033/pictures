"""Puerta física del plan resuelto (ADR-0023 paso 4).

Espejo de los casos de `scripts/test/test-material-consistency.ts`, que es donde la
regla estaba cubierta mientras vivía en TypeScript. Los textos se afirman
completos a propósito: son lo que lee el modelo para corregir el plan, y el
puerto no debe cambiarlos ni un byte.
"""

from __future__ import annotations

from typing import Any

from app.plan import PHYSICAL_GATE_PREFIX, _physical_warnings


def _plan(
    *estructuras: dict[str, Any], restricciones: dict[str, Any] | None = None
) -> dict[str, Any]:
    plan: dict[str, Any] = {"estructuras": list(estructuras)}
    if restricciones is not None:
        plan["restricciones"] = restricciones
    return plan


def _declarada(
    estructura_id: str, densidad: str = "media", mezcla: str = "clasica"
) -> dict[str, Any]:
    return {"estructura_id": estructura_id, "densidad": densidad, "mezcla": mezcla}


def _resuelta(
    estructura_id: str,
    tipo: str,
    eje_m: float,
    globos: int,
    repeticiones: int = 1,
    diam_pulg: float | None = 12.0,
) -> dict[str, Any]:
    return {
        "estructura_id": estructura_id,
        "tipo": tipo,
        "eje_m": eje_m,
        "repeticiones": repeticiones,
        "lineas": [{"unidades": globos, "diam_pulg": diam_pulg}],
    }


def test_estructura_en_banda_no_avisa() -> None:
    plan = _plan(_declarada("EST_01_ARCO"))
    avisos = _physical_warnings(plan, [_resuelta("EST_01_ARCO", "arco", 4.0, 80)])
    assert avisos == []


def test_guirnalda_escasa_avisa_con_el_texto_exacto() -> None:
    plan = _plan(_declarada("EST_01_GUIRNALDA", densidad="lujosa"))
    avisos = _physical_warnings(plan, [_resuelta("EST_01_GUIRNALDA", "guirnalda", 2.5, 5)])
    assert avisos == [
        f"{PHYSICAL_GATE_PREFIX}EST_01_GUIRNALDA: estimated material quantity appears too low"
        " for high density over 2.50 m (5 installed balloons)"
    ]


def test_guirnalda_excesiva_avisa_con_el_texto_exacto() -> None:
    plan = _plan(_declarada("EST_01_GUIRNALDA", densidad="lujosa"))
    avisos = _physical_warnings(plan, [_resuelta("EST_01_GUIRNALDA", "guirnalda", 2.5, 400)])
    assert avisos == [
        f"{PHYSICAL_GATE_PREFIX}EST_01_GUIRNALDA: estimated material quantity appears unusually"
        " high for high density over 2.50 m (400 installed balloons)"
    ]


def test_pared_y_centro_de_mesa_no_se_miden() -> None:
    """Su dimensión mayor no es un tramo de instalación: no tienen banda calibrada."""
    plan = _plan(_declarada("EST_01_PARED"), _declarada("EST_02_CENTRO"))
    avisos = _physical_warnings(
        plan,
        [
            _resuelta("EST_01_PARED", "pared", 3.0, 1),
            _resuelta("EST_02_CENTRO", "centro_mesa", 3.0, 1),
        ],
    )
    assert avisos == []


def test_lineas_sin_globos_no_se_miden() -> None:
    """Un tramo de props (``diam_pulg`` nulo) no es un conteo de globos."""
    plan = _plan(_declarada("EST_01_ARCO"))
    avisos = _physical_warnings(plan, [_resuelta("EST_01_ARCO", "arco", 4.0, 1, diam_pulg=None)])
    assert avisos == []


def test_el_eje_se_multiplica_por_las_repeticiones() -> None:
    """80 globos en 4 m están en banda; los mismos repartidos en 6 instancias, no."""
    plan = _plan(_declarada("EST_01_ARCO"))
    assert _physical_warnings(plan, [_resuelta("EST_01_ARCO", "arco", 4.0, 80)]) == []
    avisos = _physical_warnings(plan, [_resuelta("EST_01_ARCO", "arco", 4.0, 80, repeticiones=6)])
    assert len(avisos) == 1
    assert "appears too low" in avisos[0]
    assert "over 24.00 m" in avisos[0]


def test_densidad_desconocida_cae_en_media() -> None:
    plan = _plan(_declarada("EST_01_ARCO", densidad="inventada"))
    avisos = _physical_warnings(plan, [_resuelta("EST_01_ARCO", "arco", 10.0, 20)])
    assert len(avisos) == 1
    assert "for medium density" in avisos[0]


def test_tamano_obligatorio_grande_escala_la_banda() -> None:
    """Un arco "solo R-24" cuenta menos globos correctos y no debe caer fuera de banda.

    Sin escalar, 52 globos en 6,2 m (8,39/m) caen por debajo del mínimo de
    densidad media (8,4/m) y un plan válido deja de poder confirmarse. El factor
    de la mezcla efectiva baja la banda y lo admite.
    """
    estructura = _resuelta("EST_01_ARCO", "arco", 6.2, 52)
    sin_restriccion = _plan(_declarada("EST_01_ARCO", mezcla="organica_fina"))
    assert len(_physical_warnings(sin_restriccion, [estructura])) == 1

    con_restriccion = _plan(
        _declarada("EST_01_ARCO", mezcla="organica_fina"),
        restricciones={"tamanos": [{"valor": "R-24", "polaridad": "obligatorio"}]},
    )
    assert _physical_warnings(con_restriccion, [estructura]) == []


def test_tamano_no_obligatorio_no_escala_la_banda() -> None:
    """Solo la polaridad ``obligatorio`` cambia la mezcla efectiva."""
    estructura = _resuelta("EST_01_ARCO", "arco", 6.2, 52)
    plan = _plan(
        _declarada("EST_01_ARCO", mezcla="organica_fina"),
        restricciones={"tamanos": [{"valor": "R-24", "polaridad": "preferido"}]},
    )
    assert len(_physical_warnings(plan, [estructura])) == 1
