"""Semiarcos y columnas al confirmar: cada subtipo con su forma, su densidad y las medidas del plan.

El caso que lo abrió (2026-10-04): un «Semiarco orgánico derecho» de 1,2 × 2,2 m salía en su tarjeta como un arco
completo de dos patas de 3,68 × 2,61 m. La receta copiaba solo el ``corte`` de la forma de medio arco, el ancho del
plan (que es lo que mide la pieza que se ve) iba tal cual al ``anchoM`` del arco completo —y 1,2 m está por debajo
del mínimo del motor, así que la receta ni se sostenía—, y la puerta aceptaba un arco entero en un semiarco.
Los criterios están en ``clasificador-decoraciones/docs`` (``investigacion-arco-organico.md``, «Medio arco en un
plan»; ``investigacion-columnas.md``, «Densidad y remate en un plan»; ``investigacion-columna-organica.md``,
«Columna en un plan»).
"""

from __future__ import annotations

import copy
import hashlib
from typing import Any, cast

import pytest

from app.armado_estructura import (
    CORTE_MEDIO_ARCO_FUERTE,
    CORTE_MEDIO_ARCO_LEVE,
    FORMA_COLUMNA_ASIMETRICA,
    FORMA_SEMIARCO,
    FORMA_SEMIARCO_ASIMETRICO,
    OMOIKANE_ARMADO_SCOPE,
    ArmadoEstructuraRequest,
    completar,
)
from app.columnaorg.formas import FORMAS_COLUMNA
from app.guia_escena import pieza_de_guia
from app.organico.formas import FORMAS_LISTAS
from app.plan import pieza_del_motor_resuelta
from tests.guirnalda_datos import material, plan, resolver

CONTEXTO: dict[str, object] = {
    "schema_version": "operational.v1",
    "request_id": "00000000-0000-4000-8000-0000000000e7",
    "correlation_id": "ffffffff-ffff-4fff-8fff-fffffffffff7",
    "deadline_at": "2030-01-01T00:00:00Z",
    "deadline_ms": 5000,
    "scopes": [OMOIKANE_ARMADO_SCOPE],
    "body_sha256": hashlib.sha256(b"semiarco-columna").hexdigest(),
}
PIEZA = "EST_01_PIEZA"
_FORMA = {forma.id: forma for forma in FORMAS_LISTAS}
#: La mezcla del caso real (R-12 188, R-5 90, R-9 60, R-18 24, R-24 9): la orgánica fina del plan.
MEZCLA_CASO_REAL = "organica_fina"


def pieza(tipo: str, oficial: str, medidas: dict[str, float], **extra: object) -> dict[str, object]:
    return {
        "estructura_id": PIEZA,
        "nombre": extra.pop("nombre", "Pieza"),
        "tipo": tipo,
        "estructura_oficial": oficial,
        "rol_escena": "focal",
        "ubicacion": extra.pop("ubicacion", "lateral_izquierdo"),
        "medidas": medidas,
        "repeticiones": 1,
        "densidad": extra.pop("densidad", "media"),
        "mezcla": extra.pop("mezcla", "organica_fina"),
        "materiales": [
            material("rosado", 0.5, principal=True),
            material("blanco", 0.3),
            material("dorado", 0.2),
        ],
        "porque": "Pieza de prueba.",
        **extra,
    }


def completado(estructura: dict[str, object]) -> dict[str, Any]:
    peticion = ArmadoEstructuraRequest.model_validate(
        {
            "context": CONTEXTO,
            "schema_version": "omoikane-armado-estructura.v1",
            "accion": "completar",
            "plan": plan(estructura),
        }
    )
    return cast(dict[str, Any], completar(peticion)["armados"][0])


def completado_con_inclinacion(estructura: dict[str, object], inclinacion: float) -> dict[str, Any]:
    """Como `completado`, con la lectura de la foto de hacia dónde se va la pieza (fracción de su alto)."""
    peticion = ArmadoEstructuraRequest.model_validate(
        {
            "context": CONTEXTO,
            "schema_version": "omoikane-armado-estructura.v1",
            "accion": "completar",
            "plan": plan(estructura),
            "inclinaciones": [{"referencia_element_id": "REF_01_E01", "inclinacion": inclinacion}],
        }
    )
    return cast(dict[str, Any], completar(peticion)["armados"][0])


def armada(estructura: dict[str, object]) -> dict[str, object]:
    """La pieza con el armado que la confirmación le escribe, como queda en el plan."""
    salida = completado(estructura)
    return {**copy.deepcopy(estructura), salida["clave"]: salida["armado"]}


def globos(estructura: dict[str, object]) -> int:
    del_motor = pieza_del_motor_resuelta(estructura)
    assert del_motor is not None
    return len(cast(list[object], del_motor[1]["globos"]))


# --- Semiarcos -------------------------------------------------------------------------------------


def test_el_semiarco_organico_derecho_del_caso_real_es_medio_arco_de_un_lado_con_sus_medidas() -> (
    None
):
    real = pieza(
        "semiarco",
        "semiarco_asimetrico",
        {"ancho_m": 1.2, "alto_m": 2.2},
        nombre="Semiarco orgánico derecho",
        ubicacion="lateral_derecho",
        mezcla=MEZCLA_CASO_REAL,
    )
    salida = completado(real)
    assert salida["clave"] == "armado_arco_organico"
    forma = cast(dict[str, Any], salida["armado"]["forma"])
    # De un solo lado, volteado a la derecha, con la pata gruesa de «medio-pila». El corte ya no es el 0,68 de la
    # forma lista (un bastón con la punta colgando un tercio del alto): sin lectura de la foto, el moderado (UI-1c).
    assert forma["corte"] == CORTE_MEDIO_ARCO_FUERTE < _FORMA[FORMA_SEMIARCO].forma["corte"] < 1
    assert forma["espejo"] is True
    # El lado pesado se voltea con la pieza (2026-10-05): sin voltear, el de la izquierda caía en la punta libre
    # de un semiarco derecho y el texto de la imagen decía «más grueso a la izquierda», donde no hay pie.
    assert forma["carga"] == -_FORMA[FORMA_SEMIARCO_ASIMETRICO].forma["carga"]
    # Las medidas son las del plan: el alto tal cual y el ancho del arco completo que, cortado, deja los 1,2 m
    # que se ven; no los 3,68 × 2,61 m de un arco entero. Con el corte moderado (UI-1c) ese ancho ya no es el
    # mínimo del motor (1,5 m, con el que la pieza de corte 0,68 se quedaba): se encuentra uno que llega.
    assert forma["altoM"] == 2.2
    assert 1.5 <= forma["anchoM"] < 2.0
    del_motor = pieza_del_motor_resuelta(armada(real))
    assert del_motor is not None
    resuelto = del_motor[1]
    assert cast(float, resuelto["ancho_m"]) < 1.6
    assert abs(cast(float, resuelto["alto_m"]) - 2.2) < 0.2


@pytest.mark.anyio
async def test_en_el_semiarco_cuenta_compra_y_guia_salen_del_mismo_armado() -> None:
    real = armada(
        pieza(
            "semiarco",
            "semiarco_asimetrico",
            {"ancho_m": 1.2, "alto_m": 2.2},
            ubicacion="lateral_derecho",
            mezcla=MEZCLA_CASO_REAL,
        )
    )
    total = globos(real)
    resuelto = await resolver(plan(real))
    estructura = next(
        e
        for e in cast(list[dict[str, Any]], resuelto["estructuras"])
        if e["estructura_id"] == PIEZA
    )
    assert estructura["total_unidades"] == total
    guia = pieza_de_guia(real, [])
    assert not isinstance(guia, str)
    assert len(cast(list[object], guia["discos"])) == total


def test_un_arco_entero_no_pasa_por_semiarco() -> None:
    """La puerta del motor acepta un arco completo en un semiarco (es el mismo contrato): aquí no."""
    real = pieza("semiarco", "semiarco_asimetrico", {"ancho_m": 1.2, "alto_m": 2.2})
    entero = cast(dict[str, Any], copy.deepcopy(completado(real)["armado"]))
    entero["forma"] = {**entero["forma"], "corte": 1, "anchoM": 3.6, "altoM": 2.6}
    salida = completado({**real, "armado_arco_organico": entero})
    assert salida["origen"] != "modelo"
    assert cast(dict[str, Any], salida["armado"]["forma"])["corte"] < 1
    assert any("no_es_medio_arco" in aviso for aviso in salida["avisos"])
    # Y uno cortado pero con otras medidas tampoco.
    otro = {**entero, "forma": {**entero["forma"], "corte": 0.68}}
    salida = completado({**real, "armado_arco_organico": otro})
    assert any("medidas_del_plan" in aviso for aviso in salida["avisos"])


def test_semiarco_y_semiarco_asimetrico_no_son_la_misma_pieza() -> None:
    medidas = {"ancho_m": 3.0, "alto_m": 2.4}
    simetrico = completado(pieza("semiarco", "semiarco", medidas))["armado"]
    asimetrico = completado(pieza("semiarco", "semiarco_asimetrico", medidas))["armado"]
    assert simetrico["volumen"] == dict(_FORMA[FORMA_SEMIARCO].volumen)
    assert asimetrico["volumen"] == dict(_FORMA[FORMA_SEMIARCO_ASIMETRICO].volumen)
    assert simetrico["forma"]["corte"] == asimetrico["forma"]["corte"]
    assert simetrico["forma"]["carga"] != asimetrico["forma"]["carga"]


@pytest.mark.parametrize("oficial", ["semiarco", "semiarco_asimetrico"])
def test_mas_densa_nunca_lleva_menos_globos_en_un_semiarco(oficial: str) -> None:
    conteos = [
        globos(armada(pieza("semiarco", oficial, {"ancho_m": 3.0, "alto_m": 2.4}, densidad=d)))
        for d in ("sencilla", "media", "lujosa")
    ]
    assert conteos[0] < conteos[1] < conteos[2], conteos


# --- Columnas --------------------------------------------------------------------------------------


def test_la_columna_clasica_no_lleva_remate_si_nadie_lo_pide() -> None:
    salida = completado(pieza("columna", "columna", {"alto_m": 1.8}, mezcla="clasica"))
    assert salida["clave"] == "armado_columna"
    assert salida["armado"]["remate"]["tipo"] == "ninguno"
    del_motor = pieza_del_motor_resuelta(
        armada(pieza("columna", "columna", {"alto_m": 1.8}, mezcla="clasica"))
    )
    assert del_motor is not None
    # 1,8 m pedidos salían de 2,24 m con el globo de 24" del remate encima.
    assert cast(float, del_motor[1]["alto_total_m"]) < 1.9


def test_la_columna_clasica_por_densidad_cambia_los_globos_por_capa() -> None:
    capas = {
        d: completado(pieza("columna", "columna", {"alto_m": 1.8}, mezcla="clasica", densidad=d))[
            "armado"
        ]["cuerpo"]["globos_capa"]
        for d in ("sencilla", "media", "lujosa")
    }
    assert capas == {"sencilla": 3, "media": 4, "lujosa": 5}
    no_densa = completado(
        pieza("columna", "columna_no_densa", {"alto_m": 1.8}, mezcla="clasica", densidad="sencilla")
    )
    assert no_densa["armado"]["cuerpo"]["globos_capa"] == 3


@pytest.mark.parametrize("mezcla", ["clasica", "organica_fina"])
def test_la_columna_asimetrica_es_organica_e_inclinada(mezcla: str) -> None:
    salida = completado(pieza("columna", "columna_asimetrica", {"alto_m": 1.8}, mezcla=mezcla))
    assert salida["clave"] == "armado_columna_organica"
    lista = next(f for f in FORMAS_COLUMNA if f.id == FORMA_COLUMNA_ASIMETRICA)
    forma = cast(dict[str, Any], salida["armado"]["forma"])
    assert forma["altoM"] == 1.8
    esperado = 1.8 * lista.forma["inclinacionM"] / lista.forma["altoM"]
    assert abs(forma["inclinacionM"] - esperado) < 1e-9
    recta = completado(pieza("columna", "columna", {"alto_m": 1.8}, mezcla="organica_fina"))
    assert recta["armado"]["forma"]["inclinacionM"] == 0.0


def test_un_semiarco_sin_medidas_se_arma_con_las_medidas_que_el_plan_le_pone() -> None:
    """CASE-004 de images-judge: el armado y el resumen no pueden tener medidas distintas.

    El armado se construye antes de que la resolución complete las medidas por defecto. Sin ``medidas`` el motor
    usaba la plantilla de la forma lista (un semiarco de 3,4 × 2,5 m) y el plan mostraba 1,2 × 2,2 m: la curva
    dibujada no era la de la pieza. Ahora una pieza sin medidas se arma exactamente como con las que el plan le pone.
    """
    sin_medidas = cast(
        dict[str, Any], completado(pieza("semiarco", "semiarco", {}))["armado"]["forma"]
    )
    con_las_del_plan = cast(
        dict[str, Any],
        completado(pieza("semiarco", "semiarco", {"ancho_m": 1.2, "alto_m": 2.2}))["armado"][
            "forma"
        ],
    )
    assert sin_medidas == con_las_del_plan
    assert sin_medidas["altoM"] == 2.2, "el alto es el del plan, no el de la plantilla del motor"
    lista = _FORMA[FORMA_SEMIARCO]
    assert sin_medidas["anchoM"] != lista.forma["anchoM"], (
        "el ancho se ajusta a las medidas, no es el de la plantilla"
    )


def test_las_medidas_que_el_modelo_si_escribio_no_se_pisan_con_las_del_plan() -> None:
    propias = cast(
        dict[str, Any],
        completado(pieza("semiarco", "semiarco", {"ancho_m": 1.8, "alto_m": 2.0}))["armado"][
            "forma"
        ],
    )
    por_defecto = cast(
        dict[str, Any], completado(pieza("semiarco", "semiarco", {}))["armado"]["forma"]
    )
    assert propias["altoM"] == 2.0
    assert propias != por_defecto


def test_la_columna_asimetrica_que_la_foto_muestra_recta_sale_recta() -> None:
    """CASE-001 de images-judge: «recta observada» (0) no es «sin dato» (ausente).

    Sin lectura la asimétrica se tuerce lo que su forma lista (25 % del alto); con un 0 de la foto, no.
    """
    base = pieza(
        "columna",
        "columna_asimetrica",
        {"alto_m": 1.8},
        mezcla="organica_fina",
        referencia_element_id="REF_01_E01",
    )
    sin_lectura = cast(dict[str, Any], completado(base)["armado"]["forma"])
    assert sin_lectura["inclinacionM"] == pytest.approx(1.8 * 0.6 / 2.4)
    recta = cast(dict[str, Any], completado_con_inclinacion(base, 0.0)["armado"]["forma"])
    assert recta["inclinacionM"] == 0.0
    inclinada = cast(dict[str, Any], completado_con_inclinacion(base, 0.22)["armado"]["forma"])
    assert inclinada["inclinacionM"] == pytest.approx(1.8 * 0.22)
    hacia_la_izquierda = cast(
        dict[str, Any], completado_con_inclinacion(base, -0.22)["armado"]["forma"]
    )
    assert hacia_la_izquierda["inclinacionM"] == pytest.approx(-1.8 * 0.22)


def test_el_medio_arco_solo_cuelga_la_punta_si_la_foto_vio_un_vuelo_fuerte() -> None:
    """UI-1c (observación del usuario sobre las guías de FLUX): los semiarcos salían como bastones.

    Todo medio arco tomaba el corte 0,68 de su forma lista y la punta caía un tercio del alto pasada la cima,
    aunque la foto dijera que la pieza apenas dobla la punta. Leve: la punta se queda en la cima. Fuerte o sin
    lectura: una caída moderada. El ancho visible sigue siendo el del plan.
    """
    base = pieza(
        "semiarco",
        "semiarco_asimetrico",
        {"ancho_m": 1.2, "alto_m": 2.2},
        referencia_element_id="REF_01_E01",
    )
    leve = cast(dict[str, Any], completado_con_inclinacion(base, 0.22)["armado"]["forma"])
    fuerte = cast(dict[str, Any], completado_con_inclinacion(base, -0.45)["armado"]["forma"])
    sin_lectura = cast(dict[str, Any], completado(base)["armado"]["forma"])
    assert leve["corte"] == CORTE_MEDIO_ARCO_LEVE
    assert fuerte["corte"] == sin_lectura["corte"] == CORTE_MEDIO_ARCO_FUERTE
    assert CORTE_MEDIO_ARCO_LEVE < CORTE_MEDIO_ARCO_FUERTE < _FORMA[FORMA_SEMIARCO].forma["corte"]
    assert leve["anchoM"] != _FORMA[FORMA_SEMIARCO_ASIMETRICO].forma["anchoM"], (
        "el ancho se busca con el corte nuevo"
    )


@pytest.mark.parametrize("mezcla", ["organica_gruesa", "solo_grandes"])
def test_una_columna_de_globos_grandes_los_reparte_y_no_se_afila(mezcla: str) -> None:
    """CASE-001 de images-judge (UI-4): la columna dorada es casi toda de globos grandes y de ancho casi constante.

    La forma lista y el estilo «lleno» mandaban el 80 % de los grandes al pie y afilaban la punta a 0,7 m sobre
    1,1 m; la guía de escena que sigue FLUX salía cónica. Con una mezcla de grandes, los grandes van por todo el
    cuerpo y la punta conserva casi todo el grosor. Una mezcla de chicos sigue como antes.
    """
    grandes = cast(
        dict[str, Any],
        completado(
            pieza(
                "columna", "columna_asimetrica", {"alto_m": 2.2}, mezcla=mezcla, densidad="lujosa"
            )
        )["armado"],
    )
    assert grandes["tamanos"]["grandesAbajo"] <= 0.4
    assert grandes["volumen"]["grosorCimaM"] >= 0.85 * grandes["volumen"]["grosorPatasM"] - 1e-9
    chicos = cast(
        dict[str, Any],
        completado(
            pieza(
                "columna",
                "columna_asimetrica",
                {"alto_m": 2.2},
                mezcla="organica_fina",
                densidad="lujosa",
            )
        )["armado"],
    )
    assert chicos["tamanos"]["grandesAbajo"] > 0.4, "una columna de chicos conserva su plantilla"
    assert chicos["volumen"]["grosorCimaM"] < 0.85 * chicos["volumen"]["grosorPatasM"]


@pytest.mark.parametrize(
    ("oficial", "mezcla"),
    [("columna", "clasica"), ("columna", "organica_fina"), ("columna_asimetrica", "organica_fina")],
)
def test_mas_densa_nunca_lleva_menos_globos_en_una_columna(oficial: str, mezcla: str) -> None:
    conteos = [
        globos(armada(pieza("columna", oficial, {"alto_m": 1.8}, mezcla=mezcla, densidad=d)))
        for d in ("sencilla", "media", "lujosa")
    ]
    assert conteos[0] < conteos[1] < conteos[2], conteos
