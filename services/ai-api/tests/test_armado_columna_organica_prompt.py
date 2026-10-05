"""Las frases con las que una columna armada con el motor orgánico se cuenta a los modelos de imagen.

Lo que el caption sabía decir de una columna orgánica era «a balloon column of large and small ... balloons»: ni la
silueta, ni el lado hacia el que se va, ni cómo acaba arriba. El 2026-10-04 dos columnas rosa/blanco/plata salieron
de la LoRA con un globo gigante coronando cada una, que no está en el plan ni en la cotización, porque
``_armado_columna_organica`` apaga la corona a propósito y el prompt nunca se enteraba.

Aquí se comprueba lo que la imagen y el caption necesitan de las dos frases —que la silueta, la inclinación, el
serpenteo, el racimo y la punta se digan, y que el fragmento LoRA cumpla sus reglas— sin fijar la redacción palabra
por palabra: la redacción es de Python y puede mejorar.
"""

from __future__ import annotations

import copy
import re
from collections.abc import Mapping
from typing import Any

import pytest

from app.armado_columna_organica import (
    VERSION,
    EstructuraColumnaOrganica,
    armado_resuelto,
)
from app.armado_columna_organica_prompt import frases_columna_organica

#: La pieza del fallo del 2026-10-04: rosa, blanco y plata, con el plata como acento cromado.
MATERIALES = [("rosado", "mate"), ("blanco", "mate"), ("plateado", "cromado")]
TONOS = ["#ffc0cb", "#ffffff", "#c0c0c0"]

BASE: dict[str, Any] = {
    "version": VERSION,
    "origen": "sugerido",
    "forma": {
        "altoM": 2.2,
        "inclinacionM": 0.0,
        "serpenteoM": 0.0,
        "ondulacion": 0.3,
        "suelo": True,
        "persona": True,
    },
    "volumen": {
        "grosorPatasM": 0.85,
        "grosorCimaM": 0.45,
        "irregularidad": 0.4,
        "relleno": 0.6,
        "racimo": 4,
        "salientes": 0.35,
    },
    "tamanos": {
        "mezcla": {"5": 32, "12": 42, "18": 20, "24": 6},
        "grandesAbajo": 0.8,
        "inflado": 1,
        "variacion": 0.1,
    },
    "colores": {
        "paleta": [
            {"material": 0, "peso": 40, "acabado": "mate", "rol": "normal"},
            {"material": 1, "peso": 40, "acabado": "mate", "rol": "normal"},
            {"material": 2, "peso": 20, "acabado": "cromado", "rol": "acento"},
        ],
        "reparto": "azar",
        "mezcla": 0.5,
    },
    "adornos": {"follaje": 0.6, "flores": 0},
    "aspecto": {
        "brillo": 0.6,
        "sombra": 0.2,
        "contorno": 0.8,
        "profundidad": 0.5,
        "semilla": 11,
    },
    # Apagada, como la deja `_armado_columna_organica`: es el caso del fallo.
    "corona": {"activa": False, "tamano": 24, "material": 2},
}

#: Siluetas: el grosor de la punta frente al de la base, y qué tiene que decir cada frase de ellas. Se prueba lo
#: que dicen (se afina / es recta / se abre), no con qué palabras exactas lo dicen.
AFINA = r"taper|narrow(er|ing|s)? (toward|at|near) the top|thinner (toward|at) the top"
RECTA = r"same (width|thickness)|even (in )?(width|thickness)|straight-sided"
ABRE = r"widen|wider (toward|at) the top|flar(e|ing)|narrow(er)? at the base"


def armado(**cambios: Mapping[str, Any]) -> dict[str, Any]:
    """El armado de partida con uno o varios bloques cambiados por encima (``forma``, ``volumen``, ``corona``)."""
    copia = copy.deepcopy(BASE)
    for clave, valores in cambios.items():
        copia[clave] = {**copia[clave], **valores}
    return copia


def frases(armado_: Mapping[str, Any]) -> tuple[str, str]:
    """Las dos frases de un armado, pasando por el motor de verdad: las medidas son las ya armadas."""
    resuelto = armado_resuelto(
        EstructuraColumnaOrganica(es_columna=True, materiales=TONOS), armado_
    )
    return frases_columna_organica(armado_, resuelto, MATERIALES)


# ---------------------------------------------------------------------------
# La silueta
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("punta", "dice", "callan"),
    [
        # Punta bastante más delgada que la base: se afina al subir.
        (0.3, AFINA, (ABRE, RECTA)),
        # Punta como la base: recta de abajo arriba.
        (0.85, RECTA, (AFINA, ABRE)),
        # Punta más ancha que la base: se abre arriba.
        (1.4, ABRE, (AFINA, RECTA)),
    ],
    ids=["se_afina", "recta", "se_abre"],
)
def test_la_silueta_sale_del_grosor_de_la_base_frente_al_de_la_punta(
    punta: float, dice: str, callan: tuple[str, ...]
) -> None:
    gemini, lora = frases(armado(volumen={"grosorCimaM": punta}))

    for texto in (gemini, lora):
        assert re.search(dice, texto, re.I), texto
        for otra in callan:
            assert not re.search(otra, texto, re.I), (otra, texto)


def test_gemini_dice_las_medidas_ya_armadas_no_las_pedidas() -> None:
    pedido = armado(forma={"altoM": 2.4})
    resuelto = armado_resuelto(EstructuraColumnaOrganica(es_columna=True, materiales=TONOS), pedido)
    gemini, _lora = frases_columna_organica(pedido, resuelto, MATERIALES)

    for medida in ("alto_m", "grosor_base_m", "grosor_punta_m"):
        assert f"{round(float(resuelto[medida]), 1):g} m" in gemini, (medida, gemini)


# ---------------------------------------------------------------------------
# La inclinación y el serpenteo
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("inclinacion", "lado", "otro"),
    [(-0.4, "left", "right"), (0.4, "right", "left")],
    ids=["izquierda", "derecha"],
)
def test_la_inclinacion_nombra_su_lado(inclinacion: float, lado: str, otro: str) -> None:
    gemini, lora = frases(armado(forma={"inclinacionM": inclinacion}))

    for texto in (gemini, lora):
        assert re.search(rf"\b{lado}\b", texto, re.I), texto
        assert not re.search(rf"\b{otro}\b", texto, re.I), texto
    # Gemini lleva además cuánto se corre, en metros reales.
    assert "0.4 m" in gemini, gemini


def test_una_columna_derecha_no_nombra_ningun_lado() -> None:
    gemini, lora = frases(armado())

    for texto in (gemini, lora):
        assert not re.search(r"\b(left|right|leaning|tilt)", texto, re.I), texto


def test_el_serpenteo_se_dice_solo_cuando_se_ve() -> None:
    _sin_g, sin_lora = frases(armado(forma={"serpenteoM": 0.0}))
    con_gemini, con_lora = frases(armado(forma={"serpenteoM": 0.4}))

    assert not re.search(r"\bS\b|serpentin|wind|snak", sin_lora), sin_lora
    assert re.search(r"\bS\b|serpentin|wind|snak", con_lora), con_lora
    assert re.search(r"\bS\b|serpentin|wind|snak", con_gemini), con_gemini
    assert "0.4 m" in con_gemini, con_gemini


# ---------------------------------------------------------------------------
# El racimo
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(("racimo", "palabra"), [(1, "one"), (3, "three"), (5, "five")])
def test_el_racimo_va_en_palabras_en_el_lora_y_en_cifras_en_gemini(
    racimo: int, palabra: str
) -> None:
    gemini, lora = frases(armado(volumen={"racimo": racimo}))

    assert f"clusters of {palabra}" in lora, lora
    assert f"{racimo} balloon" in gemini, gemini


# ---------------------------------------------------------------------------
# La corona: el fallo del 2026-10-04
# ---------------------------------------------------------------------------


def test_con_la_corona_apagada_las_dos_frases_dicen_como_acaba_arriba() -> None:
    gemini, lora = frases(armado(corona={"activa": False}))

    # En positivo: lo que sí hay arriba son los mismos racimos del cuerpo.
    for texto in (gemini, lora):
        assert re.search(r"(end|finish)\w*\s.*\btop\b|\btop\b.*\b(same|rest)\b", texto, re.I), texto
        assert re.search(r"\b(same|rest)\b", texto, re.I), texto
    # Y en el fragmento LoRA, nunca en negativo: FLUX no tiene prompt negativo y «no large balloon on top» le hace
    # dibujar el globo, que es exactamente lo que pasó.
    assert not re.search(r"\b(no|not|without|never|avoid)\b", lora, re.I), lora
    assert not re.search(r"topped|topper|crown", lora, re.I), lora


def test_con_la_corona_encendida_las_dos_frases_la_nombran_con_su_tamano_y_su_color() -> None:
    gemini, lora = frases(armado(corona={"activa": True, "tamano": 24, "material": 2}))

    assert re.search(r"\b(top|crown)\w*\b", gemini, re.I), gemini
    assert "24-inch" in gemini, gemini
    assert "silver" in gemini, gemini
    # El caption no lleva cifras: el tamaño va en palabras, y el color es el del material de la corona.
    assert re.search(r"topped by|crowned", lora, re.I), lora
    assert re.search(r"\b(large|larger|giant|small)\b", lora, re.I), lora
    assert "silver" in lora, lora


@pytest.mark.parametrize(
    ("tamano", "palabra"),
    [(5, "small"), (9, "small"), (12, "larger"), (24, "large"), (36, "giant")],
)
def test_el_tamano_de_la_corona_se_dice_en_palabras_segun_lo_que_sobresale(
    tamano: int, palabra: str
) -> None:
    _gemini, lora = frases(armado(corona={"activa": True, "tamano": tamano, "material": 0}))

    assert f"topped by a {palabra} pink balloon" in lora, lora


def test_la_corona_apagada_y_la_encendida_no_dicen_lo_mismo() -> None:
    apagada = frases(armado(corona={"activa": False}))
    encendida = frases(armado(corona={"activa": True}))

    assert apagada[0] != encendida[0]
    assert apagada[1] != encendida[1]


# ---------------------------------------------------------------------------
# Las reglas de cada fragmento
# ---------------------------------------------------------------------------

#: Todos los armados que las reglas tienen que cumplir, sea cual sea la silueta, el lado o la punta.
VARIANTES = [
    ("base", armado()),
    ("afina", armado(volumen={"grosorCimaM": 0.3})),
    ("recta", armado(volumen={"grosorCimaM": 0.85})),
    ("abre", armado(volumen={"grosorCimaM": 1.4})),
    ("izquierda", armado(forma={"inclinacionM": -0.5}, volumen={"grosorCimaM": 0.3})),
    ("derecha_serpentea", armado(forma={"inclinacionM": 0.5, "serpenteoM": 0.5})),
    ("coronada", armado(corona={"activa": True})),
    ("racimo_uno", armado(volumen={"racimo": 1})),
]


@pytest.mark.parametrize(("nombre", "cual"), VARIANTES, ids=[v[0] for v in VARIANTES])
def test_el_fragmento_lora_es_ascii_sin_cifras_y_un_modificador(
    nombre: str, cual: Mapping[str, Any]
) -> None:
    _gemini, lora = frases(cual)

    assert lora.isascii(), (nombre, lora)
    assert lora.strip() == lora and lora, (nombre, lora)
    assert not re.search(r"\d", lora), (nombre, lora)
    assert "  " not in lora, (nombre, lora)
    assert len(lora) <= 600, (nombre, len(lora))
    # Es un modificador: el compilador ya escribió «a balloon column of ... balloons» y pega esto detrás con un
    # espacio. Empezar por el sustantivo (o por su artículo) nombraba dos columnas seguidas.
    assert not re.match(r"(an?|the)\s", lora), (nombre, lora)
    assert not re.match(r"[,;.]", lora), (nombre, lora)
    assert "column" not in lora.lower(), (nombre, lora)


@pytest.mark.parametrize(("nombre", "cual"), VARIANTES, ids=[v[0] for v in VARIANTES])
def test_el_fragmento_lora_no_nombra_un_arco_ni_una_estructura_de_apoyo(
    nombre: str, cual: Mapping[str, Any]
) -> None:
    _gemini, lora = frases(cual)

    # «asymmetrical balloon column» se dibujó doblándose como un medio arco (2026-10-03); y una pieza con patas,
    # bases o armazón es otra técnica y otra cotización. FLUX no tiene prompt negativo: no se nombran.
    for prohibida in ("arch", "stand", "leg", "frame"):
        assert prohibida not in lora.lower(), (nombre, prohibida, lora)
    assert "ribbon" not in lora.lower(), (nombre, lora)


@pytest.mark.parametrize(("nombre", "cual"), VARIANTES, ids=[v[0] for v in VARIANTES])
def test_gemini_se_presenta_cierra_con_solo_globos_y_nunca_nombra_un_arco(
    nombre: str, cual: Mapping[str, Any]
) -> None:
    gemini, _lora = frases(cual)

    assert gemini.startswith("COLUMN ASSEMBLY - "), (nombre, gemini)
    assert "round latex balloons" in gemini, (nombre, gemini)
    assert re.search(r"only of round latex balloons", gemini), (nombre, gemini)
    assert re.search(r"no ribbons", gemini), (nombre, gemini)
    assert "arch" not in gemini.lower(), (nombre, gemini)
    assert len(gemini) <= 1500, (nombre, len(gemini))


def test_los_colores_son_los_del_plan_en_ingles_nunca_en_espanol() -> None:
    gemini, lora = frases(armado(corona={"activa": True, "material": 2}))

    for ingles in ("pink", "white", "silver"):
        assert ingles in gemini, (ingles, gemini)
    assert "chrome" in gemini, "el acabado del material va con su color en la frase de Gemini"
    for espanol in ("rosado", "blanco", "plateado", "cromado", "mate"):
        assert espanol not in gemini.lower(), (espanol, gemini)
        assert espanol not in lora.lower(), (espanol, lora)


def test_un_indice_de_material_que_el_plan_no_tiene_se_descarta_en_vez_de_inventarse() -> None:
    sin_tercero = armado()
    sin_tercero["colores"] = {
        **BASE["colores"],
        "paleta": [
            {"material": 0, "peso": 50, "acabado": "mate", "rol": "normal"},
            {"material": 1, "peso": 50, "acabado": "mate", "rol": "normal"},
        ],
    }
    gemini, _lora = frases_columna_organica(
        sin_tercero,
        armado_resuelto(EstructuraColumnaOrganica(es_columna=True, materiales=TONOS), sin_tercero),
        MATERIALES[:1],
    )

    assert "pink" in gemini, gemini
    assert "white" not in gemini, gemini
