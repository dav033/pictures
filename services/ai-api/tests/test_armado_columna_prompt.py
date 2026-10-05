"""Las frases con las que una columna clásica armada se cuenta a los modelos de imagen (ADR-0035).

Una columna con ``armado_columna`` se cobra por su armado —el patrón, los globos de cada anillo, el remate de
la punta—, así que la imagen tiene que leerlo. Las escribe Python (dueño del armado) y TypeScript solo las
inserta. Aquí se comprueba lo que la imagen y el caption necesitan **que la frase diga**, sin fijar su
redacción palabra por palabra (la redacción es de Python y puede mejorar).
"""

from __future__ import annotations

import copy
import re
from collections.abc import Mapping
from typing import cast

import pytest

from app.armado_columna import EstructuraColumna, armado_resuelto, opciones_admitidas
from app.armado_columna_prompt import frases_columna

#: ``(color, acabado)`` de cada material de la pieza, en el orden de ``materiales`` del plan.
COLORES: list[tuple[str, str]] = [
    ("azul", ""),
    ("blanco", ""),
    ("dorado", "cromado"),
    ("rosado", ""),
    ("negro", ""),
    ("verde", ""),
]
TONOS = ["#0000ff", "#ffffff", "#c9a227", "#ffc0cb", "#000000", "#00ff00"]
COLUMNA = EstructuraColumna(es_columna=True, materiales=TONOS)

BASE: dict[str, object] = {
    "version": "armado-columna.v1",
    "origen": "decorador",
    "modo": "altura",
    "patron": "espiral",
    "opciones": {"vueltas": 2, "inclinacion": 1},
    "cuerpo": {
        "alto_m": 1.6,
        "globos_capa": 4,
        "abajo": 12,
        "arriba": 12,
        "escalonado": True,
        "base": True,
    },
    "inflado": {
        "inflado": 1,
        "tamano": 1.14,
        "compresion": 0.8,
        "variacion_tam": 0,
        "variacion_tono": 0.03,
        "desorden": 0,
        "semilla": 7,
    },
    "remate": {"tipo": "ninguno", "tamano": 24, "cantidad": 5, "foil_m": 0.7, "material": 1},
    "capas": [],
    "materiales": [0, 1],
}

#: Los nueve patrones que publica el motor, con los colores que cada uno necesita.
PATRONES = [
    (cast(str, p["id"]), cast(int, p["min_colores"]))
    for p in cast(list[Mapping[str, object]], opciones_admitidas()["patrones"])
]
REMATES = list(cast(list[str], opciones_admitidas()["remates"]))


def _armado(**cambios: object) -> dict[str, object]:
    armado = copy.deepcopy(BASE)
    armado.update(cambios)
    return armado


def _con_patron(patron: str, cuantos: int, **cambios: object) -> dict[str, object]:
    # Sin opciones el motor pone el valor de partida de cada mando, que es como llega de la interfaz.
    cambios.setdefault("opciones", {})
    return _armado(patron=patron, materiales=list(range(cuantos)), **cambios)


def _con_remate(tipo: str, **cambios: object) -> dict[str, object]:
    """Un armado cuyo remate es del tipo pedido, con el dorado (índice 2) como su color."""
    return _armado(
        materiales=[0, 1, 2],
        remate={"tipo": tipo, "tamano": 24, "cantidad": 5, "foil_m": 0.7, "material": 2},
        **cambios,
    )


def _frases(armado: Mapping[str, object]) -> tuple[str, str]:
    return frases_columna(armado, armado_resuelto(COLUMNA, armado), COLORES)


def _cuerpo(armado: Mapping[str, object]) -> dict[str, object]:
    return cast(dict[str, object], armado["cuerpo"])


# --- Lo que las dos frases cumplen siempre -----------------------------------------------


@pytest.mark.parametrize(("patron", "colores"), PATRONES)
def test_cada_patron_del_motor_tiene_frase_para_gemini_y_para_el_lora(
    patron: str, colores: int
) -> None:
    gemini, lora = _frases(_con_patron(patron, colores))

    assert gemini.startswith("COLUMN ASSEMBLY - "), "el armado va primero y con su nombre"
    assert "round 12-inch latex balloons" in gemini, "el tamaño del globo va con cifra"
    assert "no ribbons, streamers or fabric" in gemini, (
        "solo globos redondos de látex: lección de las cintas (ADR-0032)"
    )
    assert len(gemini) <= 1500, "el contrato publica hasta 1500 caracteres"

    # El fragmento LoRA es ASCII, corto y sin cifras: el v004 no aprendió números.
    assert lora.isascii() and lora.strip() and len(lora) <= 600
    assert not re.search(r"\d", lora), lora
    # Es un modificador: el compilador ya escribió «a balloon column of ... balloons» y pega esto detrás.
    assert not re.match(r"an?\b", lora, flags=re.IGNORECASE), lora
    assert "column of" not in lora, "no se nombra una segunda columna"
    # Nunca un arco: en el vocabulario del corpus esa palabra es otra pieza.
    assert "arch" not in lora.lower() and "arch" not in gemini.lower()
    assert "ribbon" not in lora.lower()

    # Cada color del patrón se nombra en inglés, en su papel; nunca el nombre del plan en español.
    for ingles, espanol in [("blue", "azul"), ("white", "blanco"), ("gold", "dorado")][:colores]:
        assert ingles in gemini and ingles in lora, (patron, ingles)
        assert espanol not in gemini.lower() and espanol not in lora.lower()


@pytest.mark.parametrize(("patron", "colores"), PATRONES)
def test_el_fragmento_lora_va_entero_en_positivo(patron: str, colores: int) -> None:
    """FLUX no tiene prompt negativo: lo que la columna no es no se nombra (decisión 28 de ADR-0032)."""
    _gemini, lora = _frases(_con_patron(patron, colores))

    assert not re.search(r"\b(no|not|without|nothing|never)\b", lora, flags=re.IGNORECASE), lora


# --- El patrón ---------------------------------------------------------------------------


def test_la_espiral_se_dice_como_rayas_en_diagonal_que_dan_la_vuelta() -> None:
    gemini, lora = _frases(_con_patron("espiral", 2))

    for frase in (gemini, lora):
        assert "diagonal" in frase and "spiral" in frase
        assert "blue" in frase and "white" in frase


def test_la_espiral_sin_inclinacion_se_dice_como_rayas_verticales_rectas() -> None:
    """Con ``inclinacion: 0`` el motor pinta rayas rectas, y la frase no puede prometer una espiral."""
    gemini, lora = _frases(_con_patron("espiral", 2, opciones={"vueltas": 2, "inclinacion": 0}))

    for frase in (gemini, lora):
        assert "vertical" in frase and "spiral" not in frase


def test_las_rayas_son_verticales_y_el_apilado_son_anillos_de_color() -> None:
    """Los dos patrones de «anillos» del motor no son el mismo dibujo y no se dicen igual.

    ``rayas`` colorea por posición dentro del anillo (rayas verticales que se repiten alrededor);
    ``apilado`` colorea por capa (bandas horizontales apiladas de abajo arriba).
    """
    rayas_gemini, rayas_lora = _frases(_con_patron("rayas", 2))
    apilado_gemini, apilado_lora = _frases(_con_patron("apilado", 2))

    for frase in (rayas_gemini, rayas_lora):
        assert "vertical" in frase and "around the column" in frase
    for frase in (apilado_gemini, apilado_lora):
        assert "horizontal bands" in frase and "bottom up" in frase
    assert "vertical" not in apilado_gemini and "vertical" not in apilado_lora


def test_el_diamante_pone_cada_color_en_su_papel() -> None:
    """El motor pinta el centro con el segundo color, su anillo con el tercero y el fondo con el primero."""
    gemini, _lora = _frases(_con_patron("diamante", 3))

    centro = gemini.index("white")
    anillo = gemini.index("high-shine chrome gold")
    fondo = gemini.index("blue background")
    assert centro < anillo < fondo, gemini


def test_el_diamante_con_dos_colores_no_inventa_un_anillo_que_el_motor_no_pinta() -> None:
    """Sin tercer color el motor no dibuja el anillo del rombo: solo rombos sobre el fondo."""
    gemini, _lora = _frases(_con_patron("diamante", 2))

    assert "diamond" in gemini and "ringed by" not in gemini


def test_el_punteado_dice_el_fondo_y_los_puntos() -> None:
    gemini, lora = _frases(_con_patron("punteado", 2))

    for frase in (gemini, lora):
        assert "blue background" in frase and "white balloons" in frase


def test_el_ombre_dice_el_degradado_de_abajo_arriba_y_invertir_lo_voltea() -> None:
    normal, _ = _frases(_con_patron("ombre", 3))
    invertido, _ = _frases(
        _con_patron("ombre", 3, opciones={"suavidad": 0.6, "invertir": 1}),
    )

    assert "from blue at the base" in normal and "chrome gold at the top" in normal
    assert "from high-shine chrome gold at the base" in invertido
    assert "blue at the top" in invertido


def test_el_azar_se_dice_como_azar_y_no_como_un_dibujo() -> None:
    gemini, lora = _frases(_con_patron("aleatorio", 3))

    for frase in (gemini, lora):
        assert "at random" in frase


def test_con_mas_de_cuatro_colores_el_caption_dice_una_mezcla_sin_cifras() -> None:
    _gemini, lora = _frases(_con_patron("aleatorio", 5))

    assert "a mix of five colors" in lora
    assert not re.search(r"\d", lora)


def test_un_patron_que_el_motor_sume_y_la_tabla_no_conozca_no_inventa_un_dibujo() -> None:
    resuelto = armado_resuelto(COLUMNA, _con_patron("solido", 2))
    futuro = _con_patron("solido", 2)
    futuro["patron"] = "patron_nuevo"

    gemini, lora = frases_columna(futuro, resuelto, COLORES)

    assert "in blue and white" in gemini and "in blue and white" in lora


def test_por_capas_no_promete_un_patron_que_el_motor_no_aplica() -> None:
    """Por capas la lista de capas **es** el diseño: el patrón del armado no colorea nada."""
    armado = _armado(
        modo="capas",
        patron="espiral",
        capas=[
            {"tamano": 12, "materiales": [0, 1, 0, 1]},
            {"tamano": 12, "materiales": [1, 1, 0, 0, 1]},
        ],
    )

    gemini, lora = _frases(armado)

    for frase in (gemini, lora):
        assert "spiral" not in frase and "diagonal" not in frase
        assert "one by one" in frase
    # Las capas de este armado no llevan los mismos globos y la frase lo dice sin mentir.
    assert "4 to 5" in gemini and "four to five" in lora


# --- El cuerpo ---------------------------------------------------------------------------


def test_gemini_dice_las_medidas_que_el_motor_armo_y_no_las_pedidas() -> None:
    armado = _con_remate("globo")
    resuelto = armado_resuelto(COLUMNA, armado)

    gemini, _lora = frases_columna(armado, resuelto, COLORES)

    assert f"about {round(cast(float, resuelto['alto_total_m']), 1):g} m tall" in gemini
    assert f"{round(cast(float, resuelto['diametro_m']), 1):g} m across" in gemini
    assert f"stack of {resuelto['capas']} rings" in gemini
    # El alto pedido (1,6 m) no es el que el motor arma con un globo de remate encima.
    assert "1.6 m tall" not in gemini


@pytest.mark.parametrize(
    ("globos_capa", "palabra"), [(3, "three"), (4, "four"), (5, "five"), (6, "six")]
)
def test_los_globos_por_anillo_van_con_cifra_en_gemini_y_en_palabra_en_el_lora(
    globos_capa: int, palabra: str
) -> None:
    armado = _armado()
    _cuerpo(armado)["globos_capa"] = globos_capa

    gemini, lora = _frases(armado)

    assert f"rings of {globos_capa} round" in gemini
    assert f"rings of {palabra} round" in lora
    assert not re.search(r"\d", lora)


@pytest.mark.parametrize(
    ("nominal", "palabra"), [(5, "small"), (9, "small"), (12, ""), (24, "large"), (36, "giant")]
)
def test_el_tamano_del_globo_va_con_cifra_en_gemini_y_con_palabra_en_el_lora(
    nominal: int, palabra: str
) -> None:
    armado = _armado()
    _cuerpo(armado).update(abajo=nominal, arriba=nominal)

    gemini, lora = _frases(armado)

    assert f"round {nominal}-inch latex balloons" in gemini
    if palabra:
        assert f"{palabra} round balloons" in lora
    else:
        assert not any(p in lora for p in ("small round", "large round", "giant round"))


def test_una_columna_que_se_afina_lo_dice_y_no_pide_grosor_constante() -> None:
    armado = _armado()
    _cuerpo(armado).update(abajo=24, arriba=12)

    gemini, lora = _frases(armado)

    assert "24-inch" in gemini and "12-inch" in gemini
    assert "same thickness" not in gemini, "pedir grosor constante contradiría la columna afinada"
    assert "larger at the base" in lora and "smaller at the top" in lora


def test_el_escalonado_se_dice_en_las_dos_frases() -> None:
    escalonada_gemini, escalonada_lora = _frases(_armado())
    recta = _armado()
    _cuerpo(recta)["escalonado"] = False
    recta_gemini, recta_lora = _frases(recta)

    assert "nest in the gaps" in escalonada_gemini and "nested into the gaps" in escalonada_lora
    assert "straight" in recta_gemini and "straight" in recta_lora
    assert "nest" not in recta_lora


def test_el_plato_de_la_base_entra_en_la_frase_de_gemini() -> None:
    con_plato, _ = _frases(_armado())
    sin_plato_armado = _armado()
    _cuerpo(sin_plato_armado)["base"] = False
    sin_plato, _ = _frases(sin_plato_armado)

    assert "base plate" in con_plato
    assert "base plate" not in sin_plato and "on the floor" in sin_plato


# --- El remate ---------------------------------------------------------------------------


@pytest.mark.parametrize("tipo", REMATES)
def test_los_cinco_remates_se_cuentan_en_las_dos_frases(tipo: str) -> None:
    assert tipo in ("ninguno", "globo", "racimo", "estrella", "corazon")
    gemini, lora = _frases(_con_remate(tipo))

    assert lora.isascii() and not re.search(r"\d", lora)
    if tipo == "ninguno":
        # En positivo: cómo termina la punta, no lo que no lleva (el «no topper» le hace dibujar uno).
        assert "flush" in gemini and "top ring" in gemini
        assert "flush" in lora and "top ring" in lora
        assert "topped" not in lora and "crown" not in lora.lower()
        return
    assert "Crown it" in gemini, gemini
    assert "topped with" in lora, lora


def test_sin_remate_la_punta_se_describe_y_el_caption_no_corona_nada() -> None:
    """El fallo del 2026-10-04: el LoRA coronó con un globo gigante una columna que el plan no corona."""
    _gemini, lora = _frases(_con_remate("ninguno"))

    assert not re.search(r"\b(topper|topped|star|heart|cluster)\b", lora, flags=re.IGNORECASE), lora
    assert "level" in lora or "bare" in lora


def test_el_remate_de_globo_dice_su_tamano_y_su_color() -> None:
    gemini, lora = _frases(_con_remate("globo"))

    assert "round 24-inch latex balloon in high-shine chrome gold" in gemini
    assert "large round balloon in gold" in lora


def test_el_remate_de_racimo_cuenta_el_que_el_motor_arma_no_el_que_se_pidio() -> None:
    """El motor baja el racimo a R18 para que no sea más ancho que la columna; la frase cuenta ese."""
    armado = _con_remate("racimo")
    resuelto = armado_resuelto(COLUMNA, armado)
    globos = cast(list[Mapping[str, object]], cast(dict[str, object], resuelto["remate"])["globos"])
    tamano = max(cast(int, g["tamano"]) for g in globos)
    cuantos = sum(cast(int, g["cantidad"]) for g in globos)

    gemini, lora = frases_columna(armado, resuelto, COLORES)

    assert tamano != 24, "el motor saneó el tamaño pedido; si no, este test ya no prueba nada"
    assert f"cluster of {cuantos} round {tamano}-inch latex balloons" in gemini
    assert "24-inch" not in gemini
    assert "cluster of five" in lora


@pytest.mark.parametrize(("tipo", "figura"), [("estrella", "star"), ("corazon", "heart")])
def test_el_remate_de_foil_se_dice_como_foil_y_queda_fuera_del_cierre_de_solo_latex(
    tipo: str, figura: str
) -> None:
    gemini, lora = _frases(_con_remate(tipo))

    assert f"{figura}-shaped foil balloon" in gemini
    assert "high-shine chrome gold" in gemini
    # El cierre de ADR-0032 no puede pedir que todo sea látex cuando la punta es un foil cotizado.
    assert "foil topper" in gemini and "whole column only of round latex" not in gemini
    assert "no ribbons, streamers or fabric" in gemini
    assert f"foil {figura}" in lora and "gold" in lora


def test_el_alto_del_remate_va_con_cifra_en_gemini_y_no_en_el_lora() -> None:
    armado = _con_remate("racimo")
    resuelto = armado_resuelto(COLUMNA, armado)

    gemini, lora = frases_columna(armado, resuelto, COLORES)

    assert f"{round(cast(float, resuelto['remate_alto_m']), 1):g} m" in gemini
    assert not re.search(r"\d", lora)


# --- Invariantes -------------------------------------------------------------------------


def test_el_acabado_va_en_gemini_y_no_en_el_lora() -> None:
    """El compilador del caption ya dice los acabados con el vocabulario del LoRA (ADR-0028 §8)."""
    gemini, lora = _frases(_con_patron("apilado", 3))

    assert "high-shine chrome gold" in gemini
    assert "gold" in lora and "chrome" not in lora


def test_un_indice_de_material_que_el_plan_no_tiene_no_inventa_un_color() -> None:
    armado = _con_patron("apilado", 2)
    resuelto = armado_resuelto(COLUMNA, armado)

    gemini, lora = frases_columna(armado, resuelto, [COLORES[0]])

    assert "blue" in gemini and "white" not in gemini
    assert "catalog color" not in gemini and "catalog color" not in lora


def test_es_determinista_y_no_toca_el_armado() -> None:
    armado = _con_patron("diamante", 3)
    antes = copy.deepcopy(armado)

    assert _frases(armado) == _frases(armado)
    assert armado == antes
