"""Las herramientas del motor del diseñador en el agente de chat (ADR-0034 §5).

Lo que se prueba aquí es la **puerta**, no el motor: que el catálogo salga del motor y no de una lista escrita
a mano, que un armado que no se sostiene salga con su motivo estable en vez de colarse, y que ningún arco ni
ninguna columna del plan se quede sin armado. Cómo coloca los globos es de ``tests/test_arco.py`` y
``tests/test_armado_columna.py``, contra sus vectores de oro.
"""

from __future__ import annotations

import hashlib
import json
import time
from collections.abc import Mapping, Sequence
from typing import Any, cast
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.arco.tipos import PATRON_IDS as PATRON_IDS_ARCO
from app.armado_columna import PATRON_IDS as PATRON_IDS_COLUMNA
from app.guirnalda.tipos import config_inicial as config_inicial_guirnalda
from app.main import Settings, build_signature, create_app
from app.omoikane.armado_estructura import (
    OMOIKANE_ARMADO_RESULT_VERSION,
    OMOIKANE_ARMADO_SCOPE,
    ArmadoEstructuraRequest,
    resolver_armado_estructura,
)
from app.operational_store import InMemoryOperationalStore
from app.organico.tipos import ACABADOS as _ACABADOS, REPARTOS as _REPARTOS
from app.plan import PlanResolutionError

SECRET = "o" * 32

#: Los acabados y los repartos tal como los nombra el motor. La prueba los compara contra el catálogo que
#: publica la operación: si allá se añade uno, aquí se ve sin tocar nada.
ACABADOS_MOTOR = tuple(cast(str, a["valor"]) for a in _ACABADOS)
REPARTOS_MOTOR = tuple(cast(str, r["valor"]) for r in _REPARTOS)

CONTEXTO: dict[str, object] = {
    "schema_version": "operational.v1",
    "request_id": "00000000-0000-4000-8000-0000000000a0",
    "correlation_id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
    "deadline_at": "2030-01-01T00:00:00Z",
    "deadline_ms": 5000,
    "scopes": [OMOIKANE_ARMADO_SCOPE],
    "body_sha256": "0" * 64,
}

GLOBO_ARCO: dict[str, object] = {
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


def _peticion(**campos: object) -> ArmadoEstructuraRequest:
    return ArmadoEstructuraRequest(
        context=cast(Any, CONTEXTO),
        schema_version="omoikane-armado-estructura.v1",
        **cast(Any, campos),
    )


def _estructura(
    estructura_id: str,
    tipo: str,
    colores: int,
    *,
    acabados: Sequence[str | None] = (),
    **extra: object,
) -> dict[str, object]:
    return {
        "estructura_id": estructura_id,
        "nombre": "Pieza",
        "tipo": tipo,
        "rol_escena": "focal",
        "ubicacion": "fondo_pared",
        "medidas": {"ancho_m": 3.2, "alto_m": 2.3, "largo_m": 4.5},
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": "clasica",
        "materiales": [
            {
                "product_id": f"prod-{indice}",
                "participacion": round(1 / colores, 4),
                "rol_material": "principal" if indice == 0 else "secundario",
                **(
                    {"acabado": acabados[indice]}
                    if indice < len(acabados) and acabados[indice] is not None
                    else {}
                ),
            }
            for indice in range(colores)
        ],
        "porque": "Prueba.",
        **extra,
    }


#: Un ``armado-guirnalda.v1`` de ADR-0032, el que NO es del motor. Está aquí para comprobar que convive.
ARMADO_GUIRNALDA_ADR_0032: dict[str, object] = {
    "version": "armado-guirnalda.v1",
    "origen": "sugerido",
    "soporte": "pared",
    "forma": "recta",
    "racimo": {"unidad": "cuarteto", "tamano_pulg_base": 12},
    "relleno": None,
    "remates": [],
}


def _plan(*estructuras: Mapping[str, object]) -> dict[str, object]:
    return {
        "plan_version": "1.0",
        "plan_id": "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
        "concepto": {"titulo": "Prueba", "descripcion": "Prueba.", "paleta": ["rosado"]},
        "espacio": {"tipo": "salon", "fuente": "cliente"},
        "estructuras": [dict(estructura) for estructura in estructuras],
    }


def _armado_arco(**extra: object) -> dict[str, object]:
    return {
        "version": "armado-arco.v1",
        "origen": "sugerido",
        "patron": "punteado",
        "opciones": {},
        "geometria": {"forma": "semi", "anchoM": 3, "altoM": 2, "globosAncho": 4, "suelo": True},
        "globo": dict(GLOBO_ARCO),
        "capas": [],
        "secciones": [],
        "materiales": [0, 1],
        **extra,
    }


# --- La consulta: el catálogo sale del motor ------------------------------------------------


def test_el_catalogo_del_arco_trae_los_catorce_patrones_con_sus_mandos() -> None:
    salida = resolver_armado_estructura(_peticion(accion="catalogo", tipo="arco"))
    assert salida["operation_schema_version"] == OMOIKANE_ARMADO_RESULT_VERSION
    opciones = cast(dict[str, Any], salida["opciones"])
    patrones = cast(list[dict[str, Any]], opciones["patrones"])
    # Los catorce del diseñador, en el orden del motor: si allá se añade uno, aquí se ve sin tocar nada.
    assert [patron["id"] for patron in patrones] == list(PATRON_IDS_ARCO)
    assert len(patrones) == 14
    solido = next(patron for patron in patrones if patron["id"] == "solido")
    assert (solido["min_colores"], solido["max_colores"]) == (1, 1)
    floral = next(patron for patron in patrones if patron["id"] == "floral")
    assert floral["min_colores"] == 4
    # Cada mando llega con su rango y su valor de partida, que es lo que el modelo no puede adivinar.
    espiral = next(patron for patron in patrones if patron["id"] == "espiral")
    mandos = {
        cast(str, mando["clave"]): mando
        for mando in cast(list[dict[str, Any]], espiral["controles"])
    }
    assert set(mandos) == {"ancho", "inclinacion", "inversion", "espejo"}
    assert all({"min", "max", "paso", "defecto"} <= set(mando) for mando in mandos.values())
    assert opciones["formas"] == ["alto", "semi", "herradura"]
    assert opciones["ancho_m"] == {"min": 0.8, "max": 10.0}


def test_el_catalogo_de_la_columna_trae_los_nueve_patrones_y_sus_remates() -> None:
    opciones = cast(
        dict[str, Any],
        resolver_armado_estructura(_peticion(accion="catalogo", tipo="columna"))["opciones"],
    )
    assert [patron["id"] for patron in cast(list[dict[str, Any]], opciones["patrones"])] == list(
        PATRON_IDS_COLUMNA
    )
    assert opciones["modos"] == ["altura", "capas"]
    assert "racimo" in cast(list[str], opciones["remates"])


# --- El armado: la puerta del motor decide --------------------------------------------------


def test_un_armado_valido_pasa_y_devuelve_lo_que_lleva_de_verdad() -> None:
    salida = resolver_armado_estructura(
        _peticion(
            accion="armar",
            estructura_id="EST_01_ARCO",
            pieza={"tipo": "arco", "colores": 2, "ancho_m": 3.0, "alto_m": 2.4},
            patron="espiral",
            materiales=[0, 1],
        )
    )
    armado = cast(dict[str, Any], salida["armado"])
    assert armado["version"] == "armado-arco.v1"
    assert armado["patron"] == "espiral"
    # La geometría sale de las medidas de la pieza sin que el modelo las repita.
    assert cast(dict[str, Any], armado["geometria"])["anchoM"] == 3.0
    assert cast(dict[str, Any], armado["geometria"])["altoM"] == 2.4
    # Los mandos que el modelo no mandó son los del motor, no ceros.
    assert cast(dict[str, Any], armado["opciones"]) == {
        "ancho": 2.0,
        "inclinacion": 2.0,
        "inversion": 0.0,
        "espejo": 0.0,
    }
    resumen = cast(dict[str, Any], salida["resumen"])
    assert resumen["total_globos"] > 0
    assert (
        sum(linea["cantidad"] for linea in cast(list[dict[str, Any]], resumen["conteo"]))
        == resumen["total_globos"]
    )
    assert {linea["material"] for linea in cast(list[dict[str, Any]], resumen["conteo"])} == {0, 1}
    assert resumen["largo_m"] > 0
    # El dibujo no sale por aquí: el modelo no mira píxeles y el SVG pesa decenas de kilobytes.
    assert "grafica" not in salida and "globos" not in resumen


def test_un_patron_inexistente_se_rechaza_con_su_motivo() -> None:
    with pytest.raises(PlanResolutionError) as rechazo:
        resolver_armado_estructura(
            _peticion(
                accion="armar",
                estructura_id="EST_01_ARCO",
                pieza={"tipo": "arco", "colores": 2},
                patron="mirlo",
                materiales=[0, 1],
            )
        )
    detalles = cast(dict[str, object], rechazo.value.details)
    assert (rechazo.value.code, detalles["motivo"]) == ("armado_invalido", "patron_desconocido")
    assert "espiral" in cast(str, detalles["mensaje"]), "el mensaje dice cuáles hay"
    assert detalles["estructura_id"] == "EST_01_ARCO"


def test_un_color_que_la_pieza_no_lleva_se_rechaza_con_su_motivo() -> None:
    with pytest.raises(PlanResolutionError) as rechazo:
        resolver_armado_estructura(
            _peticion(
                accion="armar",
                pieza={"tipo": "arco", "colores": 2},
                patron="espiral",
                materiales=[0, 5],
            )
        )
    detalles = cast(dict[str, object], rechazo.value.details)
    assert detalles["motivo"] == "material_fuera_de_rango"
    assert "2 colores" in cast(str, detalles["mensaje"])


def test_un_patron_que_pide_mas_colores_de_los_que_hay_se_rechaza() -> None:
    with pytest.raises(PlanResolutionError) as rechazo:
        resolver_armado_estructura(
            _peticion(
                accion="armar",
                pieza={"tipo": "arco", "colores": 4},
                patron="floral",
                materiales=[0, 1],
            )
        )
    assert cast(dict[str, object], rechazo.value.details)["motivo"] == "pocos_materiales"


def test_un_mando_fuera_de_rango_se_acota_con_aviso_y_uno_ajeno_se_ignora() -> None:
    salida = resolver_armado_estructura(
        _peticion(
            accion="armar",
            pieza={"tipo": "arco", "colores": 2},
            patron="espiral",
            materiales=[0, 1],
            opciones={"ancho": 99, "radio": 2},
        )
    )
    assert cast(dict[str, Any], cast(dict[str, Any], salida["armado"])["opciones"])["ancho"] == 6.0
    avisos = cast(list[str], salida["avisos"])
    assert any("acoto" in aviso and "ancho" in aviso for aviso in avisos)
    assert any("radio" in aviso for aviso in avisos), (
        "un mando de otro patrón se dice, no se aplica"
    )


def test_una_columna_se_arma_por_altura_con_su_remate() -> None:
    salida = resolver_armado_estructura(
        _peticion(
            accion="armar",
            estructura_id="EST_02_COLUMNA",
            pieza={"tipo": "columna", "colores": 3, "alto_m": 2.0},
            patron="ombre",
            materiales=[0, 1, 2],
            remate={"tipo": "estrella", "foil_m": 0.8},
        )
    )
    armado = cast(dict[str, Any], salida["armado"])
    assert (armado["modo"], armado["patron"]) == ("altura", "ombre")
    assert cast(dict[str, Any], armado["cuerpo"])["alto_m"] == 2.0
    remate = cast(dict[str, Any], armado["remate"])
    assert (remate["tipo"], remate["foil_m"], remate["material"]) == ("estrella", 0.8, 0)
    resumen = cast(dict[str, Any], salida["resumen"])
    assert resumen["capas"] > 0 and resumen["alto_total_m"] > 2.0


def test_un_arco_mas_ancho_de_lo_que_el_motor_arma_se_acota() -> None:
    salida = resolver_armado_estructura(
        _peticion(
            accion="armar",
            pieza={"tipo": "arco", "colores": 1, "ancho_m": 42.0},
            patron="solido",
            materiales=[0],
        )
    )
    assert (
        cast(dict[str, Any], cast(dict[str, Any], salida["armado"])["geometria"])["anchoM"] == 10.0
    )
    assert any("acoto" in aviso for aviso in cast(list[str], salida["avisos"]))


def test_armar_exige_pieza_patron_y_materiales() -> None:
    with pytest.raises(ValidationError):
        _peticion(accion="armar", patron="espiral", materiales=[0])
    with pytest.raises(ValidationError):
        _peticion(accion="catalogo")
    with pytest.raises(ValidationError):
        _peticion(accion="completar")
    with pytest.raises(ValidationError):
        _peticion(
            accion="armar",
            pieza={"tipo": "arco", "colores": 2},
            patron="espiral",
            materiales=[0, 99],
        )


# --- Completar: ninguna pieza con motor se queda sin armado ---------------------------------


def test_cada_pieza_con_motor_sin_armado_recibe_la_receta_del_motor() -> None:
    plan = _plan(
        _estructura("EST_01_ARCO", "arco", 2),
        _estructura("EST_02_COLUMNA", "columna", 1),
        _estructura("EST_03_PARED", "pared", 2),
    )
    armados = cast(
        list[dict[str, Any]],
        resolver_armado_estructura(_peticion(accion="completar", plan=plan))["armados"],
    )
    # Una pared no tiene motor migrado: sigue por el camino de siempre.
    assert [armado["estructura_id"] for armado in armados] == ["EST_01_ARCO", "EST_02_COLUMNA"]
    arco = armados[0]
    assert (arco["origen"], arco["clave"]) == ("receta", "armado_arco")
    assert cast(dict[str, Any], arco["armado"])["patron"] == "espiral", (
        "el patrón con el que arranca el diseñador"
    )
    assert cast(dict[str, Any], cast(dict[str, Any], arco["armado"])["geometria"])["anchoM"] == 3.2
    assert cast(dict[str, Any], arco["armado"])["materiales"] == [0, 1]
    columna = armados[1]
    assert (columna["origen"], columna["clave"]) == ("receta", "armado_columna")
    # Un solo color solo se puede pintar sólido.
    assert cast(dict[str, Any], columna["armado"])["patron"] == "solido"
    assert cast(dict[str, Any], columna["armado"])["materiales"] == [0]


def test_la_receta_del_arco_usa_el_arcoiris_cuando_hay_mas_colores_que_bandas() -> None:
    plan = _plan(_estructura("EST_01_ARCO", "arco", 6))
    armados = cast(
        list[dict[str, Any]],
        resolver_armado_estructura(_peticion(accion="completar", plan=plan))["armados"],
    )
    armado = cast(dict[str, Any], armados[0]["armado"])
    assert armado["patron"] == "arcoiris", "es el único de los catorce que reparte seis bandas"
    assert armado["materiales"] == [0, 1, 2, 3, 4, 5], "ningún color de la pieza se queda fuera"
    # El arcoíris quiere un globo a lo ancho por banda: lo decide el motor, no esta frontera.
    assert cast(dict[str, Any], armado["geometria"])["globosAncho"] == 6


def test_el_armado_que_el_modelo_armo_llega_al_plan_cuando_se_sostiene() -> None:
    plan = _plan(_estructura("EST_01_ARCO", "arco", 2))
    propuesto = {"estructura_id": "EST_01_ARCO", "tipo": "arco", "armado": _armado_arco()}
    armados = cast(
        list[dict[str, Any]],
        resolver_armado_estructura(_peticion(accion="completar", plan=plan, armados=[propuesto]))[
            "armados"
        ],
    )
    assert armados[0]["origen"] == "modelo"
    assert cast(dict[str, Any], armados[0]["armado"])["patron"] == "punteado"
    assert armados[0]["avisos"] == []


def test_un_armado_del_modelo_que_no_se_sostiene_cae_a_la_receta_con_su_motivo() -> None:
    plan = _plan(_estructura("EST_01_ARCO", "arco", 2))
    # `floral` pide cuatro colores y la pieza lleva dos: el modelo no podía saberlo al armarlo.
    propuesto = {
        "estructura_id": "EST_01_ARCO",
        "tipo": "arco",
        "armado": _armado_arco(patron="floral"),
    }
    armados = cast(
        list[dict[str, Any]],
        resolver_armado_estructura(_peticion(accion="completar", plan=plan, armados=[propuesto]))[
            "armados"
        ],
    )
    assert armados[0]["origen"] == "receta"
    assert "pocos_materiales" in cast(list[str], armados[0]["avisos"])[0]


def test_un_armado_escrito_en_el_plan_se_vuelve_a_validar_contra_la_pieza() -> None:
    # El modelo puede escribirlo directamente en `confirmar_plan_decoracion`; su salida no autoriza nada.
    bueno = _plan(_estructura("EST_01_ARCO", "arco", 2, armado_arco=_armado_arco()))
    assert (
        cast(
            list[dict[str, Any]],
            resolver_armado_estructura(_peticion(accion="completar", plan=bueno))["armados"],
        )[0]["origen"]
        == "modelo"
    )
    malo = _plan(_estructura("EST_01_ARCO", "arco", 2, armado_arco=_armado_arco(materiales=[0, 4])))
    caido = cast(
        list[dict[str, Any]],
        resolver_armado_estructura(_peticion(accion="completar", plan=malo))["armados"],
    )[0]
    assert caido["origen"] == "receta"
    assert "material_fuera_de_rango" in cast(list[str], caido["avisos"])[0]


def test_completar_sin_estructuras_es_un_plan_invalido() -> None:
    with pytest.raises(PlanResolutionError) as rechazo:
        resolver_armado_estructura(_peticion(accion="completar", plan={"plan_version": "1.0"}))
    assert rechazo.value.code == "invalid_plan"


# --- La guirnalda orgánica: el tercer tipo, y el único sin patrón ---------------------------


def test_el_catalogo_de_la_guirnalda_trae_acabados_repartos_y_papeles_del_motor() -> None:
    opciones = cast(
        dict[str, Any],
        resolver_armado_estructura(_peticion(accion="catalogo", tipo="guirnalda"))["opciones"],
    )
    # Una guirnalda orgánica no tiene patrón: lo que se elige es el acabado, el reparto y el papel.
    assert "patrones" not in opciones
    assert [a["valor"] for a in cast(list[dict[str, Any]], opciones["acabados"])] == list(
        ACABADOS_MOTOR
    )
    assert [r["valor"] for r in cast(list[dict[str, Any]], opciones["repartos"])] == list(
        REPARTOS_MOTOR
    )
    # Cada reparto llega con su texto y su ayuda, que es lo que el modelo no puede adivinar.
    assert all(
        {"valor", "texto", "ayuda"} <= set(r)
        for r in cast(list[dict[str, Any]], opciones["repartos"])
    )
    assert list(cast(list[str], opciones["roles"])) == ["normal", "acento"]
    assert cast(dict[str, Any], opciones["largo_m"])["min"] > 0
    assert "max_materiales" in opciones


def test_una_guirnalda_valida_pasa_con_su_paleta_y_dice_lo_que_lleva() -> None:
    salida = resolver_armado_estructura(
        _peticion(
            accion="armar",
            estructura_id="EST_03_GUIRNALDA",
            pieza={
                "tipo": "guirnalda",
                "colores": 3,
                "largo_m": 4.0,
                "pesos": [0.5, 0.3, 0.2],
                "acabados": ["mate", None, "cromado"],
            },
            paleta=[{"material": 0}, {"material": 1}, {"material": 2, "rol": "acento"}],
            reparto="racimos",
            tamanos=[
                {"tamano": 5, "peso": 30},
                {"tamano": 12, "peso": 50},
                {"tamano": 18, "peso": 20},
            ],
        )
    )
    armado = cast(dict[str, Any], salida["armado"])
    assert armado["version"] == "armado-guirnalda-organica.v1"
    assert "patron" not in armado, "una guirnalda orgánica no tiene patrón"
    # El largo sale de la pieza y el resto de la línea, del motor.
    forma = cast(dict[str, Any], armado["forma"])
    assert forma["largoM"] == 4.0
    assert forma["ondas"] == 1.5 and forma["festones"] == 1
    assert "espejo" not in forma, "el contrato no publica `espejo`; lo rellena la puerta"
    colores = cast(dict[str, Any], armado["colores"])
    assert colores["reparto"] == "racimos"
    # Los pesos salen de la participación de cada material y el acabado de lo que el plan declara.
    assert [c["peso"] for c in cast(list[dict[str, Any]], colores["paleta"])] == [50.0, 30.0, 20.0]
    assert [c["acabado"] for c in cast(list[dict[str, Any]], colores["paleta"])] == [
        "mate",
        "mate",
        "cromado",
    ]
    assert [c["rol"] for c in cast(list[dict[str, Any]], colores["paleta"])] == [
        "normal",
        "normal",
        "acento",
    ]
    assert cast(dict[str, Any], armado["tamanos"])["mezcla"] == {"5": 30.0, "12": 50.0, "18": 20.0}
    resumen = cast(dict[str, Any], salida["resumen"])
    assert resumen["total_globos"] > 0
    assert resumen["largo_m"] > 0 and resumen["sueltos"] == 0
    assert {linea["material"] for linea in cast(list[dict[str, Any]], resumen["conteo"])} == {
        0,
        1,
        2,
    }
    # El follaje y las flores se listan, no se cotizan.
    assert set(cast(dict[str, Any], resumen["adornos"])) == {"ramas", "flores"}
    assert "grafica" not in salida


def test_un_acabado_un_papel_o_un_reparto_que_el_motor_no_conoce_se_rechazan() -> None:
    for pedido, motivo in [
        ({"paleta": [{"material": 0, "acabado": "reflex"}]}, "acabado_desconocido"),
        ({"paleta": [{"material": 0, "rol": "estrella"}]}, "rol_desconocido"),
        ({"paleta": [{"material": 0}], "reparto": "espiral"}, "reparto_desconocido"),
    ]:
        with pytest.raises(PlanResolutionError) as rechazo:
            resolver_armado_estructura(
                _peticion(
                    accion="armar",
                    estructura_id="EST_03_GUIRNALDA",
                    pieza={"tipo": "guirnalda", "colores": 2},
                    **cast(Any, pedido),
                )
            )
        detalles = cast(dict[str, object], rechazo.value.details)
        assert detalles["motivo"] == motivo
        # El mensaje dice cuáles hay, para que el modelo pueda corregir sin otra consulta.
        assert "Los que hay" in cast(str, detalles["mensaje"])


def test_un_color_que_la_guirnalda_no_lleva_se_rechaza() -> None:
    with pytest.raises(PlanResolutionError) as rechazo:
        resolver_armado_estructura(
            _peticion(
                accion="armar",
                pieza={"tipo": "guirnalda", "colores": 2},
                paleta=[{"material": 0}, {"material": 4}],
            )
        )
    assert cast(dict[str, object], rechazo.value.details)["motivo"] == "material_fuera_de_rango"


def test_un_acabado_del_plan_que_el_motor_no_conoce_va_mate_con_aviso() -> None:
    salida = resolver_armado_estructura(
        _peticion(
            accion="armar",
            pieza={"tipo": "guirnalda", "colores": 1, "acabados": ["perlado"]},
            paleta=[{"material": 0}],
        )
    )
    paleta = cast(
        list[dict[str, Any]],
        cast(dict[str, Any], cast(dict[str, Any], salida["armado"])["colores"])["paleta"],
    )
    assert paleta[0]["acabado"] == "mate", (
        "no se inventa una equivalencia del vocabulario del catálogo"
    )
    assert any("perlado" in aviso for aviso in cast(list[str], salida["avisos"]))


def test_una_guirnalda_mas_larga_de_lo_que_el_motor_arma_se_acota() -> None:
    salida = resolver_armado_estructura(
        _peticion(
            accion="armar",
            pieza={"tipo": "guirnalda", "colores": 1, "largo_m": 42.0},
            paleta=[{"material": 0}],
        )
    )
    forma = cast(dict[str, Any], cast(dict[str, Any], salida["armado"])["forma"])
    assert forma["largoM"] == 10.0
    assert any("acoto" in aviso for aviso in cast(list[str], salida["avisos"]))


def test_armar_una_guirnalda_pide_paleta_y_no_patron() -> None:
    # Sin paleta no hay nada que armar...
    with pytest.raises(ValidationError):
        _peticion(accion="armar", pieza={"tipo": "guirnalda", "colores": 2})
    # ...y el patrón no hace falta, porque una guirnalda orgánica no tiene.
    sin_patron = resolver_armado_estructura(
        _peticion(
            accion="armar", pieza={"tipo": "guirnalda", "colores": 1}, paleta=[{"material": 0}]
        )
    )
    assert sin_patron["accion"] == "armar"
    # Un arco sí lo necesita.
    with pytest.raises(ValidationError):
        _peticion(accion="armar", pieza={"tipo": "arco", "colores": 2}, paleta=[{"material": 0}])


def test_la_receta_de_la_guirnalda_sale_del_largo_de_la_pieza_y_reparte_sus_colores() -> None:
    plan = _plan(_estructura("EST_01_GUIRNALDA", "guirnalda", 2, acabados=(None, "cromado")))
    armados = cast(
        list[dict[str, Any]],
        resolver_armado_estructura(_peticion(accion="completar", plan=plan))["armados"],
    )
    completado = armados[0]
    assert (completado["tipo"], completado["clave"], completado["origen"]) == (
        "guirnalda",
        "armado_guirnalda_organica",
        "receta",
    )
    armado = cast(dict[str, Any], completado["armado"])
    # Solo el largo se ajusta con las medidas de la pieza; lo demás es `config_inicial()` del motor.
    assert cast(dict[str, Any], armado["forma"])["largoM"] == 4.5
    inicial = config_inicial_guirnalda()
    assert cast(dict[str, Any], armado["volumen"]) == dict(
        cast(Mapping[str, Any], inicial["volumen"])
    )
    assert cast(dict[str, Any], armado["aspecto"]) == dict(
        cast(Mapping[str, Any], inicial["aspecto"])
    )
    colores = cast(dict[str, Any], armado["colores"])
    # Los dos colores de la pieza, repartidos por participación, al azar, que es el reparto del diseñador.
    assert colores["reparto"] == "azar"
    assert [c["material"] for c in cast(list[dict[str, Any]], colores["paleta"])] == [0, 1]
    assert [c["peso"] for c in cast(list[dict[str, Any]], colores["paleta"])] == [50.0, 50.0]
    assert [c["acabado"] for c in cast(list[dict[str, Any]], colores["paleta"])] == [
        "mate",
        "cromado",
    ]
    assert [c["rol"] for c in cast(list[dict[str, Any]], colores["paleta"])] == ["normal", "normal"]


def test_una_guirnalda_puede_traer_los_dos_armados_y_el_del_motor_no_toca_al_viejo() -> None:
    """La trampa de la guirnalda: ``armado-guirnalda.v1`` (ADR-0032) y el del motor conviven en la pieza.

    Esta operación solo decide ``armado_guirnalda_organica``. El viejo no lo lee para validarlo, no lo
    devuelve y no lo borra: tiene su propio dueño (``completar_armados_guirnalda`` en la resolución).
    """
    plan = _plan(
        _estructura(
            "EST_01_GUIRNALDA", "guirnalda", 2, armado_guirnalda=dict(ARMADO_GUIRNALDA_ADR_0032)
        )
    )
    armados = cast(
        list[dict[str, Any]],
        resolver_armado_estructura(_peticion(accion="completar", plan=plan))["armados"],
    )
    assert len(armados) == 1
    completado = armados[0]
    assert completado["clave"] == "armado_guirnalda_organica"
    assert cast(dict[str, Any], completado["armado"])["version"] == "armado-guirnalda-organica.v1"
    # Nada de lo que sale de aquí menciona el armado de ADR-0032...
    assert "armado_guirnalda" not in completado
    # ...y la estructura que entró sigue con el suyo intacto: la operación no muta el plan.
    estructura = cast(list[dict[str, Any]], plan["estructuras"])[0]
    assert estructura["armado_guirnalda"] == ARMADO_GUIRNALDA_ADR_0032
    assert "armado_guirnalda_organica" not in estructura, (
        "completar no escribe en el plan; eso es de Next"
    )


def test_un_armado_de_guirnalda_del_modelo_que_no_se_sostiene_cae_a_la_receta() -> None:
    plan = _plan(_estructura("EST_01_GUIRNALDA", "guirnalda", 2))
    # Una paleta que nombra un color que la pieza no lleva: el modelo no podía saberlo al armarla.
    bueno = cast(
        dict[str, Any],
        resolver_armado_estructura(
            _peticion(
                accion="armar",
                pieza={"tipo": "guirnalda", "colores": 2},
                paleta=[{"material": 0}, {"material": 1}],
            )
        )["armado"],
    )
    malo = {
        **bueno,
        "colores": {
            **cast(dict[str, Any], bueno["colores"]),
            "paleta": [{"material": 7, "peso": 50, "acabado": "mate", "rol": "normal"}],
        },
    }
    armados = cast(
        list[dict[str, Any]],
        resolver_armado_estructura(
            _peticion(
                accion="completar",
                plan=plan,
                armados=[
                    {"estructura_id": "EST_01_GUIRNALDA", "tipo": "guirnalda", "armado": malo}
                ],
            )
        )["armados"],
    )
    assert armados[0]["origen"] == "receta"
    assert "material_fuera_de_rango" in cast(list[str], armados[0]["avisos"])[0]
    # Y el bueno sí entra.
    conserva = cast(
        list[dict[str, Any]],
        resolver_armado_estructura(
            _peticion(
                accion="completar",
                plan=plan,
                armados=[
                    {"estructura_id": "EST_01_GUIRNALDA", "tipo": "guirnalda", "armado": bueno}
                ],
            )
        )["armados"],
    )
    assert conserva[0]["origen"] == "modelo"
    assert conserva[0]["armado"] == bueno


def test_el_endpoint_devuelve_el_catalogo_de_la_guirnalda() -> None:
    status, body = _post(
        {
            "schema_version": "omoikane-armado-estructura.v1",
            "accion": "catalogo",
            "tipo": "guirnalda",
        },
        "00000000-0000-4000-8000-0000000000b4",
    )
    assert status == 200
    payload = cast(dict[str, Any], body["payload"])
    assert payload["tipo"] == "guirnalda"
    assert len(cast(list[object], cast(dict[str, Any], payload["opciones"])["acabados"])) == 4


# --- El endpoint ---------------------------------------------------------------------------


def _post(
    operacion: Mapping[str, object], nonce: str, *, scope: str = OMOIKANE_ARMADO_SCOPE
) -> tuple[int, dict[str, object]]:
    context = {
        **CONTEXTO,
        "scopes": [scope],
        "body_sha256": hashlib.sha256(
            json.dumps(operacion, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest(),
    }
    body = json.dumps(
        {"context": context, **operacion}, separators=(",", ":"), ensure_ascii=False
    ).encode()
    timestamp = int(time.time())
    path = "/internal/v1/omoikane/armado-estructura"
    headers = {
        "content-type": "application/json",
        "x-internal-schema-version": "operational.v1",
        "x-internal-timestamp": str(timestamp),
        "x-internal-nonce": nonce,
        "x-internal-scopes": scope,
        "x-internal-signature": build_signature(
            secret=SECRET,
            method="POST",
            path=path,
            timestamp=timestamp,
            nonce=UUID(nonce),
            scopes=[scope],
            body=body,
        ),
    }
    app = create_app(
        Settings(environment="test", hmac_secret=SECRET),
        operational_store=InMemoryOperationalStore(),
    )
    with TestClient(app) as client:
        response = client.post(path, content=body, headers=headers)
    return response.status_code, cast(dict[str, object], response.json())


def test_el_endpoint_devuelve_el_catalogo() -> None:
    status, body = _post(
        {"schema_version": "omoikane-armado-estructura.v1", "accion": "catalogo", "tipo": "arco"},
        "00000000-0000-4000-8000-0000000000b1",
    )
    assert status == 200
    payload = cast(dict[str, Any], body["payload"])
    assert payload["operation_schema_version"] == OMOIKANE_ARMADO_RESULT_VERSION
    assert len(cast(list[object], cast(dict[str, Any], payload["opciones"])["patrones"])) == 14


def test_el_endpoint_responde_422_con_el_motivo_de_un_armado_invalido() -> None:
    status, body = _post(
        {
            "schema_version": "omoikane-armado-estructura.v1",
            "accion": "armar",
            "estructura_id": "EST_01_ARCO",
            "pieza": {"tipo": "arco", "colores": 2},
            "patron": "floral",
            "materiales": [0, 1],
        },
        "00000000-0000-4000-8000-0000000000b2",
    )
    detail = cast(dict[str, object], body["detail"])
    assert (status, detail["code"]) == (422, "armado_invalido")
    assert (detail["estructura_id"], detail["motivo"]) == ("EST_01_ARCO", "pocos_materiales")


def test_el_endpoint_exige_su_scope() -> None:
    status, body = _post(
        {"schema_version": "omoikane-armado-estructura.v1", "accion": "catalogo", "tipo": "arco"},
        "00000000-0000-4000-8000-0000000000b3",
        scope="plan.armado_guirnalda",
    )
    assert (status, cast(dict[str, object], body["detail"])["code"]) == (403, "insufficient_scope")
