"""Patrón de color de una guirnalda armada (ADR-0032, entrega E5).

El patrón decide el color de cada globo de los racimos; el armado decide la
unidad, el soporte, la forma, el relleno y los remates. Lo que se fija aquí:

- sin armado, ``sugerir_patron`` da exactamente lo de antes (confeti con
  varios tamaños, espiral de cuartetos con uno);
- con armado, el preset va por racimo (espiral si los colores caben en un
  racimo, anillos si no) con ``globos_por_racimo`` = la unidad del armado, y
  la unidad del armado manda sobre la de la foto;
- el espejo se admite en una guirnalda armada en U invertida, simétrica desde
  el centro, y en nada más que un arco;
- el armado colorea sus racimos con el patrón expandido sobre ellos
  (``filas_de_racimos``), no con filas de la rejilla tomadas a lo largo;
- una edición que saca la guirnalda de la U le quita el espejo con aviso.

Las rejillas pequeñas se cuentan a mano en el comentario de cada caso.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import replace
from typing import cast

import pytest

from app.patron_color import (
    EstructuraPatron,
    MaterialPatron,
    PatronColorInvalido,
    filas_de_racimos,
    modos_admitidos,
    patron_desde_pista,
    patron_resuelto,
    sugerir_patron,
    validar_y_expandir,
)
from app.plan_edicion import (
    AVISO_ARMADO_GUIRNALDA_QUITADO,
    AVISO_ESPEJO_GUIRNALDA,
    EdicionArmadoGuirnalda,
    EdicionMezcla,
    editar_plan,
)
from tests.guirnalda_datos import GUIRNALDA, estructura_del_plan, guirnalda, plan, resolver


def _guirnalda(
    *,
    total: int = 48,
    un_tamano: bool = False,
    partes: Sequence[float] = (0.6, 0.4),
    racimo: int | None = None,
    forma: str | None = None,
    tipo: str = "guirnalda",
) -> EstructuraPatron:
    colores = ("rosado", "blanco", "dorado", "negro")[: len(partes)]
    return EstructuraPatron(
        estructura_id="EST_01_GUIRNALDA",
        tipo=tipo,
        total=total,
        un_tamano=un_tamano,
        ancho_m=None,
        alto_m=None,
        repeticiones=1,
        materiales=tuple(
            MaterialPatron(color=color, acabado=None, participacion=parte)
            for color, parte in zip(colores, partes, strict=True)
        ),
        racimo_armado=racimo,
        forma_armado=forma,
    )


def _patron(base: Mapping[str, object], **extra: object) -> dict[str, object]:
    return {"version": "patron-color.v1", "origen": "decorador", "base": dict(base), **extra}


def _filas(estructura: EstructuraPatron, patron: Mapping[str, object]) -> list[list[int]]:
    return [list(fila) for fila in validar_y_expandir(estructura, patron).celdas]


def _armado(**extra: object) -> dict[str, object]:
    return {
        "version": "armado-guirnalda.v1",
        "origen": "decorador",
        "soporte": "pared",
        "forma": "recta",
        "racimo": {"unidad": "cuarteto", "tamano_pulg_base": 12},
        "relleno": {"material": 0, "proporcion": 0.2},
        "remates": [],
        **extra,
    }


U_INVERTIDA = {
    "soporte": "colgada",
    "forma": "u_invertida",
    "caida_m": 0.6,
    "puntos_de_anclaje": 2,
}


# --- Sin armado, lo de siempre ------------------------------------------------------------


def test_sin_armado_el_preset_es_el_de_antes() -> None:
    # Varios tamaños: confeti por participación (60/40) con la semilla del id.
    confeti = sugerir_patron(_guirnalda())
    assert cast(Mapping[str, object], confeti["base"])["modo"] == "aleatorio"
    assert cast(Mapping[str, object], confeti["base"])["pesos"] == [
        {"material": 0, "peso": 60},
        {"material": 1, "peso": 40},
    ]
    assert "globos_por_racimo" not in confeti
    # Un solo tamaño: espiral de cuartetos. Racimo de 4 con 0,6/0,4: una posición por
    # color y las 2 que quedan por mayor resto de (1,4; 0,6) -> [1, 1] -> A,B,A,B.
    espiral = sugerir_patron(_guirnalda(un_tamano=True))
    assert espiral == {
        "version": "patron-color.v1",
        "origen": "sugerido",
        "base": {"modo": "espiral", "racimo": [0, 1, 0, 1], "trazo": "espiral"},
    }


def test_la_unidad_de_un_armado_solo_cuenta_en_una_guirnalda() -> None:
    columna = _guirnalda(tipo="columna", un_tamano=True)
    assert sugerir_patron(replace(columna, racimo_armado=3, forma_armado="u_invertida")) == (
        sugerir_patron(columna)
    )


# --- Preset por racimo ------------------------------------------------------------------


@pytest.mark.parametrize(
    ("partes", "racimo", "base"),
    [
        # Cuarteto con dos colores (0,6/0,4): A,B,A,B, igual que el preset de un tamaño.
        ((0.6, 0.4), 4, {"modo": "espiral", "racimo": [0, 1, 0, 1], "trazo": "espiral"}),
        # Trío: una por color y la que queda por mayor resto de (0,8; 0,2) -> A,B,A.
        ((0.6, 0.4), 3, {"modo": "espiral", "racimo": [0, 1, 0], "trazo": "espiral"}),
        # Quinteto con tres colores (0,5/0,3/0,2): una por color y las 2 que quedan por
        # mayor resto de (1,5; 0,5; 0) -> 1,5 y 0,5 empatan en resto y gana A: A:3, B:1,
        # C:1, intercalados sin repetir el anterior -> A,B,A,C,A.
        (
            (0.5, 0.3, 0.2),
            5,
            {"modo": "espiral", "racimo": [0, 1, 0, 2, 0], "trazo": "espiral"},
        ),
        # Cuatro colores no caben en un trío: anillos, un color por racimo, de mayor
        # a menor participación.
        (
            (0.1, 0.4, 0.3, 0.2),
            3,
            {"modo": "anillos", "secuencia": [1, 2, 3, 0], "largo": 1},
        ),
    ],
)
def test_con_armado_el_preset_va_por_racimo(
    partes: Sequence[float], racimo: int, base: Mapping[str, object]
) -> None:
    estructura = _guirnalda(partes=partes, racimo=racimo)
    preset = sugerir_patron(estructura)
    assert preset == {
        "version": "patron-color.v1",
        "origen": "sugerido",
        "globos_por_racimo": racimo,
        "base": base,
    }
    expansion = validar_y_expandir(estructura, preset)
    assert expansion.geometria == "racimos" and expansion.columnas == racimo


def test_la_unidad_del_armado_manda_sobre_la_de_la_foto() -> None:
    pista = {
        "referencia_element_id": "ref-1",
        "modo": "espiral",
        "colores": ["rosado", "blanco"],
        "globos_por_racimo": 4,
        "confianza": 0.9,
    }
    armada = cast(Mapping[str, object], patron_desde_pista(_guirnalda(racimo=3), pista))
    assert armada["globos_por_racimo"] == 3
    assert cast(Mapping[str, object], armada["base"])["racimo"] == [0, 1, 0]
    sin_armado = cast(Mapping[str, object], patron_desde_pista(_guirnalda(), pista))
    assert sin_armado["globos_por_racimo"] == 4


# --- Espejo en U invertida ----------------------------------------------------------------

BLOQUES = {"modo": "bloques", "bloques": [{"material": 0, "peso": 1}, {"material": 1, "peso": 1}]}


def test_el_espejo_se_arma_en_una_guirnalda_en_u_invertida() -> None:
    # 24 globos de un tamaño en cuartetos: 6 filas. Con espejo, L' = 3 y los bloques
    # miden mayor resto de 3 por (1, 1) = [2, 1]: filas r' = 0,1,2,2,1,0 -> A,A,B,B,A,A.
    u = _guirnalda(total=24, un_tamano=True, racimo=4, forma="u_invertida")
    con_espejo = _filas(u, _patron(BLOQUES, simetria="espejo"))
    assert [fila[0] for fila in con_espejo] == [0, 0, 1, 1, 0, 0]
    assert con_espejo == con_espejo[::-1], "simétrica desde el centro"
    # Sin espejo, los bloques van de un extremo al otro: 3 y 3.
    assert [fila[0] for fila in _filas(u, _patron(BLOQUES))] == [0, 0, 0, 1, 1, 1]


@pytest.mark.parametrize(
    "estructura",
    [
        _guirnalda(total=24, un_tamano=True, racimo=4, forma="recta"),
        _guirnalda(total=24, un_tamano=True, racimo=4, forma="arco_caido"),
        _guirnalda(total=24, un_tamano=True),
    ],
    ids=["recta", "arco_caido", "sin_armado"],
)
def test_el_espejo_no_se_arma_en_otra_guirnalda(estructura: EstructuraPatron) -> None:
    with pytest.raises(PatronColorInvalido) as error:
        validar_y_expandir(estructura, _patron(BLOQUES, simetria="espejo"))
    assert error.value.motivo == "simetria_no_permitida"
    assert "U invertida" in error.value.mensaje


def test_el_arco_conserva_su_espejo_y_su_mensaje() -> None:
    columna = _guirnalda(tipo="columna", total=24, un_tamano=True)
    with pytest.raises(PatronColorInvalido) as error:
        validar_y_expandir(columna, _patron(BLOQUES, simetria="espejo"))
    assert error.value.mensaje == "El espejo solo se arma en un arco."


def test_modos_admitidos_ofrecen_espejo_solo_en_u_invertida() -> None:
    u = modos_admitidos(_guirnalda(racimo=4, forma="u_invertida"))
    assert [(item["modo"], item["espejo"]) for item in u] == [
        ("espiral", True),
        ("anillos", True),
        ("bloques", True),
        ("degradado", True),
        ("aleatorio", False),
        ("flor", True),
    ]
    for forma in (None, "recta", "arco_caido"):
        assert not any(
            item["espejo"] for item in modos_admitidos(_guirnalda(racimo=4, forma=forma))
        )


def test_la_redaccion_en_espejo_va_desde_cada_extremo_hasta_el_centro() -> None:
    # 20 globos en cuartetos: 5 filas; con espejo L' = 3, bloques [2, 1] y la fila del
    # centro (impar) es una sola: 2 cuartetos rosados desde cada extremo, 1 blanco al centro.
    u = _guirnalda(total=20, un_tamano=True, racimo=4, forma="u_invertida")
    resuelto = patron_resuelto(u, _patron(BLOQUES, simetria="espejo"), aplicado=True)
    assert "desde cada extremo hasta el centro, en espejo" in str(resuelto["descripcion"])
    assert (
        "Arma los bloques en orden, desde cada extremo hasta el centro: 2 cuartetos de rosado (1);"
        " en el centro, 1 cuarteto de blanco (2)."
    ) in cast(list[str], resuelto["instrucciones"])
    assert "from both ends up to the center, mirrored on each side" in str(
        resuelto["prompt_gemini"]
    )
    lora = str(resuelto["prompt_lora"])
    assert lora == (
        "color-blocked in sections of pink, then white from both ends up to the center,"
        " mirrored on each side"
    )
    assert lora.isascii() and not any(caracter.isdigit() for caracter in lora)
    acento = _patron(
        {"modo": "espiral", "racimo": [0, 0, 0, 0], "trazo": "espiral"},
        simetria="espejo",
        acentos=[{"material": 1, "cada": 2, "desde": 1, "posiciones": [0]}],
    )
    instrucciones = cast(list[str], patron_resuelto(u, acento, aplicado=True)["instrucciones"])
    assert any("contando desde cada extremo" in linea for linea in instrucciones)


# --- El patrón sobre los racimos del armado ---------------------------------------------------


def test_filas_de_racimos_repite_el_estilo_sobre_los_racimos_que_se_arman() -> None:
    # 48 globos en cuartetos: la rejilla tiene 12 filas, pero el armado arma 8 racimos.
    estructura = _guirnalda(partes=(0.4, 0.3, 0.3), racimo=4)
    anillos = _patron({"modo": "anillos", "secuencia": [0, 1, 2], "largo": 1}, globos_por_racimo=4)
    filas = filas_de_racimos(estructura, anillos, 8)
    assert filas is not None
    assert [fila[0] for fila in filas] == [0, 1, 2, 0, 1, 2, 0, 1]
    # Tomar 8 de las 12 filas a lo largo (filas 0,2,3,5,6,8,9,11) perdía el blanco.
    rejilla = _filas(estructura, anillos)
    a_lo_largo = [rejilla[((2 * i + 1) * 12) // 16][0] for i in range(8)]
    assert 1 not in a_lo_largo


def test_filas_de_racimos_respeta_el_espejo_y_los_acentos() -> None:
    u = _guirnalda(racimo=4, forma="u_invertida")
    espejo = _patron({"modo": "anillos", "secuencia": [0, 1], "largo": 1}, simetria="espejo")
    # 7 racimos: r' = 0,1,2,3,2,1,0 -> A,B,A,B,A,B,A.
    filas = cast(tuple[tuple[int, ...], ...], filas_de_racimos(u, espejo, 7))
    assert [fila[0] for fila in filas] == [0, 1, 0, 1, 0, 1, 0]
    # Un acento cada 3 racimos desde el 2 (posición 1): racimos 2 y 5 de 6.
    acento = _patron(
        {"modo": "espiral", "racimo": [0, 0, 0, 0], "trazo": "espiral"},
        acentos=[{"material": 1, "cada": 3, "desde": 2, "posiciones": [0]}],
    )
    con_acento = cast(tuple[tuple[int, ...], ...], filas_de_racimos(u, acento, 6))
    assert [numero + 1 for numero, fila in enumerate(con_acento) if fila[0] == 1] == [2, 5]


def test_filas_de_racimos_no_cambia_los_pintados_ni_la_pared() -> None:
    pintado = _patron(
        {"modo": "espiral", "racimo": [0, 1, 0, 1], "trazo": "espiral"},
        pintados=[{"fila": 0, "material": 1}],
    )
    assert filas_de_racimos(_guirnalda(racimo=4), pintado, 8) is None
    pared = replace(_guirnalda(tipo="pared", total=12), ancho_m=4.0, alto_m=3.0)
    assert filas_de_racimos(pared, _patron(BLOQUES), 3) is None


# --- Dentro de la resolución y la edición -------------------------------------------------------


def _materiales_por_racimo(resuelto: Mapping[str, object]) -> list[list[int]]:
    armado = cast(list[dict[str, object]], resuelto["armados_guirnalda"])[0]
    material = {
        cast(int, entrada["codigo"]): cast(int, entrada["material"])
        for entrada in cast(list[dict[str, object]], armado["leyenda"])
    }
    return [
        [material[codigo] for codigo in cast(list[int], racimo["codigos"])]
        for racimo in cast(list[dict[str, object]], armado["racimos"])
    ]


@pytest.mark.anyio
async def test_sin_armado_la_confirmacion_da_el_patron_de_antes() -> None:
    resuelto = await resolver(plan(), completar_patrones=True)
    patron = cast(dict[str, object], estructura_del_plan(resuelto)["patron_color"])
    assert cast(Mapping[str, object], patron["base"])["modo"] == "aleatorio"
    assert "globos_por_racimo" not in patron


@pytest.mark.anyio
async def test_una_guirnalda_armada_recibe_el_patron_por_racimo_y_lo_sigue() -> None:
    # La clásica: el patrón por racimo es de los racimos que se compran (la orgánica la cuenta el motor).
    trio = _armado(racimo={"unidad": "trio", "tamano_pulg_base": 12}, relleno=None)
    resuelto = await resolver(
        plan(guirnalda(armado_guirnalda=trio, densidad="sencilla", mezcla="clasica")),
        completar_patrones=True,
    )
    patron = cast(dict[str, object], estructura_del_plan(resuelto)["patron_color"])
    assert patron["globos_por_racimo"] == 3
    assert patron["base"] == {"modo": "espiral", "racimo": [0, 1, 0], "trazo": "espiral"}
    racimos = _materiales_por_racimo(resuelto)
    assert racimos and all(racimo == [0, 1, 0] for racimo in racimos)


@pytest.mark.anyio
async def test_la_u_invertida_en_espejo_se_arma_simetrica() -> None:
    espejo = {
        "version": "patron-color.v1",
        "origen": "decorador",
        "globos_por_racimo": 4,
        "base": {"modo": "anillos", "secuencia": [0, 1], "largo": 2},
        "simetria": "espejo",
    }
    resuelto = await resolver(
        plan(
            guirnalda(
                armado_guirnalda=_armado(**U_INVERTIDA, relleno=None),
                patron_color=espejo,
                mezcla="clasica",
            )
        )
    )
    racimos = _materiales_por_racimo(resuelto)
    assert len(racimos) >= 4
    assert [racimo[0] for racimo in racimos] == [racimo[0] for racimo in racimos][::-1]
    assert {racimo[0] for racimo in racimos} == {0, 1}


def _plan_en_u_con_espejo() -> dict[str, object]:
    return plan(
        guirnalda(
            armado_guirnalda=_armado(**U_INVERTIDA),
            patron_color=_patron(BLOQUES, simetria="espejo", globos_por_racimo=4),
        )
    )


@pytest.mark.anyio
async def test_sacar_la_guirnalda_de_la_u_le_quita_el_espejo() -> None:
    recta = editar_plan(
        _plan_en_u_con_espejo(),
        EdicionArmadoGuirnalda(
            accion="armado_guirnalda", estructura_id=GUIRNALDA, armado_guirnalda=_armado()
        ),
    )
    patron = cast(dict[str, object], estructura_del_plan({"plan": recta.plan})["patron_color"])
    assert "simetria" not in patron and patron["base"] == BLOQUES
    assert recta.avisos == (AVISO_ESPEJO_GUIRNALDA,)
    await resolver(recta.plan)  # el plan editado se resuelve: el patrón vale sin espejo

    sin_armado = editar_plan(
        _plan_en_u_con_espejo(),
        EdicionArmadoGuirnalda(
            accion="armado_guirnalda", estructura_id=GUIRNALDA, armado_guirnalda=None
        ),
    )
    assert "simetria" not in cast(
        dict[str, object], estructura_del_plan({"plan": sin_armado.plan})["patron_color"]
    )
    assert sin_armado.avisos == (AVISO_ESPEJO_GUIRNALDA,)
    await resolver(sin_armado.plan)


@pytest.mark.anyio
async def test_una_edicion_que_quita_el_armado_en_u_quita_el_espejo() -> None:
    # Clásica no tiene globos chicos para el relleno: el armado se quita y, con él, la U.
    mezcla = EdicionMezcla(accion="mezcla", estructura_id=GUIRNALDA, mezcla="clasica")
    editado = editar_plan(_plan_en_u_con_espejo(), mezcla)
    estructura = estructura_del_plan({"plan": editado.plan})
    assert "armado_guirnalda" not in estructura
    assert "simetria" not in cast(dict[str, object], estructura["patron_color"])
    assert editado.avisos == (AVISO_ARMADO_GUIRNALDA_QUITADO, AVISO_ESPEJO_GUIRNALDA)
    await resolver(editado.plan)


@pytest.mark.anyio
async def test_seguir_en_u_conserva_el_espejo() -> None:
    otra_caida = editar_plan(
        _plan_en_u_con_espejo(),
        EdicionArmadoGuirnalda(
            accion="armado_guirnalda",
            estructura_id=GUIRNALDA,
            armado_guirnalda=_armado(**{**U_INVERTIDA, "caida_m": 0.8}),
        ),
    )
    patron = cast(dict[str, object], estructura_del_plan({"plan": otra_caida.plan})["patron_color"])
    assert patron["simetria"] == "espejo"
    assert otra_caida.avisos == ()
