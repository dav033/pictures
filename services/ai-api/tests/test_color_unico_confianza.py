"""La lectura «monocromo» solo vale con la confianza de cualquier otra lectura de la foto (2026-10-05).

En Next, una pista ``monocromo`` se guarda como ``appearance.color_unico`` y manda sobre las etiquetas del
analizador y sobre la medida en píxeles: la pieza compra UN material. Dicha con 0,2 de confianza, una columna
dorada, blanca y negra se compraba solo en dorado. ``validar_pistas`` la degrada a «ninguno» por debajo de
``CONFIANZA_MINIMA_PISTA`` y la deja igual por encima; lo demás que lee la pista (remate y tamaños) no es de
la disposición de color y se queda.
"""

from __future__ import annotations

import pytest

from app.amaterasu.patron_referencia import ElementoReferencia, validar_pistas
from app.patron_color import CONFIANZA_MINIMA_PISTA

ELEMENTOS = [
    ElementoReferencia(
        element_id="REF_01_E01",
        tipo="columna",
        colores_observados=["chrome gold", "matte white", "black"],
    ),
]


def _monocroma(confianza: float) -> dict[str, object]:
    [pista] = validar_pistas(
        {
            "pistas": [
                {
                    "element_id": "REF_01_E01",
                    "modo": "monocromo",
                    "colores": ["dorado"],
                    "confianza": confianza,
                    "tamanos": "un_solo_tamano",
                    "remate": {"tipo": "globo", "color": "dorado"},
                }
            ]
        },
        ELEMENTOS,
    )
    return pista


def test_the_cut_is_the_same_as_every_other_photo_reading() -> None:
    assert CONFIANZA_MINIMA_PISTA == 0.5


@pytest.mark.parametrize("confianza", [0.0, 0.2, 0.49])
def test_a_doubtful_single_color_reading_falls_to_ninguno(confianza: float) -> None:
    pista = _monocroma(confianza)
    assert pista["modo"] == "ninguno"
    assert pista["colores"] == []
    assert pista["confianza"] == confianza
    # El remate y los tamaños son de la pieza, no de su color: siguen viajando.
    assert pista["tamanos"] == "un_solo_tamano"
    assert pista["remate"] == {"tipo": "globo", "color": "dorado"}


@pytest.mark.parametrize("confianza", [0.5, 0.9, 1.0])
def test_a_confident_single_color_reading_is_unchanged(confianza: float) -> None:
    pista = _monocroma(confianza)
    assert pista["modo"] == "monocromo"
    assert pista["colores"] == ["dorado"]


def _monocroma_con_motas(motas: list[str]) -> dict[str, object]:
    [pista] = validar_pistas(
        {
            "pistas": [
                {
                    "element_id": "REF_01_E01",
                    "modo": "monocromo",
                    "colores": ["rosado"],
                    "motas": motas,
                    "confianza": 0.9,
                    "tamanos": "chicos_con_pocos_grandes",
                }
            ]
        },
        ELEMENTOS,
    )
    return pista


def test_a_single_color_with_sprinkled_accents_of_another_color_is_not_single_color() -> None:
    """Foto de ejemplo 08 (2026-10-05): «monocromo rosado, motas dorado» son columnas rosas con dorado suelto.

    Como ``color_unico`` manda sobre las etiquetas, guardarla como monocroma perdía el dorado entero; cae a
    «ninguno» y deciden las etiquetas («pearl pink, chrome gold»). Los tamaños siguen viajando.
    """
    pista = _monocroma_con_motas(["dorado"])
    assert pista["modo"] == "ninguno"
    assert pista["colores"] == []
    assert pista["tamanos"] == "chicos_con_pocos_grandes"


def test_accents_of_the_same_color_keep_it_single_color() -> None:
    pista = _monocroma_con_motas(["rosado"])
    assert pista["modo"] == "monocromo"
    assert pista["colores"] == ["rosado"]


def test_other_modes_keep_their_own_rule() -> None:
    """El corte es de la monocroma: una pista de patrón poco confiable la sigue descartando ``patron_color``."""
    [pista] = validar_pistas(
        {
            "pistas": [
                {
                    "element_id": "REF_01_E01",
                    "modo": "anillos",
                    "colores": ["dorado", "blanco"],
                    "confianza": 0.2,
                }
            ]
        },
        ELEMENTOS,
    )
    assert pista["modo"] == "anillos"
    assert pista["colores"] == ["dorado", "blanco"]
