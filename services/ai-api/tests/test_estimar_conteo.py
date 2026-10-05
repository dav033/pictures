"""Estimar el conteo de globos (``estimar-conteo.v1``): solo lectura, y siempre el número del dueño.

No hay conteo real etiquetado en el repo contra el que medir una «verdad», y esta herramienta no la inventa:
cada cifra que devuelve es la de quien la decide al confirmar. Por eso las pruebas son de **paridad con el
dueño**, no un espejo de la fórmula:

- sin armado, el total, el reparto por tamaño y la puerta física son los que da ``resolve_plan`` para la
  misma pieza (``resolver()`` de ``guirnalda_datos``, con su ``FakePlanStore``);
- con armado, el total del motor es el del resumen de ``armar`` (la puerta del chat) y el de la resolución, y
  la densidad y la mezcla del plan no lo mueven;
- una sugerencia, aplicada a la pieza y resuelta de verdad, da el total que prometió y no dispara la puerta
  física;
- lo que no se puede contar sale con un código estable, y nada de esto muta un plan ni cambia ``plan_hash``.
"""

from __future__ import annotations

import copy
import hashlib
import json
import time
from collections.abc import Mapping, Sequence
from typing import Any, cast
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft7Validator
from pydantic import ValidationError

from app import conteo_foto
from app.estimar_conteo import (
    ESTIMAR_CONTEO_SCOPE,
    EstimarConteoRequest,
    estimar_conteo,
)
from app.generated_models import contract_schema
from app.main import Settings, build_signature, create_app
from app.armado_estructura import (
    ArmadoEstructuraRequest,
    ColorPedido,
    FormaPedida,
    GeometriaPedida,
    PiezaArmado,
    armar,
)
from app.operational_store import InMemoryOperationalStore
from app.plan import PlanResolutionError
from tests.guirnalda_datos import GUIRNALDA, guirnalda, plan, resolver
from tests.test_plan_armado_motor import (
    arco,
    armado_arco,
    armado_columna,
    armado_organico,
    columna,
)

CONTEXTO = {
    "schema_version": "operational.v1",
    "request_id": "00000000-0000-4000-8000-0000000000e0",
    "correlation_id": "ffffffff-ffff-4fff-8fff-ffffffffffe0",
    "deadline_at": "2030-01-01T00:00:00Z",
    "deadline_ms": 5000,
    "scopes": [ESTIMAR_CONTEO_SCOPE],
    "body_sha256": "0" * 64,
}
RESULTADO = Draft7Validator(contract_schema("EstimarConteoResult"))
DENSIDADES = ("sencilla", "media", "lujosa")
MEZCLAS = ("clasica", "organica_fina", "organica_gruesa", "solo_grandes")

#: Cada tipo con su pieza del plan (de las pruebas del motor) y sus medidas.
PIEZAS: dict[str, tuple[str, dict[str, float]]] = {
    "arco": ("EST_01_ARCO", {"ancho_m": 3, "alto_m": 2.4}),
    "columna": ("EST_02_COLUMNA", {"alto_m": 1.6}),
    "guirnalda": (GUIRNALDA, {"largo_m": 2.5}),
}


@pytest.fixture(autouse=True)
def sin_tope_de_reloj(monkeypatch: pytest.MonkeyPatch) -> None:
    """Las pruebas de resultado no dependen de qué tan cargada esté la máquina: el reloj se prueba aparte."""
    monkeypatch.setattr("app.estimar_conteo.PRESUPUESTO_SEGUNDOS", 3600.0)


def candidato(etiqueta: str, tipo: str, **extra: object) -> dict[str, object]:
    """Un candidato del contrato; por defecto, la pieza de las pruebas del motor sin armado."""
    return {
        "etiqueta": etiqueta,
        "tipo": tipo,
        "medidas": dict(PIEZAS[tipo][1]) if tipo in PIEZAS else {},
        "densidad": "media",
        "mezcla": "organica_fina",
        **extra,
    }


def peticion(candidatos: Sequence[Mapping[str, object]], **extra: object) -> EstimarConteoRequest:
    return EstimarConteoRequest.model_validate(
        {
            "context": CONTEXTO,
            "schema_version": "estimar-conteo.v1",
            "candidatos": [dict(c) for c in candidatos],
            **extra,
        }
    )


def estimar(candidatos: Sequence[Mapping[str, object]], **extra: object) -> dict[str, Any]:
    """La estimación, validada contra el contrato de salida exportado (dueño: Zod)."""
    resultado = estimar_conteo(peticion(candidatos, **extra))
    errores = [error.message for error in RESULTADO.iter_errors(resultado)]
    assert errores == [], errores
    return cast(dict[str, Any], resultado)


def uno(tipo: str, **extra: object) -> dict[str, Any]:
    """El único candidato de una estimación, con el mismo ``extra`` para el candidato."""
    objetivo = extra.pop("objetivo", None)
    candidatos = [candidato("pieza", tipo, **extra)]
    resultado = estimar(candidatos, **({} if objetivo is None else {"objetivo": objetivo}))
    return cast(dict[str, Any], resultado["candidatos"][0])


def pieza_del_plan(tipo: str, **extra: object) -> dict[str, object]:
    """La misma pieza como estructura del plan que resuelve ``resolve_plan``."""
    base = {"arco": arco, "columna": columna, "guirnalda": guirnalda}[tipo]
    return base(**extra)


async def resolver_pieza(estructura: dict[str, object]) -> dict[str, Any]:
    """La pieza resuelta de verdad: total por instancia, reparto por tamaño y avisos de puerta física."""
    resuelto = await resolver(plan(estructura))
    pieza = cast(
        dict[str, Any],
        next(
            e
            for e in cast(list[dict[str, Any]], resuelto["estructuras"])
            if e["estructura_id"] == estructura["estructura_id"]
        ),
    )
    repeticiones = int(cast(int, estructura.get("repeticiones", 1)))
    return {
        "total": pieza["total_unidades"] // repeticiones,
        "total_instalado": pieza["total_unidades"],
        "eje_m": pieza["eje_m"],
        "reparto": sorted(
            (int(m["diam_pulg"]), m["unidades"] // repeticiones) for m in pieza["mezcla_real"]
        ),
        "puerta": [
            aviso
            for aviso in cast(list[str], resuelto["advertencias"])
            if aviso.startswith("puerta_fisica:")
        ],
        "hash": resuelto["plan_hash"],
    }


def reparto_estimado(candidato_resultado: Mapping[str, Any]) -> list[tuple[int, int]]:
    return [(r["pulgadas"], r["cantidad"]) for r in candidato_resultado["reparto_por_tamano"]]


def como_arco(armado: dict[str, object] | None = None, **cambios: object) -> dict[str, object]:
    return {"armado_arco": armado if armado is not None else armado_arco(**cambios)}


def con_cambios_del_armado(
    armado: dict[str, object], cambios: Sequence[Mapping[str, object]], bloques: Mapping[str, str]
) -> dict[str, object]:
    """Aplica al armado lo que una sugerencia del motor propuso, mando por mando."""
    nuevo = copy.deepcopy(armado)
    for cambio in cambios:
        bloque, clave = bloques[str(cambio["campo"])].split(".")
        cast(dict[str, object], nuevo[bloque])[clave] = cambio["despues"]
    return nuevo


BLOQUES_ARCO = {
    "tamano_globo": "globo.nominal",
    "globos_ancho": "geometria.globosAncho",
    "ancho_m": "geometria.anchoM",
}
BLOQUES_COLUMNA = {
    "globos_capa": "cuerpo.globos_capa",
    "abajo": "cuerpo.abajo",
    "arriba": "cuerpo.arriba",
    "alto_m": "cuerpo.alto_m",
}
BLOQUES_GUIRNALDA = {"largo_m": "forma.largoM"}


# --- (a) Sin armado: el total es el que da resolve_plan ----------------------------------------------


@pytest.mark.anyio
@pytest.mark.parametrize("tipo", ["arco", "columna", "guirnalda"])
@pytest.mark.parametrize("densidad", DENSIDADES)
@pytest.mark.parametrize("mezcla", MEZCLAS)
async def test_sin_armado_el_total_y_el_reparto_son_los_de_la_resolucion(
    tipo: str, densidad: str, mezcla: str
) -> None:
    real = await resolver_pieza(pieza_del_plan(tipo, densidad=densidad, mezcla=mezcla))
    estimado = uno(tipo, densidad=densidad, mezcla=mezcla)
    assert estimado["fuente"] == "formula"
    assert estimado["total_motor"] is None
    assert estimado["total_vigente"] == estimado["total_formula"] == real["total"]
    assert reparto_estimado(estimado) == real["reparto"]
    assert estimado["eje_m"] == real["eje_m"]
    assert estimado["nota"] is None
    # La puerta física: el mismo veredicto y, con una sola instancia, la misma frase.
    assert estimado["puerta_fisica"]["dentro"] is (real["puerta"] == [])
    assert [a.replace("EST_01_CANDIDATO", "X") for a in estimado["puerta_fisica"]["avisos"]] == [
        a.replace(str(PIEZAS[tipo][0]), "X") for a in real["puerta"]
    ]


@pytest.mark.anyio
async def test_las_repeticiones_multiplican_lo_instalado_y_no_lo_vigente() -> None:
    real = await resolver_pieza(pieza_del_plan("columna", repeticiones=3))
    estimado = uno("columna", repeticiones=3)
    assert estimado["total_vigente"] == real["total"]
    assert estimado["total_instalado"] == real["total_instalado"] == 3 * real["total"]
    assert estimado["repeticiones"] == 3


@pytest.mark.anyio
async def test_los_tamanos_obligatorios_del_cliente_cambian_el_conteo_como_en_la_resolucion() -> (
    None
):
    base = pieza_del_plan("arco")
    resuelto = await resolver(
        {
            **plan(base),
            "restricciones": {
                "estructuras": [],
                "colores": [],
                "acabados": [],
                "tamanos": [
                    {
                        "valor": "R-12",
                        "procedencia": "explicito",
                        "texto_original": "solo globos R-12",
                        "polaridad": "obligatorio",
                    }
                ],
            },
        }
    )
    pieza = cast(list[dict[str, Any]], resuelto["estructuras"])[0]
    estimado = estimar([candidato("solo 12", "arco")], tamanos_obligatorios=[12])["candidatos"][0]
    assert estimado["total_vigente"] == pieza["total_unidades"]
    assert reparto_estimado(estimado) == [(12, pieza["total_unidades"])]


@pytest.mark.anyio
async def test_estructuras_oficiales_con_geometria_propia_cuentan_como_el_dueno() -> None:
    """El aro circular (eje = circunferencia) y el arco asimétrico (banda afinada) no son un arco normal."""
    for oficial, medidas in (
        ("aro_circular", {"ancho_m": 1.5, "alto_m": 1.5}),
        ("arco_asimetrico", {"ancho_m": 3, "alto_m": 2.4}),
    ):
        real = await resolver_pieza(
            pieza_del_plan("arco", estructura_oficial=oficial, medidas=medidas)
        )
        estimado = uno("arco", estructura_oficial=oficial, medidas=medidas)
        assert estimado["total_vigente"] == real["total"], oficial
        assert estimado["eje_m"] == real["eje_m"], oficial


# --- (b) Con armado: cuenta el motor, y la fórmula no lo mueve -----------------------------------------


def _armar(pieza: PiezaArmado, **campos: object) -> dict[str, Any]:
    peticion_armar = ArmadoEstructuraRequest(
        context=CONTEXTO,  # type: ignore[arg-type]
        schema_version="omoikane-armado-estructura.v1",
        accion="armar",
        estructura_id="EST_09_X",
        pieza=pieza,
        **campos,  # type: ignore[arg-type]
    )
    return armar(peticion_armar)


def test_con_armado_de_arco_el_total_del_motor_es_el_del_resumen_de_armar() -> None:
    armado = _armar(
        PiezaArmado(tipo="arco", colores=2, ancho_m=3, alto_m=2.4),
        patron="espiral",
        materiales=[0, 1],
    )
    estimado = uno("arco", **como_arco(armado["armado"]))
    assert estimado["fuente"] == "motor"
    assert estimado["total_motor"] == estimado["total_vigente"] == armado["resumen"]["total_globos"]
    assert estimado["total_formula"] != estimado["total_motor"]
    assert estimado["formula_clasica"] is not None
    assert "NO lo mueven" in estimado["nota"]
    assert "densidad, la mezcla y las medidas del plan" in estimado["nota"]


def test_con_armado_de_columna_el_total_del_motor_es_el_del_resumen_de_armar() -> None:
    armado = _armar(
        PiezaArmado(tipo="columna", colores=2, alto_m=1.6),
        patron="espiral",
        materiales=[0, 1],
    )
    estimado = uno("columna", armado_columna=armado["armado"])
    assert estimado["total_motor"] == armado["resumen"]["total_globos"] == estimado["total_vigente"]


def test_con_armado_de_guirnalda_el_total_del_motor_es_el_del_resumen_de_armar() -> None:
    armado = _armar(
        PiezaArmado(tipo="guirnalda", colores=2, largo_m=2.5),
        paleta=[ColorPedido(material=0), ColorPedido(material=1)],
    )
    estimado = uno("guirnalda", armado_guirnalda_organica=armado["armado"])
    assert estimado["total_motor"] == armado["resumen"]["total_globos"] == estimado["total_vigente"]
    assert "semilla" in estimado["nota"]


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("tipo", "clave", "armado"),
    [
        ("arco", "armado_arco", armado_arco()),
        ("columna", "armado_columna", armado_columna()),
        ("guirnalda", "armado_guirnalda_organica", armado_organico()),
    ],
)
async def test_con_armado_el_total_vigente_es_el_que_cobra_la_resolucion(
    tipo: str, clave: str, armado: dict[str, object]
) -> None:
    real = await resolver_pieza(pieza_del_plan(tipo, **{clave: armado}))
    estimado = uno(tipo, **{clave: armado})
    assert estimado["total_vigente"] == estimado["total_motor"] == real["total"]
    assert reparto_estimado(estimado) == real["reparto"]
    assert estimado["puerta_fisica"]["dentro"] is (real["puerta"] == [])
    assert estimado["total_formula"] != real["total"]


@pytest.mark.parametrize(
    ("tipo", "clave", "armado"),
    [
        ("arco", "armado_arco", armado_arco()),
        ("columna", "armado_columna", armado_columna()),
        ("guirnalda", "armado_guirnalda_organica", armado_organico()),
    ],
)
def test_con_armado_ni_la_densidad_ni_la_mezcla_mueven_el_total(
    tipo: str, clave: str, armado: dict[str, object]
) -> None:
    totales = {
        (densidad, mezcla): uno(tipo, densidad=densidad, mezcla=mezcla, **{clave: armado})[
            "total_vigente"
        ]
        for densidad in DENSIDADES
        for mezcla in MEZCLAS
    }
    assert len(set(totales.values())) == 1, totales


def test_las_medidas_del_plan_tampoco_mueven_el_total_de_una_pieza_con_armado() -> None:
    chico = uno("arco", medidas={"ancho_m": 1.0, "alto_m": 1.0}, **como_arco())
    grande = uno("arco", medidas={"ancho_m": 6.0, "alto_m": 4.0}, **como_arco())
    assert chico["total_vigente"] == grande["total_vigente"]


@pytest.mark.anyio
async def test_una_estructura_oficial_que_ningun_motor_arma_se_cuenta_con_la_formula() -> None:
    """El aro circular no entra al motor aunque su tipo sea ``arco``: su cifra es la de la fórmula.

    Antes sí entraba —ningún motor mira ``estructura_oficial``— y esta prueba comprobaba que la nota lo
    advirtiera. Desde el 2026-10-04 la puerta lo impide (``plan.OFICIALES_SIN_MOTOR``: una forma ``circular``
    o ``libre`` no es una que un motor produzca), así que ya no hay nada que advertir: el total es el de la
    fórmula, que es el que de verdad cuenta un aro (su eje es la circunferencia).
    """
    medidas = {"ancho_m": 1.5, "alto_m": 1.5}
    sin_armado = await resolver_pieza(
        pieza_del_plan("arco", estructura_oficial="aro_circular", medidas=medidas)
    )
    estimado = uno("arco", estructura_oficial="aro_circular", medidas=medidas, **como_arco())
    assert estimado["total_formula"] == sin_armado["total"]
    # El armado guardado en la pieza no la cuenta: ni total del motor, ni nota del motor.
    assert (estimado["fuente"], estimado["total_motor"], estimado["nota"]) == (
        "formula",
        None,
        None,
    )
    assert estimado["total_vigente"] == estimado["total_formula"]
    # La advertencia sigue viva donde importa: un oficial que SÍ arma un motor y cuya forma el motor no
    # distingue, como un arco asimétrico, que para el motor es un arco.
    nota = uno("arco", estructura_oficial="arco_asimetrico", **como_arco())["nota"]
    assert "arco_asimetrico" in nota and "no distingue la forma" in nota
    # Un arco normal con motor no lleva esa advertencia.
    assert "no distingue la forma" not in uno("arco", **como_arco())["nota"]


@pytest.mark.anyio
async def test_la_puerta_fisica_del_motor_se_reporta_igual_que_la_resolucion() -> None:
    """Un arco de 1,5 m con motor puede quedar 'demasiado bajo' donde la fórmula no: se informa, no se esconde."""
    chico = armado_arco(
        geometria={"forma": "semi", "anchoM": 1.5, "altoM": 0.8, "globosAncho": 2, "suelo": True}
    )
    real = await resolver_pieza(pieza_del_plan("arco", densidad="lujosa", **como_arco(chico)))
    estimado = uno("arco", densidad="lujosa", **como_arco(chico))
    assert estimado["puerta_fisica"]["dentro"] is (real["puerta"] == [])
    assert len(estimado["puerta_fisica"]["avisos"]) == len(real["puerta"])
    assert estimado["total_vigente"] == real["total"]


# --- (c) Una sugerencia reduce la brecha, respeta la puerta física y es lo que de verdad daría -------


def _gap(objetivo: int, total: int) -> int:
    return abs(objetivo - total)


@pytest.mark.anyio
@pytest.mark.parametrize("objetivo", [30, 36, 60])
async def test_la_sugerencia_de_formula_aplicada_y_resuelta_da_el_total_prometido(
    objetivo: int,
) -> None:
    estimado = uno("guirnalda", objetivo={"conteo": objetivo})
    sugerencia = estimado["sugerencia"]
    assert sugerencia["estado"] == "propuesta" and sugerencia["via"] == "formula"
    assert sugerencia["brecha"]["dentro_de_tolerancia"] is True
    assert _gap(objetivo, sugerencia["total_resultante"]) < _gap(
        objetivo, estimado["total_vigente"]
    )
    cambios = {c["campo"]: c["despues"] for c in sugerencia["cambios"]}
    medidas = {**PIEZAS["guirnalda"][1], **{k: v for k, v in cambios.items() if k.endswith("_m")}}
    real = await resolver_pieza(
        pieza_del_plan("guirnalda", densidad=cambios.get("densidad", "media"), medidas=medidas)
    )
    assert real["total"] == sugerencia["total_resultante"]
    assert real["puerta"] == []
    assert conteo_foto.dentro_de_tolerancia(objetivo, real["total"])


@pytest.mark.anyio
async def test_la_sugerencia_de_formula_de_un_arco_mueve_densidad_y_medidas_y_respeta_la_puerta() -> (
    None
):
    estimado = uno("arco", objetivo={"conteo": 60})
    sugerencia = estimado["sugerencia"]
    assert sugerencia["estado"] == "propuesta" and sugerencia["via"] == "formula"
    assert {c["campo"] for c in sugerencia["cambios"]} <= {
        "densidad",
        "ancho_m",
        "alto_m",
        "largo_m",
    }
    cambios = {c["campo"]: c["despues"] for c in sugerencia["cambios"]}
    real = await resolver_pieza(
        pieza_del_plan(
            "arco",
            densidad=cambios.get("densidad", "media"),
            medidas={
                "ancho_m": cambios.get("ancho_m", 3),
                "alto_m": cambios.get("alto_m", 2.4),
            },
        )
    )
    assert real["total"] == sugerencia["total_resultante"]
    assert real["puerta"] == []
    assert _gap(60, real["total"]) < _gap(60, estimado["total_vigente"])


def test_si_las_medidas_son_del_cliente_la_sugerencia_de_formula_no_las_mueve() -> None:
    resultado = estimar(
        [candidato("arco del cliente", "arco")],
        objetivo={"conteo": 100},
        medidas_del_cliente=True,
    )
    sugerencia = resultado["candidatos"][0]["sugerencia"]
    assert all(c["campo"] == "densidad" for c in sugerencia["cambios"])
    assert sugerencia["estado"] in {"propuesta", "sin_ajuste_posible"}


def test_dentro_de_la_tolerancia_no_hace_falta_cambiar_nada() -> None:
    estimado = uno("guirnalda", objetivo={"conteo": 50})
    assert estimado["brecha"]["dentro_de_tolerancia"] is True
    assert estimado["sugerencia"]["estado"] == "no_necesaria"
    assert estimado["sugerencia"]["cambios"] == []


def test_la_brecha_usa_la_tolerancia_de_conteo_foto_y_no_una_copia() -> None:
    objetivo = 40
    estimado = uno("guirnalda", objetivo={"conteo": objetivo, "exacto": True})
    brecha = estimado["brecha"]
    assert brecha["objetivo"] == objetivo
    assert brecha["diferencia"] == estimado["total_vigente"] - objetivo
    assert brecha["absoluta"] == abs(brecha["diferencia"])
    assert brecha["tolerancia"] == round(conteo_foto.tolerancia(objetivo), 2)
    assert brecha["dentro_de_tolerancia"] is conteo_foto.dentro_de_tolerancia(
        objetivo, estimado["total_vigente"]
    )
    assert brecha["relativa"] == round(brecha["absoluta"] / objetivo, 4)


@pytest.mark.anyio
async def test_la_sugerencia_del_arco_con_motor_mueve_el_armado_y_no_la_formula() -> None:
    base = armado_arco()
    estimado = uno("arco", objetivo={"conteo": 60}, **como_arco(base))
    sugerencia = estimado["sugerencia"]
    assert sugerencia["estado"] == "propuesta" and sugerencia["via"] == "motor"
    # Los mandos del motor, nunca la densidad ni la mezcla, que no lo mueven.
    assert {c["campo"] for c in sugerencia["cambios"]} <= set(BLOQUES_ARCO)
    assert sugerencia["brecha"]["dentro_de_tolerancia"] is True
    assert _gap(60, sugerencia["total_resultante"]) < _gap(60, estimado["total_vigente"])
    # Aplicada al armado y resuelta de verdad por la resolución del plan: el total es el prometido y la
    # puerta física no avisa.
    nuevo = con_cambios_del_armado(base, sugerencia["cambios"], BLOQUES_ARCO)
    real = await resolver_pieza(pieza_del_plan("arco", armado_arco=nuevo))
    assert real["total"] == sugerencia["total_resultante"]
    assert real["puerta"] == []
    # Y el estimador la lee igual con el armado ya cambiado.
    assert uno("arco", **como_arco(nuevo))["total_vigente"] == real["total"]


@pytest.mark.parametrize(
    ("tipo", "pieza", "clave", "objetivo"),
    [
        ("arco", PiezaArmado(tipo="arco", colores=2, ancho_m=3, alto_m=2.4), "armado_arco", 60),
        ("arco", PiezaArmado(tipo="arco", colores=2, ancho_m=3, alto_m=2.4), "armado_arco", 120),
        ("columna", PiezaArmado(tipo="columna", colores=2, alto_m=1.6), "armado_columna", 40),
        ("columna", PiezaArmado(tipo="columna", colores=2, alto_m=1.6), "armado_columna", 24),
    ],
)
def test_lo_que_sugiere_el_motor_se_aplica_con_armar_y_da_el_mismo_total(
    tipo: str, pieza: PiezaArmado, clave: str, objetivo: int
) -> None:
    """La sugerencia dice 'aplícalo con armar_estructura (geometria.X)': se comprueba que es verdad.

    Con el mismo patrón y los mismos materiales, pedir ``geometria.X`` que propone la sugerencia da el total
    que prometió, porque los mandos tienen el mismo nombre en las dos herramientas.
    """
    armado = _armar(pieza, patron="espiral", materiales=[0, 1])
    estimado = uno(tipo, objetivo={"conteo": objetivo}, **{clave: armado["armado"]})
    sugerencia = estimado["sugerencia"]
    assert sugerencia["estado"] == "propuesta" and sugerencia["via"] == "motor", sugerencia
    pedido = {cambio["campo"]: cambio["despues"] for cambio in sugerencia["cambios"]}
    reaplicado = _armar(
        pieza, patron="espiral", materiales=[0, 1], geometria=GeometriaPedida(**pedido)
    )
    assert reaplicado["resumen"]["total_globos"] == sugerencia["total_resultante"]
    assert conteo_foto.dentro_de_tolerancia(objetivo, reaplicado["resumen"]["total_globos"])


@pytest.mark.anyio
async def test_la_sugerencia_de_la_columna_con_motor_la_confirma_la_resolucion() -> None:
    base = armado_columna()
    estimado = uno("columna", objetivo={"conteo": 40}, armado_columna=base)
    sugerencia = estimado["sugerencia"]
    assert sugerencia["estado"] == "propuesta" and sugerencia["via"] == "motor"
    nuevo = con_cambios_del_armado(base, sugerencia["cambios"], BLOQUES_COLUMNA)
    real = await resolver_pieza(pieza_del_plan("columna", armado_columna=nuevo))
    assert real["total"] == sugerencia["total_resultante"]
    assert real["puerta"] == []
    assert conteo_foto.dentro_de_tolerancia(40, real["total"])


@pytest.mark.anyio
async def test_la_sugerencia_de_la_guirnalda_con_motor_es_para_la_semilla_fija_y_no_promete_exactitud() -> (
    None
):
    base = armado_organico()
    estimado = uno("guirnalda", objetivo={"conteo": 90}, armado_guirnalda_organica=base)
    sugerencia = estimado["sugerencia"]
    assert sugerencia["estado"] == "propuesta" and sugerencia["via"] == "motor"
    assert [c["campo"] for c in sugerencia["cambios"]] == ["largo_m"]
    assert "semilla" in sugerencia["motivo"] and "no es exacta" in sugerencia["motivo"]
    nuevo = con_cambios_del_armado(base, sugerencia["cambios"], BLOQUES_GUIRNALDA)
    real = await resolver_pieza(pieza_del_plan("guirnalda", armado_guirnalda_organica=nuevo))
    assert real["total"] == sugerencia["total_resultante"]
    assert real["puerta"] == []


def test_un_objetivo_inalcanzable_con_motor_se_dice_y_no_se_finge() -> None:
    estimado = uno("arco", objetivo={"conteo": 5000}, **como_arco())
    sugerencia = estimado["sugerencia"]
    assert sugerencia["estado"] == "sin_ajuste_posible"
    assert sugerencia["cambios"] == [] and sugerencia["total_resultante"] is None
    assert "densidad, la mezcla y las medidas del plan no mueven" in sugerencia["motivo"]


def test_con_medidas_del_cliente_la_sugerencia_del_motor_no_toca_el_ancho() -> None:
    resultado = estimar(
        [candidato("arco", "arco", **como_arco())],
        objetivo={"conteo": 9},
        medidas_del_cliente=True,
    )
    sugerencia = resultado["candidatos"][0]["sugerencia"]
    assert all(c["campo"] != "ancho_m" for c in sugerencia["cambios"])
    if sugerencia["estado"] == "sin_ajuste_posible":
        assert "medidas son del cliente" in sugerencia["motivo"]


def test_una_columna_por_capas_se_dice_no_evaluada() -> None:
    por_capas = armado_columna(modo="capas", capas=[{"tamano": 12, "materiales": [0, 1, 0, 1]}] * 8)
    estimado = uno("columna", objetivo={"conteo": 200}, armado_columna=por_capas)
    assert estimado["sugerencia"]["estado"] == "no_evaluada"
    assert "capas" in estimado["sugerencia"]["motivo"]


def _garlandas(cuantas: int, **extra: object) -> list[dict[str, object]]:
    """Guirnaldas con armado del motor y semillas distintas: cada una cuenta de verdad, sin repetir el caché."""
    return [
        candidato(
            f"guirnalda {n}",
            "guirnalda",
            armado_guirnalda_organica=armado_organico(
                aspecto={**armado_organico()["aspecto"], "semilla": 11 + n}  # type: ignore[index]
            ),
            **extra,
        )
        for n in range(cuantas)
    ]


def test_el_conteo_base_de_cada_candidato_se_cobra_al_presupuesto(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Dos guirnaldas con motor cuestan 16 unidades solo de contarlas: con 16 no queda nada para buscar.

    Antes el presupuesto solo cobraba la búsqueda, así que el conteo base de un candidato se le gastaba en
    silencio al presupuesto de otro.
    """
    con_margen = estimar(_garlandas(2), objetivo={"conteo": 150})
    assert con_margen["candidatos"][0]["sugerencia"]["estado"] == "propuesta"
    monkeypatch.setattr("app.estimar_conteo.PRESUPUESTO_EVALUACIONES", 16)
    resultado = estimar(_garlandas(2), objetivo={"conteo": 150})
    sugerencias = [c["sugerencia"] for c in resultado["candidatos"]]
    assert [s["estado"] for s in sugerencias] == ["cortada_por_tope"] * 2
    assert all("evaluaciones" in s["motivo"] for s in sugerencias)
    # El conteo base sigue saliendo: lo que se pregunta no se niega.
    assert all(c["total_motor"] for c in resultado["candidatos"])


def test_el_presupuesto_corta_por_tiempo_con_un_reloj_inyectado() -> None:
    from app.estimar_conteo_sugerencia import Presupuesto

    ahora = [0.0]
    presupuesto = Presupuesto(100, segundos=2.0, reloj=lambda: ahora[0])
    assert presupuesto.cobrar(1, 1.0) is True
    ahora[0] = 1.5
    assert presupuesto.cobrar(1, 1.0) is False, (
        "no se empieza una evaluación que no cabe en el tiempo"
    )
    assert (presupuesto.agotado, presupuesto.causa) == (True, "tiempo")
    # Lo que ya se gastó en contar también corre el reloj, y las unidades de base no pueden ser negativas.
    presupuesto.gastar(10_000)
    assert presupuesto.restante == 0


def test_una_busqueda_cortada_por_tiempo_se_dice_y_no_es_un_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Con un reloj que avanza 1 s por lectura, el tope de 2 s se cumple antes de la primera evaluación."""
    import functools

    import app.estimar_conteo as modulo
    from app.estimar_conteo_sugerencia import Presupuesto

    ahora = [0.0]

    def reloj() -> float:
        ahora[0] += 1.0
        return ahora[0]

    monkeypatch.setattr("app.estimar_conteo.PRESUPUESTO_SEGUNDOS", 2.0)
    monkeypatch.setattr(modulo, "Presupuesto", functools.partial(Presupuesto, reloj=reloj))
    resultado = estimar([candidato("arco", "arco", **como_arco())], objetivo={"conteo": 600})
    sugerencia = resultado["candidatos"][0]["sugerencia"]
    assert sugerencia["estado"] == "cortada_por_tope"
    assert "el tiempo" in sugerencia["motivo"]
    assert sugerencia["cambios"] == [] and sugerencia["total_resultante"] is None
    assert resultado["candidatos"][0]["total_motor"], (
        "el conteo base sale aunque la búsqueda se corte"
    )


def test_el_tope_de_tiempo_acota_la_estimacion_con_el_reloj_real(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Con el caché del motor frío y un objetivo inalcanzable, la consulta no pasa de lo que cuesta contar + el tope."""
    from app import plan as modulo_plan

    monkeypatch.setattr("app.estimar_conteo.PRESUPUESTO_SEGUNDOS", 0.5)
    modulo_plan._pieza_del_motor.cache_clear()
    inicio = time.perf_counter()
    resultado = estimar(_garlandas(2), objetivo={"conteo": 400})
    transcurrido = time.perf_counter() - inicio
    estados = {c["sugerencia"]["estado"] for c in resultado["candidatos"]}
    # Sin tope de reloj, dos guirnaldas con objetivo lejano tardaban ~10 s (6 tardaban ~20 s).
    assert transcurrido < 4.0, f"{transcurrido:.1f} s"
    assert estados <= {"cortada_por_tope", "sin_ajuste_posible", "propuesta"}
    assert "cortada_por_tope" in estados


def test_mas_de_dos_guirnaldas_con_armado_por_consulta_es_un_error_estable() -> None:
    estimar(_garlandas(2))
    with pytest.raises(PlanResolutionError) as error:
        estimar(_garlandas(3))
    assert _codigo(error) == (
        "candidato_invalido",
        "guirnalda 2",
        "demasiadas_guirnaldas_con_armado",
    )
    # Las guirnaldas sin armado no cuentan para el tope: son la fórmula.
    estimar([candidato(f"g{n}", "guirnalda") for n in range(6)])


# --- Una estimación a la vez --------------------------------------------------------------------------


def test_la_exclusion_no_hace_cola_y_se_libera() -> None:
    from app.estimar_conteo import ExclusionDeEstimacion

    exclusion = ExclusionDeEstimacion()
    primera = exclusion.reservar()
    assert primera is not None
    assert exclusion.reservar() is None, "la segunda no espera: responde ocupado"
    exclusion.soltar(primera)
    segunda = exclusion.reservar()
    assert segunda is not None
    # Soltar una reserva vieja no suelta la vigente.
    exclusion.soltar(primera)
    assert exclusion.reservar() is None
    # Un trabajo cancelado en la cola sin correr suelta su reserva; uno que ya corrió la suelta él mismo.
    exclusion.soltar_si_no_inicio(segunda)
    assert exclusion.reservar() is not None


def test_la_exclusion_la_suelta_el_hilo_al_terminar_aunque_falle() -> None:
    from app.estimar_conteo import ExclusionDeEstimacion

    exclusion = ExclusionDeEstimacion()
    reserva = exclusion.reservar()
    assert reserva is not None
    with pytest.raises(PlanResolutionError):
        exclusion.estimar(
            reserva, peticion([candidato("sin armado valido", "arco", colores=1, **como_arco())])
        )
    assert reserva.iniciada is True
    assert exclusion.reservar() is not None, "el hilo soltó la reserva aunque la estimación falló"


def test_una_reserva_que_nadie_soltó_vence() -> None:
    from app.estimar_conteo import RESERVA_MAXIMA_S, ExclusionDeEstimacion

    ahora = [100.0]
    exclusion = ExclusionDeEstimacion(reloj=lambda: ahora[0])
    assert exclusion.reservar() is not None
    ahora[0] += RESERVA_MAXIMA_S / 2
    assert exclusion.reservar() is None
    ahora[0] += RESERVA_MAXIMA_S
    assert exclusion.reservar() is not None, (
        "una estimación perdida no deja la ruta ocupada para siempre"
    )


def test_el_endpoint_responde_ocupado_si_hay_otra_estimacion_en_curso() -> None:
    from app.estimar_conteo import EXCLUSION

    reserva = EXCLUSION.reservar()
    assert reserva is not None
    try:
        estado, cuerpo = _post(_operacion(), "00000000-0000-4000-8000-0000000000e6")
    finally:
        EXCLUSION.soltar(reserva)
    assert (estado, cuerpo["detail"]["code"]) == (429, "estimacion_ocupada")
    # Libre otra vez, responde, y la deja libre al terminar.
    estado, _ = _post(_operacion(), "00000000-0000-4000-8000-0000000000e7")
    assert estado == 200
    libre = EXCLUSION.reservar()
    assert libre is not None
    EXCLUSION.soltar(libre)


# --- Números no finitos ---------------------------------------------------------------------------------


@pytest.mark.parametrize("valor", [float("nan"), float("inf"), float("-inf")])
def test_un_numero_no_finito_se_rechaza(valor: float) -> None:
    for cambios in (
        {"candidatos": [candidato("x", "arco", medidas={"ancho_m": valor, "alto_m": 2})]},
        {"candidatos": [candidato("x", "arco")], "objetivo": {"conteo": valor}},
    ):
        with pytest.raises(ValidationError):
            EstimarConteoRequest.model_validate(
                {"context": CONTEXTO, "schema_version": "estimar-conteo.v1", **cambios}
            )


def test_un_nan_por_http_responde_422_y_no_se_cuenta_como_si_faltara() -> None:
    operacion = _operacion(
        candidatos=[candidato("x", "arco", medidas={"ancho_m": float("nan"), "alto_m": 2})],
        objetivo=None,
    )
    del operacion["objetivo"]
    estado, cuerpo = _post(operacion, "00000000-0000-4000-8000-0000000000e8")
    assert (estado, cuerpo["detail"]["code"]) == (422, "invalid_request")


# --- Una guirnalda con motor: la sugerencia se aplica con armar y da el mismo total -------------------------------


@pytest.mark.parametrize("objetivo", [55, 90, 100, 120, 140, 160])
def test_lo_que_sugiere_la_guirnalda_se_aplica_con_armar_y_da_el_mismo_total(objetivo: int) -> None:
    pieza = PiezaArmado(tipo="guirnalda", colores=2, largo_m=2.5)
    paleta = [ColorPedido(material=0), ColorPedido(material=1)]
    armado = _armar(pieza, paleta=paleta)
    estimado = uno(
        "guirnalda", objetivo={"conteo": objetivo}, armado_guirnalda_organica=armado["armado"]
    )
    sugerencia = estimado["sugerencia"]
    assert sugerencia["estado"] == "propuesta" and sugerencia["via"] == "motor", sugerencia
    assert [c["campo"] for c in sugerencia["cambios"]] == ["largo_m"]
    reaplicado = _armar(
        pieza, paleta=paleta, forma=FormaPedida(largo_m=sugerencia["cambios"][0]["despues"])
    )
    assert reaplicado["resumen"]["total_globos"] == sugerencia["total_resultante"]
    assert conteo_foto.dentro_de_tolerancia(objetivo, reaplicado["resumen"]["total_globos"])


def test_el_mejor_candidato_esta_dentro_de_tolerancia_y_de_la_puerta_fisica() -> None:
    resultado = estimar(
        [
            candidato("lejos", "arco"),
            candidato("cerca", "guirnalda"),
            candidato("tambien cerca", "columna"),
        ],
        objetivo={"conteo": 48},
    )
    mejor = next(c for c in resultado["candidatos"] if c["etiqueta"] == resultado["mejor"])
    assert mejor["brecha"]["dentro_de_tolerancia"] is True
    assert mejor["puerta_fisica"]["dentro"] is True
    assert resultado["mejor"] == "cerca"
    assert estimar([candidato("sola", "arco")], objetivo={"conteo": 5000})["mejor"] is None
    assert estimar([candidato("sola", "arco")])["mejor"] is None
    assert estimar([candidato("sola", "arco")])["candidatos"][0]["sugerencia"] is None


# --- (d) Entradas inválidas: error de contrato estable ----------------------------------------------


@pytest.mark.parametrize(
    "cambios",
    [
        {"candidatos": []},
        {"candidatos": [candidato(str(n), "arco") for n in range(7)]},
        {"candidatos": [{**candidato("x", "arco"), "densidad": "extrema"}]},
        {"candidatos": [{**candidato("x", "arco"), "tipo": "kit"}]},
        {"candidatos": [{**candidato("x", "arco"), "extra": 1}]},
        {"candidatos": [{**candidato("x", "arco"), "medidas": {"ancho_m": -1}}]},
        {
            "candidatos": [
                {**candidato("x", "arco"), "estructura_oficial": "aro_circular", "tipo": "columna"}
            ]
        },
        {
            "candidatos": [
                {
                    **candidato("x", "arco"),
                    "estructura_oficial": "arco_no_denso",
                    "densidad": "lujosa",
                }
            ]
        },
        {"candidatos": [{**candidato("x", "arco"), "armado_arco": {"version": "armado-arco.v1"}}]},
        {"candidatos": [candidato("x", "arco")], "objetivo": {"conteo": 0}},
        {"candidatos": [candidato("x", "arco")], "objetivo": {"conteo": 12, "extra": True}},
        {"candidatos": [candidato("x", "arco")], "tamanos_obligatorios": [0]},
        {"candidatos": [candidato("x", "arco")], "medidas_del_cliente": "si"},
        {"candidatos": [candidato("x", "arco")], "inesperado": True},
        {"candidatos": [{**candidato("x", "arco"), "etiqueta": ""}]},
    ],
)
def test_una_forma_invalida_se_rechaza_con_el_contrato(cambios: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        EstimarConteoRequest.model_validate(
            {"context": CONTEXTO, "schema_version": "estimar-conteo.v1", **cambios}
        )


def _codigo(error: pytest.ExceptionInfo[PlanResolutionError]) -> tuple[str, str, str]:
    detalles = error.value.details or {}
    return (error.value.code, str(detalles.get("estructura_id")), str(detalles.get("motivo")))


def test_dos_etiquetas_iguales_son_un_error_estable() -> None:
    with pytest.raises(PlanResolutionError) as error:
        estimar([candidato("igual", "arco"), candidato("igual", "columna")])
    assert _codigo(error) == ("candidato_invalido", "igual", "etiqueta_repetida")
    assert error.value.status_code == 422


def test_un_armado_de_otro_tipo_no_se_ignora_en_silencio() -> None:
    with pytest.raises(PlanResolutionError) as error:
        estimar([candidato("arco con columna", "arco", armado_columna=armado_columna())])
    assert _codigo(error) == ("candidato_invalido", "arco con columna", "armado_no_corresponde")
    with pytest.raises(PlanResolutionError) as error:
        estimar(
            [
                candidato(
                    "pared con arco", "pared", medidas={"ancho_m": 3, "alto_m": 2}, **como_arco()
                )
            ]
        )
    assert _codigo(error)[2] == "armado_no_corresponde"


@pytest.mark.anyio
@pytest.mark.parametrize("tipo", ["arco", "columna", "guirnalda"])
async def test_una_pieza_sin_medidas_se_cuenta_con_las_de_por_defecto_como_al_confirmar(
    tipo: str,
) -> None:
    """El chat deja vacías las medidas que el cliente no dio: el plan asume las de por defecto, y esto también."""
    real = await resolver_pieza(pieza_del_plan(tipo, medidas={}))
    estimado = estimar([candidato("sin medidas", tipo, medidas={})])["candidatos"][0]
    assert estimado["total_vigente"] == real["total"]
    assert estimado["eje_m"] == real["eje_m"]
    assert any("se asumieron las de por defecto" in aviso for aviso in estimado["avisos"])
    # Con medidas dadas no hay aviso.
    assert estimar([candidato("con medidas", tipo)])["candidatos"][0]["avisos"] == []


def test_un_armado_que_el_motor_rechaza_sale_con_su_motivo_y_la_etiqueta() -> None:
    with pytest.raises(PlanResolutionError) as error:
        # El armado nombra el material 1 y la pieza solo lleva uno.
        estimar([candidato("arco de un color", "arco", colores=1, **como_arco())])
    codigo, etiqueta, motivo = _codigo(error)
    assert (codigo, etiqueta, motivo) == (
        "armado_invalido",
        "arco de un color",
        "material_fuera_de_rango",
    )
    assert error.value.details and error.value.details["mensaje"]


# --- El borde HTTP -------------------------------------------------------------------------------------


def _post(
    operacion: Mapping[str, object], nonce: str, *, scope: str = ESTIMAR_CONTEO_SCOPE
) -> tuple[int, dict[str, Any]]:
    contexto = {
        **CONTEXTO,
        "scopes": [scope],
        "body_sha256": hashlib.sha256(
            json.dumps(operacion, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest(),
    }
    cuerpo = json.dumps(
        {"context": contexto, **operacion}, separators=(",", ":"), ensure_ascii=False
    ).encode()
    marca = int(time.time())
    ruta = "/internal/v1/plan/estimar-conteo"
    cabeceras = {
        "content-type": "application/json",
        "x-internal-schema-version": "operational.v1",
        "x-internal-timestamp": str(marca),
        "x-internal-nonce": nonce,
        "x-internal-scopes": scope,
        "x-internal-signature": build_signature(
            secret="e" * 32,
            method="POST",
            path=ruta,
            timestamp=marca,
            nonce=UUID(nonce),
            scopes=[scope],
            body=cuerpo,
        ),
    }
    app = create_app(
        Settings(environment="test", hmac_secret="e" * 32),
        operational_store=InMemoryOperationalStore(),
    )
    with TestClient(app) as cliente:
        respuesta = cliente.post(ruta, content=cuerpo, headers=cabeceras)
    return respuesta.status_code, cast(dict[str, Any], respuesta.json())


def _operacion(**cambios: object) -> dict[str, object]:
    return {
        "schema_version": "estimar-conteo.v1",
        "candidatos": [
            candidato("arco", "arco", **como_arco()),
            candidato("guirnalda", "guirnalda"),
        ],
        "objetivo": {"conteo": 60, "exacto": False},
        **cambios,
    }


def test_el_endpoint_devuelve_el_resultado_del_contrato() -> None:
    estado, cuerpo = _post(_operacion(), "00000000-0000-4000-8000-0000000000e1")
    assert estado == 200
    payload = cuerpo["payload"]
    assert [e.message for e in RESULTADO.iter_errors(payload)] == []
    assert payload["operation_schema_version"] == "estimar-conteo-result.v1"
    assert {c["etiqueta"] for c in payload["candidatos"]} == {"arco", "guirnalda"}


def test_el_endpoint_responde_422_con_codigo_estable() -> None:
    estado, cuerpo = _post(
        _operacion(candidatos=[candidato("x", "arco", densidad="extrema")]),
        "00000000-0000-4000-8000-0000000000e2",
    )
    assert (estado, cuerpo["detail"]["code"]) == (422, "invalid_request")
    estado, cuerpo = _post(
        _operacion(candidatos=[candidato("a", "arco"), candidato("a", "arco")]),
        "00000000-0000-4000-8000-0000000000e3",
    )
    assert (estado, cuerpo["detail"]["code"]) == (422, "candidato_invalido")
    assert (cuerpo["detail"]["estructura_id"], cuerpo["detail"]["motivo"]) == (
        "a",
        "etiqueta_repetida",
    )
    assert cuerpo["detail"]["mensaje"]
    estado, cuerpo = _post(
        _operacion(candidatos=[candidato("sin color", "arco", colores=1, **como_arco())]),
        "00000000-0000-4000-8000-0000000000e4",
    )
    assert (estado, cuerpo["detail"]["code"]) == (422, "armado_invalido")
    assert cuerpo["detail"]["motivo"] == "material_fuera_de_rango"


def test_el_endpoint_exige_su_scope() -> None:
    estado, cuerpo = _post(
        _operacion(), "00000000-0000-4000-8000-0000000000e5", scope="plan.resolve"
    )
    assert (estado, cuerpo["detail"]["code"]) == (403, "insufficient_scope")


# --- (e) Solo lectura: no muta nada y no toca plan_hash -----------------------------------------------


@pytest.mark.anyio
async def test_estimar_no_muta_la_peticion_ni_cambia_el_plan_hash() -> None:
    estructura = pieza_del_plan("arco", armado_arco=armado_arco())
    antes = await resolver_pieza(estructura)

    candidatos = [
        candidato("con motor", "arco", **como_arco()),
        candidato("columna", "columna", armado_columna=armado_columna()),
        candidato("guirnalda", "guirnalda"),
    ]
    pedida = peticion(candidatos, objetivo={"conteo": 40}, tamanos_obligatorios=[12])
    instantanea = pedida.model_dump()
    primera = estimar_conteo(pedida)
    segunda = estimar_conteo(pedida)

    assert pedida.model_dump() == instantanea
    assert candidatos == [
        candidato("con motor", "arco", **como_arco()),
        candidato("columna", "columna", armado_columna=armado_columna()),
        candidato("guirnalda", "guirnalda"),
    ]
    assert primera == segunda
    despues = await resolver_pieza(estructura)
    assert despues["hash"] == antes["hash"]
    assert despues["total"] == antes["total"]


def test_estimar_es_pura_cpu_y_no_recibe_ningun_almacen() -> None:
    import inspect

    assert not inspect.iscoroutinefunction(estimar_conteo)
    assert list(inspect.signature(estimar_conteo).parameters) == ["request"]
    # Nada de catálogo ni de productos en la entrada: el material de la pieza son marcadores.
    assert {"materiales", "allowlist", "catalog_snapshot_id"}.isdisjoint(
        contract_schema("EstimarConteoRequest")["properties"]
    )
