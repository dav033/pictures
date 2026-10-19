"""Las frases con las que un arco orgánico armado se cuenta a los modelos de imagen.

El arco orgánico se arma y se cobra por su armado desde el 2026-10-03, pero no producía ninguna frase: el
caption se quedaba en el sustantivo y los colores, y la proporción, la curva, el lado cargado y el grosor de
la banda salían a ojo del LoRA. Aquí se comprueba lo que la imagen y el caption necesitan de las dos frases
—que cada mando del armado llegue, y las reglas del fragmento LoRA (ASCII, sin cifras, un modificador que no
vuelve a nombrar el arco)— sin fijar su redacción palabra por palabra: la redacción es de Python y puede
mejorar.
"""

from __future__ import annotations

import copy
import re
from typing import Any, cast

import pytest

from app.armado_arco_organico import EstructuraArcoOrganico, armado_resuelto
from app.armado_arco_organico_prompt import frases_arco_organico
from app.armado_estructura import FORMA_SEMIARCO
from app.organico.formas import FORMAS_LISTAS

#: ``(color, acabado)`` de los materiales del plan, en su orden: a esto apuntan los índices de la paleta.
MATERIALES = [("dorado", "cromado"), ("blanco", "mate")]
TONOS = ["#c9a227", "#ffffff"]

#: El armado de partida del motor (``app/organico/tipos.config_inicial``) con la paleta del contrato: es el
#: que construye ``_armado_arco_organico`` para una pieza de dos colores.
BASE: dict[str, Any] = {
    "version": "armado-arco-organico.v1",
    "origen": "sugerido",
    "forma": {
        "anchoM": 4,
        "altoM": 2.6,
        "cima": 0.42,
        "curva": 2,
        "ondulacion": 0.3,
        "carga": 0.35,
        "corte": 1,
        "espejo": False,
        "suelo": True,
    },
    "volumen": {
        "grosorPatasM": 0.9,
        "grosorCimaM": 0.62,
        "irregularidad": 0.35,
        "relleno": 0.72,
        "racimo": 4,
        "salientes": 0.35,
    },
    "tamanos": {
        "mezcla": {"5": 32, "12": 45, "18": 18, "24": 5},
        "grandesAbajo": 0.6,
        "inflado": 1,
        "variacion": 0.1,
    },
    "colores": {
        "paleta": [
            {"material": 0, "peso": 60, "acabado": "cromado", "rol": "normal"},
            {"material": 1, "peso": 40, "acabado": "mate", "rol": "normal"},
        ],
        "reparto": "azar",
        "mezcla": 0.5,
    },
    "adornos": {"follaje": 0.8, "flores": 0},
    "aspecto": {"brillo": 0.6, "sombra": 0.2, "contorno": 0.8, "profundidad": 0.5, "semilla": 11},
}

#: Un arco resuelto de mentira: solo lo que la frase lee del motor. Las pruebas que miran una palabra no
#: necesitan colocar 400 globos, y la que sí lo hace (``test_las_medidas_son_las_que_armo_el_motor``) pasa por
#: el motor de verdad para que un cambio de nombre de campo se vea.
RESUELTO: dict[str, Any] = {
    "ancho_m": 4.0,
    "alto_m": 2.6,
    "grosor_patas_m": 0.9,
    "grosor_cima_m": 0.62,
    "sueltos": 0,
}


def _armado(
    *, forma: dict[str, Any] | None = None, volumen: dict[str, Any] | None = None
) -> dict[str, Any]:
    armado = copy.deepcopy(BASE)
    armado["forma"].update(forma or {})
    armado["volumen"].update(volumen or {})
    return armado


def _frases(armado: dict[str, Any], resuelto: dict[str, Any] | None = None) -> tuple[str, str]:
    medidas = dict(RESUELTO)
    medidas.update(
        ancho_m=float(armado["forma"]["anchoM"]),
        alto_m=float(armado["forma"]["altoM"]),
        grosor_patas_m=float(armado["volumen"]["grosorPatasM"]),
        grosor_cima_m=float(armado["volumen"]["grosorCimaM"]),
    )
    medidas.update(resuelto or {})
    return frases_arco_organico(armado, medidas, MATERIALES)


# ---------------------------------------------------------------------------
# Lo que las dos frases tienen que cumplir siempre
# ---------------------------------------------------------------------------

CASOS: list[tuple[str, dict[str, Any]]] = [
    ("de partida", {}),
    ("alto", {"forma": {"anchoM": 2.4, "altoM": 3.2}}),
    ("tendido", {"forma": {"anchoM": 7.0, "altoM": 1.8}}),
    ("medio arco", {"forma": {"corte": 0.7}}),
    ("medio arco volteado", {"forma": {"corte": 0.7, "espejo": True}}),
    ("herradura cargada", {"forma": {"curva": 3.2, "carga": -0.8, "cima": 0.34}}),
    ("en punta y simétrico", {"forma": {"curva": 1.7, "carga": 0, "cima": 0.5}}),
    ("engorda arriba", {"volumen": {"grosorPatasM": 0.45, "grosorCimaM": 1.2, "racimo": 1}}),
    ("racimo grande", {"volumen": {"racimo": 8}}),
]


@pytest.mark.parametrize(("nombre", "cambios"), CASOS, ids=[c[0] for c in CASOS])
def test_cada_armado_tiene_frase_para_gemini_y_para_el_lora(
    nombre: str, cambios: dict[str, Any]
) -> None:
    gemini, lora = _frases(_armado(**cast(Any, cambios)))

    assert gemini.startswith("ARCH ASSEMBLY - "), "el armado va primero y con su nombre"
    assert "round latex balloons" in gemini, "solo globos: lección de las cintas (ADR-0032)"
    assert "no ribbons, streamers, twisted bands or fabric" in gemini
    assert len(gemini) <= 1500
    # El fragmento LoRA es ASCII, corto y sin cifras ni medidas (el LoRA v004 no aprendió números).
    assert lora.isascii() and lora.strip() and len(lora) <= 600
    assert not re.search(r"\d", lora), lora
    assert "ribbon" not in lora.lower(), "el caption no nombra lo que no debe aparecer"


@pytest.mark.parametrize(("nombre", "cambios"), CASOS, ids=[c[0] for c in CASOS])
def test_el_fragmento_lora_es_un_modificador_y_no_vuelve_a_nombrar_el_arco(
    nombre: str, cambios: dict[str, Any]
) -> None:
    """El compilador ya escribió «an organic balloon garland arch of ... balloons» y pega esto detrás.

    Empezar por el sustantivo nombraba dos arcos seguidos, el fallo que ya tuvieron el bouquet y la
    guirnalda. En el corpus v004 un arco de verdad es «organic balloon garland arch» (regla 4 de
    ``scripts/lora/recaption-v004.ts``), así que ninguna de esas palabras puede volver.
    """
    _gemini, lora = _frases(_armado(**cast(Any, cambios)))

    assert not re.match(r"^an?\s", lora), lora
    for palabra in ("arch", "garland", "balloon arch"):
        assert palabra not in lora.lower(), (palabra, lora)


@pytest.mark.parametrize(("nombre", "cambios"), CASOS, ids=[c[0] for c in CASOS])
def test_las_dos_frases_dicen_que_apoya_en_el_suelo(nombre: str, cambios: dict[str, Any]) -> None:
    """Lo que distingue un arco de una guirnalda: se apoya en el suelo por sus patas."""
    gemini, lora = _frases(_armado(**cast(Any, cambios)))

    for frase in (gemini, lora):
        assert "standing on the floor on" in frase, frase
        assert "leg" in frase, frase


# ---------------------------------------------------------------------------
# Cada mando del armado en su trozo de frase
# ---------------------------------------------------------------------------


def test_un_arco_mas_alto_que_ancho_es_un_arco_alto() -> None:
    gemini, lora = _frases(_armado(forma={"anchoM": 2.4, "altoM": 3.2}))

    assert "taller than it is wide" in gemini
    assert "taller than it is wide" in lora
    assert "wider than it is tall" not in gemini


def test_un_arco_mucho_mas_ancho_que_alto_es_bajo_y_tendido() -> None:
    gemini, lora = _frases(_armado(forma={"anchoM": 7.0, "altoM": 1.8}))

    assert "low, wide arch" in gemini and "much wider than it is tall" in gemini
    assert "low and wide" in lora and "much wider than it is tall" in lora
    assert "taller than it is wide" not in lora


@pytest.mark.parametrize(
    ("curva", "gemini_dice", "lora_dice"),
    [
        (1.7, "sweeping up to a soft point", "sweeping up to a soft point"),
        (2.0, "a rounded sweep", "softly rounded"),
        (3.2, "like a horseshoe", "straight legs and a flat top"),
    ],
)
def test_la_curva_se_dice_segun_lo_cerrada_que_vaya(
    curva: float, gemini_dice: str, lora_dice: str
) -> None:
    gemini, lora = _frases(_armado(forma={"curva": curva}))

    assert gemini_dice in gemini and lora_dice in lora


@pytest.mark.parametrize(
    ("carga", "lado", "otro"), [(-0.8, "left", "right"), (0.8, "right", "left")]
)
def test_la_carga_nombra_el_lado_que_pesa_mas(carga: float, lado: str, otro: str) -> None:
    """Es lo que hace asimétrico a un arco orgánico: ``carga`` positiva carga la derecha."""
    gemini, lora = _frases(_armado(forma={"carga": carga}))

    assert f"more volume on the {lado} side" in gemini
    assert f"heavier and thicker on the {lado}" in lora
    assert f"heavier and thicker on the {otro}" not in lora


def test_una_carga_de_una_pizca_deja_los_dos_lados_iguales() -> None:
    gemini, lora = _frases(_armado(forma={"carga": 0.02}))

    assert "the same volume on both sides" in gemini
    assert "evenly weighted on both sides" in lora


@pytest.mark.parametrize(("cima", "lado"), [(0.32, "left"), (0.68, "right")])
def test_la_cima_corrida_dice_por_donde_pasa_el_punto_mas_alto(cima: float, lado: str) -> None:
    gemini, lora = _frases(_armado(forma={"cima": cima}))

    assert f"highest point shifted toward the {lado} side" in gemini
    assert f"highest point off to the {lado}" in lora


def test_la_cima_centrada_no_se_corre_a_ningun_lado() -> None:
    gemini, lora = _frases(_armado(forma={"cima": 0.5}))

    assert "highest point centered" in gemini and "highest point centered" in lora
    assert "shifted toward" not in gemini


def test_el_espejo_voltea_los_lados_que_se_nombran() -> None:
    """``espejo`` no se dice con la palabra «mirrored», que no significa nada sin una referencia.

    Lo que de verdad hace el motor es voltear la pieza: la cima pasa al otro lado y, en un medio arco, la
    pata que se apoya es la otra (``app/organico/espina.py`` corta por el final y luego voltea). La carga no
    se voltea: su factor se mide siempre de la pata izquierda a la derecha.
    """
    derecho, lora_derecho = _frases(_armado(forma={"cima": 0.34, "corte": 0.7, "carga": 0.6}))
    volteado, lora_volteado = _frases(
        _armado(forma={"cima": 0.34, "corte": 0.7, "carga": 0.6, "espejo": True})
    )

    assert "highest point off to the left" in lora_derecho
    assert "highest point off to the right" in lora_volteado
    assert "on its left leg" in derecho and "on its right leg" in volteado
    # El lado cargado es el mismo en las dos: lo dicen las dos frases sin cambiar de lado.
    for frase in (lora_derecho, lora_volteado):
        assert "heavier and thicker on the right" in frase
    assert "mirror" not in (volteado + lora_volteado).lower()


def test_un_medio_arco_no_promete_dos_patas_en_el_suelo() -> None:
    """``corte`` menor que 1 es un medio arco: sube por una pata y termina en el aire."""
    gemini, lora = _frases(_armado(forma={"corte": 0.7}))

    assert "on both legs" not in gemini and "on both legs" not in lora
    assert "on its left leg" in gemini
    assert "finishes free in the air on the right" in gemini
    assert "finishing free in the air on the right" in lora


def test_el_corte_con_el_que_sale_un_semiarco_del_plan_ya_dice_medio_arco() -> None:
    """La cifra de verdad, no una de prueba: la que ``_armado_arco_organico(medio=True)`` pone.

    El tipo ``semiarco`` del plan se arma con la forma lista ``FORMA_SEMIARCO`` del motor, y el productor de
    frases ya sabía leer ``corte``: lo que faltaba era que alguna pieza llegara con él. Esta prueba ata las
    dos puntas —el corte que la receta elige y la frase que la imagen lee— para que subir el corte por
    encima de 1 en el motor se vea aquí y no en un caption que promete dos patas en el suelo.
    """
    corte = next(forma.forma["corte"] for forma in FORMAS_LISTAS if forma.id == FORMA_SEMIARCO)
    assert corte < 1

    gemini, lora = _frases(_armado(forma={"corte": corte}))
    assert "on both legs" not in gemini and "on both legs" not in lora
    assert "climbing until it finishes free in the air" in gemini
    assert "climbing and finishing free in the air" in lora


@pytest.mark.parametrize(
    ("patas", "cima", "gemini_dice", "lora_dice"),
    [
        (
            1.2,
            0.45,
            "thickest at the legs and tapering toward the crown",
            "tapering toward the top",
        ),
        (0.45, 1.2, "slimmer at the legs and swelling toward the crown", "swelling toward the top"),
        (0.8, 0.8, "the same thickness all the way along", "the same thickness all the way along"),
    ],
)
def test_el_grosor_dice_si_engorda_hacia_arriba_o_hacia_abajo(
    patas: float, cima: float, gemini_dice: str, lora_dice: str
) -> None:
    gemini, lora = _frases(_armado(volumen={"grosorPatasM": patas, "grosorCimaM": cima}))

    assert gemini_dice in gemini and lora_dice in lora


@pytest.mark.parametrize(("racimo", "palabra"), [(1, "one"), (4, "four"), (8, "eight")])
def test_el_racimo_va_con_cifra_en_gemini_y_con_palabra_en_el_lora(
    racimo: int, palabra: str
) -> None:
    gemini, lora = _frases(_armado(volumen={"racimo": racimo}))

    assert f"from {racimo} balloon{'' if racimo == 1 else 's'} per cluster" in gemini
    assert f"in clusters of {palabra}" in lora


def test_los_colores_van_en_gemini_por_lo_que_el_plan_compra_y_no_en_el_caption() -> None:
    """El acabado se dice a Gemini; el fragmento LoRA no lleva colores: el caption ya los escribió."""
    gemini, lora = _frases(_armado())

    assert "gold" in gemini and "white" in gemini
    assert "chrome" in gemini.lower()
    assert "dorado" not in gemini.lower() and "blanco" not in gemini.lower()
    assert "gold" not in lora and "white" not in lora


def test_un_indice_de_material_que_el_plan_no_tiene_no_se_inventa() -> None:
    armado = _armado()
    armado["colores"]["paleta"] = [{"material": 7, "peso": 100, "acabado": "mate", "rol": "normal"}]

    gemini, _lora = _frases(armado)

    assert "the approved colors" in gemini


def test_los_globos_sueltos_del_motor_se_cierran_en_la_frase_de_gemini() -> None:
    con, _lora = _frases(_armado(), {"sueltos": 3})
    sin, _ = _frases(_armado(), {"sueltos": 0})

    assert "every balloon touches another" in con
    assert "every balloon touches another" not in sin


def test_es_determinista_y_no_toca_el_armado() -> None:
    armado = _armado(forma={"carga": -0.4, "corte": 0.8})
    antes = copy.deepcopy(armado)

    assert _frases(armado) == _frases(armado)
    assert armado == antes


# ---------------------------------------------------------------------------
# Contra el motor de verdad
# ---------------------------------------------------------------------------


def test_las_medidas_son_las_que_armo_el_motor_no_las_pedidas() -> None:
    """Gemini lee las medidas **ya armadas**: el motor recorta el alto y el grosor cuando no caben.

    Pasa por ``armado_resuelto`` de verdad (coloca los globos) para que un cambio en el nombre de un campo
    del motor no deje la frase describiendo otra pieza en silencio.
    """
    armado = _armado(forma={"anchoM": 3.2, "altoM": 2.2})
    resuelto = armado_resuelto(EstructuraArcoOrganico(es_arco=True, materiales=TONOS), armado)

    gemini, lora = frases_arco_organico(armado, resuelto, MATERIALES)

    assert f"about {round(float(resuelto['ancho_m']), 1):g} m wide" in gemini
    assert f"{round(float(resuelto['alto_m']), 1):g} m tall" in gemini
    assert f"about {round(float(resuelto['grosor_patas_m']), 1):g} m thick at the legs" in gemini
    assert f"{round(float(resuelto['grosor_cima_m']), 1):g} m at the crown" in gemini
    assert lora.isascii() and not re.search(r"\d", lora)
