"""Cómo llegan el armado y el patrón de una guirnalda por partes a la imagen (2026-09-28).

Una guirnalda orgánica en pared con espiral de cuartetos rosado, naranja,
rosado y dorado salió en fal.ai (LoRA v007) con cintas retorcidas rosado y
naranja cruzando la pieza. El armado sí llegaba al caption; lo que llegaba mal
era la redacción: "wrapped in a spiral of pink, orange and gold stripes winding
along its length" se dibujaba literalmente como franjas que envuelven la
guirnalda, y "tight and twisted against each other" (Gemini) como bandas
retorcidas. Lo que se fija aquí:

- con armado, la espiral y los anillos se redactan como racimos iguales de
  globos redondos (cuántos de cada color lleva cada uno), sin "spiral",
  "stripes", "bands", "wrapped" ni "winding" en el caption LoRA, que sigue en
  ASCII, sin cifras y sin nombrar otra guirnalda;
- Gemini conserva la espiral como giro de los racimos, dicha como colores de
  los propios globos, y el armado excluye cintas, serpentinas y bandas;
- sin armado (una guirnalda clásica, una columna) las frases son byte a byte
  las de antes: la corrección no toca lo que nadie reportó.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import cast

import pytest

from app.patron_color import EstructuraPatron, MaterialPatron, patron_resuelto
from tests.guirnalda_datos import guirnalda, material, plan, resolver

#: Palabras que el modelo de imagen dibujó como cintas o que describen la pieza envuelta.
_CINTAS = re.compile(r"spiral|stripe|band|ribbon|streamer|wrapped|winding|twist", re.IGNORECASE)


def _guirnalda(
    colores: Sequence[str] = ("rosado", "naranja", "dorado"),
    *,
    racimo: int | None = 4,
    tipo: str = "guirnalda",
    forma: str | None = "recta",
) -> EstructuraPatron:
    return EstructuraPatron(
        estructura_id="EST_01_GUIRNALDA",
        tipo=tipo,
        total=48,
        un_tamano=False,
        ancho_m=None,
        alto_m=None,
        repeticiones=1,
        materiales=tuple(
            MaterialPatron(color=color, acabado=None, participacion=1 / len(colores))
            for color in colores
        ),
        racimo_armado=racimo,
        forma_armado=forma if racimo is not None else None,
    )


def _espiral(racimo: Sequence[int], trazo: str = "espiral", **extra: object) -> dict[str, object]:
    return {
        "version": "patron-color.v1",
        "origen": "decorador",
        "globos_por_racimo": len(racimo),
        "base": {"modo": "espiral", "racimo": list(racimo), "trazo": trazo},
        **extra,
    }


def _anillos(secuencia: Sequence[int], **extra: object) -> dict[str, object]:
    return {
        "version": "patron-color.v1",
        "origen": "decorador",
        "globos_por_racimo": 4,
        "base": {"modo": "anillos", "secuencia": list(secuencia), "largo": 2},
        **extra,
    }


def _frases(estructura: EstructuraPatron, patron: Mapping[str, object]) -> tuple[str, str]:
    resuelto = patron_resuelto(estructura, patron, aplicado=True)
    return str(resuelto["prompt_gemini"]), str(resuelto["prompt_lora"])


def _lora_limpia(lora: str) -> None:
    assert lora.isascii() and not any(caracter.isdigit() for caracter in lora), lora
    assert "garland" not in lora, lora
    assert not _CINTAS.search(lora), lora


# --- Espiral sobre los racimos del armado -------------------------------------------------


def test_la_espiral_de_la_guirnalda_armada_son_racimos_de_globos() -> None:
    # El caso del usuario: cuartetos rosado, naranja, rosado, dorado.
    gemini, lora = _frases(_guirnalda(), _espiral([0, 1, 0, 2]))
    assert lora == "every cluster holding two pink, one orange and one gold balloon"
    _lora_limpia(lora)
    assert gemini == (
        "COLOR PATTERN — every four-balloon cluster is the same: two pink, one orange and one"
        " gold round latex balloons, in the order pink, orange, pink, gold around the cluster."
        " The clusters repeat one after another along its length, each one turned a little"
        " further in the same direction, so the colors trace a soft spiral through the"
        " balloons. The pattern comes only from the balloons' own colors; keep the order"
        " unbroken and do not randomize."
    )
    assert not re.search(r"stripe|band|ribbon|wrapped|winding|diagonal", gemini)


@pytest.mark.parametrize(
    ("trazo", "giro"),
    [
        ("zigzag", "turned one way for two clusters and the other way for the next two"),
        ("recto", "all turned the same way, so each color lines up along the garland"),
    ],
)
def test_los_otros_trazos_tampoco_son_franjas(trazo: str, giro: str) -> None:
    gemini, lora = _frases(_guirnalda(("rosado", "blanco")), _espiral([0, 1, 0, 1], trazo))
    # El trazo es cómo se gira cada racimo al armarlo; en el caption, los racimos.
    assert lora == "every cluster holding two pink and two white balloons"
    _lora_limpia(lora)
    assert giro in gemini
    assert not re.search(r"stripe|band|ribbon|chevron", gemini)


@pytest.mark.parametrize(
    ("colores", "racimo", "lora"),
    [
        # Quinteto de dos colores: el número va con el plural.
        (
            ("rosado", "blanco"),
            [0, 1, 0, 1, 0],
            "every cluster holding three pink and two white balloons",
        ),
        # Trío de tres colores: uno de cada uno.
        (
            ("rosado", "blanco", "dorado"),
            [0, 1, 2],
            "every cluster holding one pink, one white and one gold balloon",
        ),
        # Dos materiales del mismo color (dos acabados) son un solo nombre y suman.
        (
            ("rosado", "rosado", "dorado"),
            [0, 1, 0, 2],
            "every cluster holding three pink and one gold balloon",
        ),
    ],
)
def test_cuantos_globos_de_cada_color(
    colores: Sequence[str], racimo: Sequence[int], lora: str
) -> None:
    _gemini, frase = _frases(_guirnalda(colores, racimo=len(racimo)), _espiral(racimo))
    assert frase == lora
    _lora_limpia(frase)


def test_los_acentos_siguen_detras() -> None:
    patron = _espiral([0, 1, 0, 1], acentos=[{"material": 2, "cada": 3, "desde": 1}])
    _gemini, lora = _frases(_guirnalda(("rosado", "blanco", "dorado")), patron)
    assert lora == (
        "every cluster holding two pink and two white balloons, with evenly spaced gold accent"
        " clusters"
    )


# --- Anillos sobre los racimos del armado -------------------------------------------------


def test_los_anillos_de_la_guirnalda_armada_son_racimos_de_un_color() -> None:
    gemini, lora = _frases(_guirnalda(("rosado", "blanco")), _anillos([0, 1]))
    assert lora == "each cluster one solid color, pink and white in turn along its length"
    _lora_limpia(lora)
    # La frase Gemini ya hablaba de racimos de un color: no cambia.
    assert gemini == (
        "COLOR PATTERN — each cluster is a single color; clusters follow the order pink → white,"
        " 2 clusters per color, repeating along its length."
    )
    en_u = _guirnalda(("rosado", "blanco"), forma="u_invertida")
    _gemini, espejo = _frases(en_u, _anillos([0, 1], simetria="espejo"))
    assert espejo == (
        "each cluster one solid color, pink and white in turn from both ends up to the center,"
        " mirrored on each side"
    )


# --- Sin armado, byte a byte lo de antes ---------------------------------------------------


@pytest.mark.parametrize("tipo", ["guirnalda", "columna", "arco"])
def test_sin_armado_la_espiral_y_los_anillos_no_cambian(tipo: str) -> None:
    eje = {
        "guirnalda": "along its length",
        "columna": "from base to top",
        "arco": "from the left base over the top to the right base",
    }[tipo]
    sin_armado = _guirnalda(racimo=None, tipo=tipo)
    gemini, lora = _frases(sin_armado, _espiral([0, 1, 0, 2]))
    assert lora == f"wrapped in a spiral of pink, orange and gold stripes winding {eje}"
    assert gemini == (
        "COLOR PATTERN — build it from identical four-balloon clusters (pink, orange, pink, gold"
        " around each cluster) rotated one eighth of a turn per layer so the colors form"
        f" continuous diagonal spiral stripes winding {eje}; keep the order unbroken and do not"
        " randomize."
    )
    dos_colores = _guirnalda(("rosado", "blanco"), racimo=None, tipo=tipo)
    _gemini, anillos = _frases(dos_colores, _anillos([0, 1]))
    assert anillos == f"built with stacked bands of pink and white repeating {eje}"


def test_la_unidad_del_armado_solo_cambia_la_redaccion_de_una_guirnalda() -> None:
    # Una columna nunca tiene racimos de armado: su espiral son franjas de verdad.
    columna = _guirnalda(tipo="columna")
    assert _frases(columna, _espiral([0, 1, 0, 2])) == _frases(
        _guirnalda(racimo=None, tipo="columna"), _espiral([0, 1, 0, 2])
    )


# --- El plan resuelto: armado y patrón juntos ---------------------------------------------


@pytest.mark.anyio
async def test_el_plan_resuelto_lleva_la_redaccion_nueva() -> None:
    armado = {
        "version": "armado-guirnalda.v1",
        "origen": "decorador",
        "soporte": "pared",
        "forma": "recta",
        "racimo": {"unidad": "cuarteto", "tamano_pulg_base": 12},
        "relleno": {"material": 0, "proporcion": 0.2},
        "remates": [],
    }
    tres = [
        material("rosado", 0.5, principal=True),
        material("blanco", 0.25),
        material("dorado", 0.25),
    ]
    resuelto = await resolver(
        plan(
            guirnalda(materiales=tres, armado_guirnalda=armado, patron_color=_espiral([0, 1, 0, 2]))
        )
    )
    armados = cast(list[dict[str, object]], resuelto["armados_guirnalda"])
    patrones = cast(list[dict[str, object]], resuelto["patrones_color"])
    assert len(armados) == 1 and len(patrones) == 1
    gemini_armado, lora_armado = str(armados[0]["prompt_gemini"]), str(armados[0]["prompt_lora"])
    # Decisión 28: en la pared, tras los racimos, la línea de los extremos libres.
    assert gemini_armado.endswith(
        "Keep the clusters packed tightly against each other so the garland reads as one"
        " continuous organic piece with no gaps, made only of round latex balloons: no ribbons,"
        " streamers, twisted bands or fabric. Both ends hang free in the air, well above the"
        " floor: no stands, no legs, no poles and no frame reaching the floor."
    )
    assert "twisted against each other" not in gemini_armado
    assert lora_armado == (
        "mounted flat high on the wall, both ends free, in clusters of four with small pink,"
        " white and gold filler balloons"
    )
    lora_patron = str(patrones[0]["prompt_lora"])
    assert lora_patron == "every cluster holding two pink, one white and one gold balloon"
    # Lo que Kagutsuchi pone detrás de los materiales (armado, coma, patrón).
    _lora_limpia(f"{lora_armado}, {lora_patron}")
    assert "round latex balloons" in str(patrones[0]["prompt_gemini"])
