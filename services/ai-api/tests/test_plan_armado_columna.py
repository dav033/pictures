"""Vista previa del armado de columnas, con su dibujo (ADR-0034, ADR-0035 paso 3).

``POST /internal/v1/plan/armado-columna`` resuelve el armado que manda el editor, o da la receta de la pieza con
``armado_columna: null``, y devuelve la columna resuelta y el SVG que emite el mismo motor que colocó los globos.
Sin catálogo y sin efectos: el plan dice qué pieza es y ``colores`` solo la pintan.

Es el gemelo de ``test_plan_armado_arco.py``. Se prueba por el endpoint de verdad (firma HMAC, contexto
operacional, ``TestClient``) y no solo por la función, porque lo que monta esta entrega es el transporte: el scope,
el contrato local de la petición y la traducción de ``ArmadoInvalido`` a un error de cliente con ``motivo`` y
``mensaje``. Los números del motor (huella de cada globo, conteo, medidas) los fijan los vectores de oro de
``test_armado_columna.py`` y ``test_columna_dibujo.py``; aquí no se vuelve a calcular nada.
"""

from __future__ import annotations

import hashlib
import json
import time
from collections.abc import Mapping
from typing import cast
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.armado_columna import (
    EstructuraColumna,
    _config_desde_armado,
    armado_resuelto,
    avisos_colores_sin_uso,
    grafica_de,
    limites_de,
)
from app.columna.motor import generar
from app.main import Settings, build_signature, create_app
from app.operational_store import InMemoryOperationalStore
from app.plan import PlanResolutionError
from app.plan_armado_columna import (
    AVISO_SIN_COLORES,
    PATRON_UN_COLOR,
    PlanArmadoColumnaRequest,
    vista_previa_armado_columna,
)
from tests.guirnalda_datos import arco, material, plan

SECRET = "w" * 32
COLUMNA = "EST_03_COLUMNA"
ARCO = "EST_02_ARCO"
RUTA = "/internal/v1/plan/armado-columna"
SCOPE = "plan.armado_columna"
# Azul y blanco: los dos tonos con los que el motor abre su espiral de referencia.
COLORES = ["#1d4ed8", "#ffffff"]
CONTEXTO = {
    "schema_version": "operational.v1",
    "request_id": "00000000-0000-4000-8000-000000000c00",
    "correlation_id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
    "deadline_at": "2030-01-01T00:00:00Z",
    "deadline_ms": 5000,
    "scopes": [SCOPE],
}


def columna(**extra: object) -> dict[str, object]:
    """Una columna del plan con un solo color (dorado)."""
    return {
        "estructura_id": COLUMNA,
        "nombre": "Columna",
        "tipo": "columna",
        "estructura_oficial": "columna",
        "rol_escena": "acento",
        "ubicacion": "lateral_derecho",
        "medidas": {"alto_m": 2.0},
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": "organica_fina",
        "materiales": [material("dorado", 1.0, principal=True)],
        "porque": "Columna de prueba.",
        **extra,
    }


def _columna_dos_colores(**extra: object) -> dict[str, object]:
    return columna(
        materiales=[material("azul", 0.6, principal=True), material("blanco", 0.4)], **extra
    )


def _operacion(
    armado: Mapping[str, object] | None,
    *,
    estructura_id: str = COLUMNA,
    estructuras: tuple[dict[str, object], ...] | None = None,
    **extra: object,
) -> dict[str, object]:
    piezas = estructuras if estructuras is not None else (_columna_dos_colores(),)
    return {
        "schema_version": "plan-armado-columna.v1",
        "plan": plan(*piezas),
        "estructura_id": estructura_id,
        "armado_columna": None if armado is None else dict(armado),
        "colores": COLORES,
        **extra,
    }


def _peticion(armado: Mapping[str, object] | None, **extra: object) -> PlanArmadoColumnaRequest:
    return PlanArmadoColumnaRequest.model_validate(
        {"context": {**CONTEXTO, "body_sha256": "a" * 64}, **_operacion(armado, **extra)}
    )


def _receta_de(armado: Mapping[str, object] | None = None) -> dict[str, object]:
    """El armado con el que Python resolvió la pieza (la receta, si no se le dio uno)."""
    return cast(dict[str, object], vista_previa_armado_columna(_peticion(armado))["armado"])


# --- La vista previa ---------------------------------------------------------------


def test_sin_armado_devuelve_la_receta_con_el_alto_de_la_pieza() -> None:
    resultado = vista_previa_armado_columna(_peticion(None))

    armado = cast(dict[str, object], resultado["armado"])
    cuerpo = cast(dict[str, object], armado["cuerpo"])
    assert resultado["operation_schema_version"] == "plan-armado-columna-result.v1"
    assert (armado["origen"], armado["modo"], armado["patron"]) == ("sugerido", "altura", "espiral")
    # El alto es el del plan (2 m), no el de la imagen de referencia del motor (1,6 m).
    assert cuerpo["alto_m"] == 2.0
    # Los dos colores de la pieza, en su orden; el remate toma el primero.
    assert armado["materiales"] == [0, 1]
    assert cast(dict[str, object], armado["remate"])["material"] == 0
    assert armado["capas"] == []


def test_la_receta_resuelve_una_columna_con_globos_y_con_svg() -> None:
    resultado = vista_previa_armado_columna(_peticion(None))

    columna_resuelta = cast(dict[str, object], resultado["columna"])
    globos = cast(list[dict[str, object]], columna_resuelta["globos"])
    grafica = cast(dict[str, object], resultado["grafica"])
    assert columna_resuelta["version"] == "armado-columna.v1"
    assert len(globos) > 0, "el motor coloca cada globo de la columna"
    assert all(globo["material"] in (0, 1) for globo in globos)
    # El conteo es el de los globos colocados: nada se cuenta aparte.
    assert sum(
        cast(int, linea["cantidad"])
        for linea in cast(list[dict[str, object]], columna_resuelta["conteo"])
    ) == len(globos)
    assert cast(float, columna_resuelta["alto_total_m"]) > 0
    # El dibujo lo emite el mismo motor: la gráfica no recalcula nada.
    assert grafica["lienzo"] == {"ancho": 600, "alto": 720}
    assert cast(str, grafica["svg"]).startswith("<")
    # Derivado: el SVG sale por esta ruta y nunca dentro de la columna que viaja en el plan resuelto.
    assert "grafica" not in columna_resuelta and "svg" not in columna_resuelta


def test_el_dibujo_usa_los_tonos_de_la_pieza() -> None:
    svg = cast(
        str, cast(dict[str, object], vista_previa_armado_columna(_peticion(None))["grafica"])["svg"]
    )

    # Los dos tonos pedidos pintan los globos (los testigos #000001/#000002 del conteo no aparecen).
    assert "1d4ed8" in svg.lower() and "ffffff" in svg.lower()
    assert "000001" not in svg and "000002" not in svg


def test_devuelve_las_herramientas_del_motor_y_los_rangos_vivos() -> None:
    resultado = vista_previa_armado_columna(_peticion(None))

    opciones = cast(dict[str, object], resultado["opciones"])
    limites = cast(dict[str, object], resultado["limites"])
    patrones = cast(list[dict[str, object]], opciones["patrones"])
    assert len(patrones) == 9, "los nueve patrones de la columna"
    assert {"modos", "remates", "tamanos", "globos_capa", "alto_m", "max_capas"} <= set(opciones)
    # Con este armado puesto: el alto que cabe depende del diámetro y el remate del inflado.
    assert limites["altoMin"] <= 2.0 <= limites["altoMax"]  # type: ignore[operator]
    assert set(limites) == {
        "diametro",
        "altoMin",
        "altoMax",
        "foilMin",
        "foilMax",
        "rematesGlobo",
        "rematesRacimo",
    }
    assert 24 in cast(list[int], limites["rematesGlobo"]), (
        "la receta usa un remate R24: tiene que caber"
    )


def test_un_armado_dado_se_resuelve_tal_cual() -> None:
    receta = _receta_de()
    dado = {**receta, "origen": "decorador", "patron": "apilado", "opciones": {"grosor": 2}}

    resultado = vista_previa_armado_columna(_peticion(dado))

    assert resultado["armado"] == dado, "un borrador vuelve tal como se dio"
    assert len(cast(list[object], cast(dict[str, object], resultado["columna"])["globos"])) > 0


def test_una_pieza_de_un_color_recibe_una_columna_solida() -> None:
    # `columna()` trae un solo material (dorado): la espiral pide dos y la receta baja a sólido.
    resultado = vista_previa_armado_columna(
        _peticion(None, estructuras=(columna(),), colores=["#d4af37"])
    )

    armado = cast(dict[str, object], resultado["armado"])
    assert (armado["patron"], armado["materiales"]) == (PATRON_UN_COLOR, [0])
    assert armado["opciones"] == {}, "el sólido no tiene mandos propios"


def test_sin_los_tonos_resueltos_el_dibujo_lo_avisa() -> None:
    # Un plan nombra el color en palabras («azul»), que sin catálogo no es un tono.
    peticion = PlanArmadoColumnaRequest.model_validate(
        {
            "context": {**CONTEXTO, "body_sha256": "a" * 64},
            "schema_version": "plan-armado-columna.v1",
            "plan": plan(_columna_dos_colores()),
            "estructura_id": COLUMNA,
            "armado_columna": None,
        }
    )

    columna_resuelta = cast(dict[str, object], vista_previa_armado_columna(peticion)["columna"])

    assert AVISO_SIN_COLORES in cast(list[str], columna_resuelta["avisos"])


def test_un_color_de_la_pieza_que_el_armado_no_toma_se_avisa() -> None:
    # Una columna sólida sobre una pieza de dos colores: no se rechaza, se avisa que el blanco no se compraría.
    solida = {**_receta_de(), "patron": "solido", "opciones": {}, "materiales": [0]}
    solida["remate"] = {**cast(dict[str, object], solida["remate"]), "material": 0}

    avisos = cast(
        list[str],
        cast(dict[str, object], vista_previa_armado_columna(_peticion(solida))["columna"])[
            "avisos"
        ],
    )

    assert any("La columna no usa el color Blanco" in aviso for aviso in avisos)
    assert not any("Azul" in aviso and "no usa" in aviso for aviso in avisos)


# --- La puerta: lo que esta entrega añade a ``armado_columna.py`` -------------------


def test_la_grafica_no_mueve_ni_un_globo_respecto_del_conteo() -> None:
    """El dibujo con tonos reales y la colocación con testigos son la misma columna."""
    pieza = EstructuraColumna(es_columna=True, materiales=COLORES)
    armado = _receta_de()

    resuelto = armado_resuelto(pieza, armado)
    grafica = grafica_de(pieza, armado)

    # El documento envuelve exactamente el mismo interior que se le da al editor.
    assert cast(str, grafica["documento"]).startswith('<?xml version="1.0" encoding="UTF-8"?>')
    assert cast(str, grafica["svg"]) in cast(str, grafica["documento"])
    # Y los globos son los mismos con tonos reales que con testigos: el color no mueve nada.
    cuantos = len(cast(list[object], armado["materiales"]))
    reales, _ = _config_desde_armado(armado, COLORES)
    testigos, _ = _config_desde_armado(armado)
    assert cuantos == 2
    colocados = [(g.x, g.y, g.z, g.r, g.capa, g.k) for g in generar(reales).globos]
    assert colocados == [(g.x, g.y, g.z, g.r, g.capa, g.k) for g in generar(testigos).globos]
    assert len(colocados) == len(cast(list[object], resuelto["globos"]))


def test_el_alto_que_pide_el_decorador_se_acota_a_los_limites() -> None:
    pieza = EstructuraColumna(es_columna=True, materiales=COLORES)
    armado = _receta_de()

    limites = cast(dict[str, float], limites_de(armado, pieza))

    assert 0.5 <= limites["altoMin"] < limites["altoMax"] <= 6.0
    assert limites["foilMin"] < limites["foilMax"]
    # Un globo más grande hace más ancha la columna: el alto mínimo sube.
    ancha = {
        **armado,
        "cuerpo": {**cast(dict[str, object], armado["cuerpo"]), "abajo": 24, "arriba": 24},
    }
    assert cast(dict[str, float], limites_de(ancha, pieza))["altoMin"] > limites["altoMin"]


def test_avisos_de_colores_sin_uso() -> None:
    assert avisos_colores_sin_uso(["azul", "blanco"], [0, 1]) == []
    avisos = avisos_colores_sin_uso(["azul", "", "blanco"], [0])
    assert len(avisos) == 2
    assert "sin nombre" in avisos[0] and "Blanco" in avisos[1]
    assert all("Elige un patrón que lo tome o quítalo de la pieza" in aviso for aviso in avisos)


# --- Los rechazos ------------------------------------------------------------------


def test_un_armado_invalido_responde_con_motivo_y_mensaje() -> None:
    # El remate apunta a un color que la pieza no lleva.
    receta = _receta_de()
    malo = {**receta, "remate": {**cast(dict[str, object], receta["remate"]), "material": 7}}

    with pytest.raises(PlanResolutionError) as error:
        vista_previa_armado_columna(_peticion(malo))

    detalles = error.value.details or {}
    assert (error.value.code, error.value.status_code) == ("armado_invalido", 422)
    assert (detalles["estructura_id"], detalles["motivo"]) == (COLUMNA, "material_fuera_de_rango")
    assert "columna no lleva" in str(detalles["mensaje"]), (
        "la frase es la de Python, para el decorador"
    )


def test_una_pieza_que_no_es_una_columna_no_se_arma_asi() -> None:
    with pytest.raises(PlanResolutionError) as error:
        vista_previa_armado_columna(
            _peticion(None, estructura_id=ARCO, estructuras=(arco(), _columna_dos_colores()))
        )

    assert (error.value.details or {})["motivo"] == "no_es_columna"


def test_un_color_que_la_pieza_no_lleva_se_rechaza() -> None:
    fuera = {**_receta_de(), "materiales": [0, 5]}

    with pytest.raises(PlanResolutionError) as error:
        vista_previa_armado_columna(_peticion(fuera))

    assert (error.value.details or {})["motivo"] == "material_fuera_de_rango"


def test_una_estructura_desconocida_responde_404() -> None:
    with pytest.raises(PlanResolutionError) as error:
        vista_previa_armado_columna(_peticion(None, estructura_id="EST_09_OTRA"))

    assert (error.value.code, error.value.status_code) == ("estructura_no_encontrada", 404)


def test_un_plan_que_no_cumple_el_contrato_responde_422() -> None:
    with pytest.raises(PlanResolutionError) as error:
        vista_previa_armado_columna(_peticion(None, plan={"plan_version": "1.0"}))

    assert (error.value.code, error.value.status_code) == ("invalid_plan", 422)


def test_la_forma_del_armado_se_exige_en_la_frontera() -> None:
    with pytest.raises(ValidationError):
        _peticion({"version": "otra"})


def test_un_color_que_no_es_hexadecimal_se_rechaza_en_la_frontera() -> None:
    with pytest.raises(ValidationError):
        _peticion(None, colores=["azul", "#ffffff"])


# --- El endpoint -------------------------------------------------------------------


def _post(
    operation: Mapping[str, object], nonce: str, *, scope: str = SCOPE
) -> tuple[int, dict[str, object]]:
    context = {
        **CONTEXTO,
        "scopes": [scope],
        "body_sha256": hashlib.sha256(
            json.dumps(operation, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest(),
    }
    body = json.dumps(
        {"context": context, **operation}, separators=(",", ":"), ensure_ascii=False
    ).encode()
    timestamp = int(time.time())
    headers = {
        "content-type": "application/json",
        "x-internal-schema-version": "operational.v1",
        "x-internal-timestamp": str(timestamp),
        "x-internal-nonce": nonce,
        "x-internal-scopes": scope,
        "x-internal-signature": build_signature(
            secret=SECRET,
            method="POST",
            path=RUTA,
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
        response = client.post(RUTA, content=body, headers=headers)
    return response.status_code, cast(dict[str, object], response.json())


def test_el_endpoint_devuelve_una_columna_resuelta_con_globos_y_con_svg() -> None:
    status, body = _post(_operacion(None), "00000000-0000-4000-8000-000000000c01")

    assert status == 200
    payload = cast(dict[str, object], body["payload"])
    columna_resuelta = cast(dict[str, object], payload["columna"])
    grafica = cast(dict[str, object], payload["grafica"])
    assert payload["operation_schema_version"] == "plan-armado-columna-result.v1"
    assert len(cast(list[object], columna_resuelta["globos"])) > 0
    assert cast(str, grafica["svg"]).startswith("<")
    assert set(grafica) == {"lienzo", "svg"}, "solo lo que publica VistaColumnaSchema"
    assert cast(dict[str, object], payload["armado"])["origen"] == "sugerido"
    assert "patrones" in cast(dict[str, object], payload["opciones"])
    assert "altoMin" in cast(dict[str, object], payload["limites"])


def test_el_endpoint_responde_422_con_motivo_cuando_el_armado_no_se_sostiene() -> None:
    receta = _receta_de()
    malo = {**receta, "remate": {**cast(dict[str, object], receta["remate"]), "material": 7}}
    status, body = _post(_operacion(malo), "00000000-0000-4000-8000-000000000c02")

    detail = cast(dict[str, object], body["detail"])
    assert (status, detail["code"]) == (422, "armado_invalido")
    assert (detail["estructura_id"], detail["motivo"]) == (COLUMNA, "material_fuera_de_rango")


def test_el_endpoint_exige_su_propio_scope() -> None:
    status, _ = _post(
        _operacion(None), "00000000-0000-4000-8000-000000000c03", scope="plan.armado_arco"
    )

    assert status == 403


# --- El barrido: ningún armado del contrato es un 500 ------------------------------


def test_ningun_armado_dentro_del_contrato_rompe_la_vista_previa() -> None:
    """Un armado que el contrato admite se arma o se rechaza con su frase: nunca un fallo del servidor.

    Es lo que ADR-0035 hizo con el arco (1.200 armados al azar y las esquinas de los rangos). Aquí se sortean
    ejes dentro de lo que el contrato publica —globos por capa, altos, los seis tamaños, los cinco remates, los nueve
    patrones, con inflado y compresión en sus extremos— y cada uno tiene que dar una columna que cumple
    ``plan-resuelto.v1`` o un ``armado_invalido``.
    """
    import random

    from app.armado_columna import PATRON_IDS, TAMANOS_GLOBO, TIPOS_REMATE

    azar = random.Random(20261002)
    receta = _receta_de()
    resueltos = rechazados = 0
    for _ in range(240):
        patron = azar.choice(PATRON_IDS)
        cuerpo = {
            "alto_m": azar.choice([0.5, 1.0, 2.0, 3.5, 6.0, round(azar.uniform(0.5, 6.0), 2)]),
            "globos_capa": azar.randint(3, 6),
            "abajo": azar.choice(TAMANOS_GLOBO),
            "arriba": azar.choice(TAMANOS_GLOBO),
            "escalonado": azar.random() < 0.5,
            "base": azar.random() < 0.5,
        }
        inflado = {
            "inflado": azar.choice([0.8, 1.0, 1.1]),
            "tamano": azar.choice([1.0, 1.14, 1.4]),
            "compresion": azar.choice([0.7, 0.8, 1.0]),
            "variacion_tam": azar.choice([0.0, 0.3]),
            "variacion_tono": azar.choice([0.0, 0.25]),
            "desorden": azar.choice([0.0, 0.4]),
            "semilla": azar.randint(1, 99999),
        }
        remate = {
            "tipo": azar.choice(TIPOS_REMATE),
            "tamano": azar.choice(TAMANOS_GLOBO),
            "cantidad": azar.randint(3, 5),
            "foil_m": azar.choice([0.3, 0.7, 2.5]),
            "material": azar.randint(0, 1),
        }
        armado = {
            **receta,
            "patron": patron,
            "opciones": {},
            "cuerpo": cuerpo,
            "inflado": inflado,
            "remate": remate,
            "materiales": [0, 1, 0][: 3 if patron == "ombre" else 2] if patron != "solido" else [0],
        }
        try:
            columna_resuelta = cast(
                dict[str, object], vista_previa_armado_columna(_peticion(armado))["columna"]
            )
        except PlanResolutionError as error:
            assert (error.code, error.status_code) == ("armado_invalido", 422), armado
            rechazados += 1
            continue
        assert len(cast(list[object], columna_resuelta["globos"])) <= 900
        resueltos += 1
    assert resueltos > 150, (
        "el barrido tiene que arrancar la mayoría de los armados, no rechazarlos todos"
    )
    assert resueltos + rechazados == 240


def test_el_globo_grande_de_arriba_se_quita_y_se_pone() -> None:
    """Quitar el remate (``ninguno``) acorta la columna y no deja globos de remate; ponerlo lo devuelve."""
    receta = _receta_de()
    con_globo = {**receta, "remate": {**cast(dict[str, object], receta["remate"]), "tipo": "globo"}}
    sin_globo = {
        **receta,
        "remate": {**cast(dict[str, object], receta["remate"]), "tipo": "ninguno"},
    }

    puesto = cast(dict[str, object], vista_previa_armado_columna(_peticion(con_globo))["columna"])
    quitado = cast(dict[str, object], vista_previa_armado_columna(_peticion(sin_globo))["columna"])

    assert cast(dict[str, object], puesto["remate"])["globos"], (
        "con globo grande hay globos de remate"
    )
    assert cast(dict[str, object], quitado["remate"]) == {"descripcion": "Sin remate", "globos": []}
    assert quitado["remate_alto_m"] == 0 and cast(float, puesto["remate_alto_m"]) > 0
    assert cast(float, quitado["alto_total_m"]) < cast(float, puesto["alto_total_m"]), (
        "sin el globo, la columna es más baja"
    )
    # El cuerpo no cambia por quitarle el remate: mismos globos de cuerpo, mismas capas.
    assert quitado["globos"] == puesto["globos"] and quitado["capas"] == puesto["capas"]
