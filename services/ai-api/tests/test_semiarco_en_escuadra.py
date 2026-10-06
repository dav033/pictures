"""Medio arco en escuadra (2026-10-06): la foto 5 de la Fase 7 tiene una guirnalda que sube por la derecha del
panel y lo cruza entero por arriba, en L invertida. La lectura lo dice («u_invertida» sobre la pared); antes salía
un bastón estrecho con la punta caída, que FLUX cerraba en U.
"""

from __future__ import annotations

from typing import Any

from app.armado_estructura import (
    CORTE_MEDIO_ARCO_FUERTE,
    CURVA_EN_ESCUADRA,
    PiezaArmado,
    _cruza_por_arriba,
    _receta,
    _valida,
)

LECTURA_L = {"soporte": "pared", "forma": "u_invertida", "confianza": 0.95}


def _semiarco() -> PiezaArmado:
    return PiezaArmado(
        tipo="semiarco", colores=3, alto_m=2.2, ancho_m=1.6, mezcla="organica_fina",
        tonos=["azul", "dorado", "crema"], espejo=True, asimetrica=True,
    )


def _forma(armado: dict[str, Any]) -> dict[str, Any]:
    forma = armado["forma"]
    assert isinstance(forma, dict)
    return forma


def test_solo_cruza_por_arriba_una_u_invertida_confiable_sobre_un_fondo() -> None:
    assert _cruza_por_arriba(LECTURA_L)
    assert _cruza_por_arriba({**LECTURA_L, "soporte": "sobre_estructura"})
    assert not _cruza_por_arriba({**LECTURA_L, "forma": "curva"}), "una curva suave es otra cosa"
    assert not _cruza_por_arriba({**LECTURA_L, "confianza": 0.3}), "una lectura dudosa no manda"
    assert not _cruza_por_arriba({**LECTURA_L, "soporte": "piso"})
    assert not _cruza_por_arriba(None)


def test_la_l_invertida_tiene_cima_recta_y_llega_a_la_esquina() -> None:
    pieza = _semiarco()
    armado = _receta(pieza, [], lectura_linea=LECTURA_L)
    forma = _forma(armado)
    assert forma["curva"] == CURVA_EN_ESCUADRA
    assert forma["anchoM"] == 1.6, "cortada en la esquina, la pieza que se ve mide el arco completo"
    volumen = armado["volumen"]
    assert volumen["grosorPatasM"] <= 0.3 * 1.6 + 1e-9, "una banda que enmarca, no la pila de un medio arco"
    # La cima cruza el ancho y se corta en la esquina lejana: más allá de una pata y la cima casi entera.
    a = (1.6 - volumen["grosorPatasM"]) / 2
    hs = 2.2 - volumen["grosorCimaM"] / 2
    assert forma["corte"] > (hs + 1.5 * a) / (2 * hs + 2 * a), "la punta no se queda en la mitad de la cima"
    assert forma["corte"] < (2 * hs + 2 * a - 0.05 * hs) / (2 * hs + 2 * a), "ni baja por el otro lado"
    assert 2 * a > 1.0, "la cima recorre más de un metro"
    assert forma["espejo"] is True
    assert armado["origen"] == "referencia"
    assert _valida(pieza, armado) is None, "el contrato lo admite"


def test_una_escuadra_estrecha_para_su_alto_se_acota_y_sigue_siendo_valida() -> None:
    # Un plan de 1,45 × 2,66 m dejaba el armado inválido (el motor no arma menos de 1,5 m de ancho) y la pieza salía
    # sin armado ni guía de escena.
    pieza = PiezaArmado(
        tipo="semiarco", colores=3, alto_m=2.66, ancho_m=1.45, mezcla="organica_fina",
        tonos=["azul", "champagne", "dorado"], espejo=True, asimetrica=True,
    )
    avisos: list[str] = []
    armado = _receta(pieza, avisos, lectura_linea=LECTURA_L)
    assert _valida(pieza, armado) is None
    assert _forma(armado)["anchoM"] == 1.5
    assert any("se acoto" in aviso for aviso in avisos)


def test_sin_esa_lectura_el_medio_arco_sigue_igual() -> None:
    pieza = _semiarco()
    forma = _forma(_receta(pieza, []))
    assert forma["curva"] != CURVA_EN_ESCUADRA
    assert forma["corte"] <= CORTE_MEDIO_ARCO_FUERTE
    con_curva_suave = _forma(_receta(pieza, [], lectura_linea={**LECTURA_L, "forma": "curva"}))
    assert con_curva_suave == forma
