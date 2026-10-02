"""Regresiones de la revisión adversaria de los armados de columna, columna orgánica y guirnalda orgánica.

Cada prueba fija un hallazgo que se reprodujo antes de corregirlo: lo que se esperaba y lo que pasaba está en su
docstring. Los números de los motores los fijan sus vectores de oro; aquí se prueba lo que es de las puertas (lo que
rechazan, lo que publican) y de las ediciones del plan.
"""

from __future__ import annotations

import copy
from collections.abc import Mapping
from typing import Any, cast

import pytest

from app import armado_arco, armado_columna, armado_columna_organica, armado_guirnalda_organica
from app.armado_columna import PATRONES, EstructuraColumna, materiales_con_globos
from app.armado_validacion import MOTIVO_NO_FINITO
from app.merma import MERMA
from app.plan import PlanResolutionError
from app.plan_edicion import editar_plan
from tests import test_armado_arco as t_arco
from tests import test_armado_columna_organica as t_org
from tests import test_armado_guirnalda_organica as t_gui
from tests import test_plan_edicion_armado_columna as t_col_edicion
from tests import test_plan_edicion_armado_columna_organica as t_org_edicion
from tests.guirnalda_datos import guirnalda as guirnalda_plan
from tests.guirnalda_datos import plan

CLASICO: dict[str, Any] = t_col_edicion.ARMADO
ORGANICO: dict[str, Any] = t_org_edicion.ARMADO


def _clasica(*tonos: str) -> EstructuraColumna:
    return EstructuraColumna(
        es_columna=True, materiales=list(tonos or ("#111111", "#222222", "#333333", "#444444"))
    )


# --- MEDIO-6: un patrón con menos colores de los que pide es un armado inválido, nunca un 500 -----------------------------------


@pytest.mark.parametrize(
    ("patron", "materiales"), [("espiral", [0]), ("ombre", [0, 1]), ("rayas", [2])]
)
def test_un_patron_con_menos_colores_de_los_que_pide_se_rechaza_con_su_frase(
    patron: str, materiales: list[int]
) -> None:
    # Antes: KeyError dentro del motor (`'#f59e0b'`), es decir, un 500 con un armado que el esquema admite.
    armado = {
        **CLASICO,
        "patron": patron,
        "opciones": {},
        "materiales": materiales,
        "remate": {**CLASICO["remate"], "material": 0},
    }

    with pytest.raises(armado_columna.ArmadoInvalido) as caso:
        armado_columna.armado_resuelto(_clasica(), armado)

    assert caso.value.motivo == "pocos_colores"
    assert str(PATRONES[patron].min_colores) in caso.value.mensaje and len(materiales) > 0


def test_el_mismo_armado_por_capas_no_depende_del_patron_y_se_sigue_armando() -> None:
    capas = [{"tamano": 12, "materiales": [0, 0, 0]}, {"tamano": 12, "materiales": [0, 0, 0]}]
    armado = {
        **CLASICO,
        "modo": "capas",
        "patron": "espiral",
        "opciones": {},
        "materiales": [0],
        "capas": capas,
    }

    assert armado_columna.armado_resuelto(_clasica(), armado)["globos"]


def test_guardar_un_patron_con_pocos_colores_responde_422_con_frase() -> None:
    base = plan(t_col_edicion._columna_dos_colores(), guirnalda_plan())
    armado = {**CLASICO, "patron": "ombre", "opciones": {}, "materiales": [0, 1]}

    with pytest.raises(PlanResolutionError) as caso:
        editar_plan(base, t_col_edicion._edicion(armado))

    assert (caso.value.code, caso.value.status_code) == ("armado_invalido", 422)
    assert cast(Mapping[str, str], caso.value.details)["motivo"] == "pocos_colores"
    assert cast(Mapping[str, str], caso.value.details)["mensaje"]


# --- MEDIO-5: el color «sin globos» sale de lo que se compra, no de los índices que el armado declara -------------------------


def test_un_remate_ninguno_con_material_no_cuenta_como_color_usado() -> None:
    # Antes: `avisos_colores_sin_uso` daba [] porque el remate nombraba el color 1, aunque no compraba ningún globo.
    armado = {
        **CLASICO,
        "patron": "solido",
        "opciones": {},
        "materiales": [0],
        "remate": {**CLASICO["remate"], "tipo": "ninguno", "material": 1},
    }

    resuelto = armado_columna.armado_resuelto(_clasica("#111111", "#222222"), armado)

    assert materiales_con_globos(resuelto) == [0]
    avisos = armado_columna.avisos_colores_sin_uso(
        ["azul", "blanco"], materiales_con_globos(resuelto)
    )
    assert len(avisos) == 1 and "Blanco" in avisos[0]


def test_un_solido_con_cuatro_indices_solo_usa_el_primero() -> None:
    armado = {
        **CLASICO,
        "patron": "solido",
        "opciones": {},
        "materiales": [0, 1, 2, 3],
        "remate": {**CLASICO["remate"], "material": 0},
    }

    resuelto = armado_columna.armado_resuelto(_clasica(), armado)

    assert materiales_con_globos(resuelto) == [0], (
        "declarar cuatro índices no compra cuatro colores"
    )


def test_guardar_una_columna_con_un_color_que_no_compra_avisa_aunque_el_remate_lo_nombre() -> None:
    pieza = t_col_edicion._columna_con_catalogo()
    armado = {
        **CLASICO,
        "patron": "solido",
        "opciones": {},
        "materiales": [0],
        "remate": {**CLASICO["remate"], "tipo": "ninguno", "material": 1},
    }

    resultado = editar_plan(plan(pieza), t_col_edicion._edicion(armado))

    assert any("no usa el color Blanco" in aviso for aviso in resultado.avisos), resultado.avisos


# --- BAJO-12: NaN pasa el esquema y el motor; las cuatro puertas lo rechazan ----------------------------------------------


def _arco_con_nan() -> tuple[Any, dict[str, Any]]:
    armado = t_arco.armado()
    armado["geometria"] = {**armado["geometria"], "alto_m": float("nan")}
    return t_arco.arco(), armado


def _clasica_con_nan() -> tuple[Any, dict[str, Any]]:
    return _clasica("#111111", "#222222"), {
        **CLASICO,
        "cuerpo": {**CLASICO["cuerpo"], "alto_m": float("nan")},
    }


def _organica_con_nan() -> tuple[Any, dict[str, Any]]:
    armado = t_org.armado()
    armado["volumen"] = {**armado["volumen"], "relleno": float("nan")}
    return t_org.columna(), armado


def _guirnalda_con_nan() -> tuple[Any, dict[str, Any]]:
    armado = t_gui.armado()
    armado["tamanos"] = {**armado["tamanos"], "mezcla": {"5": float("nan"), "12": 40}}
    return t_gui.guirnalda(), armado


@pytest.mark.parametrize(
    ("modulo", "caso"),
    [
        (armado_arco, _arco_con_nan),
        (armado_columna, _clasica_con_nan),
        (armado_columna_organica, _organica_con_nan),
        (armado_guirnalda_organica, _guirnalda_con_nan),
    ],
    ids=["arco", "columna", "columna organica", "guirnalda organica"],
)
def test_un_numero_no_finito_se_rechaza_con_422_estable_en_cada_puerta(
    modulo: Any, caso: Any
) -> None:
    # Antes: 54 globos sin error (la columna orgánica con `relleno` en NaN), 28 (la clásica con `alto_m` en NaN).
    pieza, armado = caso()

    with pytest.raises(modulo.ArmadoInvalido) as error:
        modulo.armado_resuelto(pieza, armado)

    assert error.value.motivo == MOTIVO_NO_FINITO
    assert error.value.mensaje


@pytest.mark.parametrize("infinito", [float("inf"), float("-inf")])
def test_el_infinito_tampoco_pasa(infinito: float) -> None:
    armado = {**CLASICO, "cuerpo": {**CLASICO["cuerpo"], "alto_m": infinito}}

    with pytest.raises(armado_columna.ArmadoInvalido) as error:
        armado_columna.validar(_clasica(), armado)

    assert error.value.motivo == MOTIVO_NO_FINITO


def test_guardar_un_armado_con_nan_responde_422_y_no_lo_escribe() -> None:
    base = plan(t_org_edicion._columna_dos_colores(), guirnalda_plan())
    armado = {**ORGANICO, "volumen": {**ORGANICO["volumen"], "relleno": float("nan")}}

    with pytest.raises(PlanResolutionError) as caso:
        editar_plan(base, t_org_edicion._edicion(armado))

    assert (caso.value.code, caso.value.status_code) == ("armado_invalido", 422)
    assert cast(Mapping[str, str], caso.value.details)["motivo"] == MOTIVO_NO_FINITO


# --- ALTO-1: una columna lleva UN armado -----------------------------------------------------------------------------------


def test_no_se_guardan_el_clasico_y_el_organico_en_la_misma_columna() -> None:
    # Antes: se guardaban los dos; el plan contaba con el clásico (14 globos), el orgánico quedaba guardado sin
    # contarse ni publicarse y `medidas` eran las del último que se guardó.
    con_clasico = editar_plan(
        plan(t_col_edicion._columna_dos_colores(), guirnalda_plan()),
        t_col_edicion._edicion(CLASICO),
    ).plan
    with pytest.raises(PlanResolutionError) as caso:
        editar_plan(con_clasico, t_org_edicion._edicion(ORGANICO))
    assert (caso.value.code, caso.value.status_code) == ("armado_columna_presente", 409)

    con_organico = editar_plan(
        plan(t_org_edicion._columna_dos_colores(), guirnalda_plan()),
        t_org_edicion._edicion(ORGANICO),
    ).plan
    with pytest.raises(PlanResolutionError) as caso:
        editar_plan(con_organico, t_col_edicion._edicion(CLASICO))
    assert (caso.value.code, caso.value.status_code) == ("armado_columna_organica_presente", 409)


def test_quitar_un_armado_siempre_se_puede_y_deja_poner_el_otro() -> None:
    con_clasico = editar_plan(
        plan(t_col_edicion._columna_dos_colores(), guirnalda_plan()),
        t_col_edicion._edicion(CLASICO),
    ).plan
    sin = editar_plan(con_clasico, t_col_edicion._edicion(None)).plan
    con_organico = editar_plan(sin, t_org_edicion._edicion(ORGANICO)).plan

    pieza = t_org_edicion._pieza(con_organico, t_org_edicion.COLUMNA)
    assert "armado_columna" not in pieza and "armado_columna_organica" in pieza


def test_el_conflicto_no_toca_el_plan_ni_las_medidas() -> None:
    con_clasico = editar_plan(
        plan(t_col_edicion._columna_dos_colores(), guirnalda_plan()),
        t_col_edicion._edicion(CLASICO),
    ).plan
    antes = copy.deepcopy(con_clasico)

    with pytest.raises(PlanResolutionError):
        editar_plan(con_clasico, t_org_edicion._edicion(ORGANICO))

    assert con_clasico == antes, "el rechazo no deja nada a medias"


# --- MEDIO-7: la guirnalda orgánica no repite el material en dos filas de compra ---------------------------------------------


def _guirnalda_con_paleta_repetida() -> dict[str, Any]:
    armado = t_gui.armado()
    armado["colores"] = {
        **armado["colores"],
        "paleta": [
            {"material": 0, "peso": 40, "acabado": "mate", "rol": "normal"},
            {"material": 0, "peso": 40, "acabado": "cromado", "rol": "normal"},
            {"material": 1, "peso": 40, "acabado": "mate", "rol": "normal"},
        ],
    }
    return armado


def test_la_guirnalda_con_el_mismo_material_dos_veces_en_la_paleta_une_su_compra_en_una_fila() -> (
    None
):
    # Antes: compra [(0, 37, 41), (0, 38, 43), (1, 27, 31)]: el material 0 en dos filas (y una clave repetida en pantalla).
    resuelto = armado_guirnalda_organica.armado_resuelto(
        t_gui.guirnalda(), _guirnalda_con_paleta_repetida()
    )

    materiales = [fila["material"] for fila in resuelto["compra"]]
    assert sorted(materiales) == [0, 1], materiales
    assert sum(fila["comprar"] for fila in resuelto["compra"]) == resuelto["total_comprar"]
    assert sum(fila["cantidad"] for fila in resuelto["compra"]) == len(resuelto["globos"])
    claves = [
        (linea["material"], linea["tamano"], linea["acabado"]) for linea in resuelto["conteo"]
    ]
    assert len(claves) == len(set(claves))
    assert {linea["acabado"] for linea in resuelto["conteo"] if linea["material"] == 0} == {
        "mate",
        "cromado",
    }, "el conteo conserva el acabado"


# --- MEDIO-9: las medidas del plan son las del motor, todas --------------------------------------------------------------


def test_guardar_la_columna_organica_escribe_alto_y_ancho_del_motor() -> None:
    # Antes: solo `alto_m`; con un `ancho_m` previo de 0,3 quedaba 0,3 y el motor decía 1,06.
    pieza = t_org_edicion._columna_con_catalogo(medidas={"alto_m": 2.0, "ancho_m": 0.3})

    editado = editar_plan(plan(pieza), t_org_edicion._edicion(ORGANICO)).plan

    medidas = t_org_edicion._pieza(editado, t_org_edicion.COLUMNA)["medidas"]
    motor = armado_columna_organica.armado_resuelto(
        t_org.columna("#000001", "#000002"), ORGANICO, MERMA
    )
    assert medidas["ancho_m"] == round(motor["ancho_m"], 2) != 0.3
    assert medidas["alto_m"] == round(motor["alto_m"], 2)


def test_guardar_la_guirnalda_organica_escribe_largo_alto_y_ancho_del_motor() -> None:
    pieza = guirnalda_plan(medidas={"largo_m": 3.0, "alto_m": 0.5, "ancho_m": 0.2})
    armado = t_gui.armado()

    editado = editar_plan(
        plan(pieza),
        t_org_edicion._EDICION.validate_python(
            {
                "accion": "armado_guirnalda_organica",
                "estructura_id": pieza["estructura_id"],
                "armado_guirnalda_organica": armado,
            }
        ),
    ).plan

    medidas = next(
        e for e in editado["estructuras"] if e["estructura_id"] == pieza["estructura_id"]
    )["medidas"]  # type: ignore[index, attr-defined]
    motor = armado_guirnalda_organica.armado_resuelto(
        t_gui.guirnalda("#000001", "#000002"), armado, MERMA
    )
    assert (medidas["largo_m"], medidas["alto_m"], medidas["ancho_m"]) == (
        round(motor["largo_m"], 2),
        round(motor["alto_m"], 2),
        round(motor["ancho_m"], 2),
    )


# --- ALTO-3 (a): lo que costaría demasiado se rechaza antes de colocar nada -----------------------------------------------


def _columna_enorme() -> dict[str, Any]:
    armado = t_org.armado()
    armado["forma"] = {**armado["forma"], "altoM": 4.5}
    armado["volumen"] = {
        **armado["volumen"],
        "grosorPatasM": 1.6,
        "grosorCimaM": 1.35,
        "relleno": 1.0,
    }
    armado["tamanos"] = {**armado["tamanos"], "mezcla": {"5": 50}}
    return armado


def test_una_columna_organica_que_costaria_9_segundos_se_rechaza_antes_de_colocar(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Antes: 741 globos en 9,4 s en el hilo único. Ahora la estimación (sin colocar nada) la rechaza al instante.
    def no_debe_colocar(*_: object, **__: object) -> None:
        raise AssertionError("no debe colocar un solo globo antes de rechazar")

    monkeypatch.setattr(armado_columna_organica, "disposicion_col", no_debe_colocar)

    with pytest.raises(armado_columna_organica.ArmadoInvalido) as caso:
        armado_columna_organica.armado_resuelto(t_org.columna(), _columna_enorme())

    assert caso.value.motivo == "demasiado_grande"
    assert str(armado_columna_organica.MAX_GLOBOS_ESTIMADOS) in caso.value.mensaje


def test_una_guirnalda_organica_que_costaria_12_segundos_se_rechaza_antes_de_colocar(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    armado = t_gui.armado()
    armado["forma"] = {**armado["forma"], "largoM": 10}
    armado["volumen"] = {
        **armado["volumen"],
        "grosorPatasM": 1.2,
        "grosorCimaM": 1.4,
        "relleno": 1.0,
    }
    armado["tamanos"] = {**armado["tamanos"], "mezcla": {"5": 30, "12": 30}}

    def no_debe_colocar(*_: object, **__: object) -> None:
        raise AssertionError("no debe colocar un solo globo antes de rechazar")

    monkeypatch.setattr(armado_guirnalda_organica, "disposicion_guir", no_debe_colocar)

    with pytest.raises(armado_guirnalda_organica.ArmadoInvalido) as caso:
        armado_guirnalda_organica.armado_resuelto(t_gui.guirnalda(), armado)

    assert caso.value.motivo == "demasiado_grande"


def test_las_recetas_y_los_diseños_normales_quedan_muy_por_debajo_del_tope() -> None:
    # La receta de la columna (2,2 m) estima 44 globos y la de la guirnalda (4 m), 81: el tope (300) no las toca.
    assert armado_columna_organica.armado_resuelto(t_org.columna(), t_org.armado())["globos"]
    assert armado_guirnalda_organica.armado_resuelto(t_gui.guirnalda(), t_gui.armado())["globos"]


def test_guardar_una_columna_enorme_responde_422_con_frase() -> None:
    base = plan(t_org_edicion._columna_dos_colores(), guirnalda_plan())
    armado = {
        **ORGANICO,
        **{k: v for k, v in _columna_enorme().items() if k in ("forma", "volumen", "tamanos")},
    }

    with pytest.raises(PlanResolutionError) as caso:
        editar_plan(base, t_org_edicion._edicion(armado))

    assert (caso.value.code, caso.value.status_code) == ("armado_invalido", 422)
    assert cast(Mapping[str, str], caso.value.details)["motivo"] == "demasiado_grande"


# --- MEDIO-8: lo que cobra el plan es el conteo del motor más su reserva, y eso sí se compara --------------------------------


def test_lo_que_cobra_el_plan_sale_del_conteo_del_motor_y_no_de_la_cifra_a_comprar_del_editor() -> (
    None
):
    """El «Total a comprar» del editor es del motor (cada fila con su desperdicio); el plan cobra el conteo más su
    propia reserva global de merma, con paquetes. Aquí se compara contra lo que resuelve el plan, no motor contra motor:
    por eso la pantalla rotula esa cifra «según el motor»."""
    import asyncio

    from tests.guirnalda_datos import resolver

    editado = editar_plan(
        plan(t_org_edicion._columna_con_catalogo()), t_org_edicion._edicion(ORGANICO)
    ).plan

    resuelto = cast(dict[str, Any], asyncio.run(resolver(editado)))

    motor = armado_columna_organica.armado_resuelto(
        t_org.columna("#000001", "#000002"), ORGANICO, MERMA
    )
    conteo_motor = sum(linea["cantidad"] for linea in motor["conteo"])
    compras = resuelto["compras"]
    totales = resuelto["totales"]
    assert sum(linea["design_quantity"] for linea in compras) == conteo_motor, (
        "el plan parte del conteo del motor"
    )
    assert (
        conteo_motor == resuelto["estructuras"][0]["total_unidades"] == totales["design_quantity"]
    )
    # El plan suma UNA reserva global (`merma_porcentaje` del total) y no la merma de cada fila del motor.
    con_merma = sum(linea["unidades_con_merma"] for linea in compras)
    assert con_merma == totales["design_quantity"] + totales["target_waste_reserve"]
    assert con_merma != motor["total_comprar"], (
        "dos cifras distintas: la del editor es del motor, la del cobro es del plan"
    )
    assert con_merma >= conteo_motor, "el plan nunca cobra menos globos de los que el motor colocó"
