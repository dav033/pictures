"""Las frases con las que un arco armado se cuenta a los modelos de imagen (ADR-0035, paso 1).

Un arco con ``armado_arco`` se cobra por su armado, así que la imagen tiene que leerlo: patrón con cada color en su
papel, forma, medidas ya armadas y tamaño del globo. Las escribe Python (dueño del armado) y TypeScript solo las
inserta. Aquí se comprueba lo que la imagen y el caption necesitan de ellas, sin fijar su redacción palabra por
palabra (la redacción es de Python y puede mejorar).
"""

from __future__ import annotations

import copy
import re
from collections.abc import Mapping, Sequence
from typing import cast

import pytest

from app.armado_arco import EstructuraArco, armado_resuelto, opciones_admitidas
from app.armado_arco_prompt import frases_arco

COLORES = [
    ("azul", None),
    ("blanco", None),
    ("dorado", "cromado"),
    ("rosado", None),
    ("negro", None),
    ("verde", None),
]
TONOS = ["#0000ff", "#ffffff", "#c9a227", "#ffc0cb", "#000000", "#00ff00"]

BASE: dict[str, object] = {
    "version": "armado-arco.v1",
    "origen": "decorador",
    "patron": "solido",
    "opciones": {},
    "geometria": {
        "forma": "herradura",
        "anchoM": 3.2,
        "altoM": 2.3,
        "globosAncho": 4,
        "suelo": True,
    },
    "globo": {
        "nominal": 12,
        "inflado": 1,
        "tamano": 1.14,
        "ovalo": 1.06,
        "separacion": 1,
        "compensacion": 0.85,
        "variacionTam": 0,
        "variacionTono": 0.03,
        "desorden": 0,
        "brillo": 0.6,
        "sombra": 0.17,
        "contorno": 1,
        "profundidad": 0.8,
        "semilla": 7,
    },
    "capas": [],
    "secciones": [],
    "materiales": [0],
}


def _armado(patron: str, cuantos: int, **cambios: object) -> dict[str, object]:
    armado = copy.deepcopy(BASE)
    armado.update(patron=patron, materiales=list(range(cuantos)), **cambios)
    return armado


def _frases(armado: Mapping[str, object]) -> tuple[str, str]:
    resuelto = armado_resuelto(EstructuraArco(es_arco=True, materiales=TONOS), armado)
    return frases_arco(armado, resuelto, COLORES)


PATRONES = [(p["id"], p["min_colores"]) for p in opciones_admitidas()["patrones"]]


@pytest.mark.parametrize(("patron", "colores"), PATRONES)
def test_cada_patron_del_motor_tiene_frase_para_gemini_y_para_el_lora(
    patron: str, colores: int
) -> None:
    gemini, lora = _frases(_armado(patron, colores))

    assert gemini.startswith("ARCH ASSEMBLY"), "el armado va primero y con su nombre"
    assert "round 12-inch latex balloons" in gemini
    assert "no ribbons, streamers or fabric" in gemini, (
        "solo globos: lección de las cintas (ADR-0032)"
    )
    assert len(gemini) <= 1500
    # El caption LoRA es ASCII, corto y sin cifras ni medidas (el LoRA no aprendió números).
    assert lora.isascii() and lora.strip() and len(lora) <= 600
    assert not re.search(r"\d", lora), lora
    assert "ribbon" not in lora.lower(), "el caption no nombra lo que no debe aparecer"
    # Cada color del patrón se nombra en inglés, en su papel; nunca el nombre del plan en español.
    for _en, es in (("blue", "azul"), ("white", "blanco")):
        if colores > ["azul", "blanco"].index(es):
            assert _en in gemini and _en in lora, (patron, _en)
            assert es not in gemini.lower() and es not in lora.lower()


def test_gemini_dice_las_medidas_ya_armadas_y_la_forma_no_las_declaradas() -> None:
    # Pidió 2,3 m de alto; el motor arma la herradura con el alto que de verdad le sale.
    armado = _armado("solido", 1)
    resuelto = armado_resuelto(EstructuraArco(es_arco=True, materiales=TONOS), armado)
    gemini, _lora = frases_arco(armado, resuelto, COLORES)

    assert f"about {round(resuelto['ancho_m'], 1):g} m wide" in gemini
    assert f"{round(resuelto['alto_m'], 1):g} m tall" in gemini
    assert "horseshoe arch with straight legs" in gemini
    assert f"{resuelto['columnas']} balloons wide" in gemini


@pytest.mark.parametrize(
    ("forma", "gemini_dice", "lora_dice"),
    [
        ("alto", "tall arch", "tall balloon arch"),
        ("semi", "half-circle arch", "half-circle balloon arch"),
        ("herradura", "horseshoe arch", "horseshoe balloon arch"),
    ],
)
def test_la_forma_se_dice_en_las_dos_frases(forma: str, gemini_dice: str, lora_dice: str) -> None:
    armado = _armado("solido", 1)
    cast(dict[str, object], armado["geometria"])["forma"] = forma

    gemini, lora = _frases(armado)

    assert gemini_dice in gemini and lora_dice in lora


def test_el_tamano_del_globo_va_con_cifra_en_gemini_y_con_palabra_en_el_lora() -> None:
    for nominal, palabra in ((5, "small"), (12, ""), (24, "large"), (36, "giant")):
        armado = _armado("solido", 1)
        cast(dict[str, object], armado["globo"])["nominal"] = nominal
        # Un globo grande necesita ancho: el motor lo sube y lo dice; aquí solo importa cómo se cuenta.
        armado["geometria"] = {
            **cast(dict[str, object], armado["geometria"]),
            "anchoM": 6,
            "altoM": 3.5,
        }
        gemini, lora = _frases(armado)
        assert f"round {nominal}-inch latex balloons" in gemini
        assert (
            (palabra in lora)
            if palabra
            else ("small" not in lora and "large" not in lora and "giant" not in lora)
        )


def test_el_acabado_va_en_gemini_y_no_en_el_lora() -> None:
    gemini, lora = _frases(_armado("espiralPunteada", 3))

    assert (
        "chrome" in gemini.lower() or "chromed" in gemini.lower() or "metallic" in gemini.lower()
    ), gemini
    assert "chrome" not in lora.lower()


def test_con_mas_de_cuatro_colores_el_caption_dice_una_mezcla_sin_cifras() -> None:
    _gemini, lora = _frases(_armado("arcoiris", 5))

    assert "a mix of five colors" in lora
    assert not re.search(r"\d", lora)


def test_invertir_lee_los_colores_al_reves() -> None:
    normal, _ = _frases(_armado("apilado", 3))
    invertido, _ = _frases(_armado("apilado", 3, opciones={"invertir": 1}))

    segmento = lambda texto: texto.split("center: ")[1].split(". ")[0]  # noqa: E731
    assert segmento(normal).startswith("blue") and segmento(normal).endswith("chrome gold")
    assert segmento(invertido).startswith("high-shine chrome gold") and segmento(
        invertido
    ).endswith("blue")


def test_es_determinista_y_no_toca_el_armado() -> None:
    armado = _armado("diamante", 3)
    antes = copy.deepcopy(armado)

    assert _frases(armado) == _frases(armado)
    assert armado == antes


def test_un_patron_que_el_motor_sume_y_la_tabla_no_conozca_no_inventa_un_dibujo() -> None:
    armado = _armado("solido", 2)
    armado["patron"] = "patron_nuevo"
    resuelto = armado_resuelto(EstructuraArco(es_arco=True, materiales=TONOS), _armado("solido", 2))

    gemini, _lora = frases_arco(
        armado, resuelto, cast(Sequence[tuple[str | None, str | None]], COLORES)
    )

    assert "in blue and white" in gemini
