"""La puerta pública del motor de arco: lo que el plan le pide y lo que le devuelve.

``tests/test_arco.py`` prueba el motor contra los vectores de oro —que es lo que demuestra que la migración es
1 a 1—. Esto prueba lo otro: que la puerta traduce bien entre el vocabulario del plan (índices de material) y
el del motor (colores), que rechaza lo que no se sostiene y que el dibujo sale con los colores de verdad.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.armado_arco import (
    DESPERDICIO_POR_DEFECTO,
    VERSION,
    ArmadoInvalido,
    EstructuraArco,
    armado_resuelto,
    limites_de,
    opciones_admitidas,
)
from app.arco.tipos import PATRON_IDS

GLOBO: dict[str, Any] = {
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
}

GEOMETRIA: dict[str, Any] = {"forma": "herradura", "anchoM": 4, "altoM": 2.5, "globosAncho": 4, "suelo": True}


def armado(**cambios: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "version": VERSION,
        "origen": "sugerido",
        "patron": "espiral",
        "opciones": {"ancho": 2, "inclinacion": 2, "inversion": 0, "espejo": 0},
        "geometria": dict(GEOMETRIA),
        "globo": dict(GLOBO),
        "capas": [],
        "secciones": [],
        "materiales": [0, 1],
    }
    base.update(cambios)
    return base


def arco(*colores: str) -> EstructuraArco:
    return EstructuraArco(es_arco=True, materiales=list(colores or ("#1d4ed8", "#ffffff")))


# ---------------------------------------------------------------------------
# Lo que la puerta rechaza
# ---------------------------------------------------------------------------


def test_una_pieza_que_no_es_arco() -> None:
    with pytest.raises(ArmadoInvalido) as caso:
        armado_resuelto(EstructuraArco(es_arco=False, materiales=["#1d4ed8"]), armado())
    assert caso.value.motivo == "no_es_arco"


@pytest.mark.parametrize(
    ("cambio", "motivo"),
    [
        ({"version": "armado-arco.v2"}, "forma_invalida"),
        ({"patron": "inventado"}, "forma_invalida"),
        ({"geometria": {**GEOMETRIA, "forma": "rampa"}}, "forma_invalida"),
        ({"geometria": {**GEOMETRIA, "globosAncho": 99}}, "forma_invalida"),
        ({"globo": {**GLOBO, "nominal": 7}}, "forma_invalida"),
        ({"materiales": []}, "forma_invalida"),
        ({"opciones": {"ancho": "dos"}}, "forma_invalida"),
    ],
    ids=["version", "patron", "forma", "globos-ancho", "tamano", "sin-materiales", "opcion-no-numerica"],
)
def test_la_forma_la_valida_el_contrato(cambio: dict[str, Any], motivo: str) -> None:
    """Lo que el esquema publicado puede expresar lo rechaza el esquema, no una lista escrita a mano."""
    with pytest.raises(ArmadoInvalido) as caso:
        armado_resuelto(arco(), armado(**cambio))
    assert caso.value.motivo == motivo


def test_un_color_que_la_pieza_no_lleva() -> None:
    with pytest.raises(ArmadoInvalido) as caso:
        armado_resuelto(arco("#1d4ed8", "#ffffff"), armado(materiales=[0, 5]))
    assert caso.value.motivo == "material_fuera_de_rango"


def test_un_patron_con_menos_colores_de_los_que_necesita() -> None:
    """El ombré pide tres tonos; con dos no hay degradado que hacer y el armado no se sostiene."""
    with pytest.raises(ArmadoInvalido) as caso:
        armado_resuelto(arco("#dbeafe", "#1e40af"), armado(patron="ombre", materiales=[0, 1], opciones={}))
    assert caso.value.motivo == "pocos_materiales"


def test_una_capa_que_nombra_un_color_que_el_armado_no_trae() -> None:
    with pytest.raises(ArmadoInvalido) as caso:
        armado_resuelto(arco("#1d4ed8", "#ffffff"), armado(capas=[[0], [3], None, None]))
    assert caso.value.motivo == "material_fuera_de_rango"


# ---------------------------------------------------------------------------
# Lo que devuelve
# ---------------------------------------------------------------------------


def test_cada_globo_vuelve_a_su_material() -> None:
    resuelto = armado_resuelto(arco("#1d4ed8", "#ffffff"), armado())
    assert {g["material"] for g in resuelto["globos"]} == {0, 1}
    assert sum(c["cantidad"] for c in resuelto["conteo"]) == len(resuelto["globos"])


def test_dos_materiales_del_mismo_tono_no_se_confunden() -> None:
    """Es para lo que existen los colores testigo: dos materiales pueden ser el mismo blanco.

    Sin ellos, el motor devolvería el mismo ``#ffffff`` en los dos y no habría forma de saber cuál de los dos
    colores de la estructura se compra para cada globo.
    """
    resuelto = armado_resuelto(arco("#ffffff", "#ffffff"), armado())
    materiales = {g["material"] for g in resuelto["globos"]}
    assert materiales == {0, 1}
    conteo = {c["material"]: c["cantidad"] for c in resuelto["conteo"]}
    assert conteo[0] > 0 and conteo[1] > 0


def test_el_dibujo_lleva_los_colores_de_verdad_y_no_los_testigos() -> None:
    resuelto = armado_resuelto(arco("#d4af37", "#ffffff"), armado())
    svg = str(resuelto["grafica"]["svg"])
    assert "#d4af37" in svg
    assert "#000001" not in svg and "#000002" not in svg
    assert resuelto["grafica"]["lienzo"] == 600
    assert str(resuelto["grafica"]["documento"]).startswith("<?xml")


def test_el_dibujo_marca_cada_globo_para_poder_pintarlo() -> None:
    """Los ``data-`` de cada grupo son lo que deja pintar racimo por racimo sobre la gráfica."""
    svg = str(armado_resuelto(arco(), armado())["grafica"]["svg"])
    for atributo in ("data-b=", "data-c=", "data-f=", "data-k="):
        assert atributo in svg


def test_el_desperdicio_es_politica_del_plan() -> None:
    sin_margen = armado_resuelto(arco(), armado(), desperdicio=0)
    con_margen = armado_resuelto(arco(), armado(), desperdicio=0.2)
    assert sin_margen["total_comprar"] == sum(c["cantidad"] for c in sin_margen["conteo"])
    assert con_margen["total_comprar"] > sin_margen["total_comprar"]
    assert armado_resuelto(arco(), armado())["desperdicio"] == DESPERDICIO_POR_DEFECTO


def test_una_seccion_manda_sobre_la_capa_y_sobre_el_patron() -> None:
    """La precedencia del motor: sección por altura, luego capa a lo ancho, luego patrón."""
    resuelto = armado_resuelto(
        arco("#1d4ed8", "#ffffff"),
        armado(capas=[[0], [0], [0], [0]], secciones=[[1, 1, 1, 1]]),
    )
    del_piso = [g for g in resuelto["globos"] if g["seccion"] == 0]
    assert del_piso and all(g["material"] == 1 for g in del_piso)
    de_arriba = [g for g in resuelto["globos"] if g["seccion"] > 0]
    assert de_arriba and all(g["material"] == 0 for g in de_arriba)


def test_el_motor_avisa_de_lo_que_corrigio() -> None:
    """Una herradura más baja que su semicírculo no es posible; el motor lo dice en vez de callárselo."""
    resuelto = armado_resuelto(arco(), armado(geometria={**GEOMETRIA, "altoM": 1}))
    assert resuelto["avisos"]
    assert any("alto" in aviso.lower() for aviso in resuelto["avisos"])


def test_las_medidas_son_las_del_motor() -> None:
    resuelto = armado_resuelto(arco(), armado())
    assert resuelto["ancho_m"] == pytest.approx(4)
    assert resuelto["grosor_m"] > 0
    assert resuelto["largo_m"] > resuelto["ancho_m"]
    assert resuelto["globos_por_metro"] == pytest.approx(len(resuelto["globos"]) / resuelto["largo_m"])


# ---------------------------------------------------------------------------
# Lo que la IA y el editor pueden usar
# ---------------------------------------------------------------------------


def test_las_opciones_salen_del_motor() -> None:
    """Si allá se añade un patrón o cambia un rango, aquí se ve sin tocar nada."""
    opciones = opciones_admitidas()
    assert [p["id"] for p in opciones["patrones"]] == list(PATRON_IDS)
    assert opciones["formas"] == ["alto", "semi", "herradura"]
    assert opciones["tamanos"] == [5, 9, 12, 18, 24, 36]
    espiral = next(p for p in opciones["patrones"] if p["id"] == "espiral")
    assert {c["clave"] for c in espiral["controles"]} == {"ancho", "inclinacion", "inversion", "espejo"}
    assert all("min" in c and "max" in c and "defecto" in c for c in espiral["controles"])


def test_cada_patron_declara_cuantos_colores_necesita() -> None:
    for patron in opciones_admitidas()["patrones"]:
        assert 1 <= patron["min_colores"] <= patron["max_colores"] <= 8


def test_los_limites_dependen_del_globo_puesto() -> None:
    """Con globos R36 la banda es mucho más gruesa, así que el arco no puede ser igual de angosto."""
    pequeno = limites_de(armado(), arco())
    grande = limites_de(armado(globo={**GLOBO, "nominal": 36}), arco())
    assert grande["anchoMin"] > pequeno["anchoMin"]
