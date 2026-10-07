"""La referencia de un producto la decide la familia que su título nombra, no el acabado del material.

Banco de fotos 06 (2026-10-06): el plan compraba «Pastel Mate Azul» con el material en acabado «mate», y la guía de
escena lo pintaba con la primera referencia azul de la familia Fashion, el 040, un cian intenso. Es la misma regla
que ``referenciaDelTitulo`` de ``src/lib/plan/referencia-sempertex.ts``.
"""

from app.color_catalogo import referencia_del_titulo


def _codigo(titulo: str, acabado: str | None) -> str | None:
    referencia = referencia_del_titulo(titulo, acabado)
    return None if referencia is None else str(referencia["codigo"])


def test_el_pastel_mate_del_titulo_manda_sobre_el_mate_del_material() -> None:
    assert _codigo("B2b Globo Latex Redondo Pastel Mate Azul", "mate") == "640"


def test_sin_familia_en_el_titulo_manda_el_acabado() -> None:
    assert _codigo("B2b Globo Latex Redondo Azul", "reflex") == "940"


def test_el_fashion_sigue_siendo_el_fashion() -> None:
    assert _codigo("B2b Globo Latex Redondo Fashion Azul", "mate") == "040"
    assert _codigo("B2b Globo Latex Redondo Reflex Dorado Rosa", None) == "968"


def test_la_familia_delante_del_tono_compuesto_no_es_otro_tono() -> None:
    assert _codigo("B2b Globo Latex Redondo Fashion Azul Turquesa Profundo", None) == "035"
    assert _codigo("B2b Globo Latex Redondo Duo Rosa Azul", None) is None
