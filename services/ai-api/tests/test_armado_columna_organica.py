"""La puerta pública del motor de columna orgánica.

``tests/test_columnaorg.py`` prueba el motor contra los 216 vectores de oro, que es lo que demuestra que la
migración es 1 a 1. Esto prueba lo otro: que la puerta traduce entre el vocabulario del plan (índices de material,
y el material del globo grande de la punta) y el del motor (una paleta con su acabado y su papel), que rechaza lo que
no se sostiene, que lo que devuelve cumple el contrato publicado y que ningún armado que el contrato admite rompe la
puerta.
"""

from __future__ import annotations

import random
from typing import Any, cast

import pytest
from jsonschema import Draft7Validator

from app.armado_columna_organica import (
    DESPERDICIO_POR_DEFECTO,
    VERSION,
    ArmadoInvalido,
    EstructuraColumnaOrganica,
    armado_resuelto,
    avisos_colores_sin_uso,
    indices_usados,
    limites_de,
    opciones_admitidas,
)
from app.generated_models import contract_schema

_RESUELTA = contract_schema("PlanResuelto")["properties"]["armados_columna_organica"]["items"]
_RESUELTA_VALIDA = Draft7Validator(_RESUELTA)
_CAMPOS_RESUELTA = frozenset(_RESUELTA["properties"])


def armado(**cambios: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "version": VERSION,
        "origen": "sugerido",
        "forma": {
            "altoM": 2.2,
            "inclinacionM": 0.12,
            "serpenteoM": 0.1,
            "ondulacion": 0.3,
            "suelo": True,
            "persona": True,
        },
        "volumen": {
            "grosorPatasM": 0.85,
            "grosorCimaM": 0.45,
            "irregularidad": 0.4,
            "relleno": 0.72,
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
        "corona": {"activa": True, "tamano": 24, "material": 1},
    }
    base.update(cambios)
    return base


#: Una mezcla sin R24: lo que no se nombra toma el valor del diseño inicial, así que el cero se escribe.
SIN_24 = {
    "mezcla": {"5": 32, "9": 0, "12": 42, "18": 26, "24": 0, "36": 0},
    "grandesAbajo": 0.8,
    "inflado": 1,
    "variacion": 0.1,
}


def columna(*colores: str) -> EstructuraColumnaOrganica:
    return EstructuraColumnaOrganica(
        es_columna=True, materiales=list(colores or ("#1f7a52", "#ffffff"))
    )


def paleta(*entradas: dict[str, Any]) -> dict[str, Any]:
    return {"paleta": list(entradas), "reparto": "azar", "mezcla": 0.5}


def publicado(resuelto: dict[str, Any]) -> dict[str, Any]:
    """Lo que viaja en ``armados_columna_organica[]``: lo que el motor devuelve de más (el dibujo) se queda fuera."""
    return {campo: valor for campo, valor in resuelto.items() if campo in _CAMPOS_RESUELTA}


# ---------------------------------------------------------------------------
# Lo que la puerta rechaza
# ---------------------------------------------------------------------------


def test_una_pieza_que_no_es_columna() -> None:
    with pytest.raises(ArmadoInvalido) as caso:
        armado_resuelto(
            EstructuraColumnaOrganica(es_columna=False, materiales=["#1f7a52"]), armado()
        )
    assert caso.value.motivo == "no_es_columna"


@pytest.mark.parametrize(
    ("cambio", "motivo"),
    [
        ({"version": "armado-columna-organica.v2"}, "forma_invalida"),
        ({"colores": paleta()}, "forma_invalida"),
        ({"corona": {"activa": True, "tamano": 7, "material": 0}}, "forma_invalida"),
        ({"corona": {"activa": True, "tamano": 24}}, "forma_invalida"),
        (
            {
                "forma": {
                    "altoM": 2.2,
                    "inclinacionM": 0,
                    "serpenteoM": 0,
                    "ondulacion": 0,
                    "suelo": True,
                }
            },
            "forma_invalida",
        ),
        (
            {"tamanos": {"mezcla": {}, "grandesAbajo": 0.8, "inflado": 1, "variacion": 0.1}},
            "sin_mezcla",
        ),
        (
            {"tamanos": {"mezcla": {"12": 0}, "grandesAbajo": 0.8, "inflado": 1, "variacion": 0.1}},
            "sin_mezcla",
        ),
    ],
    ids=[
        "version",
        "sin-colores",
        "tamano-de-corona",
        "corona-sin-material",
        "forma-incompleta",
        "sin-mezcla",
        "mezcla-en-cero",
    ],
)
def test_lo_que_no_se_sostiene(cambio: dict[str, Any], motivo: str) -> None:
    with pytest.raises(ArmadoInvalido) as caso:
        armado_resuelto(columna(), armado(**cambio))
    assert caso.value.motivo == motivo


def test_un_color_que_la_pieza_no_lleva() -> None:
    with pytest.raises(ArmadoInvalido) as caso:
        armado_resuelto(
            columna(),
            armado(colores=paleta({"material": 7, "peso": 1, "acabado": "mate", "rol": "normal"})),
        )
    assert caso.value.motivo == "material_fuera_de_rango"
    # El globo de la punta también nombra un color de la pieza.
    with pytest.raises(ArmadoInvalido) as caso:
        armado_resuelto(columna(), armado(corona={"activa": True, "tamano": 24, "material": 5}))
    assert caso.value.motivo == "material_fuera_de_rango"


def test_una_pieza_sin_colores() -> None:
    with pytest.raises(ArmadoInvalido) as caso:
        armado_resuelto(EstructuraColumnaOrganica(es_columna=True, materiales=[]), armado())
    assert caso.value.motivo == "sin_materiales"


# ---------------------------------------------------------------------------
# Lo que devuelve
# ---------------------------------------------------------------------------


def test_cada_globo_vuelve_a_su_material_y_el_de_la_punta_al_suyo() -> None:
    sin_24 = SIN_24
    resuelto = armado_resuelto(columna(), armado(tamanos=sin_24))
    globos = resuelto["globos"]
    assert {g["material"] for g in globos} <= {0, 1}
    assert sum(c["cantidad"] for c in resuelto["conteo"]) == len(globos)
    assert resuelto["sueltos"] == 0, (
        "un globo que no toca a ningún otro es un fallo del motor, no del armado"
    )
    # El de la punta es de R24 y del material 1 (el blanco), y es el único R24: la mezcla del cuerpo no lleva 24.
    punta = [g for g in globos if g["tamano"] == 24]
    assert len(punta) == 1 and punta[0]["material"] == 1


def test_el_globo_grande_de_la_punta_se_pone_y_se_quita() -> None:
    sin_24 = SIN_24
    con_punta = armado_resuelto(
        columna(), armado(tamanos=sin_24, corona={"activa": True, "tamano": 24, "material": 1})
    )
    sin_punta = armado_resuelto(
        columna(), armado(tamanos=sin_24, corona={"activa": False, "tamano": 24, "material": 1})
    )

    # Con la punta hay un globo más (el de remate) que sin ella, y es el que está más arriba.
    assert len(con_punta["globos"]) == len(sin_punta["globos"]) + 1
    assert all(g["material"] >= 0 for g in con_punta["globos"]), (
        "el globo de la punta no se queda sin material"
    )
    arriba = max(con_punta["globos"], key=lambda g: g["y"] + g["r"])
    assert arriba["tamano"] == 24
    assert con_punta["alto_m"] > sin_punta["alto_m"], (
        "con el globo grande arriba la columna es más alta"
    )
    # Su material entra en el conteo y en la compra.
    assert any(c["material"] == 1 and c["tamano"] == 24 for c in con_punta["conteo"])
    assert not any(c["tamano"] == 24 for c in sin_punta["conteo"])


def test_el_material_del_globo_de_la_punta_es_el_que_pide_el_armado() -> None:
    sin_24 = SIN_24
    primero = armado_resuelto(
        columna(), armado(tamanos=sin_24, corona={"activa": True, "tamano": 24, "material": 0})
    )
    segundo = armado_resuelto(
        columna(), armado(tamanos=sin_24, corona={"activa": True, "tamano": 24, "material": 1})
    )

    assert {c["material"] for c in primero["conteo"] if c["tamano"] == 24} == {0}
    assert {c["material"] for c in segundo["conteo"] if c["tamano"] == 24} == {1}


def test_el_indice_del_motor_distingue_dos_materiales_del_mismo_tono() -> None:
    """El motor orgánico guarda el lugar del color en la paleta, así que no hacen falta colores testigo."""
    resuelto = armado_resuelto(columna("#ffffff", "#ffffff"), armado())
    assert {g["material"] for g in resuelto["globos"]} == {0, 1}


def test_los_materiales_apuntan_a_la_pieza_y_no_a_la_paleta() -> None:
    """La paleta del armado puede nombrar los colores de la pieza en otro orden, o repetir uno."""
    resuelto = armado_resuelto(
        columna("#1f7a52", "#ffffff", "#c5a253"),
        armado(
            colores=paleta(
                {"material": 2, "peso": 50, "acabado": "cromado", "rol": "normal"},
                {"material": 0, "peso": 50, "acabado": "mate", "rol": "normal"},
            ),
            corona={"activa": False, "tamano": 24, "material": 2},
        ),
    )
    assert {g["material"] for g in resuelto["globos"]} == {0, 2}


def test_el_dibujo_lleva_los_colores_de_verdad() -> None:
    svg = armado_resuelto(columna("#1f7a52", "#ffffff"), armado())["grafica"]["svg"]
    assert "1f7a52" in svg.lower()
    assert armado_resuelto(columna(), armado())["grafica"]["ancho"] == 600


def test_la_compra_son_enteros_y_lleva_desperdicio() -> None:
    resuelto = armado_resuelto(columna(), armado())
    assert all(
        isinstance(c["comprar"], int) and isinstance(c["cantidad"], int) for c in resuelto["compra"]
    )
    assert resuelto["total_comprar"] == sum(c["comprar"] for c in resuelto["compra"])
    assert resuelto["total_comprar"] >= len(resuelto["globos"])
    assert all(
        set(c["por_tamano"]) <= {"5", "9", "12", "18", "24", "36"} for c in resuelto["compra"]
    )


def test_el_desperdicio_es_politica_del_plan() -> None:
    sin = armado_resuelto(columna(), armado(), 0.0)["total_comprar"]
    con = armado_resuelto(columna(), armado(), 0.3)["total_comprar"]
    assert con > sin
    assert (
        armado_resuelto(columna(), armado())["total_comprar"]
        == armado_resuelto(columna(), armado(), DESPERDICIO_POR_DEFECTO)["total_comprar"]
    )


def test_el_motor_avisa_de_lo_que_corrigio() -> None:
    def volumen(punta: float) -> dict[str, Any]:
        return {
            "grosorPatasM": 1.4,
            "grosorCimaM": punta,
            "irregularidad": 0.4,
            "relleno": 0.72,
            "racimo": 4,
            "salientes": 0.35,
        }

    # Un globo chico sobre una punta gruesa no guarda proporción: el motor lo cambia por uno que sí y lo dice.
    cambiado = armado_resuelto(
        columna(),
        armado(volumen=volumen(0.85), corona={"activa": True, "tamano": 5, "material": 1}),
    )
    assert any(
        "R5" in aviso and "proporción" in aviso and "se cambió a R36" in aviso
        for aviso in cambiado["avisos"]
    ), cambiado["avisos"]
    assert any(g["tamano"] == 36 for g in cambiado["globos"])
    # Y si ningún globo guarda proporción con esa punta, se quita el de arriba, y se dice.
    quitado = armado_resuelto(
        columna(), armado(volumen=volumen(1.2), corona={"activa": True, "tamano": 5, "material": 1})
    )
    assert any("se quitó el globo grande de arriba" in aviso for aviso in quitado["avisos"]), (
        quitado["avisos"]
    )


def test_lo_que_devuelve_cumple_el_contrato_publicado() -> None:
    errores = [
        e.message[:120]
        for e in _RESUELTA_VALIDA.iter_errors(publicado(armado_resuelto(columna(), armado())))
    ]
    assert errores == []


def test_las_opciones_salen_del_motor() -> None:
    opciones = opciones_admitidas()
    assert [f["id"] for f in opciones["formas"]] == [
        "torre",
        "cono",
        "monticulo",
        "gruesa",
        "inclinada",
        "serpenteante",
        "aireada",
        "gigantes",
    ]
    assert [e["id"] for e in opciones["estilos"]] == ["ligero", "estandar", "lleno", "gigantes"]
    torre = opciones["formas"][0]
    assert set(torre["forma"]) == {"altoM", "inclinacionM", "serpenteoM", "ondulacion"}
    assert set(torre["tamanos"]["mezcla"]) == {"5", "9", "12", "18", "24", "36"}
    # Solo el estilo de los gigantes cambia también la mezcla de tamaños.
    assert [e["id"] for e in opciones["estilos"] if "tamanos" in e] == ["gigantes"]
    assert opciones["alto_m"] == {"min": 0.8, "max": 4.5}
    assert opciones["max_materiales"] == 8


def test_los_limites_dependen_del_grosor_y_dicen_que_globos_caben_en_la_punta() -> None:
    estandar = limites_de(armado(), columna())
    gruesa = limites_de(
        armado(
            volumen={
                "grosorPatasM": 1.4,
                "grosorCimaM": 1.4,
                "irregularidad": 0.4,
                "relleno": 0.72,
                "racimo": 4,
                "salientes": 0.35,
            }
        ),
        columna(),
    )
    assert estandar["altoMin"] < gruesa["altoMin"], "una columna más gruesa pide más alto"
    assert 24 in estandar["coronaTamanos"] and 5 not in estandar["coronaTamanos"]
    assert "coronaPermitida" not in estandar


def test_avisos_de_colores_sin_uso_e_indices_usados() -> None:
    assert avisos_colores_sin_uso(["azul", "blanco"], [0, 1]) == []
    avisos = avisos_colores_sin_uso(["azul", "", "blanco"], [0])
    assert len(avisos) == 2 and "sin nombre" in avisos[0] and "Blanco" in avisos[1]
    assert all("Agrégalo a la paleta o quítalo de la pieza" in aviso for aviso in avisos)
    # Los índices que usa el armado: la paleta y, si el globo de la punta está puesto, su material.
    assert indices_usados(armado(corona={"activa": True, "tamano": 24, "material": 2})) == [0, 1, 2]
    assert indices_usados(armado(corona={"activa": False, "tamano": 24, "material": 2})) == [0, 1]


# ---------------------------------------------------------------------------
# El barrido: ningún armado del contrato rompe la puerta
# ---------------------------------------------------------------------------


def test_ningun_armado_dentro_del_contrato_rompe_la_puerta() -> None:
    """Un armado que el contrato admite se arma o se rechaza con su frase: nunca un fallo, y siempre cumple el contrato.

    Es lo que ADR-0035 hizo con el arco y la columna: se sortean ejes dentro de lo que el contrato publica —alto,
    grosores, inclinación y serpenteo, racimo, tamaños, el globo de la punta— y cada uno tiene que dar una columna
    que cumple ``plan-resuelto.v1`` o un ``armado_invalido``.
    """
    azar = random.Random(20261002)
    resueltos = rechazados = 0
    for _ in range(40):
        mezcla = {str(t): azar.choice([0, 0, 10, 40, 90]) for t in (5, 9, 12, 18, 24, 36)}
        if not any(mezcla.values()):
            mezcla["12"] = 50
        cambios = armado(
            forma={
                "altoM": azar.choice([0.5, 1.0, 2.2, 4.5, 6.0]),
                "inclinacionM": azar.choice([-2, -0.5, 0, 0.6, 2]),
                "serpenteoM": azar.choice([0, 0.2, 1]),
                "ondulacion": azar.choice([0, 0.4, 1]),
                "suelo": azar.random() < 0.8,
                "persona": azar.random() < 0.5,
            },
            volumen={
                "grosorPatasM": azar.choice([0.2, 0.5, 0.85, 1.6, 3]),
                "grosorCimaM": azar.choice([0.2, 0.45, 0.9, 1.6, 3]),
                "irregularidad": azar.choice([0, 0.5, 1]),
                "relleno": azar.choice([0, 0.72, 1]),
                "racimo": azar.randint(1, 8),
                "salientes": azar.choice([0, 0.35, 1]),
            },
            tamanos={
                "mezcla": mezcla,
                "grandesAbajo": azar.choice([0, 0.8, 1]),
                "inflado": azar.choice([0.8, 1, 1.1]),
                "variacion": azar.choice([0, 0.3]),
            },
            corona={
                "activa": azar.random() < 0.6,
                "tamano": azar.choice([5, 9, 12, 18, 24, 36]),
                "material": azar.randint(0, 1),
            },
            aspecto={
                "brillo": 0.6,
                "sombra": 0.2,
                "contorno": 0.8,
                "profundidad": 0.5,
                "semilla": azar.randint(1, 99999),
            },
        )
        try:
            resuelto = armado_resuelto(columna(), cambios)
        except ArmadoInvalido as error:
            assert error.motivo in ("demasiados_globos", "demasiado_grande"), error.motivo
            rechazados += 1
            continue
        errores = [e.message[:120] for e in _RESUELTA_VALIDA.iter_errors(publicado(resuelto))]
        assert errores == [], (errores, cambios)
        resueltos += 1
    assert resueltos > 25, "el barrido tiene que armar la mayoría, no rechazarlos todos"
    assert resueltos + rechazados == 40


def test_el_resultado_publicado_no_lleva_el_dibujo() -> None:
    assert "grafica" not in publicado(cast(dict[str, Any], armado_resuelto(columna(), armado())))


def test_el_globo_grande_de_la_punta_no_duplica_la_fila_de_su_color_en_la_compra_ni_en_el_conteo() -> (
    None
):
    # El motor cuenta por posición de paleta y el globo de la punta es el índice −1: si su material es uno de la paleta,
    # sin unirlos ese material salía en dos filas (y una pantalla con una fila por material repetía su clave).
    resuelto = armado_resuelto(
        columna(), armado(corona={"activa": True, "tamano": 24, "material": 1})
    )
    materiales = [fila["material"] for fila in resuelto["compra"]]
    assert len(materiales) == len(set(materiales)), materiales
    claves = [
        (linea["material"], linea["tamano"], linea["acabado"]) for linea in resuelto["conteo"]
    ]
    assert len(claves) == len(set(claves)), claves
    # Unir no pierde nada: el total del motor es la suma de lo que hay que comprar de cada fila, y todos los globos cuentan.
    assert sum(fila["comprar"] for fila in resuelto["compra"]) == resuelto["total_comprar"]
    assert sum(linea["cantidad"] for linea in resuelto["conteo"]) == len(resuelto["globos"])
    assert sum(fila["cantidad"] for fila in resuelto["compra"]) == len(resuelto["globos"])
    for fila in resuelto["compra"]:
        assert sum(fila["por_tamano"].values()) == fila["cantidad"], (
            "lo que lleva de cada tamaño suma lo que lleva el color"
        )
    # Y el globo grande sigue contado: R24 del color 1 está en la compra.
    fila_uno = next(fila for fila in resuelto["compra"] if fila["material"] == 1)
    assert fila_uno["por_tamano"].get("24", 0) >= 1
