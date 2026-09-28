"""Guirnaldas por partes dentro de la resolución, la vista previa y la edición (ADR-0032).

La guirnalda de ``guirnalda_datos`` (2,5 m, ``media``, ``organica_fina``,
rosado y blanco) compra 48 globos. Con ``completar_armados_guirnalda`` recibe
la receta sin cambiar un peso de la compra; una caída declarada alarga la
cuerda y el conteo la sigue, y la puerta física mide sobre esa cuerda.
"""

from __future__ import annotations

import hashlib
import json
import math
import time
from collections.abc import Mapping
from typing import cast
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import Settings, build_signature, create_app
from app.operational_store import InMemoryOperationalStore
from app.plan import (
    PlanResolutionError,
    _garland_cord,
    _physical_warnings,
    vista_previa_de_armado_guirnalda,
)
from app.plan_edicion import (
    AVISO_ARMADO_GUIRNALDA_COLOR,
    AVISO_ARMADO_GUIRNALDA_QUITADO,
    AVISO_ARMADO_GUIRNALDA_REHACER,
    EdicionArmadoGuirnalda,
    EdicionMaterial,
    EdicionMezcla,
    EdicionReparto,
    LineaBase,
    LineasBaseEstructura,
    editar_plan,
)
from tests.guirnalda_datos import (
    GUIRNALDA,
    arco,
    estructura_del_plan,
    guirnalda,
    lineas,
    plan,
    request,
    resolver,
)

SECRET = "g" * 32


def _armado(**extra: object) -> dict[str, object]:
    return {
        "version": "armado-guirnalda.v1",
        "origen": "decorador",
        "soporte": "pared",
        "forma": "recta",
        "racimo": {"unidad": "cuarteto", "tamano_pulg_base": 12},
        "relleno": None,
        "remates": [],
        **extra,
    }


def _total(resuelto: Mapping[str, object]) -> int:
    return cast(int, cast(dict[str, object], resuelto["totales"])["total_cop"])


def _unidades(resuelto: Mapping[str, object], indice: int = 0) -> int:
    return sum(cast(int, linea["unidades"]) for linea in lineas(resuelto, indice))


def _lineas_navegador(resuelto: Mapping[str, object]) -> list[dict[str, object]]:
    """Lo que el navegador tiene de las líneas de la pieza (``plan-armado-guirnalda.v1``)."""
    return [
        {
            key: linea.get(key)
            for key in (
                "product_id",
                "variant_id",
                "color",
                "acabado",
                "unidades",
                "diam_pulg",
                "tamano_codigo",
            )
        }
        for linea in lineas(resuelto)
    ]


# --- Completar al confirmar -----------------------------------------------------------------


@pytest.mark.anyio
async def test_sin_la_bandera_nada_cambia() -> None:
    base = await resolver(plan())
    explicito = await resolver(plan(), completar_armados_guirnalda=False)
    assert base["plan_hash"] == explicito["plan_hash"]
    assert "armado_guirnalda" not in estructura_del_plan(base)
    assert "armados_guirnalda" not in base


@pytest.mark.anyio
async def test_completar_arma_la_guirnalda_sin_cambiar_la_compra() -> None:
    base = await resolver(plan())
    armada = await resolver(plan(), completar_armados_guirnalda=True)
    assert lineas(armada) == lineas(base)
    assert _total(armada) == _total(base)
    assert armada["compras"] == base["compras"]
    assert armada["plan_hash"] != base["plan_hash"], "el armado es parte del plan firmado"
    armado = cast(dict[str, object], estructura_del_plan(armada)["armado_guirnalda"])
    assert (armado["origen"], armado["soporte"], armado["forma"]) == ("sugerido", "pared", "recta")
    resuelto = cast(list[dict[str, object]], armada["armados_guirnalda"])[0]
    leyenda = cast(list[dict[str, object]], resuelto["leyenda"])
    assert sum(cast(int, e["unidades_total"]) for e in leyenda) == _unidades(armada) == 48
    assert {e["product_id"] for e in leyenda} == {"prod-rosado", "prod-blanco"}
    assert leyenda[0]["descripcion"] == "R-5 rosado", "nombrado por la línea que compra"


@pytest.mark.anyio
async def test_armados_guirnalda_queda_fuera_del_hash_y_es_punto_fijo() -> None:
    primera = await resolver(plan(), completar_armados_guirnalda=True)
    snapshot = {
        "catalog_snapshot_id": "products_catalog:guirnalda",
        "estructuras": primera["estructuras"],
        "compras": primera["compras"],
        "total_cop": _total(primera),
    }
    canonical = json.dumps(
        {"plan": primera["plan"], "snapshot": snapshot},
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    assert primera["plan_hash"] == hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    segunda = await resolver(cast(dict[str, object], primera["plan"]))
    assert segunda["plan_hash"] == primera["plan_hash"]
    assert segunda["armados_guirnalda"] == primera["armados_guirnalda"]


@pytest.mark.anyio
async def test_completar_armados_de_limita_la_sugerencia_a_esa_pieza() -> None:
    otra = guirnalda(estructura_id="EST_03_GUIRNALDA", nombre="Otra guirnalda")
    resuelto = await resolver(
        plan(guirnalda(), otra),
        completar_armados_guirnalda=True,
        completar_armados_de=["EST_03_GUIRNALDA"],
    )
    assert "armado_guirnalda" not in estructura_del_plan(resuelto, 0)
    assert estructura_del_plan(resuelto, 1).get("armado_guirnalda") is not None


@pytest.mark.anyio
async def test_solo_las_guirnaldas_reciben_armado() -> None:
    techo = guirnalda(
        estructura_id="EST_04_TECHO",
        nombre="Techo de globos",
        estructura_oficial="techo_globos",
        ubicacion="techo",
    )
    resuelto = await resolver(plan(arco(), techo), completar_armados_guirnalda=True)
    assert all(
        "armado_guirnalda" not in e
        for e in cast(dict[str, list[dict[str, object]]], resuelto["plan"])["estructuras"]
    )
    assert "armados_guirnalda" not in resuelto


def test_la_bandera_es_un_booleano_estricto() -> None:
    with pytest.raises(ValidationError):
        request(plan(), completar_armados_guirnalda="true")


# --- La lectura de la foto al confirmar (E4) ----------------------------------------------


def _pista(**extra: object) -> dict[str, object]:
    return {
        "referencia_element_id": "REF_01_E01",
        "soporte": "mesa",
        "forma": "ondulada",
        "racimos_visibles": 10,
        "unidad_racimo": "trio",
        "colores_por_racimo": ["rosado", "blanco", "rosado"],
        "relleno": {"color": "blanco", "proporcion": 0.1},
        "remates": [{"clase": "latex", "color": "rosado", "posicion": "extremo_izq"}],
        "confianza": 0.85,
        **extra,
    }


@pytest.mark.anyio
async def test_la_lectura_de_la_foto_decide_la_distribucion_y_no_la_cantidad() -> None:
    plan_ = plan(guirnalda(referencia_element_id="REF_01_E01"))
    base = await resolver(plan_)
    leida = await resolver(plan_, completar_armados_guirnalda=True, pistas_guirnalda=[_pista()])
    armado = cast(dict[str, object], estructura_del_plan(leida)["armado_guirnalda"])
    assert (armado["origen"], armado["soporte"], armado["forma"]) == (
        "referencia",
        "mesa",
        "ondulada",
    )
    assert armado["relleno"] == {"material": 1, "proporcion": 0.1}
    assert armado["remates"] == [{"material": 0, "posicion": "extremo_izq"}]
    assert cast(dict[str, object], armado["racimo"])["unidad"] == "trio"
    assert lineas(leida) == lineas(base) and _total(leida) == _total(base), "la foto no compra"
    dudosa = await resolver(
        plan_, completar_armados_guirnalda=True, pistas_guirnalda=[_pista(confianza=0.3)]
    )
    assert cast(dict[str, object], estructura_del_plan(dudosa)["armado_guirnalda"])["origen"] == (
        "sugerido"
    )
    ajena = await resolver(
        plan_,
        completar_armados_guirnalda=True,
        pistas_guirnalda=[_pista(referencia_element_id="REF_01_E09")],
    )
    assert cast(dict[str, object], estructura_del_plan(ajena)["armado_guirnalda"])["origen"] == (
        "sugerido"
    )


@pytest.mark.anyio
async def test_la_anfitriona_de_la_foto_es_la_pieza_que_la_materializa() -> None:
    plan_ = plan(
        guirnalda(referencia_element_id="REF_01_E01"), arco(referencia_element_id="REF_01_E02")
    )
    pista = _pista(soporte="sobre_estructura", anfitriona_element_id="REF_01_E02", forma="curva")
    leida = await resolver(plan_, completar_armados_guirnalda=True, pistas_guirnalda=[pista])
    armado = cast(dict[str, object], estructura_del_plan(leida)["armado_guirnalda"])
    assert (armado["soporte"], armado["estructura_id"]) == ("sobre_estructura", "EST_02_ARCO")
    resuelto = cast(list[dict[str, object]], leida["armados_guirnalda"])[0]
    assert resuelto["nombre"] == "Guirnalda sobre Arco"


def test_una_pista_mal_formada_se_rechaza() -> None:
    with pytest.raises(ValidationError):
        request(plan(), pistas_guirnalda=[_pista(soporte="techo")])
    with pytest.raises(ValidationError):
        request(plan(), pistas_guirnalda=[_pista(caida_m=0.5)])


# --- Geometría: la cuerda y la puerta física -------------------------------------------------


def test_la_cuerda_es_un_arco_de_parabola_por_tramo() -> None:
    serie = 2.5 + 8 / 3 * 0.3**2 / 2.5
    caida_chica = _garland_cord(2.5, {"forma": "arco_caido", "caida_m": 0.3})
    assert caida_chica == pytest.approx(serie, rel=0.005), (
        "con caída chica coincide con la serie 8/3"
    )
    # Una U alta sobre una puerta (1,5 m de ancho, 2,2 m de caída): la serie dice 10,1 m.
    alta = _garland_cord(1.5, {"forma": "u_invertida", "caida_m": 2.2})
    assert 1.5 + 8 / 3 * 2.2**2 / 1.5 == pytest.approx(10.1, abs=0.05)
    assert alta == pytest.approx(4.78, abs=0.01)
    assert 2 * 2.2 < alta < 2 * 2.2 + 1.5
    # Colgada de tres puntos: dos tramos de 1,25 m con la misma caída.
    tres = _garland_cord(2.5, {"forma": "arco_caido", "caida_m": 0.3, "puntos_de_anclaje": 3})
    assert tres == pytest.approx(2 * _garland_cord(1.25, {"forma": "arco_caido", "caida_m": 0.3}))
    for sin_caida in (
        {"forma": "recta"},
        {"forma": "ondulada", "caida_m": 0.5},
        {"forma": "arco_caido"},
    ):
        assert _garland_cord(2.5, sin_caida) == 2.5


@pytest.mark.anyio
async def test_la_caida_alarga_la_cuerda_y_el_conteo_la_sigue() -> None:
    recta = await resolver(plan(guirnalda(armado_guirnalda=_armado())))
    colgada = _armado(soporte="colgada", forma="arco_caido", caida_m=0.8, puntos_de_anclaje=2)
    caida = await resolver(plan(guirnalda(armado_guirnalda=colgada)))
    cuerda = _garland_cord(2.5, colgada)
    estructura = cast(list[dict[str, object]], caida["estructuras"])[0]
    assert estructura["eje_m"] == round(cuerda, 2)
    assert _unidades(caida) > _unidades(recta) == 48
    assert _unidades(caida) == pytest.approx(48 * cuerda / 2.5, rel=0.05)
    resuelto = cast(list[dict[str, object]], caida["armados_guirnalda"])[0]
    assert resuelto["largo_cuerda_m"] == round(cuerda, 2) and resuelto["largo_m"] == 2.5
    assert not any(a.startswith("puerta_fisica:") for a in cast(list[str], caida["advertencias"]))


@pytest.mark.anyio
async def test_la_puerta_fisica_mide_sobre_la_cuerda() -> None:
    # Los 48 globos de la guirnalda recta sobre la cuerda de una caída de 5 m
    # (10,5 m): la puerta los ve escasos, cosa que con el largo recto no veía.
    recta = await resolver(plan(guirnalda(armado_guirnalda=_armado())))
    colgada = _armado(soporte="colgada", forma="u_invertida", caida_m=5, puntos_de_anclaje=2)
    declarado = plan(guirnalda(armado_guirnalda=colgada))
    estructura = {
        **cast(list[dict[str, object]], recta["estructuras"])[0],
        "eje_m": round(_garland_cord(2.5, colgada), 2),
    }
    avisos = _physical_warnings(declarado, [estructura])
    assert len(avisos) == 1 and "too low" in avisos[0] and "10.5" in avisos[0]
    assert _physical_warnings(declarado, cast(list[dict[str, object]], recta["estructuras"])) == []


# --- Vista previa sin catálogo --------------------------------------------------------------


@pytest.mark.anyio
async def test_la_vista_previa_resuelve_igual_que_la_resolucion() -> None:
    armada = await resolver(plan(), completar_armados_guirnalda=True)
    firmado = cast(dict[str, object], armada["plan"])
    esperado = cast(list[dict[str, object]], armada["armados_guirnalda"])[0]
    vista = vista_previa_de_armado_guirnalda(
        firmado, GUIRNALDA, cast(dict[str, object], esperado["armado"]), _lineas_navegador(armada)
    )
    assert vista.armado == esperado
    receta = vista_previa_de_armado_guirnalda(firmado, GUIRNALDA, None, _lineas_navegador(armada))
    assert receta.armado == esperado, "la receta sin armado es la misma que se completó"
    assert receta.opciones["unidades"] == ["trio", "cuarteto", "quinteto"]


@pytest.mark.anyio
async def test_la_vista_previa_rechaza_lo_que_no_es_una_guirnalda() -> None:
    with pytest.raises(PlanResolutionError) as error:
        vista_previa_de_armado_guirnalda(plan(guirnalda(), arco()), "EST_02_ARCO", None)
    assert error.value.code == "armado_invalido"
    assert cast(dict[str, object], error.value.details)["motivo"] == "no_es_guirnalda"
    with pytest.raises(PlanResolutionError) as error:
        vista_previa_de_armado_guirnalda(plan(), "EST_09_NADA", None)
    assert (error.value.code, error.value.status_code) == ("estructura_no_encontrada", 404)
    with pytest.raises(PlanResolutionError) as error:
        vista_previa_de_armado_guirnalda(plan(), GUIRNALDA, _armado(soporte="colgada"))
    assert cast(dict[str, object], error.value.details)["motivo"] == "colgada_sin_anclajes"


@pytest.mark.anyio
async def test_un_armado_invalido_en_el_plan_se_rechaza_al_resolver() -> None:
    malo = _armado(relleno={"material": 0, "proporcion": 0.5})
    with pytest.raises(PlanResolutionError) as error:
        await resolver(plan(guirnalda(armado_guirnalda=malo)))
    assert error.value.code == "armado_invalido"
    detalles = cast(dict[str, object], error.value.details)
    assert (detalles["estructura_id"], detalles["motivo"]) == (
        GUIRNALDA,
        "relleno_mayor_que_la_mezcla",
    )


# --- Edición ---------------------------------------------------------------------------------


def _con_armado(armado: Mapping[str, object] | None = None) -> dict[str, object]:
    return plan(
        guirnalda(
            armado_guirnalda=dict(armado or _armado(relleno={"material": 0, "proporcion": 0.2}))
        )
    )


def test_la_accion_fija_y_quita_el_armado() -> None:
    colgada = _armado(soporte="colgada", forma="arco_caido", caida_m=0.5, puntos_de_anclaje=2)
    fijado = editar_plan(
        plan(),
        EdicionArmadoGuirnalda(
            accion="armado_guirnalda", estructura_id=GUIRNALDA, armado_guirnalda=colgada
        ),
    )
    assert estructura_del_plan({"plan": fijado.plan})["armado_guirnalda"] == colgada
    quitado = editar_plan(
        fijado.plan,
        EdicionArmadoGuirnalda(
            accion="armado_guirnalda", estructura_id=GUIRNALDA, armado_guirnalda=None
        ),
    )
    assert "armado_guirnalda" not in estructura_del_plan({"plan": quitado.plan})
    with pytest.raises(PlanResolutionError) as error:
        editar_plan(
            plan(),
            EdicionArmadoGuirnalda(
                accion="armado_guirnalda",
                estructura_id=GUIRNALDA,
                armado_guirnalda=_armado(soporte="sobre_estructura", estructura_id="EST_09_NADA"),
            ),
        )
    assert cast(dict[str, object], error.value.details)["motivo"] == "anfitriona_inexistente"
    with pytest.raises(ValidationError):
        EdicionArmadoGuirnalda(
            accion="armado_guirnalda", estructura_id=GUIRNALDA, armado_guirnalda={"version": "otra"}
        )


def test_un_reparto_conserva_el_armado_que_sigue_cabiendo() -> None:
    reparto = EdicionReparto(accion="repartir", estructura_id=GUIRNALDA, participaciones=[0.5, 0.5])
    editado = editar_plan(_con_armado(), reparto)
    assert estructura_del_plan({"plan": editado.plan}).get("armado_guirnalda") is not None
    assert editado.avisos == ()


def test_una_mezcla_sin_globos_chicos_quita_el_armado_con_aviso() -> None:
    mezcla = EdicionMezcla(accion="mezcla", estructura_id=GUIRNALDA, mezcla="clasica")
    editado = editar_plan(_con_armado(), mezcla)
    assert "armado_guirnalda" not in estructura_del_plan({"plan": editado.plan})
    assert editado.avisos == (AVISO_ARMADO_GUIRNALDA_QUITADO,)
    rehecho = editar_plan(_con_armado(), mezcla, completar_armados_guirnalda=True)
    assert rehecho.avisos == (AVISO_ARMADO_GUIRNALDA_REHACER,)


def test_quitar_un_color_quita_el_armado() -> None:
    quitar = EdicionMaterial(
        accion="quitar", estructura_id=GUIRNALDA, objetivo_variant_id="var-blanco-12"
    )
    lineas_base = [
        LineasBaseEstructura(
            estructura_id=GUIRNALDA,
            lineas=[
                LineaBase(product_id="prod-blanco", variant_id="var-blanco-12", color="blanco")
            ],
        )
    ]
    editado = editar_plan(_con_armado(_armado()), quitar, lineas_base)
    assert "armado_guirnalda" not in estructura_del_plan({"plan": editado.plan})
    assert editado.avisos == (AVISO_ARMADO_GUIRNALDA_COLOR,)


@pytest.mark.anyio
async def test_la_re_resolucion_tras_editar_vuelve_a_sugerirlo() -> None:
    mezcla = EdicionMezcla(accion="mezcla", estructura_id=GUIRNALDA, mezcla="clasica")
    editado = editar_plan(_con_armado(), mezcla, completar_armados_guirnalda=True)
    rehecho = await resolver(
        editado.plan, completar_armados_guirnalda=True, completar_armados_de=[GUIRNALDA]
    )
    armado = cast(dict[str, object], estructura_del_plan(rehecho)["armado_guirnalda"])
    assert armado["relleno"] is None and armado["remates"] == [], "la receta de la mezcla nueva"
    assert math.isclose(_total(rehecho), _total(await resolver(editado.plan)))


# --- El endpoint ---------------------------------------------------------------------------


def _post(
    operation: Mapping[str, object], nonce: str, *, scope: str = "plan.armado_guirnalda"
) -> tuple[int, dict[str, object]]:
    context = {
        "schema_version": "operational.v1",
        "request_id": "00000000-0000-4000-8000-000000000d00",
        "correlation_id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
        "deadline_at": "2030-01-01T00:00:00Z",
        "deadline_ms": 5000,
        "scopes": [scope],
        "body_sha256": hashlib.sha256(
            json.dumps(operation, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest(),
    }
    body = json.dumps(
        {"context": context, **operation}, separators=(",", ":"), ensure_ascii=False
    ).encode()
    timestamp = int(time.time())
    path = "/internal/v1/plan/armado-guirnalda"
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


def _operacion(armado: Mapping[str, object] | None) -> dict[str, object]:
    return {
        "schema_version": "plan-armado-guirnalda.v1",
        "plan": plan(),
        "estructura_id": GUIRNALDA,
        "armado_guirnalda": None if armado is None else dict(armado),
    }


def test_el_endpoint_devuelve_plan_armado_guirnalda_result() -> None:
    status, body = _post(_operacion(None), "00000000-0000-4000-8000-000000000d01")
    assert status == 200
    payload = cast(dict[str, object], body["payload"])
    assert payload["operation_schema_version"] == "plan-armado-guirnalda-result.v1"
    armado = cast(dict[str, object], payload["armado"])
    assert cast(dict[str, object], armado["armado"])["origen"] == "sugerido"
    assert "soportes" in cast(dict[str, object], payload["opciones"])


def test_un_armado_invalido_responde_422_con_motivo() -> None:
    status, body = _post(
        _operacion(_armado(soporte="colgada")), "00000000-0000-4000-8000-000000000d02"
    )
    detail = cast(dict[str, object], body["detail"])
    assert (status, detail["code"]) == (422, "armado_invalido")
    assert (detail["estructura_id"], detail["motivo"]) == (GUIRNALDA, "colgada_sin_anclajes")


def test_el_endpoint_exige_su_scope() -> None:
    status, body = _post(
        _operacion(None), "00000000-0000-4000-8000-000000000d03", scope="plan.armado_bouquet"
    )
    assert (status, cast(dict[str, object], body["detail"])["code"]) == (403, "insufficient_scope")
