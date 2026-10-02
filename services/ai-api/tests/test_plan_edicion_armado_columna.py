"""La edición ``armado_columna`` del plan (ADR-0035, paso 3).

Guardar la columna que el decorador armó con la vista previa en vivo es escribir su ``armado_columna`` en la
pieza, por la misma puerta que ya usan el patrón, el bouquet, la guirnalda y el arco (``POST
/internal/v1/plan/edit``). Es el gemelo de ``test_plan_edicion_armado_arco.py``: fija o quita el armado, lo
comprueba contra la pieza sin catálogo con la puerta del motor (``armado_columna.validar``, la misma de la vista
previa) y rechaza con ``armado_invalido`` y la frase del motor lo que no se sostiene. Lo que el motor corrige (el
alto que cabe con el diámetro, el remate que guarda proporción) no se rechaza: va en los avisos de la vista previa
y lo cuenta la resolución.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import time
from collections.abc import Mapping
from typing import cast
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from pydantic import TypeAdapter, ValidationError

from app.armado_columna import EstructuraColumna, armado_resuelto
from app.main import Settings, build_signature, create_app
from app.operational_store import InMemoryOperationalStore
from app.plan import PlanResolutionError
from app.plan_edicion import Edicion, LineaBase, LineasBaseEstructura, PlanEditado, editar_plan
from tests.guirnalda_datos import arco, guirnalda, lineas, material, plan, resolver

SECRET = "c" * 32
COLUMNA = "EST_03_COLUMNA"
ARCO = "EST_02_ARCO"
RUTA = "/internal/v1/plan/edit"
SCOPE = "plan.edit"
_EDICION = TypeAdapter(Edicion)

#: Una columna de dos colores, como la que arma el editor: espiral con globos R12 y remate de globo R24.
ARMADO: dict[str, object] = {
    "version": "armado-columna.v1",
    "origen": "decorador",
    "modo": "altura",
    "patron": "espiral",
    "opciones": {"vueltas": 2, "inclinacion": 1},
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
    "remate": {"tipo": "globo", "tamano": 24, "cantidad": 5, "foil_m": 0.7, "material": 1},
    "capas": [],
    "materiales": [0, 1],
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


def _plan() -> dict[str, object]:
    return plan(_columna_dos_colores(), guirnalda())


def _edicion(armado: Mapping[str, object] | None, estructura_id: str = COLUMNA) -> Edicion:
    return _EDICION.validate_python(
        {"accion": "armado_columna", "estructura_id": estructura_id, "armado_columna": armado}
    )


def _pieza(plan_: Mapping[str, object], estructura_id: str) -> dict[str, object]:
    return next(
        cast(dict[str, object], item)
        for item in cast(list[dict[str, object]], plan_["estructuras"])
        if item["estructura_id"] == estructura_id
    )


def test_fijar_un_armado_lo_escribe_en_la_pieza_y_no_toca_las_demas() -> None:
    base = _plan()
    antes = copy.deepcopy(base)

    editado = editar_plan(base, _edicion(ARMADO))

    assert _pieza(editado.plan, COLUMNA)["armado_columna"] == ARMADO, (
        "el armado se escribe tal como llegó"
    )
    assert editado.avisos == ()
    assert _pieza(editado.plan, "EST_01_GUIRNALDA") == _pieza(antes, "EST_01_GUIRNALDA")
    assert base == antes, "la edición no muta el plan recibido"


def test_quitar_el_armado_devuelve_la_pieza_al_camino_de_siempre() -> None:
    con_armado = editar_plan(_plan(), _edicion(ARMADO)).plan

    sin_armado = editar_plan(con_armado, _edicion(None)).plan

    assert "armado_columna" not in _pieza(sin_armado, COLUMNA)
    # Quitar el de una pieza que no lo tiene no cambia nada.
    assert editar_plan(sin_armado, _edicion(None)).plan == sin_armado


def test_un_armado_editado_otra_vez_se_reemplaza() -> None:
    primero = editar_plan(_plan(), _edicion(ARMADO)).plan
    otro = {**ARMADO, "patron": "apilado", "opciones": {"grosor": 2}}

    segundo = editar_plan(primero, _edicion(otro)).plan

    assert _pieza(segundo, COLUMNA)["armado_columna"] == otro


def _motivo(armado: Mapping[str, object], estructura_id: str = COLUMNA) -> tuple[str, str]:
    with pytest.raises(PlanResolutionError) as caso:
        editar_plan(_plan(), _edicion(armado, estructura_id))
    assert (caso.value.code, caso.value.status_code) == ("armado_invalido", 422)
    detalles = cast(Mapping[str, str], caso.value.details)
    assert detalles["estructura_id"] == estructura_id
    return detalles["motivo"], detalles["mensaje"]


def test_un_armado_en_una_pieza_que_no_es_columna_se_rechaza_con_la_frase_del_motor() -> None:
    motivo, mensaje = _motivo(ARMADO, "EST_01_GUIRNALDA")

    assert motivo == "no_es_columna"
    assert "columna" in mensaje.lower()


def test_un_color_que_la_pieza_no_lleva_se_rechaza() -> None:
    motivo, _ = _motivo({**ARMADO, "materiales": [0, 5]})
    assert motivo == "material_fuera_de_rango"
    # El remate también nombra un color de la pieza.
    remate = {**cast(dict[str, object], ARMADO["remate"]), "material": 7}
    assert _motivo({**ARMADO, "remate": remate})[0] == "material_fuera_de_rango"


def test_lo_que_el_motor_corrige_no_se_rechaza() -> None:
    # Una columna de 6 m con globos R36 no cabe como se pidió: el motor la ajusta y lo dice, no la rechaza.
    pedido = {
        **ARMADO,
        "cuerpo": {
            **cast(dict[str, object], ARMADO["cuerpo"]),
            "alto_m": 6,
            "abajo": 36,
            "arriba": 36,
        },
    }

    editado = editar_plan(_plan(), _edicion(pedido)).plan

    assert _pieza(editado, COLUMNA)["armado_columna"] == pedido, (
        "se guarda lo que pidió el decorador"
    )


@pytest.mark.parametrize(
    "armado",
    [
        {"version": "otra"},
        {**ARMADO, "modo": "diagonal"},
        {**ARMADO, "patron": "inventado"},
        {**ARMADO, "materiales": []},
        {**ARMADO, "inflado": {**cast(dict[str, object], ARMADO["inflado"]), "inflado": 5}},
    ],
)
def test_la_forma_del_armado_se_exige_en_la_frontera(armado: Mapping[str, object]) -> None:
    with pytest.raises(ValidationError):
        _edicion(armado)


def test_la_accion_lleva_su_estructura_y_su_armado() -> None:
    with pytest.raises(ValidationError):
        _EDICION.validate_python({"accion": "armado_columna", "estructura_id": COLUMNA})
    with pytest.raises(ValidationError):
        _EDICION.validate_python({"accion": "armado_columna", "armado_columna": None})


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
    piezas = columna(
        materiales=[_material("azul", 0.4), _material("blanco", 0.35), _material("dorado", 0.25)]
    )
    return plan(piezas, guirnalda())


def _con_remate(armado: Mapping[str, object], material_remate: int) -> dict[str, object]:
    remate = {**cast(dict[str, object], armado["remate"]), "material": material_remate}
    return {**armado, "remate": remate}


def test_quitar_un_color_corre_los_indices_del_armado_y_del_remate_y_lo_avisa() -> None:
    # La columna usa azul (0) y dorado (2), con el remate dorado. Quitar el blanco (1) deja al dorado en el 1.
    armado = _con_remate({**ARMADO, "materiales": [0, 2]}, 2)
    editado = editar_plan(_plan_tres(), _edicion(armado)).plan

    resultado = _quitar(editado, "blanco")

    nuevo = cast(dict[str, object], _pieza(resultado.plan, COLUMNA)["armado_columna"])
    assert nuevo["materiales"] == [0, 1], "el dorado ahora es el índice 1"
    assert cast(dict[str, object], nuevo["remate"])["material"] == 1, (
        "el remate sigue siendo dorado"
    )
    assert nuevo["patron"] == ARMADO["patron"], "sigue siendo el mismo patrón: todavía se sostiene"
    assert any(
        "color" in aviso.lower() and "columna" in aviso.lower() for aviso in resultado.avisos
    )


def test_quitar_el_color_del_remate_nunca_deja_un_indice_inexistente() -> None:
    armado = _con_remate({**ARMADO, "materiales": [0, 2]}, 1)
    # Aquí el remate es del blanco (1), que no usa el patrón: al quitarlo toma el primer color que queda.
    editado = editar_plan(_plan_tres(), _edicion(armado)).plan

    resultado = _quitar(editado, "blanco")

    pieza = _pieza(resultado.plan, COLUMNA)
    nuevo = cast(dict[str, object], pieza["armado_columna"])
    cuantos = len(cast(list[object], pieza["materiales"]))
    assert all(0 <= i < cuantos for i in cast(list[int], nuevo["materiales"]))
    assert 0 <= cast(int, cast(dict[str, object], nuevo["remate"])["material"]) < cuantos


def test_quitar_un_color_que_el_armado_no_usa_y_viene_despues_no_mueve_nada() -> None:
    armado = _con_remate({**ARMADO, "materiales": [0, 1]}, 0)
    editado = editar_plan(_plan_tres(), _edicion(armado)).plan

    resultado = _quitar(editado, "dorado")

    assert _pieza(resultado.plan, COLUMNA)["armado_columna"] == armado
    assert not any("columna" in aviso.lower() for aviso in resultado.avisos)


def test_si_el_patron_ya_no_cabe_con_los_colores_que_quedan_baja_a_solido_y_lo_dice() -> None:
    dos = plan(columna(materiales=[_material("azul", 0.6), _material("blanco", 0.4)]), guirnalda())
    editado = editar_plan(dos, _edicion(ARMADO)).plan

    resultado = _quitar(editado, "blanco")

    nuevo = cast(dict[str, object], _pieza(resultado.plan, COLUMNA)["armado_columna"])
    assert (nuevo["patron"], nuevo["materiales"]) == ("solido", [0])
    assert nuevo["modo"] == "altura" and nuevo["capas"] == []
    assert cast(dict[str, object], nuevo["remate"])["material"] == 0
    assert any("sólida" in aviso for aviso in resultado.avisos), (
        "se dice que el patrón cambió y por qué"
    )


def test_una_columna_por_capas_que_pierde_un_color_vuelve_a_un_patron() -> None:
    # Cada capa nombra tres posiciones de `materiales`; al quitar un color una capa se queda con dos.
    capas = [
        {"tamano": 12, "materiales": [0, 1, 2, 0]},
        {"tamano": 12, "materiales": [1, 2, 0, 1]},
    ]
    por_capas = {**ARMADO, "modo": "capas", "capas": capas, "materiales": [0, 1, 2]}
    por_capas = _con_remate(por_capas, 0)
    editado = editar_plan(_plan_tres(), _edicion(por_capas)).plan

    # Quitar el blanco (1) deja las capas con los colores de las posiciones 0 y 2 (azul y dorado).
    resultado = _quitar(editado, "blanco")

    nuevo = cast(dict[str, object], _pieza(resultado.plan, COLUMNA)["armado_columna"])
    pieza = _pieza(resultado.plan, COLUMNA)
    cuantos = len(cast(list[object], pieza["materiales"]))
    # Nunca queda una capa que apunte a un color que no existe, ni una columna que el motor rechazaría.
    assert all(0 <= i < cuantos for i in cast(list[int], nuevo["materiales"]))
    armado_resuelto(EstructuraColumna(es_columna=True, materiales=["#000001"] * cuantos), nuevo)


def test_agregar_un_color_conserva_el_armado_y_avisa_que_la_columna_no_lo_usa() -> None:
    editado = editar_plan(plan(_columna_dos_colores(), guirnalda()), _edicion(ARMADO)).plan
    agregar = _EDICION.validate_python(
        {
            "accion": "agregar",
            "estructura_id": COLUMNA,
            "variante": {"product_id": "prod-dorado", "variant_id": "var-dorado-12"},
        }
    )

    resultado = editar_plan(editado, agregar, [], ["dorado"])

    assert _pieza(resultado.plan, COLUMNA)["armado_columna"] == ARMADO
    assert any("no lo usa" in aviso for aviso in resultado.avisos)


# --- El armado manda en la pieza: medidas, compra, colores sin uso, cobertura -----------------------------


def _columna_con_catalogo(**extra: object) -> dict[str, object]:
    """Una columna dorada y blanca, los colores que el catálogo de prueba sí vende (R5 a R24)."""
    return columna(
        materiales=[material("dorado", 0.5, principal=True), material("blanco", 0.5)], **extra
    )


def _grande(abajo: int = 12, arriba: int = 12) -> dict[str, object]:
    return {
        **ARMADO,
        "cuerpo": {
            **cast(dict[str, object], ARMADO["cuerpo"]),
            "alto_m": 3.2,
            "abajo": abajo,
            "arriba": arriba,
        },
    }


def _resolver(plan_: Mapping[str, object]) -> dict[str, object]:
    return asyncio.run(resolver(plan_))


def test_guardar_un_armado_pone_las_medidas_de_la_pieza_con_las_del_motor() -> None:
    # El plan declaraba 2 m; el decorador armó una columna de 3,2 m.
    base = plan(_columna_con_catalogo())
    assert cast(dict[str, object], _pieza(base, COLUMNA)["medidas"])["alto_m"] == 2.0

    editado = editar_plan(base, _edicion(_grande())).plan

    medidas = cast(dict[str, float], _pieza(editado, COLUMNA)["medidas"])
    # Lo que mide la columna lo dice el motor (con base y remate, el alto total no es el del cuerpo).
    motor = armado_resuelto(
        EstructuraColumna(es_columna=True, materiales=["#000001", "#000002"]), _grande()
    )
    assert (medidas["alto_m"], medidas["ancho_m"]) == (
        round(cast(float, motor["alto_total_m"]), 2),
        round(cast(float, motor["diametro_m"]), 2),
    )
    assert medidas["alto_m"] != 2.0, "ya no es el de antes"


def test_el_plan_editado_se_resuelve_con_el_conteo_las_medidas_y_el_hash_del_armado() -> None:
    base = plan(_columna_con_catalogo())
    antes = _resolver(base)

    editado = editar_plan(base, _edicion(_grande())).plan
    despues = _resolver(editado)

    assert despues["plan_hash"] != antes["plan_hash"], "es otra decoración: cambia la firma"
    resuelta = cast(list[dict[str, object]], despues["armados_columna"])[0]
    conteo = sum(
        cast(int, linea["cantidad"]) for linea in cast(list[dict[str, object]], resuelta["conteo"])
    )
    estructura = cast(list[dict[str, object]], despues["estructuras"])[0]
    # La cuenta es la del motor, no la estimación de antes, y las medidas del plan son las de la columna armada.
    assert estructura["total_unidades"] == conteo
    declaradas = cast(
        dict[str, float], _pieza(cast(dict[str, object], despues["plan"]), COLUMNA)["medidas"]
    )
    assert declaradas["alto_m"] == round(cast(float, resuelta["alto_total_m"]), 2)


def test_un_color_de_la_pieza_que_el_armado_no_toma_se_avisa_antes_de_comprar_sin_el() -> None:
    solido = _con_remate({**ARMADO, "patron": "solido", "opciones": {}, "materiales": [0]}, 0)

    resultado = editar_plan(plan(_columna_con_catalogo()), _edicion(solido))

    assert any("no usa el color Blanco" in aviso for aviso in resultado.avisos), resultado.avisos
    assert any("no se comprarán" in aviso for aviso in resultado.avisos)
    # Es lo que pasaba sin decirlo: el plan sigue con el blanco y la compra no lo lleva.
    comprado = {linea["color"] for linea in lineas(_resolver(resultado.plan))}
    assert comprado == {"dorado"}
    # Un armado que usa los dos colores (el cuerpo y el remate) no avisa de nada.
    assert not editar_plan(plan(_columna_con_catalogo()), _edicion(ARMADO)).avisos


def test_un_tamano_de_globo_que_el_catalogo_no_vende_deja_la_pieza_sin_cobertura() -> None:
    editado = editar_plan(
        plan(_columna_con_catalogo()), _edicion(_grande(abajo=36, arriba=36))
    ).plan

    resuelto = _resolver(editado)

    # R36 no está en el catálogo de prueba: la resolución lo dice en `sin_cobertura` y la ruta de Next lo rechaza
    # antes de firmar (`aplicar-edicion.ts`), en vez de firmar una propuesta a la que le faltan globos.
    assert resuelto["sin_cobertura"], "sin cobertura de catálogo"


def test_con_armado_de_columna_el_reparto_y_la_mezcla_no_se_editan() -> None:
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
        assert (caso.value.code, caso.value.status_code) == ("armado_columna_activo", 409)
    # Sin armado, como siempre.
    assert editar_plan(plan(_columna_con_catalogo()), mezcla).plan


def test_editar_una_columna_no_toca_a_otra_columna_del_mismo_plan() -> None:
    otra = "EST_05_OTRA_COLUMNA"
    dos = plan(_columna_con_catalogo(), _columna_con_catalogo(estructura_id=otra))
    antes = copy.deepcopy(_pieza(dos, otra))

    editado = editar_plan(dos, _edicion(_grande())).plan

    assert _pieza(editado, otra) == antes, "la edición de una no llega a la otra"
    assert "armado_columna" in _pieza(editado, COLUMNA)
    # Y un armado dirigido a un arco se valida contra ÉL: un arco no es una columna.
    with pytest.raises(PlanResolutionError) as caso:
        editar_plan(plan(_columna_con_catalogo(), arco()), _edicion(ARMADO, ARCO))
    assert cast(Mapping[str, str], caso.value.details)["motivo"] == "no_es_columna"


# --- Frontera HTTP ------------------------------------------------------------------------


def _post(operation: Mapping[str, object], nonce: str) -> tuple[int, dict[str, object]]:
    context = {
        "schema_version": "operational.v1",
        "request_id": "00000000-0000-4000-8000-000000000c35",
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
            "accion": "armado_columna",
            "estructura_id": estructura_id,
            "armado_columna": armado,
        },
        "colores_variante": [],
        "completar_patrones": False,
    }


def test_el_endpoint_guarda_el_armado_en_el_plan() -> None:
    status, body = _post(_operacion(ARMADO), "00000000-0000-4000-8000-000000000c35")

    assert status == 200
    payload = cast(dict[str, object], body["payload"])
    assert payload["operation_schema_version"] == "plan-edit-result.v1"
    assert _pieza(cast(dict[str, object], payload["plan"]), COLUMNA)["armado_columna"] == ARMADO


def test_el_endpoint_responde_422_con_motivo_y_mensaje_cuando_el_armado_no_se_sostiene() -> None:
    status, body = _post(
        _operacion({**ARMADO, "materiales": [0, 5]}), "00000000-0000-4000-8000-000000000c36"
    )

    assert status == 422
    detail = cast(dict[str, object], body["detail"])
    assert detail["code"] == "armado_invalido"
    assert (detail["estructura_id"], detail["motivo"]) == (COLUMNA, "material_fuera_de_rango")
    assert detail["mensaje"]
