"""La puerta pública del motor de guirnalda orgánica.

``tests/test_guirnalda.py`` prueba el motor contra los 199 vectores de oro, que es lo que demuestra que la
migración es 1 a 1. Esto prueba lo otro: que la puerta traduce entre el vocabulario del plan (índices de
material) y el del motor (una paleta con su acabado y su papel), que rechaza lo que no se sostiene y que el
dibujo sale con los colores de verdad.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.armado_guirnalda_organica import (
    DESPERDICIO_POR_DEFECTO,
    VERSION,
    ArmadoInvalido,
    EstructuraGuirnalda,
    armado_resuelto,
    limites_de,
    opciones_admitidas,
)


def armado(**cambios: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "version": VERSION,
        "origen": "sugerido",
        "forma": {
            "largoM": 4,
            "alturaM": 2.2,
            "pendienteM": 0,
            "ondaM": 0.12,
            "ondas": 1.5,
            "colgadoM": 0,
            "festones": 1,
            "carga": 0,
            "suelo": True,
            "persona": True,
        },
        "volumen": {
            "grosorPatasM": 0.4,
            "grosorCimaM": 0.62,
            "irregularidad": 0.4,
            "relleno": 0.72,
            "racimo": 4,
            "salientes": 0.35,
        },
        "tamanos": {"mezcla": {"5": 32, "12": 45, "18": 18}, "grandesAbajo": 0.3, "inflado": 1, "variacion": 0.1},
        "colores": {
            "paleta": [
                {"material": 0, "peso": 40, "acabado": "mate", "rol": "normal"},
                {"material": 1, "peso": 40, "acabado": "mate", "rol": "normal"},
            ],
            "reparto": "azar",
            "mezcla": 0.5,
        },
        "adornos": {"follaje": 0.5, "flores": 0},
        "aspecto": {"brillo": 0.6, "sombra": 0.2, "contorno": 0.8, "profundidad": 0.5, "semilla": 11},
    }
    base.update(cambios)
    return base


def guirnalda(*colores: str) -> EstructuraGuirnalda:
    return EstructuraGuirnalda(es_guirnalda=True, materiales=list(colores or ("#1f7a52", "#ffffff")))


def paleta(*entradas: dict[str, Any]) -> dict[str, Any]:
    return {"paleta": list(entradas), "reparto": "azar", "mezcla": 0.5}


# ---------------------------------------------------------------------------
# Lo que la puerta rechaza
# ---------------------------------------------------------------------------


def test_una_pieza_que_no_es_guirnalda() -> None:
    with pytest.raises(ArmadoInvalido) as caso:
        armado_resuelto(EstructuraGuirnalda(es_guirnalda=False, materiales=["#1f7a52"]), armado())
    assert caso.value.motivo == "no_es_guirnalda"


@pytest.mark.parametrize(
    ("cambio", "motivo"),
    [
        ({"version": "armado-guirnalda-organica.v2"}, "forma_invalida"),
        ({"colores": paleta()}, "forma_invalida"),
        ({"colores": {**paleta({"material": 0, "peso": 1, "acabado": "mate", "rol": "normal"}), "reparto": "inventado"}}, "forma_invalida"),
        ({"colores": paleta({"material": 0, "peso": 1, "acabado": "terciopelo", "rol": "normal"})}, "forma_invalida"),
        ({"colores": paleta({"material": 0, "peso": 1, "acabado": "mate", "rol": "protagonista"})}, "forma_invalida"),
        ({"tamanos": {"mezcla": {}, "grandesAbajo": 0.3, "inflado": 1, "variacion": 0.1}}, "sin_mezcla"),
        ({"tamanos": {"mezcla": {"12": 0}, "grandesAbajo": 0.3, "inflado": 1, "variacion": 0.1}}, "sin_mezcla"),
        ({"tamanos": {"mezcla": {"7": 100}, "grandesAbajo": 0.3, "inflado": 1, "variacion": 0.1}}, "forma_invalida"),
    ],
    ids=["version", "sin-colores", "reparto", "acabado", "rol", "sin-mezcla", "mezcla-en-cero", "tamano"],
)
def test_lo_que_no_se_sostiene(cambio: dict[str, Any], motivo: str) -> None:
    with pytest.raises(ArmadoInvalido) as caso:
        armado_resuelto(guirnalda(), armado(**cambio))
    assert caso.value.motivo == motivo


def test_un_color_que_la_pieza_no_lleva() -> None:
    with pytest.raises(ArmadoInvalido) as caso:
        armado_resuelto(guirnalda("#1f7a52", "#ffffff"), armado(colores=paleta({"material": 7, "peso": 1, "acabado": "mate", "rol": "normal"})))
    assert caso.value.motivo == "material_fuera_de_rango"


def test_una_pieza_sin_colores() -> None:
    with pytest.raises(ArmadoInvalido) as caso:
        armado_resuelto(EstructuraGuirnalda(es_guirnalda=True, materiales=[]), armado())
    assert caso.value.motivo == "sin_materiales"


# ---------------------------------------------------------------------------
# Lo que devuelve
# ---------------------------------------------------------------------------


def test_cada_globo_vuelve_a_su_material() -> None:
    resuelto = armado_resuelto(guirnalda("#1f7a52", "#ffffff"), armado())
    assert {g["material"] for g in resuelto["globos"]} <= {0, 1}
    assert sum(c["cantidad"] for c in resuelto["conteo"]) == len(resuelto["globos"])
    assert resuelto["sueltos"] == 0, "un globo que no toca a ningún otro es un fallo del motor, no del armado"


def test_el_indice_del_motor_distingue_dos_materiales_del_mismo_tono() -> None:
    """El motor orgánico guarda el lugar del color en la paleta, así que no hacen falta colores testigo."""
    resuelto = armado_resuelto(guirnalda("#ffffff", "#ffffff"), armado())
    assert {g["material"] for g in resuelto["globos"]} == {0, 1}


def test_los_materiales_apuntan_a_la_pieza_y_no_a_la_paleta() -> None:
    """La paleta del armado puede nombrar los colores de la pieza en otro orden, o repetir uno."""
    resuelto = armado_resuelto(
        guirnalda("#1f7a52", "#ffffff", "#c5a253"),
        armado(colores=paleta(
            {"material": 2, "peso": 50, "acabado": "cromado", "rol": "normal"},
            {"material": 0, "peso": 50, "acabado": "mate", "rol": "normal"},
        )),
    )
    assert {g["material"] for g in resuelto["globos"]} <= {0, 2}
    assert 1 not in {g["material"] for g in resuelto["globos"]}


def test_el_dibujo_lleva_los_colores_de_verdad() -> None:
    resuelto = armado_resuelto(guirnalda("#c5a253", "#ffffff"), armado())
    svg = str(resuelto["grafica"]["svg"])
    assert "#c5a253" in svg
    assert resuelto["grafica"]["ancho"] == 760 and resuelto["grafica"]["alto"] == 440
    assert str(resuelto["grafica"]["documento"]).startswith("<?xml")


def test_la_compra_son_enteros() -> None:
    """``Math.ceil`` devuelve un número en JavaScript y un ``float`` aquí; el contrato pide enteros."""
    resuelto = armado_resuelto(guirnalda(), armado())
    for fila in resuelto["compra"]:
        assert isinstance(fila["cantidad"], int) and isinstance(fila["comprar"], int)
        assert fila["comprar"] >= fila["cantidad"]
        assert all(isinstance(v, int) for v in fila["por_tamano"].values())
    assert isinstance(resuelto["total_comprar"], int)


def test_el_desperdicio_es_politica_del_plan() -> None:
    sin_margen = armado_resuelto(guirnalda(), armado(), desperdicio=0)
    con_margen = armado_resuelto(guirnalda(), armado(), desperdicio=0.3)
    assert con_margen["total_comprar"] > sin_margen["total_comprar"]
    assert DESPERDICIO_POR_DEFECTO == 0.12


def test_los_adornos_se_listan_pero_no_se_cotizan() -> None:
    """El follaje y las flores no están en el catálogo de globos: se cuentan para que nadie los olvide."""
    con = armado_resuelto(guirnalda(), armado(adornos={"follaje": 1, "flores": 1}))
    sin = armado_resuelto(guirnalda(), armado(adornos={"follaje": 0, "flores": 0}))
    assert con["adornos"]["ramas"] > 0 and con["adornos"]["flores"] > 0
    assert sin["adornos"] == {"ramas": 0, "flores": 0}
    assert con["total_comprar"] == sin["total_comprar"]


def test_el_motor_avisa_de_lo_que_corrigio() -> None:
    """Una guirnalda de 0,8 m no puede ser tan gruesa como una de cuatro metros, y el motor lo dice."""
    resuelto = armado_resuelto(
        guirnalda(),
        armado(forma={**armado()["forma"], "largoM": 0.8}, volumen={**armado()["volumen"], "grosorCimaM": 1.4}),
    )
    assert resuelto["avisos"]


def test_un_reparto_distinto_cambia_donde_cae_cada_color_pero_no_cuantos_globos_hay() -> None:
    azar = armado_resuelto(guirnalda(), armado())
    racimos = armado_resuelto(guirnalda(), armado(colores={**armado()["colores"], "reparto": "racimos"}))
    assert len(azar["globos"]) == len(racimos["globos"])
    assert [g["material"] for g in azar["globos"]] != [g["material"] for g in racimos["globos"]]


# ---------------------------------------------------------------------------
# Lo que la IA y el editor pueden usar
# ---------------------------------------------------------------------------


def test_las_opciones_salen_del_motor() -> None:
    opciones = opciones_admitidas()
    assert {a["valor"] for a in opciones["acabados"]} == {"mate", "cromado", "confeti", "transparente"}
    assert {r["valor"] for r in opciones["repartos"]} == {"azar", "tramos", "racimos"}
    assert opciones["roles"] == ["normal", "acento"]
    assert opciones["tamanos"] == [5, 9, 12, 18, 24, 36]


def test_los_limites_dependen_del_largo() -> None:
    """Una guirnalda es mucho más larga que gruesa: el grosor máximo sube con el largo."""
    corta = limites_de(armado(forma={**armado()["forma"], "largoM": 1}), guirnalda())
    larga = limites_de(armado(forma={**armado()["forma"], "largoM": 8}), guirnalda())
    assert larga["grosorCentroMax"] > corta["grosorCentroMax"]
    assert larga["grosorExtremosMax"] > corta["grosorExtremosMax"]
