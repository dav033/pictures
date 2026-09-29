"""Registro de tipos de estructura de Amaterasu (ADR-0030)."""

from __future__ import annotations

from app.amaterasu import patron_referencia
from app.amaterasu.estructuras import (
    DEFINICIONES,
    definicion,
    definicion_de_pieza,
    frase_inicio_de_pieza,
)
from app.patron_color import MODOS


def test_mover_el_conocimiento_por_tipo_no_cambia_el_prompt_de_patrones() -> None:
    # El registro movió la frase y los modos sin tocar un byte del prompt. El
    # valor congelado cambió una sola vez desde entonces, a propósito: ADR-0036
    # añadió el modo `zonas` al prompt y a su esquema de salida (era
    # patron-referencia.v1:0d8c93d34d672014). Lo que este test sigue vigilando
    # es que un refactor no lo mueva sin querer.
    assert patron_referencia.PROMPT_VERSION == "patron-referencia.v1:5cbba9bd04d02884"
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


def test_techo_y_figura_entraron_sin_frase_de_patron() -> None:
    # ADR-0031: entraron al registro para el conteo; el prompt del patrón sigue
    # igual (su versión está fijada arriba).
    for clave in ("techo_globos", "figura"):
        registrado = definicion(clave)
        assert registrado is not None and registrado.inicio_de_pieza is None


def test_cada_pieza_se_describe_por_su_estructura_oficial_o_por_su_tipo() -> None:
    def clave(tipo: str, oficial: str | None = None) -> str | None:
        registrado = definicion_de_pieza(tipo, oficial)
        return registrado.clave if registrado else None

    assert clave("kit", "bouquet") == "bouquet"
    assert clave("kit", "figura") == "figura"
    assert clave("escultura", "figura") == "figura"
    assert clave("guirnalda", "techo_globos") == "techo_globos"
    assert clave("guirnalda", "guirnalda") == "guirnalda"
    # Una variante sin submódulo propio cae en su tipo.
    assert clave("arco", "arco_asimetrico") == "arco"
    assert clave("arco", "aro_circular") == "arco"
    assert clave("columna") == "columna"
    # Un kit sin estructura oficial (un racimo) no está descrito.
    assert clave("kit") is None
    assert clave("desconocido") is None
