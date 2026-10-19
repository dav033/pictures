"""El color del plan cruzado con la lámina de Sempertex: qué referencia se compra y qué cifras se publican.

Lo que se comprueba aquí es el emparejamiento y lo que sale de él, no la tabla: la tabla la genera el repo
dueño y ``test_canonico_tabla.py`` ya exige que sea idéntica a la del contrato.
"""

from __future__ import annotations


import pytest

from app.color_catalogo import (
    ACABADO_MOTOR_POR_DEFECTO,
    ACABADO_MOTOR_POR_FAMILIA,
    acabado_del_motor,
    es_aproximacion_del_motor,
    referencia_de,
)


def test_el_acabado_elige_entre_los_homonimos_y_el_orden_no_es_el_de_la_tabla() -> None:
    """«Dorado» son seis referencias y el acabado dice cuál.

    El orden de las familias es una prioridad y no un conjunto: «cromado» es antes un Reflex que un Metal.
    Quedarse con la primera de la tabla daba el Metal Dorado donde se compra el Reflex, que es un dorado
    visiblemente distinto: se inflan ``#deb25b`` y ``#a08344``.
    """
    reflex = referencia_de("dorado", "cromado")
    metal = referencia_de("dorado", "metalizado")

    assert reflex is not None and metal is not None
    assert (reflex["codigo"], reflex["familia"]) == ("970", "reflex")
    assert (metal["codigo"], metal["familia"]) == ("570", "metal")
    assert reflex["hexGlobo"] != metal["hexGlobo"]


def test_un_color_que_la_lamina_no_nombra_no_se_inventa() -> None:
    """La paleta del plan tiene 26 palabras y 16 nombran una referencia; las otras se quedan sin cifras.

    Sin esto, «champagne» habría cogido la referencia «más parecida» y el prompt habría pedido un Pantone que
    nadie eligió.
    """
    assert referencia_de("champagne", "mate") is None
    assert referencia_de("multicolor", "mate") is None
    assert referencia_de(None, "mate") is None


def test_el_reflex_del_catalogo_es_el_970_y_no_el_dorado_fashion() -> None:
    """La palabra del catálogo («reflex») elige la familia igual que la del analizador («cromado»).

    El bloque de cifras para Gemini lo arma ahora TypeScript con la misma prioridad
    (`referenciaDelCatalogo`, `scripts/test/test-colores-exactos.ts`); esto fija el lado de Python.
    """
    reflex = referencia_de("dorado", "reflex")
    assert reflex is not None and reflex["codigo"] == "970"


@pytest.mark.parametrize(
    ("color", "acabado", "esperado"),
    [
        ("dorado", "reflex", "cromado"),
        ("rosado", "reflex", "cromado"),
        ("plateado", "metal", "cromado"),
        ("transparente", "cristal", "transparente"),
        # No hay «Rosado Cristal» en la lámina: manda la palabra del catálogo, no la referencia de respaldo.
        ("rosado", "cristal", "transparente"),
        ("blanco", "fashion", "mate"),
        ("lila", "perlado", "mate"),
        ("dorado", None, "mate"),
        # Un color que no está en la lámina conserva el acabado de su palabra.
        ("burdeos", "reflex", "cromado"),
    ],
)
def test_acabado_del_motor_sigue_la_familia_del_repo_dueno(
    color: str, acabado: str | None, esperado: str
) -> None:
    assert acabado_del_motor(color, acabado) == esperado


def test_la_tabla_del_motor_solo_nombra_acabados_del_motor() -> None:
    from app.organico.tipos import ACABADOS

    validos = {str(a["valor"]) for a in ACABADOS}
    assert set(ACABADO_MOTOR_POR_FAMILIA.values()) <= validos
    assert ACABADO_MOTOR_POR_DEFECTO in validos


def test_solo_se_avisa_cuando_el_motor_aproxima() -> None:
    assert es_aproximacion_del_motor("lila", "perlado")
    assert not es_aproximacion_del_motor("dorado", "reflex")
    assert not es_aproximacion_del_motor("blanco", "fashion")
    assert not es_aproximacion_del_motor("blanco", None)
