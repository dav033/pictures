"""Registro de tipos de estructura de Amaterasu (ADR-0030)."""

from __future__ import annotations

from app.amaterasu import patron_referencia
from app.amaterasu.estructuras import DEFINICIONES, definicion, frase_inicio_de_pieza
from app.patron_color import MODOS


def test_mover_el_conocimiento_por_tipo_no_cambia_el_prompt_de_patrones() -> None:
    # Valor anterior al registro: la frase y los modos se movieron sin tocar un byte.
    assert patron_referencia.PROMPT_VERSION == "patron-referencia.v1:0d8c93d34d672014"
    assert (
        "The start of a piece is: the base of a column; the left foot of an arch (going up "
        "over the top and down to the right foot); the base of a half-arch toward its open "
        "tip; the left end of a garland; the top-left corner of a wall; the bottom of a "
        "centerpiece." in patron_referencia.SYSTEM_INSTRUCTION
    )


def test_los_modos_del_detector_son_los_del_contrato() -> None:
    assert patron_referencia.MODOS == MODOS


def test_cada_tipo_tiene_un_solo_submodulo() -> None:
    claves = [d.clave for d in DEFINICIONES]
    assert len(claves) == len(set(claves))
    assert definicion("columna") is not None
    assert definicion("kit") is None


def test_la_frase_solo_nombra_tipos_con_patron() -> None:
    frase = frase_inicio_de_pieza()
    for d in DEFINICIONES:
        if d.inicio_de_pieza is not None:
            assert d.inicio_de_pieza in frase
