"""Vista previa del patrón de color para el editor (ADR-0028 §10).

`POST /internal/v1/plan/patron` expande el patrón que manda el editor, o sugiere
el preset con `patron_color: null`, sin catálogo. Expectativas a mano sobre la
columna de `test_plan_patron.py`: 10 cuartetos, 40 globos.
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

from app.main import Settings, build_signature, create_app
from app.operational_store import InMemoryOperationalStore
from app.plan_edicion import PlanPatronRequest, vista_previa_patron

SECRET = "v" * 32
COLUMNA = "EST_01_COLUMNA"
ANILLOS = {
    "version": "patron-color.v1",
    "origen": "decorador",
    "base": {"modo": "anillos", "secuencia": [0, 1, 2], "largo": 1},
}
SIN_AZUL = {
    "version": "patron-color.v1",
    "origen": "decorador",
    "base": {"modo": "espiral", "racimo": [0, 1, 0, 1], "trazo": "espiral"},
}
CONTEXTO = {
    "schema_version": "operational.v1",
    "request_id": "00000000-0000-4000-8000-000000000b00",
    "correlation_id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
    "deadline_at": "2030-01-01T00:00:00Z",
    "deadline_ms": 5000,
    "scopes": ["plan.patron"],
}


def _columna(**extra: object) -> dict[str, object]:
    return {
        "estructura_id": COLUMNA,
        "nombre": "Columna",
        "tipo": "columna",
        "rol_escena": "focal",
        "ubicacion": "lateral_izquierdo",
        "medidas": {"alto_m": 1.8},
        "repeticiones": 2,
        "densidad": "media",
        "mezcla": "clasica",
        "materiales": [
            {
                "product_id": f"prod-{color}",
                "color": color,
                "participacion": parte,
                "rol_material": "secundario",
            }
            for color, parte in (("blanco", 0.4), ("negro", 0.3), ("azul", 0.3))
        ],
        "porque": "Columna de prueba.",
        **extra,
    }


def _plan() -> dict[str, object]:
    return {
        "plan_version": "1.0",
        "plan_id": "27272727-2727-4272-8272-272727272727",
        "concepto": {"titulo": "Prueba", "descripcion": "Vista previa.", "paleta": ["blanco"]},
        "espacio": {"tipo": "salon", "fuente": "cliente"},
        "estructuras": [_columna()],
        "supuestos": [],
        "referencia_omitida": [],
    }


def _operacion(
    patron: Mapping[str, object] | None, estructura_id: str = COLUMNA
) -> dict[str, object]:
    return {
        "schema_version": "plan-patron.v1",
        "plan": _plan(),
        "estructura_id": estructura_id,
        "patron_color": None if patron is None else dict(patron),
    }


def _peticion(patron: Mapping[str, object] | None) -> PlanPatronRequest:
    return PlanPatronRequest.model_validate(
        {"context": {**CONTEXTO, "body_sha256": "a" * 64}, **_operacion(patron)}
    )


def _conteo(resultado: Mapping[str, object]) -> list[tuple[int, int]]:
    patron = cast(dict[str, object], resultado["patron"])
    return [
        (cast(int, c["unidades_por_instancia"]), cast(int, c["unidades_total"]))
        for c in cast(list[dict[str, object]], patron["conteo"])
    ]


def test_sin_patron_devuelve_la_sugerencia_sin_aplicar() -> None:
    resultado = vista_previa_patron(_peticion(None))

    patron = cast(dict[str, object], resultado["patron"])
    assert resultado["operation_schema_version"] == "plan-patron-result.v1"
    assert (patron["estructura_id"], patron["aplicado"]) == (COLUMNA, False)
    # 4p - 1 = 0.6, 0.2, 0.2 → la posición que sobra al blanco: [0, 1, 0, 2].
    assert patron["patron"] == {
        "version": "patron-color.v1",
        "origen": "sugerido",
        "base": {"modo": "espiral", "racimo": [0, 1, 0, 2], "trazo": "espiral"},
    }
    # 20/10/10 por columna y el doble con dos repeticiones.
    assert _conteo(resultado) == [(20, 40), (10, 20), (10, 20)]


def test_un_patron_dado_se_expande_como_aplicado() -> None:
    resultado = vista_previa_patron(_peticion(ANILLOS))

    patron = cast(dict[str, object], resultado["patron"])
    # 10 filas 0, 1, 2, 0…: 4, 3 y 3 cuartetos.
    assert (patron["aplicado"], patron["filas"], patron["columnas"]) == (True, 10, 4)
    assert patron["patron"] == ANILLOS
    assert _conteo(resultado) == [(16, 32), (12, 24), (12, 24)]


CONFETI = {
    "version": "patron-color.v1",
    "origen": "referencia",
    "base": {
        "modo": "aleatorio",
        "pesos": [
            {"material": 0, "peso": 40},
            {"material": 1, "peso": 30},
            {"material": 2, "peso": 30},
        ],
        "semilla": 7,
    },
    "acentos": [{"material": 2, "cada": 3, "desde": 2, "posiciones": [0]}],
}


def _peticion_reparto(
    participaciones: list[float], columna: Mapping[str, object]
) -> PlanPatronRequest:
    return PlanPatronRequest.model_validate(
        {
            "context": {**CONTEXTO, "body_sha256": "a" * 64},
            "schema_version": "plan-patron.v1",
            "plan": {**_plan(), "estructuras": [dict(columna)]},
            "estructura_id": COLUMNA,
            "patron_color": None,
            "participaciones": participaciones,
        }
    )


def test_el_reparto_del_deslizador_se_dibuja_sin_guardar() -> None:
    # Mientras se arrastra: el mismo `repartir` de la edición sobre el confeti,
    # sin tocar el plan. 40 celdas por 50/25/25 → 20, 10 y 10 por columna.
    resultado = vista_previa_patron(
        _peticion_reparto([0.5, 0.25, 0.25], _columna(patron_color=CONFETI))
    )

    patron = cast(dict[str, object], resultado["patron"])
    assert patron["aplicado"] is True
    assert cast(dict[str, object], patron["patron"])["base"] == {
        "modo": "aleatorio",
        "pesos": [
            {"material": 0, "peso": 50},
            {"material": 1, "peso": 25},
            {"material": 2, "peso": 25},
        ],
        "semilla": 7,
    }
    assert _conteo(resultado) == [(20, 40), (10, 20), (10, 20)]
    # El reparto lo eligió el decorador: el confeti que venía de la foto pasa a ser suyo.
    assert cast(dict[str, object], patron["patron"])["origen"] == "decorador"
    # El acento de la foto se integró al confeti, y la vista previa lo dice.
    assert "acentos" not in cast(dict[str, object], patron["patron"])
    assert any("se integraron al confeti" in aviso for aviso in cast(list[str], patron["avisos"]))


def test_la_vista_previa_dice_que_estilos_ofrece_el_editor() -> None:
    resultado = vista_previa_patron(_peticion(None))

    modos = cast(list[dict[str, object]], resultado["modos_admitidos"])
    assert [modo["modo"] for modo in modos] == [
        "espiral",
        "anillos",
        "bloques",
        "degradado",
        "aleatorio",
        "flor",
    ]
    assert all(
        modo["direcciones"] == ["longitudinal"] and modo["espejo"] is False for modo in modos
    )


def test_el_punto_de_partida_de_un_estilo_se_pide_con_modo() -> None:
    # Participación 0.4 / 0.3 / 0.3: los anillos van del blanco al azul.
    peticion = PlanPatronRequest.model_validate(
        {"context": {**CONTEXTO, "body_sha256": "a" * 64}, **_operacion(None), "modo": "anillos"}
    )

    patron = cast(dict[str, object], vista_previa_patron(peticion)["patron"])

    assert patron["aplicado"] is False
    assert cast(dict[str, object], patron["patron"])["base"] == {
        "modo": "anillos",
        "secuencia": [0, 1, 2],
        "largo": 1,
    }


def test_modo_solo_va_sin_patron() -> None:
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        PlanPatronRequest.model_validate(
            {
                "context": {**CONTEXTO, "body_sha256": "a" * 64},
                **_operacion(ANILLOS),
                "modo": "anillos",
            }
        )


def test_el_reparto_de_una_pieza_sin_patron_no_tiene_nada_que_dibujar() -> None:
    import pytest

    from app.plan import PlanResolutionError

    with pytest.raises(PlanResolutionError) as error:
        vista_previa_patron(_peticion_reparto([0.5, 0.25, 0.25], _columna()))
    assert (error.value.code, error.value.status_code) == ("sin_patron", 409)


def test_reparto_y_patron_no_van_juntos() -> None:
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        PlanPatronRequest.model_validate(
            {
                "context": {**CONTEXTO, "body_sha256": "a" * 64},
                **_operacion(ANILLOS),
                "participaciones": [0.5, 0.25, 0.25],
            }
        )


def _post(
    operation: Mapping[str, object], nonce: str, *, scope: str = "plan.patron"
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
            path="/internal/v1/plan/patron",
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
        response = client.post("/internal/v1/plan/patron", content=body, headers=headers)
    return response.status_code, cast(dict[str, object], response.json())


def test_el_endpoint_devuelve_plan_patron_result() -> None:
    status, body = _post(_operacion(ANILLOS), "00000000-0000-4000-8000-000000000b01")

    assert status == 200
    payload = cast(dict[str, object], body["payload"])
    assert payload["operation_schema_version"] == "plan-patron-result.v1"
    assert _conteo(payload) == [(16, 32), (12, 24), (12, 24)]


def test_un_patron_invalido_responde_422_con_motivo_y_mensaje() -> None:
    status, body = _post(_operacion(SIN_AZUL), "00000000-0000-4000-8000-000000000b02")

    detail = cast(dict[str, object], body["detail"])
    assert (status, detail["code"]) == (422, "patron_invalido")
    assert (detail["estructura_id"], detail["motivo"]) == (COLUMNA, "material_sin_uso")
    assert "azul (3)" in str(detail["mensaje"])


def test_una_estructura_desconocida_responde_404() -> None:
    status, body = _post(_operacion(None, "EST_09_OTRA"), "00000000-0000-4000-8000-000000000b03")

    assert (status, cast(dict[str, object], body["detail"])["code"]) == (
        404,
        "estructura_no_encontrada",
    )


def test_un_patron_fuera_del_contrato_responde_invalid_plan() -> None:
    vacio = {**SIN_AZUL, "base": {"modo": "espiral", "racimo": [], "trazo": "espiral"}}

    status, body = _post(_operacion(vacio), "00000000-0000-4000-8000-000000000b04")

    assert (status, cast(dict[str, object], body["detail"])["code"]) == (422, "invalid_plan")


def test_el_endpoint_exige_su_scope_y_el_campo_patron() -> None:
    sin_patron = {key: value for key, value in _operacion(None).items() if key != "patron_color"}

    status_scope, body_scope = _post(
        _operacion(None), "00000000-0000-4000-8000-000000000b05", scope="plan.edit"
    )
    status_cuerpo, body_cuerpo = _post(sin_patron, "00000000-0000-4000-8000-000000000b06")

    assert (status_scope, cast(dict[str, object], body_scope["detail"])["code"]) == (
        403,
        "insufficient_scope",
    )
    # `null` pide la sugerencia; omitir el campo no es lo mismo.
    assert (status_cuerpo, cast(dict[str, object], body_cuerpo["detail"])["code"]) == (
        422,
        "invalid_request",
    )


# --- Líneas de la pieza (``lineas``): solo nombran ----------------------------------

LINEA = {
    "product_id": "prod-azul",
    "variant_id": "var-azul-12",
    "color": "azul",
    "acabado": None,
    "unidades": 20,
    "diam_pulg": 12,
}


def _con_lineas(lineas: object, **extra: object) -> dict[str, object]:
    return {
        "context": {**CONTEXTO, "body_sha256": "a" * 64},
        **_operacion(None),
        "lineas": lineas,
        **extra,
    }


@pytest.mark.parametrize(
    "lineas",
    [
        [{**LINEA, "sku": "AZUL-12"}],
        [{key: value for key, value in LINEA.items() if key != "unidades"}],
        [{key: value for key, value in LINEA.items() if key != "color"}],
        [{**LINEA, "unidades": 0}],
        [{**LINEA, "unidades": 2.5}],
        [{**LINEA, "diam_pulg": -1}],
        [{**LINEA, "variant_id": ""}],
        [{**LINEA, "color": "x" * 161}],
        [LINEA] * 257,
    ],
    ids=[
        "campo_de_mas",
        "sin_unidades",
        "sin_color",
        "cero_unidades",
        "unidades_no_enteras",
        "diametro_negativo",
        "variante_vacia",
        "color_largo",
        "mas_de_256",
    ],
)
def test_las_lineas_de_la_pieza_tienen_una_forma_estricta_y_acotada(lineas: object) -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        PlanPatronRequest.model_validate(_con_lineas(lineas))


def test_las_lineas_van_con_cualquier_pedido_y_sin_reemplazos_no_cambian_nada() -> None:
    # Sin `variant_overrides` no hay nada que renombrar: la vista previa es la de siempre.
    minima = {key: value for key, value in LINEA.items() if key not in ("acabado", "diam_pulg")}
    for extra in ({}, {"modo": "anillos"}):
        con = vista_previa_patron(
            PlanPatronRequest.model_validate(_con_lineas([LINEA, minima], **extra))
        )
        sin = vista_previa_patron(
            PlanPatronRequest.model_validate(
                {"context": {**CONTEXTO, "body_sha256": "a" * 64}, **_operacion(None), **extra}
            )
        )
        assert con == sin


def test_el_endpoint_acepta_las_lineas_y_rechaza_las_que_no_cumplen() -> None:
    operacion = {**_operacion(ANILLOS), "lineas": [LINEA]}
    status, _body = _post(operacion, "00000000-0000-4000-8000-000000000b30")
    status_mala, body_mala = _post(
        {**_operacion(ANILLOS), "lineas": [{**LINEA, "precio": 1}]},
        "00000000-0000-4000-8000-000000000b31",
    )

    assert status == 200
    assert (status_mala, cast(dict[str, object], body_mala["detail"])["code"]) == (
        422,
        "invalid_request",
    )


# --- Cambiar de estilo con el borrador (``desde``) y rechazos con estilos ------------

LINEALES = ["espiral", "anillos", "bloques", "degradado", "aleatorio", "flor"]
MODOS_COLUMNA = [
    {"modo": modo, "direcciones": ["longitudinal"], "espejo": False} for modo in LINEALES
]


def _peticion_estilo(modo: str, desde: Mapping[str, object] | None) -> PlanPatronRequest:
    return PlanPatronRequest.model_validate(
        {
            "context": {**CONTEXTO, "body_sha256": "a" * 64},
            **_operacion(None),
            "modo": modo,
            **({} if desde is None else {"desde": dict(desde)}),
        }
    )


def test_el_estilo_nuevo_parte_del_borrador_del_decorador() -> None:
    # La columna mide T = 39 globos (test_plan_patron.py): en tríos, round(39 / 3)
    # = 13 filas × 3, justo 39. Participación 0.4 / 0.3 / 0.3 → anillos [0, 1, 2]:
    # filas blancas 0, 3, 6, 9, 12; negras 1, 4, 7, 10; azules el resto → 15, 12, 12.
    # El acento azul pasa tal cual: posición 1 de las filas pares (0, 2, …, 12)
    # quita 3 blancos (filas 0, 6, 12) y 2 negros (4, 10) → 12, 10, 17.
    # Los globos pintados son de la gráfica anterior: no pasan.
    acento = {"material": 2, "cada": 2, "desde": 1, "posiciones": [1]}
    desde = {
        "version": "patron-color.v1",
        "origen": "decorador",
        "globos_por_racimo": 3,
        "base": {"modo": "espiral", "racimo": [0, 1, 2], "trazo": "espiral"},
        "acentos": [acento],
        "pintados": [{"fila": 0, "material": 1}],
    }

    resultado = vista_previa_patron(_peticion_estilo("anillos", desde))

    patron = cast(dict[str, object], resultado["patron"])
    assert patron["aplicado"] is False
    assert patron["patron"] == {
        "version": "patron-color.v1",
        "origen": "sugerido",
        "globos_por_racimo": 3,
        "base": {"modo": "anillos", "secuencia": [0, 1, 2], "largo": 1},
        "acentos": [acento],
    }
    assert (patron["filas"], patron["columnas"]) == (13, 3)
    assert _conteo(resultado) == [(12, 24), (10, 20), (17, 34)]
    assert patron["avisos"] == []
    assert resultado["modos_admitidos"] == MODOS_COLUMNA


def test_lo_que_no_pasa_al_estilo_nuevo_se_avisa_en_la_vista_previa() -> None:
    # Racimos de 8: round(39 / 8) = 5 filas; las flores necesitan la fila 5 para
    # su primer centro (índice 4) y la tienen, así que el 8 pasa; el acento en
    # la posición 9 no cabe en un racimo de 8.
    desde = {
        "version": "patron-color.v1",
        "origen": "decorador",
        "globos_por_racimo": 8,
        "base": {"modo": "anillos", "secuencia": [0, 1, 2], "largo": 1},
        "acentos": [{"material": 1, "cada": 2, "desde": 1, "posiciones": [8]}],
    }

    patron = cast(dict[str, object], vista_previa_patron(_peticion_estilo("flor", desde))["patron"])

    assert cast(dict[str, object], patron["patron"])["globos_por_racimo"] == 8
    assert "acentos" not in cast(dict[str, object], patron["patron"])
    assert cast(list[str], patron["avisos"])[0] == (
        "El acento de negro (2) no cabe en el estilo «flores»: se quitó."
    )


def test_desde_solo_va_con_modo_y_con_la_forma_del_contrato() -> None:
    import pytest
    from pydantic import ValidationError

    desde = {**ANILLOS}
    with pytest.raises(ValidationError):
        PlanPatronRequest.model_validate(
            {"context": {**CONTEXTO, "body_sha256": "a" * 64}, **_operacion(None), "desde": desde}
        )
    with pytest.raises(ValidationError):
        _peticion_estilo(
            "anillos", {**ANILLOS, "base": {"modo": "anillos", "secuencia": [], "largo": 1}}
        )
    with pytest.raises(ValidationError):
        _peticion_estilo("anillos", {**ANILLOS, "color": "azul"})


def _columna_diminuta() -> dict[str, object]:
    # 0.2 m de columna: una sola fila de 4 globos para 5 colores → ningún preset se arma.
    return _columna(
        medidas={"alto_m": 0.2},
        materiales=[
            {
                "product_id": f"prod-{color}",
                "color": color,
                "participacion": 0.2,
                "rol_material": "secundario",
            }
            for color in ("blanco", "negro", "azul", "rojo", "dorado")
        ],
    )


def test_sin_sugerencia_el_rechazo_trae_los_estilos_de_la_pieza() -> None:
    import pytest

    from app.plan import PlanResolutionError

    peticion = PlanPatronRequest.model_validate(
        {
            "context": {**CONTEXTO, "body_sha256": "a" * 64},
            **_operacion(None),
            "plan": {**_plan(), "estructuras": [_columna_diminuta()]},
        }
    )

    with pytest.raises(PlanResolutionError) as error:
        vista_previa_patron(peticion)

    detalles = cast(dict[str, object], error.value.details)
    assert (error.value.code, detalles["motivo"]) == ("patron_invalido", "material_sin_uso")
    assert detalles["modos_admitidos"] == MODOS_COLUMNA


def test_la_vista_previa_de_una_pieza_no_expande_las_demas() -> None:
    # Solo se expande la pieza pedida (ADR-0028 §10): el patrón de otra no cambia
    # su rejilla ni su conteo, y expandirlas todas multiplicaba el trabajo de cada
    # vista previa por el número de piezas. Aunque el de la otra no se pueda
    # armar (lo rechaza la resolución del plan), esta pieza se dibuja.
    otra = {**_columna(patron_color=SIN_AZUL), "estructura_id": "EST_02_COLUMNA"}
    peticion = PlanPatronRequest.model_validate(
        {
            "context": {**CONTEXTO, "body_sha256": "a" * 64},
            **_operacion(ANILLOS),
            "plan": {**_plan(), "estructuras": [_columna(), otra]},
        }
    )

    resultado = vista_previa_patron(peticion)

    patron = cast(dict[str, object], resultado["patron"])
    assert (patron["estructura_id"], patron["aplicado"]) == (COLUMNA, True)
    assert _conteo(resultado) == _conteo(vista_previa_patron(_peticion(ANILLOS)))


def test_el_endpoint_devuelve_los_estilos_en_el_rechazo() -> None:
    sin_sugerencia = {**_operacion(None), "plan": {**_plan(), "estructuras": [_columna_diminuta()]}}

    status_patron, body_patron = _post(_operacion(SIN_AZUL), "00000000-0000-4000-8000-000000000b07")
    status_sugerencia, body_sugerencia = _post(
        sin_sugerencia, "00000000-0000-4000-8000-000000000b08"
    )

    for status, body in ((status_patron, body_patron), (status_sugerencia, body_sugerencia)):
        detail = cast(dict[str, object], body["detail"])
        assert (status, detail["code"]) == (422, "patron_invalido")
        assert detail["modos_admitidos"] == MODOS_COLUMNA


def test_el_endpoint_calcula_la_vista_previa_fuera_del_event_loop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # La vista previa se pide mientras el decorador arrastra: su cálculo (CPU
    # puro) no puede frenar el event loop del resto de ai-api. Va al hilo del plan.
    import threading

    import app.main as main

    hilos: list[str] = []
    calcular = main.vista_previa_patron

    def espia(peticion: PlanPatronRequest) -> dict[str, object]:
        hilos.append(threading.current_thread().name)
        return calcular(peticion)

    monkeypatch.setattr(main, "vista_previa_patron", espia)

    status, _body = _post(_operacion(ANILLOS), "00000000-0000-4000-8000-000000000b20")

    assert status == 200
    assert len(hilos) == 1 and hilos[0].startswith("plan-cpu")
