"""La edición ``armado_arco`` del plan (ADR-0035, paso 1).

Guardar el arco que el decorador armó con la vista previa en vivo es escribir su ``armado_arco`` en la pieza,
por la misma puerta que ya usan el patrón, el bouquet y la guirnalda (``POST /internal/v1/plan/edit``). Aquí
se prueba esa acción: fija o quita el armado, lo comprueba contra la pieza sin catálogo con
``armado_arco.validar`` (la misma puerta de la vista previa) y rechaza con ``armado_invalido`` y la frase del
motor lo que no se sostiene. Lo que el motor corrige (el ancho que cabe, el alto de la forma) no se rechaza:
va en los avisos de la vista previa y lo cuenta la resolución.
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

from app.armado_arco import EstructuraArco, armado_resuelto
from app.main import Settings, build_signature, create_app
from app.operational_store import InMemoryOperationalStore
from app.plan import PlanResolutionError
from app.plan_edicion import Edicion, LineaBase, LineasBaseEstructura, PlanEditado, editar_plan
from tests.guirnalda_datos import (
    allowlist_hasta,
    arco,
    guirnalda,
    lineas,
    material,
    plan,
    resolver,
)

SECRET = "r" * 32
ARCO = "EST_02_ARCO"
GUIRNALDA = "EST_01_GUIRNALDA"
RUTA = "/internal/v1/plan/edit"
SCOPE = "plan.edit"
_EDICION = TypeAdapter(Edicion)

#: Un armado de arco de dos colores, como el que arma el editor: chevron en herradura con globos R12.
ARMADO: dict[str, object] = {
    "version": "armado-arco.v1",
    "origen": "decorador",
    "patron": "chevron",
    "opciones": {"ancho": 3, "inclinacion": 2, "invertir": 0, "espejo": 1},
    "geometria": {
        "forma": "herradura",
        "anchoM": 3.2,
        "altoM": 2.3,
        "globosAncho": 4,
        "suelo": True,
    },
    "globo": {
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
    },
    "capas": [],
    "secciones": [],
    "materiales": [0, 1],
}


def _arco_dos_colores(**extra: object) -> dict[str, object]:
    return arco(
        materiales=[material("azul", 0.6, principal=True), material("blanco", 0.4)], **extra
    )


def _plan() -> dict[str, object]:
    return plan(_arco_dos_colores(), guirnalda())


def _edicion(armado: Mapping[str, object] | None, estructura_id: str = ARCO) -> Edicion:
    return _EDICION.validate_python(
        {"accion": "armado_arco", "estructura_id": estructura_id, "armado_arco": armado}
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

    assert _pieza(editado.plan, ARCO)["armado_arco"] == ARMADO, (
        "el armado se escribe tal como llegó"
    )
    assert editado.avisos == ()
    assert _pieza(editado.plan, GUIRNALDA) == _pieza(antes, GUIRNALDA)
    assert base == antes, "la edición no muta el plan recibido"


def test_quitar_el_armado_devuelve_la_pieza_al_camino_de_siempre() -> None:
    con_armado = editar_plan(_plan(), _edicion(ARMADO)).plan

    sin_armado = editar_plan(con_armado, _edicion(None)).plan

    assert "armado_arco" not in _pieza(sin_armado, ARCO)
    # Quitar el de una pieza que no lo tiene no cambia nada.
    assert editar_plan(sin_armado, _edicion(None)).plan == sin_armado


def test_un_armado_editado_otra_vez_se_reemplaza() -> None:
    primero = editar_plan(_plan(), _edicion(ARMADO)).plan
    otro = {**ARMADO, "patron": "zigzag", "opciones": {"ancho": 2}}

    segundo = editar_plan(primero, _edicion(otro)).plan

    assert _pieza(segundo, ARCO)["armado_arco"] == otro


def _motivo(armado: Mapping[str, object], estructura_id: str = ARCO) -> tuple[str, str]:
    with pytest.raises(PlanResolutionError) as caso:
        editar_plan(_plan(), _edicion(armado, estructura_id))
    assert (caso.value.code, caso.value.status_code) == ("armado_invalido", 422)
    detalles = cast(Mapping[str, str], caso.value.details)
    assert detalles["estructura_id"] == estructura_id
    return detalles["motivo"], detalles["mensaje"]


def test_un_armado_en_una_pieza_que_no_es_arco_se_rechaza_con_la_frase_del_motor() -> None:
    motivo, mensaje = _motivo(ARMADO, GUIRNALDA)

    assert motivo == "no_es_arco"
    assert "arco" in mensaje.lower()


def test_un_color_que_la_pieza_no_lleva_se_rechaza() -> None:
    motivo, mensaje = _motivo({**ARMADO, "materiales": [0, 5]})

    assert motivo == "material_fuera_de_rango"
    assert mensaje


def test_un_patron_con_menos_colores_de_los_que_pide_se_rechaza() -> None:
    motivo, mensaje = _motivo({**ARMADO, "materiales": [0]})

    assert motivo == "pocos_materiales"
    assert "«" in mensaje, "la frase nombra el patrón, en español"


def test_lo_que_el_motor_corrige_no_se_rechaza() -> None:
    # Un alto imposible para la herradura: el motor lo ajusta al resolver y lo dice en los avisos; guardar no
    # es el sitio donde se decide que un arco de 0,8 m de alto "no cabe".
    pasado = {**ARMADO, "geometria": {**cast(dict[str, object], ARMADO["geometria"]), "altoM": 0.8}}

    editado = editar_plan(_plan(), _edicion(pasado))

    assert _pieza(editado.plan, ARCO)["armado_arco"] == pasado


@pytest.mark.parametrize(
    "armado",
    [
        {**ARMADO, "version": "otra"},
        {**ARMADO, "patron": "inventado"},
        {**ARMADO, "campo_nuevo": 1},
        {key: value for key, value in ARMADO.items() if key != "globo"},
    ],
)
def test_la_forma_del_armado_se_exige_en_la_frontera(armado: Mapping[str, object]) -> None:
    with pytest.raises(ValidationError):
        _edicion(armado)


def test_la_accion_lleva_su_estructura_y_su_armado() -> None:
    with pytest.raises(ValidationError):
        _EDICION.validate_python({"accion": "armado_arco", "estructura_id": ARCO})
    with pytest.raises(ValidationError):
        _EDICION.validate_python({"accion": "armado_arco", "armado_arco": None})


def test_una_estructura_que_no_existe_es_404() -> None:
    with pytest.raises(PlanResolutionError) as caso:
        editar_plan(_plan(), _edicion(ARMADO, "EST_99_NO_EXISTE"))
    assert (caso.value.code, caso.value.status_code) == ("estructura_no_encontrada", 404)


# --- Un armado que no cabe en el contrato, y colores que cambian bajo el armado ---------------------------


def _tres_colores(**extra: object) -> dict[str, object]:
    return arco(
        materiales=[
            material("azul", 0.4, principal=True),
            material("blanco", 0.35),
            material("dorado", 0.25),
        ],
        **extra,
    )


def _linea(color: str) -> LineasBaseEstructura:
    return LineasBaseEstructura(
        estructura_id=ARCO,
        lineas=[LineaBase(product_id=f"prod-{color}", variant_id=f"var-{color}-12", color=color)],
    )


def _quitar(plan_: Mapping[str, object], color: str) -> PlanEditado:
    edicion = _EDICION.validate_python(
        {
            "accion": "quitar",
            "estructura_id": ARCO,
            "objetivo_variant_id": f"var-{color}-12",
        }
    )
    return editar_plan(plan_, edicion, [_linea(color)])


def _material(color: str, parte: float) -> dict[str, object]:
    return {**material(color, parte), "variant_id": f"var-{color}-12"}


def _plan_tres() -> dict[str, object]:
    piezas = arco(
        materiales=[_material("azul", 0.4), _material("blanco", 0.35), _material("dorado", 0.25)]
    )
    return plan(piezas, guirnalda())


def test_un_armado_demasiado_grande_es_armado_invalido_con_su_frase_y_no_un_500() -> None:
    gigante = {
        **ARMADO,
        "geometria": {
            "forma": "herradura",
            "anchoM": 10,
            "altoM": 6,
            "globosAncho": 8,
            "suelo": True,
        },
        "globo": {**cast(dict[str, object], ARMADO["globo"]), "nominal": 5},
    }

    motivo, mensaje = _motivo(gigante)

    assert motivo == "demasiados_globos"
    assert "1.200" in mensaje and "R5" in mensaje, "dice cuántos caben y con qué globo"
    assert "usa un globo más grande" in mensaje, "dice qué hacer"


def test_quitar_un_color_corre_los_indices_del_armado_y_lo_avisa() -> None:
    # El arco usa azul (0) y dorado (2). Quitar el blanco (1) deja a dorado en la posición 1.
    armado = {**ARMADO, "materiales": [0, 2]}
    editado = editar_plan(_plan_tres(), _edicion(armado)).plan

    resultado = _quitar(editado, "blanco")

    nuevo = cast(dict[str, object], _pieza(resultado.plan, ARCO)["armado_arco"])
    assert nuevo["materiales"] == [0, 1], "el dorado ahora es el índice 1"
    assert nuevo["patron"] == ARMADO["patron"], "sigue siendo el mismo patrón: todavía se sostiene"
    assert any("color" in aviso.lower() and "arco" in aviso.lower() for aviso in resultado.avisos)


def test_quitar_el_color_que_usa_el_armado_nunca_deja_un_indice_inexistente() -> None:
    armado = {**ARMADO, "materiales": [0, 1]}
    editado = editar_plan(_plan_tres(), _edicion(armado)).plan

    resultado = _quitar(editado, "blanco")

    pieza = _pieza(resultado.plan, ARCO)
    nuevo = cast(dict[str, object], pieza["armado_arco"])
    cuantos = len(cast(list[object], pieza["materiales"]))
    assert all(0 <= i < cuantos for i in cast(list[int], nuevo["materiales"]))
    # El chevron pide 2 colores y con el blanco fuera el armado solo conserva el azul: baja a sólido, no a otro color.
    assert (nuevo["patron"], nuevo["materiales"]) == ("solido", [0])


def test_quitar_un_color_que_el_armado_no_usa_y_viene_despues_no_mueve_nada() -> None:
    armado = {**ARMADO, "materiales": [0, 1]}
    editado = editar_plan(_plan_tres(), _edicion(armado)).plan

    resultado = _quitar(editado, "dorado")

    assert _pieza(resultado.plan, ARCO)["armado_arco"] == armado
    assert not any("arco" in aviso.lower() for aviso in resultado.avisos)


def test_si_el_patron_ya_no_cabe_con_los_colores_que_quedan_baja_a_solido_y_lo_dice() -> None:
    dos = plan(arco(materiales=[_material("azul", 0.6), _material("blanco", 0.4)]), guirnalda())
    editado = editar_plan(dos, _edicion(ARMADO)).plan

    resultado = _quitar(editado, "blanco")

    nuevo = cast(dict[str, object], _pieza(resultado.plan, ARCO)["armado_arco"])
    assert (nuevo["patron"], nuevo["materiales"]) == ("solido", [0])
    assert nuevo["capas"] == [] and nuevo["secciones"] == []
    assert any("sólido" in aviso for aviso in resultado.avisos), (
        "se dice que el patrón cambió y por qué"
    )


def test_agregar_un_color_conserva_el_armado_y_avisa_que_el_arco_no_lo_usa() -> None:
    editado = editar_plan(plan(_arco_dos_colores(), guirnalda()), _edicion(ARMADO)).plan
    agregar = _EDICION.validate_python(
        {
            "accion": "agregar",
            "estructura_id": ARCO,
            "variante": {"product_id": "prod-dorado", "variant_id": "var-dorado-12"},
        }
    )

    resultado = editar_plan(editado, agregar, [], ["dorado"])

    assert _pieza(resultado.plan, ARCO)["armado_arco"] == ARMADO
    assert any("no lo usa" in aviso for aviso in resultado.avisos)


def test_un_armado_con_indices_que_la_pieza_ya_no_tiene_no_se_guarda() -> None:
    # La pieza lleva dos colores; un borrador viejo del editor nombra el tercero.
    with pytest.raises(PlanResolutionError) as caso:
        editar_plan(
            plan(_arco_dos_colores(), guirnalda()), _edicion({**ARMADO, "materiales": [0, 2]})
        )
    assert cast(Mapping[str, str], caso.value.details)["motivo"] == "material_fuera_de_rango"


# --- El armado manda en la pieza: medidas, compra, colores sin uso, cobertura ---------------------------------


def _arco_con_catalogo(**extra: object) -> dict[str, object]:
    """Un arco dorado y blanco, los colores que el catálogo de prueba sí vende (R5 a R24)."""
    return arco(
        materiales=[material("dorado", 0.5, principal=True), material("blanco", 0.5)], **extra
    )


def _grande(nominal: int = 12) -> dict[str, object]:
    return {
        **ARMADO,
        "geometria": {
            **cast(dict[str, object], ARMADO["geometria"]),
            "anchoM": 9,
            "altoM": 5,
            "globosAncho": 4,
        },
        "globo": {**cast(dict[str, object], ARMADO["globo"]), "nominal": nominal},
    }


def _resolver(plan_: Mapping[str, object]) -> dict[str, object]:
    return asyncio.run(resolver(plan_))


def test_guardar_un_armado_pone_las_medidas_de_la_pieza_con_las_del_motor() -> None:
    # El plan declaraba 3 x 2,4 m; el decorador armó un arco de 9 x 5 m.
    base = plan(_arco_con_catalogo())
    assert cast(dict[str, object], _pieza(base, ARCO)["medidas"])["ancho_m"] == 3

    editado = editar_plan(base, _edicion(_grande())).plan

    medidas = cast(dict[str, float], _pieza(editado, ARCO)["medidas"])
    # Lo que mide el arco lo dice el motor (la herradura de 5 m de alto declarado mide 5,3 m ya armada).
    motor = armado_resuelto(
        EstructuraArco(es_arco=True, materiales=["#000001", "#000002"]), _grande()
    )
    assert (medidas["ancho_m"], medidas["alto_m"]) == (
        round(motor["ancho_m"], 2),
        round(motor["alto_m"], 2),
    )
    assert medidas["ancho_m"] == 9.0 and medidas["alto_m"] != 2.4, "ya no son las de antes"


def test_el_plan_editado_se_resuelve_con_el_conteo_las_medidas_y_el_hash_del_armado() -> None:
    base = plan(_arco_con_catalogo())
    antes = _resolver(base)

    editado = editar_plan(base, _edicion(_grande())).plan
    despues = _resolver(editado)

    assert despues["plan_hash"] != antes["plan_hash"], "es otra decoración: cambia la firma"
    resuelta = cast(list[dict[str, object]], despues["armados_arco"])[0]
    conteo = sum(
        cast(int, linea["cantidad"]) for linea in cast(list[dict[str, object]], resuelta["conteo"])
    )
    estructura = cast(list[dict[str, object]], despues["estructuras"])[0]
    # La compra es el conteo del motor, no la estimación de antes, y las medidas del plan son las del arco armado.
    assert estructura["total_unidades"] == conteo
    assert conteo > cast(
        int, cast(list[dict[str, object]], antes["estructuras"])[0]["total_unidades"]
    )
    declaradas = cast(
        dict[str, float], _pieza(cast(dict[str, object], despues["plan"]), ARCO)["medidas"]
    )
    assert (declaradas["ancho_m"], declaradas["alto_m"]) == (
        resuelta["ancho_m"],
        resuelta["alto_m"],
    )


def test_un_color_de_la_pieza_que_el_armado_no_toma_se_avisa_antes_de_comprar_sin_el() -> None:
    solido = {**ARMADO, "patron": "solido", "opciones": {}, "materiales": [0]}

    resultado = editar_plan(plan(_arco_con_catalogo()), _edicion(solido))

    assert any("no usa el color Blanco" in aviso for aviso in resultado.avisos), resultado.avisos
    assert any("no se comprarán" in aviso for aviso in resultado.avisos)
    # Es lo que pasaba sin decirlo: el plan sigue con el blanco y la compra no lo lleva.
    comprado = {linea["color"] for linea in lineas(_resolver(resultado.plan))}
    assert comprado == {"dorado"}
    # Un armado que usa los dos colores no avisa de nada.
    assert not editar_plan(plan(_arco_con_catalogo()), _edicion(ARMADO)).avisos


def test_un_r36_que_el_producto_no_vende_se_compra_como_su_r24_y_se_dice() -> None:
    editado = editar_plan(plan(_arco_con_catalogo()), _edicion(_grande(nominal=36))).plan

    resuelto = _resolver(editado)

    # R36 no está en el catálogo de prueba pero el R24 del mismo producto sí: se compra ese (b7f5cfe2) y la
    # resolución lo cuenta en `sustituciones`, que es lo que se le dice al cliente. No queda nada sin cobertura.
    assert not resuelto["sin_cobertura"]
    sustituciones = cast(list[dict[str, str]], resuelto["sustituciones"])
    assert {(s["pedido"], s["entregado"]) for s in sustituciones} == {("R-36", "R-24")}


def test_un_tamano_de_globo_que_ningun_producto_sirve_deja_la_pieza_sin_cobertura() -> None:
    editado = editar_plan(plan(_arco_con_catalogo()), _edicion(_grande(nominal=36))).plan

    # Sin R24 ni R36 en lo que se puede comprar no hay con qué sustituir el R36 (el 36 solo se sirve con el 24).
    resuelto = asyncio.run(resolver(editado, allowlist=allowlist_hasta(18)))

    # La resolución lo dice en `sin_cobertura` y la ruta de Next lo rechaza antes de firmar (`aplicar-edicion.ts`),
    # en vez de firmar una propuesta a la que le faltan globos.
    assert resuelto["sin_cobertura"], "sin cobertura de catálogo"


def test_con_armado_de_arco_el_reparto_y_la_mezcla_no_se_editan() -> None:
    con_armado = editar_plan(plan(_arco_con_catalogo()), _edicion(ARMADO)).plan
    reparto = _EDICION.validate_python(
        {"accion": "repartir", "estructura_id": ARCO, "participaciones": [0.7, 0.3]}
    )
    mezcla = _EDICION.validate_python(
        {"accion": "mezcla", "estructura_id": ARCO, "mezcla": "clasica"}
    )

    for edicion in (reparto, mezcla):
        with pytest.raises(PlanResolutionError) as caso:
            editar_plan(con_armado, edicion)
        assert (caso.value.code, caso.value.status_code) == ("armado_arco_activo", 409)
    # Sin armado, como siempre.
    assert editar_plan(plan(_arco_con_catalogo()), mezcla).plan


def test_editar_un_arco_no_toca_a_otro_arco_del_mismo_plan() -> None:
    otro = "EST_05_OTRO_ARCO"
    dos = plan(_arco_con_catalogo(), _arco_con_catalogo(estructura_id=otro))
    antes = copy.deepcopy(_pieza(dos, otro))

    editado = editar_plan(dos, _edicion(_grande())).plan

    assert _pieza(editado, otro) == antes, "la edición de uno no llega al otro"
    assert "armado_arco" in _pieza(editado, ARCO)
    # Y un armado dirigido a la pieza equivocada se valida contra ELLA: una guirnalda no es un arco.
    with pytest.raises(PlanResolutionError) as caso:
        editar_plan(plan(_arco_con_catalogo(), guirnalda()), _edicion(ARMADO, GUIRNALDA))
    assert cast(Mapping[str, str], caso.value.details)["motivo"] == "no_es_arco"


def test_la_merma_de_la_vista_previa_es_la_del_plan_y_no_una_copia() -> None:
    from app.armado_arco import DESPERDICIO_POR_DEFECTO
    from app.plan import MERMA

    assert DESPERDICIO_POR_DEFECTO == MERMA


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


def _operacion(armado: Mapping[str, object] | None, estructura_id: str = ARCO) -> dict[str, object]:
    return {
        "schema_version": "plan-edit.v1",
        "plan": _plan(),
        "lineas_base": [],
        "edicion": {"accion": "armado_arco", "estructura_id": estructura_id, "armado_arco": armado},
        "colores_variante": [],
        "completar_patrones": False,
    }


def test_el_endpoint_guarda_el_armado_en_el_plan() -> None:
    status, body = _post(_operacion(ARMADO), "00000000-0000-4000-8000-000000000e35")

    assert status == 200
    payload = cast(dict[str, object], body["payload"])
    assert payload["operation_schema_version"] == "plan-edit-result.v1"
    assert _pieza(cast(dict[str, object], payload["plan"]), ARCO)["armado_arco"] == ARMADO


def test_el_endpoint_responde_422_con_motivo_y_mensaje_cuando_el_armado_no_se_sostiene() -> None:
    status, body = _post(
        _operacion({**ARMADO, "materiales": [0]}), "00000000-0000-4000-8000-000000000e36"
    )

    assert status == 422
    detail = cast(dict[str, object], body["detail"])
    assert detail["code"] == "armado_invalido"
    assert (detail["estructura_id"], detail["motivo"]) == (ARCO, "pocos_materiales")
    assert detail["mensaje"]
