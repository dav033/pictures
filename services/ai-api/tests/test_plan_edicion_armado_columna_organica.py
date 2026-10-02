"""La edición ``armado_columna_organica`` del plan (ADR-0035, paso 3).

Guardar la columna orgánica que el decorador armó con la vista previa en vivo es escribir su
``armado_columna_organica`` en la pieza, por la misma puerta que ya usan el arco, la columna clásica y la guirnalda
(``POST /internal/v1/plan/edit``). Es el gemelo de ``test_plan_edicion_armado_columna.py``: fija o quita el armado, lo
comprueba contra la pieza sin catálogo con la puerta del motor (``armado_columna_organica.validar``, la misma de la
vista previa) y rechaza con ``armado_invalido`` y la frase del motor lo que no se sostiene. Lo que el motor corrige
(el grosor que cabe en el alto, el globo de la punta que guarda proporción) no se rechaza: va en los avisos.

También prueba lo que el plan hace con la pieza armada: cuenta con el motor (ADR-0034), publica
``armados_columna_organica`` fuera del snapshot y deja que el armado clásico, si lo trae, mande.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import time
from collections.abc import Mapping
from typing import Any, cast
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from pydantic import TypeAdapter, ValidationError

from app.armado_columna_organica import EstructuraColumnaOrganica, armado_resuelto
from app.main import Settings, build_signature, create_app
from app.operational_store import InMemoryOperationalStore
from app.plan import MERMA, PlanResolutionError
from app.plan_edicion import Edicion, LineaBase, LineasBaseEstructura, PlanEditado, editar_plan
from tests.guirnalda_datos import arco, guirnalda, lineas, material, plan, resolver
from tests.test_armado_columna_organica import armado as armado_base

SECRET = "e" * 32
COLUMNA = "EST_03_COLUMNA"
ARCO = "EST_02_ARCO"
RUTA = "/internal/v1/plan/edit"
SCOPE = "plan.edit"
_EDICION = TypeAdapter(Edicion)

#: Una columna orgánica de dos colores, como la que arma el editor, con el globo grande de arriba en el segundo.
ARMADO: dict[str, Any] = armado_base(origen="decorador")


def columna(**extra: object) -> dict[str, object]:
    """Una columna del plan con un solo color (dorado)."""
    return {
        "estructura_id": COLUMNA,
        "nombre": "Columna",
        "tipo": "columna",
        "estructura_oficial": "columna_asimetrica",
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


def _columna_con_catalogo(**extra: object) -> dict[str, object]:
    """Una columna dorada y blanca, los colores que el catálogo de prueba sí vende (R5 a R24)."""
    return columna(
        materiales=[material("dorado", 0.5, principal=True), material("blanco", 0.5)], **extra
    )


def _plan() -> dict[str, object]:
    return plan(_columna_dos_colores(), guirnalda())


def _edicion(armado: Mapping[str, object] | None, estructura_id: str = COLUMNA) -> Edicion:
    return _EDICION.validate_python(
        {
            "accion": "armado_columna_organica",
            "estructura_id": estructura_id,
            "armado_columna_organica": armado,
        }
    )


def _pieza(plan_: Mapping[str, object], estructura_id: str) -> dict[str, Any]:
    return next(
        cast(dict[str, Any], item)
        for item in cast(list[dict[str, Any]], plan_["estructuras"])
        if item["estructura_id"] == estructura_id
    )


# --- Fijar y quitar -----------------------------------------------------------------------


def test_fijar_un_armado_lo_escribe_en_la_pieza_y_no_toca_las_demas() -> None:
    base = _plan()
    otra = copy.deepcopy(
        [
            e
            for e in cast(list[dict[str, Any]], base["estructuras"])
            if e["estructura_id"] != COLUMNA
        ]
    )

    editado = editar_plan(base, _edicion(ARMADO)).plan

    assert _pieza(editado, COLUMNA)["armado_columna_organica"] == ARMADO
    assert [
        e
        for e in cast(list[dict[str, Any]], editado["estructuras"])
        if e["estructura_id"] != COLUMNA
    ] == otra


def test_quitar_el_armado_devuelve_la_pieza_al_camino_de_siempre() -> None:
    con = editar_plan(_plan(), _edicion(ARMADO)).plan

    sin = editar_plan(con, _edicion(None)).plan

    assert "armado_columna_organica" not in _pieza(sin, COLUMNA)


def test_un_armado_editado_otra_vez_se_reemplaza() -> None:
    con = editar_plan(_plan(), _edicion(ARMADO)).plan
    otro = {**ARMADO, "volumen": {**ARMADO["volumen"], "relleno": 0.9}}

    editado = editar_plan(con, _edicion(otro)).plan

    assert _pieza(editado, COLUMNA)["armado_columna_organica"] == otro


def test_un_armado_en_una_pieza_que_no_es_columna_se_rechaza_con_la_frase_del_motor() -> None:
    with pytest.raises(PlanResolutionError) as caso:
        editar_plan(plan(_columna_dos_colores(), arco()), _edicion(ARMADO, ARCO))

    assert (caso.value.code, caso.value.status_code) == ("armado_invalido", 422)
    assert cast(Mapping[str, str], caso.value.details)["motivo"] == "no_es_columna"


def test_un_color_que_la_pieza_no_lleva_se_rechaza() -> None:
    malo = {**ARMADO, "corona": {**ARMADO["corona"], "material": 5}}

    with pytest.raises(PlanResolutionError) as caso:
        editar_plan(_plan(), _edicion(malo))

    assert cast(Mapping[str, str], caso.value.details)["motivo"] == "material_fuera_de_rango"


def test_lo_que_el_motor_corrige_no_se_rechaza() -> None:
    # Un globo R5 sobre una punta gruesa no guarda proporción: el motor lo cambia, y eso se cuenta al resolver.
    grueso = {
        **ARMADO,
        "volumen": {**ARMADO["volumen"], "grosorCimaM": 0.85},
        "corona": {"activa": True, "tamano": 5, "material": 1},
    }

    editado = editar_plan(_plan(), _edicion(grueso)).plan

    assert _pieza(editado, COLUMNA)["armado_columna_organica"] == grueso


@pytest.mark.parametrize(
    "armado",
    [
        {**ARMADO, "version": "armado-columna.v1"},
        {**ARMADO, "forma": {**ARMADO["forma"], "altoM": 99}},
        {key: value for key, value in ARMADO.items() if key != "corona"},
        {**ARMADO, "extra": 1},
    ],
)
def test_la_forma_del_armado_se_exige_en_la_frontera(armado: Mapping[str, object]) -> None:
    with pytest.raises(ValidationError):
        _edicion(armado)


def test_la_accion_lleva_su_estructura_y_su_armado() -> None:
    with pytest.raises(ValidationError):
        _EDICION.validate_python({"accion": "armado_columna_organica", "estructura_id": COLUMNA})


def test_una_estructura_que_no_existe_es_404() -> None:
    with pytest.raises(PlanResolutionError) as caso:
        editar_plan(_plan(), _edicion(ARMADO, "EST_09_OTRA"))
    assert (caso.value.code, caso.value.status_code) == ("estructura_no_encontrada", 404)


# --- Colores que cambian bajo el armado -------------------------------------------------------------------


def _linea(color: str) -> LineasBaseEstructura:
    return LineasBaseEstructura(
        estructura_id=COLUMNA,
        lineas=[LineaBase(product_id=f"prod-{color}", variant_id=f"var-{color}-12", color=color)],
    )


def _quitar(plan_: Mapping[str, object], color: str) -> PlanEditado:
    edicion = _EDICION.validate_python(
        {"accion": "quitar", "estructura_id": COLUMNA, "objetivo_variant_id": f"var-{color}-12"}
    )
    return editar_plan(plan_, edicion, [_linea(color)])


def _material(color: str, parte: float) -> dict[str, object]:
    return {**material(color, parte), "variant_id": f"var-{color}-12"}


def _plan_tres() -> dict[str, object]:
    pieza = columna(
        materiales=[_material("azul", 0.4), _material("blanco", 0.35), _material("dorado", 0.25)]
    )
    return plan(pieza, guirnalda())


def _con_paleta(materiales_de_paleta: list[int], material_corona: int) -> dict[str, Any]:
    return {
        **ARMADO,
        "colores": {
            **ARMADO["colores"],
            "paleta": [
                {"material": indice, "peso": 40, "acabado": "mate", "rol": "normal"}
                for indice in materiales_de_paleta
            ],
        },
        "corona": {**ARMADO["corona"], "material": material_corona},
    }


def test_quitar_un_color_corre_los_indices_de_la_paleta_y_del_globo_de_arriba_y_lo_avisa() -> None:
    # La paleta usa azul (0) y dorado (2), con el globo de arriba dorado. Quitar el blanco (1) deja al dorado en el 1.
    con = editar_plan(_plan_tres(), _edicion(_con_paleta([0, 2], 2))).plan

    resultado = _quitar(con, "blanco")

    armado = _pieza(resultado.plan, COLUMNA)["armado_columna_organica"]
    assert [color["material"] for color in armado["colores"]["paleta"]] == [0, 1]
    assert armado["corona"]["material"] == 1
    assert armado["origen"] == "decorador"
    assert any("Quitaste un color" in aviso for aviso in resultado.avisos), resultado.avisos


def test_quitar_el_color_del_globo_de_arriba_nunca_deja_un_indice_inexistente() -> None:
    con = editar_plan(_plan_tres(), _edicion(_con_paleta([0, 1], 2))).plan

    resultado = _quitar(con, "dorado")

    armado = _pieza(resultado.plan, COLUMNA)["armado_columna_organica"]
    assert armado["corona"]["material"] == 0, "pasa al primer color de la pieza"
    assert [color["material"] for color in armado["colores"]["paleta"]] == [0, 1]


def test_quitar_un_color_que_el_armado_no_usa_y_viene_despues_no_mueve_nada() -> None:
    con = editar_plan(_plan_tres(), _edicion(_con_paleta([0, 1], 1))).plan

    resultado = _quitar(con, "dorado")

    assert (
        _pieza(resultado.plan, COLUMNA)["armado_columna_organica"]
        == _pieza(con, COLUMNA)["armado_columna_organica"]
    )
    assert not resultado.avisos


def test_quitar_el_unico_color_de_la_paleta_la_deja_con_el_primero_de_la_pieza() -> None:
    con = editar_plan(_plan_tres(), _edicion(_con_paleta([1], 1))).plan

    resultado = _quitar(con, "blanco")

    armado = _pieza(resultado.plan, COLUMNA)["armado_columna_organica"]
    assert [color["material"] for color in armado["colores"]["paleta"]] == [0]
    assert any("Quitaste el color que usaba la columna" in aviso for aviso in resultado.avisos), (
        resultado.avisos
    )


def test_agregar_un_color_conserva_el_armado_y_avisa_que_la_columna_no_lo_usa() -> None:
    editado = editar_plan(_plan(), _edicion(ARMADO)).plan
    agregar = _EDICION.validate_python(
        {
            "accion": "agregar",
            "estructura_id": COLUMNA,
            "variante": {"product_id": "prod-dorado", "variant_id": "var-dorado-12"},
        }
    )

    resultado = editar_plan(editado, agregar, [], ["dorado"])

    assert _pieza(resultado.plan, COLUMNA)["armado_columna_organica"] == ARMADO
    assert any("no lo usa" in aviso for aviso in resultado.avisos)


# --- El armado manda en la pieza: medidas, compra, colores sin uso, cobertura -----------------------------


def _resolver(plan_: Mapping[str, object]) -> dict[str, Any]:
    return cast(dict[str, Any], asyncio.run(resolver(plan_)))


def _grande() -> dict[str, Any]:
    return {**ARMADO, "forma": {**ARMADO["forma"], "altoM": 3.4}}


def test_guardar_un_armado_pone_las_medidas_de_la_pieza_con_las_del_motor() -> None:
    base = plan(_columna_con_catalogo())
    assert _pieza(base, COLUMNA)["medidas"]["alto_m"] == 2.0

    editado = editar_plan(base, _edicion(_grande())).plan

    motor = armado_resuelto(
        EstructuraColumnaOrganica(True, ["#000001", "#000002"]), _grande(), MERMA
    )
    assert _pieza(editado, COLUMNA)["medidas"]["alto_m"] == round(motor["alto_m"], 2)
    assert _pieza(editado, COLUMNA)["medidas"]["alto_m"] != 2.0, "ya no es el de antes"


def test_el_plan_editado_se_resuelve_con_el_conteo_y_la_compra_del_motor() -> None:
    base = plan(_columna_con_catalogo())
    antes = _resolver(base)

    editado = editar_plan(base, _edicion(_grande())).plan
    despues = _resolver(editado)

    assert despues["plan_hash"] != antes["plan_hash"], "es otra decoración: cambia la firma"
    resuelta = despues["armados_columna_organica"][0]
    conteo = sum(linea["cantidad"] for linea in resuelta["conteo"])
    assert despues["estructuras"][0]["total_unidades"] == conteo, (
        "cuenta el motor, no la estimación"
    )
    assert "armados_columna" not in despues, "no es la columna clásica"
    assert "grafica" not in resuelta and "svg" not in resuelta, (
        "el dibujo no viaja en el plan resuelto"
    )
    # El plan compra lo que la hoja de armado dice: la compra del motor con el margen del plan, por material.
    motor = armado_resuelto(
        EstructuraColumnaOrganica(True, ["#000001", "#000002"]), _grande(), MERMA
    )
    assert resuelta["total_comprar"] == motor["total_comprar"]


def test_la_pieza_sin_armado_sigue_como_siempre_y_no_publica_nada_de_columna_organica() -> None:
    despues = _resolver(plan(_columna_con_catalogo()))

    assert "armados_columna_organica" not in despues


def test_con_los_dos_armados_manda_el_clasico() -> None:
    clasico: dict[str, Any] = {
        "version": "armado-columna.v1",
        "origen": "decorador",
        "modo": "altura",
        "patron": "solido",
        "opciones": {},
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
        "remate": {"tipo": "globo", "tamano": 24, "cantidad": 5, "foil_m": 0.7, "material": 0},
        "capas": [],
        "materiales": [0],
    }
    pieza = _columna_con_catalogo(armado_columna=clasico, armado_columna_organica=ARMADO)

    despues = _resolver(plan(pieza))

    assert len(despues["armados_columna"]) == 1
    assert "armados_columna_organica" not in despues


def test_un_color_de_la_pieza_que_el_armado_no_toma_se_avisa_antes_de_comprar_sin_el() -> None:
    uno = _con_paleta([0], 0)

    resultado = editar_plan(plan(_columna_con_catalogo()), _edicion(uno))

    assert any("no usa el color Blanco" in aviso for aviso in resultado.avisos), resultado.avisos
    assert any("no se comprarán" in aviso for aviso in resultado.avisos)
    comprado = {linea["color"] for linea in lineas(_resolver(resultado.plan))}
    assert comprado == {"dorado"}, (
        "el blanco sigue en el plan y la compra no lo lleva: por eso se avisa"
    )
    # Un armado que usa los dos colores (la paleta y el globo de arriba) no avisa de nada.
    assert not editar_plan(plan(_columna_con_catalogo()), _edicion(ARMADO)).avisos


def test_un_tamano_de_globo_que_el_catalogo_no_vende_deja_la_pieza_sin_cobertura() -> None:
    gigantes = {
        **ARMADO,
        "tamanos": {**ARMADO["tamanos"], "mezcla": {"36": 10}},
        "corona": {**ARMADO["corona"], "activa": False},
    }
    editado = editar_plan(plan(_columna_con_catalogo()), _edicion(gigantes)).plan

    resuelto = _resolver(editado)

    # R36 no está en el catálogo de prueba: la resolución lo dice en `sin_cobertura` y la ruta de Next lo rechaza
    # antes de firmar (`aplicar-edicion.ts`), en vez de firmar una propuesta a la que le faltan globos.
    assert resuelto["sin_cobertura"], "sin cobertura de catálogo"


def test_con_armado_de_columna_organica_el_reparto_y_la_mezcla_no_se_editan() -> None:
    con_armado = editar_plan(plan(_columna_con_catalogo()), _edicion(ARMADO)).plan
    reparto = _EDICION.validate_python(
        {"accion": "repartir", "estructura_id": COLUMNA, "participaciones": [0.7, 0.3]}
    )
    mezcla = _EDICION.validate_python(
        {"accion": "mezcla", "estructura_id": COLUMNA, "mezcla": "clasica"}
    )

    for edicion in (reparto, mezcla):
        with pytest.raises(PlanResolutionError) as caso:
            editar_plan(con_armado, edicion)
        assert (caso.value.code, caso.value.status_code) == ("armado_columna_organica_activo", 409)
    # Sin armado, como siempre.
    assert editar_plan(plan(_columna_con_catalogo()), mezcla).plan


def test_editar_una_columna_no_toca_a_otra_columna_del_mismo_plan() -> None:
    otra = "EST_05_OTRA_COLUMNA"
    dos = plan(_columna_con_catalogo(), _columna_con_catalogo(estructura_id=otra))
    antes = copy.deepcopy(_pieza(dos, otra))

    editado = editar_plan(dos, _edicion(_grande())).plan

    assert _pieza(editado, otra) == antes, "la edición de una no llega a la otra"
    assert "armado_columna_organica" in _pieza(editado, COLUMNA)


# --- Frontera HTTP ------------------------------------------------------------------------


def _post(operation: Mapping[str, object], nonce: str) -> tuple[int, dict[str, object]]:
    context = {
        "schema_version": "operational.v1",
        "request_id": "00000000-0000-4000-8000-000000000e35",
        "correlation_id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
        "deadline_at": "2030-01-01T00:00:00Z",
        "deadline_ms": 5000,
        "body_sha256": hashlib.sha256(
            json.dumps(operation, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest(),
        "scopes": [SCOPE],
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
        "x-internal-scopes": SCOPE,
        "x-internal-signature": build_signature(
            secret=SECRET,
            method="POST",
            path=RUTA,
            timestamp=timestamp,
            nonce=UUID(nonce),
            scopes=[SCOPE],
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


def _operacion(
    armado: Mapping[str, object] | None, estructura_id: str = COLUMNA
) -> dict[str, object]:
    return {
        "schema_version": "plan-edit.v1",
        "plan": _plan(),
        "lineas_base": [],
        "edicion": {
            "accion": "armado_columna_organica",
            "estructura_id": estructura_id,
            "armado_columna_organica": armado,
        },
        "colores_variante": [],
        "completar_patrones": False,
    }


def test_el_endpoint_guarda_el_armado_en_el_plan() -> None:
    status, body = _post(_operacion(ARMADO), "00000000-0000-4000-8000-000000000e35")

    assert status == 200
    payload = cast(dict[str, Any], body["payload"])
    assert payload["operation_schema_version"] == "plan-edit-result.v1"
    assert _pieza(payload["plan"], COLUMNA)["armado_columna_organica"] == ARMADO


def test_el_endpoint_responde_422_con_motivo_y_mensaje_cuando_el_armado_no_se_sostiene() -> None:
    malo = {**ARMADO, "corona": {**ARMADO["corona"], "material": 5}}
    status, body = _post(_operacion(malo), "00000000-0000-4000-8000-000000000e36")

    assert status == 422
    detail = cast(dict[str, object], body["detail"])
    assert detail["code"] == "armado_invalido"
    assert (detail["estructura_id"], detail["motivo"]) == (COLUMNA, "material_fuera_de_rango")
    assert detail["mensaje"]
