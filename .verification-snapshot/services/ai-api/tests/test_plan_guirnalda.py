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

from app.armado_estructura import armado_guirnalda_de_receta
from app.main import Settings, build_signature, create_app
from app.operational_store import InMemoryOperationalStore
from app import plan as plan_module
from app.patron_color import PatronColorInvalido
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
    # 48: sin armado del motor, la guirnalda orgánica la cuenta la fórmula (decisión del dueño del 2026-10-05; del
    # 2026-10-04 al 2026-10-05 la contaba la receta del motor y salían 76).
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
    # Sin armado del motor la guirnalda la cuenta la fórmula sobre su cuerda, y una ``ondulada`` no la alarga.
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
async def test_un_remate_que_no_se_compra_deja_la_forma_leida() -> None:
    """Con su armado del motor guardado, la guirnalda compra lo que el motor coloca con cuotas exactas.

    El armado es la receta del motor sobre la línea ondulada que leyó la foto, como la escribiría la
    confirmación: compra justo 60/40 y sus globos grandes (18" y 24") le salen blancos (2026-10-05). El rosado
    del remate leído necesita un globo rosado grande, y no se compra ninguno. ``sugerir_armado`` hace lo que
    dice: conserva la forma leída (soporte y forma) con el relleno y los remates de la receta, en vez de
    inventar un globo que no se compra. Sin el armado del motor la cuenta la fórmula, que sí compra un rosado
    grande, y el remate leído cabe (``test_la_lectura_de_la_foto_decide_la_distribucion_y_no_la_cantidad``).
    """
    sin_armado = guirnalda(referencia_element_id="REF_01_E01")
    ondulada = {**sin_armado, "armado_guirnalda": _armado(soporte="mesa", forma="ondulada")}
    del_motor = armado_guirnalda_de_receta(ondulada)
    assert del_motor is not None
    plan_ = plan({**sin_armado, "armado_guirnalda_organica": del_motor})
    leida = await resolver(plan_, completar_armados_guirnalda=True, pistas_guirnalda=[_pista()])
    armado = cast(dict[str, object], estructura_del_plan(leida)["armado_guirnalda"])
    assert (armado["soporte"], armado["forma"]) == ("mesa", "ondulada")
    assert {"material": 0, "posicion": "extremo_izq"} not in cast(list[object], armado["remates"])


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


def _pista_geometria(**extra: object) -> dict[str, object]:
    """La guirnalda de la foto del usuario: en la pared, curva, alta a la izquierda."""
    return _pista(soporte="pared", forma="curva", relleno=None, remates=[], **extra)


@pytest.mark.anyio
async def test_la_caida_y_el_desnivel_de_la_foto_llegan_al_armado_y_a_la_compra() -> None:
    # Decisión 27: la lectura trae la caída y el desnivel relativos al largo;
    # el armado los lleva en metros sobre los 2,5 m y la compra sigue la cuerda.
    plan_ = plan(guirnalda(mezcla="clasica", referencia_element_id="REF_01_E01"))
    sin = await resolver(
        plan_, completar_armados_guirnalda=True, pistas_guirnalda=[_pista_geometria()]
    )
    cae = await resolver(
        plan_,
        completar_armados_guirnalda=True,
        pistas_guirnalda=[_pista_geometria(caida_relativa=0.0, desnivel_relativo=-0.25)],
    )
    armado = cast(dict[str, object], estructura_del_plan(cae)["armado_guirnalda"])
    assert (armado["origen"], armado["soporte"], armado["forma"], armado["desnivel_m"]) == (
        "referencia",
        "pared",
        "curva",
        -0.63,
    )
    assert "caida_m" not in armado
    cuerda = _garland_cord(2.5, armado)
    assert cuerda == pytest.approx(math.hypot(2.5, 0.63))
    assert cast(list[dict[str, object]], cae["estructuras"])[0]["eje_m"] == round(cuerda, 2)
    assert _unidades(cae) > _unidades(sin) == 54, "la cuerda desnivelada lleva más globos"
    resuelto = cast(list[dict[str, object]], cae["armados_guirnalda"])[0]
    assert resuelto["globos_por_instancia"] == _unidades(cae), "el armado reparte lo que se compra"
    assert (resuelto["largo_m"], resuelto["largo_cuerda_m"]) == (2.5, round(cuerda, 2))
    # Decisión 28: tras el desnivel, la línea de los extremos libres (en la pared).
    assert "slopes down toward the right. Both ends hang free in the air" in str(
        resuelto["prompt_gemini"]
    )
    assert estructura_del_plan(cae)["medidas"] == {"largo_m": 2.5}, "la caída no toca el largo"
    # Una curva que cae cuelga en arco con su caída.
    caida = await resolver(
        plan_,
        completar_armados_guirnalda=True,
        pistas_guirnalda=[_pista_geometria(caida_relativa=0.15, desnivel_relativo=-0.2)],
    )
    colgada = cast(dict[str, object], estructura_del_plan(caida)["armado_guirnalda"])
    assert (colgada["forma"], colgada["caida_m"], colgada["desnivel_m"]) == (
        "arco_caido",
        0.38,
        -0.5,
    )
    assert _unidades(caida) > _unidades(cae)
    # Punto fijo: resolver otra vez el plan firmado da el mismo hash.
    for resuelto_ in (cae, caida):
        otra = await resolver(cast(dict[str, object], resuelto_["plan"]))
        assert otra["plan_hash"] == resuelto_["plan_hash"]
    # Sin las medidas nuevas (o en null), exactamente lo de antes.
    nulas = await resolver(
        plan_,
        completar_armados_guirnalda=True,
        pistas_guirnalda=[_pista_geometria(caida_relativa=None, desnivel_relativo=None)],
    )
    assert nulas["plan_hash"] == sin["plan_hash"]


@pytest.mark.anyio
async def test_la_foto_arqueada_hacia_arriba_llega_como_curva_y_a_la_compra() -> None:
    # Decisión 28: la guirnalda de la foto del usuario, alta a la izquierda, arqueada
    # por arriba y cayendo hacia la derecha. La v2 solo sabía caer y salía una U.
    plan_ = plan(guirnalda(mezcla="clasica", referencia_element_id="REF_01_E01"))
    sin = await resolver(
        plan_, completar_armados_guirnalda=True, pistas_guirnalda=[_pista_geometria()]
    )
    arriba = await resolver(
        plan_,
        completar_armados_guirnalda=True,
        pistas_guirnalda=[
            _pista_geometria(sentido_curva="arriba", flecha_relativa=0.1, desnivel_relativo=-0.25)
        ],
    )
    armado = cast(dict[str, object], estructura_del_plan(arriba)["armado_guirnalda"])
    assert (armado["forma"], armado["arqueo_m"], armado["desnivel_m"]) == ("curva", 0.25, -0.63)
    assert "caida_m" not in armado
    cuerda = _garland_cord(2.5, armado)
    # La misma parábola, reflejada: arquearse 0,25 m sobre la recta que baja 0,63 m
    # mide lo mismo que colgar 0,25 m bajo la que sube 0,63 m.
    assert cuerda == _garland_cord(
        2.5, {"forma": "arco_caido", "caida_m": 0.25, "desnivel_m": 0.63}
    )
    assert cuerda > math.hypot(2.5, 0.63)
    assert cast(list[dict[str, object]], arriba["estructuras"])[0]["eje_m"] == round(cuerda, 2)
    assert _unidades(arriba) > _unidades(sin) == 54, "la cuerda arqueada lleva más globos"
    resuelto = cast(list[dict[str, object]], arriba["armados_guirnalda"])[0]
    assert resuelto["globos_por_instancia"] == _unidades(arriba)
    assert (resuelto["largo_m"], resuelto["largo_cuerda_m"]) == (2.5, round(cuerda, 2))
    assert "bowing gently upward along the top" in str(resuelto["prompt_gemini"])
    assert "higher on the left, curving along the top and dropping lower at the right end" in str(
        resuelto["prompt_lora"]
    )
    otra = await resolver(cast(dict[str, object], arriba["plan"]))
    assert otra["plan_hash"] == arriba["plan_hash"], "punto fijo"
    # Hacia abajo, en cambio, cuelga en arco con su caída.
    abajo = await resolver(
        plan_,
        completar_armados_guirnalda=True,
        pistas_guirnalda=[
            _pista_geometria(sentido_curva="abajo", flecha_relativa=0.1, desnivel_relativo=-0.25)
        ],
    )
    colgada = cast(dict[str, object], estructura_del_plan(abajo)["armado_guirnalda"])
    assert (colgada["forma"], colgada["caida_m"], colgada["desnivel_m"]) == (
        "arco_caido",
        0.25,
        -0.63,
    )
    assert "arqueo_m" not in colgada
    # Sin sentido ni flecha (o en null), exactamente lo de antes.
    nulas = await resolver(
        plan_,
        completar_armados_guirnalda=True,
        pistas_guirnalda=[_pista_geometria(sentido_curva=None, flecha_relativa=None)],
    )
    assert nulas["plan_hash"] == sin["plan_hash"]


@pytest.mark.anyio
async def test_con_patron_la_cuerda_de_la_foto_es_punto_fijo() -> None:
    # El patrón por racimos (decisión 20) se completa sobre la compra de la cuerda.
    plan_ = plan(guirnalda(referencia_element_id="REF_01_E01", mezcla="clasica"))
    pista = _pista_geometria(caida_relativa=0.2, desnivel_relativo=-0.3)
    resuelto = await resolver(plan_, **AMBAS, pistas_guirnalda=[pista])
    armado = cast(dict[str, object], estructura_del_plan(resuelto)["armado_guirnalda"])
    assert (armado["forma"], armado["caida_m"], armado["desnivel_m"]) == ("arco_caido", 0.5, -0.75)
    assert _patron(resuelto)["globos_por_racimo"] == 3, "por racimos, con la unidad de la foto"
    racimos = cast(list[dict[str, object]], resuelto["armados_guirnalda"])[0]
    assert racimos["globos_por_instancia"] == _unidades(resuelto) > 48
    otra = await resolver(cast(dict[str, object], resuelto["plan"]))
    assert otra["plan_hash"] == resuelto["plan_hash"]


@pytest.mark.anyio
async def test_con_patron_la_foto_arqueada_es_punto_fijo() -> None:
    # Decisión 28, con el patrón por racimos de la foto del usuario (espiral de cuartetos).
    plan_ = plan(guirnalda(referencia_element_id="REF_01_E01"))
    pista = _pista_geometria(sentido_curva="arriba", flecha_relativa=0.1, desnivel_relativo=-0.25)
    resuelto = await resolver(plan_, **AMBAS, pistas_guirnalda=[pista])
    armado = cast(dict[str, object], estructura_del_plan(resuelto)["armado_guirnalda"])
    assert (armado["forma"], armado["arqueo_m"], armado["desnivel_m"]) == ("curva", 0.25, -0.63)
    racimos = cast(list[dict[str, object]], resuelto["armados_guirnalda"])[0]
    assert racimos["globos_por_instancia"] == _unidades(resuelto) > 48
    otra = await resolver(cast(dict[str, object], resuelto["plan"]))
    assert otra["plan_hash"] == resuelto["plan_hash"]


# --- Conteo de la foto (ADR-0031) y armado de la guirnalda ---------------------------------


def _conteo(**cambios: object) -> dict[str, object]:
    return {
        "referencia_element_id": "REF_01_E01",
        "globos_visibles": 40,
        "exacto": False,
        "estimado_total": None,
        "racimos": None,
        "globos_por_racimo": None,
        "por_tamano": [],
        "largo_relativo": None,
        "alto_relativo": None,
        "confianza": 0.8,
        **cambios,
    }


@pytest.mark.anyio
async def test_el_conteo_se_compara_con_la_cuerda_que_se_compra() -> None:
    # Una U invertida con caída: el conteo busca densidad y largo con el mismo
    # conteo que la resolución (la cuerda parabólica), no con el largo recto.
    colgada = _armado(forma="u_invertida", caida_m=0.8)
    plan_ = plan(
        guirnalda(mezcla="clasica", referencia_element_id="REF_01_E01", armado_guirnalda=colgada)
    )
    sin_conteo = await resolver(plan_)
    ajustado = await resolver(
        plan_, completar_conteos=True, pistas_conteo=[_conteo(estimado_total=81)]
    )
    [conteo] = cast(list[dict[str, object]], ajustado["conteos_referencia"])
    assert conteo["globos_antes"] == _unidades(sin_conteo) > 54, (
        "la cuenta de antes es la de la cuerda"
    )
    assert conteo["decision"] == "ajustado"
    assert abs(_unidades(ajustado) - 81) <= max(2, 0.15 * 81), "dentro de la tolerancia del conteo"
    assert conteo["globos_despues"] == _unidades(ajustado)
    estructura = estructura_del_plan(ajustado)
    assert estructura["armado_guirnalda"] == colgada, "el conteo no toca el armado"
    medidas = cast(dict[str, float], estructura["medidas"])
    eje = cast(list[dict[str, object]], ajustado["estructuras"])[0]["eje_m"]
    assert eje == round(_garland_cord(medidas["largo_m"], colgada), 2)
    assert not [
        a for a in cast(list[str], ajustado["advertencias"]) if a.startswith("puerta_fisica:")
    ]


@pytest.mark.anyio
async def test_con_medidas_del_cliente_el_conteo_se_compara_con_la_cuerda_de_la_foto() -> None:
    # Decisión 27: el conteo corre antes de completar el armado, pero cuenta la
    # guirnalda con la caída que la lectura le va a dar. Con las medidas del
    # cliente el largo no se mueve (tampoco por la caída): solo la densidad.
    plan_ = plan(guirnalda(mezcla="clasica", referencia_element_id="REF_01_E01"))
    pista = _pista_geometria(caida_relativa=0.3)
    con_caida = await resolver(plan_, completar_armados_guirnalda=True, pistas_guirnalda=[pista])
    assert _unidades(con_caida) > 54
    conteo = {"completar_conteos": True, "pistas_conteo": [_conteo(estimado_total=79)]}
    ajustado = await resolver(
        plan_, completar_armados_guirnalda=True, pistas_guirnalda=[pista], **conteo
    )
    [registro] = cast(list[dict[str, object]], ajustado["conteos_referencia"])
    assert registro["globos_antes"] == _unidades(con_caida), "la cuenta de antes es la de la cuerda"
    assert registro["decision"] == "ajustado"
    assert registro["globos_despues"] == _unidades(ajustado), "lo que el conteo eligió se compra"
    assert abs(_unidades(ajustado) - 79) <= 0.15 * 79
    estructura = estructura_del_plan(ajustado)
    assert estructura["medidas"] == {"largo_m": 2.5}
    armado = cast(dict[str, object], estructura["armado_guirnalda"])
    assert (armado["forma"], armado["caida_m"]) == ("arco_caido", 0.75)


@pytest.mark.anyio
async def test_sin_medidas_fijas_el_conteo_mueve_el_largo_y_la_caida_lo_sigue() -> None:
    # Un largo asumido que el conteo alarga: la caída se mide sobre el largo nuevo,
    # y la cuenta con que el conteo eligió ese largo es la de la cuerda que se compra.
    plan_ = {
        **plan(guirnalda(mezcla="clasica", referencia_element_id="REF_01_E01", medidas={})),
        "espacio": {"tipo": "salon", "fuente": "supuesto"},
    }
    pista = _pista_geometria(caida_relativa=0.3, desnivel_relativo=-0.2)
    ajustado = await resolver(
        plan_,
        completar_armados_guirnalda=True,
        pistas_guirnalda=[pista],
        completar_conteos=True,
        pistas_conteo=[_conteo(estimado_total=105)],
    )
    [registro] = cast(list[dict[str, object]], ajustado["conteos_referencia"])
    assert registro["decision"] == "ajustado"
    largo = cast(dict[str, float], estructura_del_plan(ajustado)["medidas"])["largo_m"]
    assert largo > 2.5, "el conteo alargó el largo asumido"
    armado = cast(dict[str, object], estructura_del_plan(ajustado)["armado_guirnalda"])
    assert armado["caida_m"] == round(0.3 * largo + 1e-9, 2)
    assert armado["desnivel_m"] == -round(0.2 * largo + 1e-9, 2)
    assert registro["globos_despues"] == _unidades(ajustado)
    assert abs(_unidades(ajustado) - 105) <= 0.15 * 105
    eje = cast(list[dict[str, object]], ajustado["estructuras"])[0]["eje_m"]
    assert eje == round(_garland_cord(largo, armado), 2)


@pytest.mark.anyio
async def test_un_largo_chico_sin_dato_del_cliente_lo_decide_el_conteo_con_la_cuerda() -> None:
    # Enmienda 2026-09-28 (ADR-0031): 0,5 m que el cliente no dio y la foto con
    # unos 75 globos. ±35 % no llega; la cantidad decide el largo, contado con
    # la cuerda que la caída y el desnivel de la lectura le van a dar.
    plan_ = {
        **plan(
            guirnalda(
                mezcla="clasica", referencia_element_id="REF_01_E01", medidas={"largo_m": 0.5}
            )
        ),
        "espacio": {"tipo": "salon", "fuente": "supuesto"},
    }
    pista = _pista_geometria(caida_relativa=0.3, desnivel_relativo=-0.2)
    lectura = {"completar_conteos": True, "pistas_conteo": [_conteo(estimado_total=75)]}
    ajustado = await resolver(
        plan_, completar_armados_guirnalda=True, pistas_guirnalda=[pista], **lectura
    )
    recto = await resolver(plan_, **lectura)
    [registro] = cast(list[dict[str, object]], ajustado["conteos_referencia"])
    assert registro["decision"] == "ajustado"
    largo = cast(dict[str, float], estructura_del_plan(ajustado)["medidas"])["largo_m"]
    largo_recto = cast(dict[str, float], estructura_del_plan(recto)["medidas"])["largo_m"]
    assert 0.5 * 1.35 < largo < largo_recto, "la cuerda colgada pide menos largo que la recta"
    armado = cast(dict[str, object], estructura_del_plan(ajustado)["armado_guirnalda"])
    assert armado["caida_m"] == round(0.3 * largo + 1e-9, 2)
    eje = cast(list[dict[str, object]], ajustado["estructuras"])[0]["eje_m"]
    assert eje == round(_garland_cord(largo, armado), 2)
    assert registro["globos_despues"] == _unidades(ajustado)
    assert abs(_unidades(ajustado) - 75) <= 0.15 * 75


@pytest.mark.anyio
async def test_la_cantidad_sale_del_conteo_y_la_distribucion_de_la_lectura() -> None:
    plan_ = plan(guirnalda(mezcla="clasica", referencia_element_id="REF_01_E01"))
    conteo = {"completar_conteos": True, "pistas_conteo": [_conteo(estimado_total=60)]}
    solo_conteo = await resolver(plan_, completar_armados_guirnalda=True, **conteo)
    con_lectura = await resolver(
        plan_, completar_armados_guirnalda=True, pistas_guirnalda=[_pista()], **conteo
    )
    assert abs(_unidades(con_lectura) - 60) <= max(2, 0.15 * 60), "la cantidad es del conteo"
    assert lineas(con_lectura) == lineas(solo_conteo)
    assert _total(con_lectura) == _total(solo_conteo), "la lectura no cambia lo que se compra"
    armado = cast(dict[str, object], estructura_del_plan(con_lectura)["armado_guirnalda"])
    assert (armado["origen"], armado["soporte"], armado["forma"]) == (
        "referencia",
        "mesa",
        "ondulada",
    )
    assert cast(dict[str, object], estructura_del_plan(solo_conteo)["armado_guirnalda"])[
        "origen"
    ] == ("sugerido")
    resuelto = cast(list[dict[str, object]], con_lectura["armados_guirnalda"])[0]
    assert resuelto["globos_por_instancia"] == _unidades(con_lectura)


# --- Al confirmar: receta → patrón por racimos → receta (ADR-0032, decisión 20) --------------

UNIDAD_K = {"trio": 3, "cuarteto": 4, "quinteto": 5}
AMBAS = {"completar_patrones": True, "completar_armados_guirnalda": True}


def _patron(resuelto: Mapping[str, object]) -> dict[str, object]:
    return cast(dict[str, object], estructura_del_plan(resuelto)["patron_color"])


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("densidad", "unidad"), [("sencilla", "trio"), ("media", "cuarteto"), ("lujosa", "quinteto")]
)
async def test_una_guirnalda_nueva_con_las_dos_banderas_va_por_racimos(
    densidad: str, unidad: str
) -> None:
    resuelto = await resolver(plan(guirnalda(densidad=densidad, mezcla="clasica")), **AMBAS)
    armado = cast(dict[str, object], estructura_del_plan(resuelto)["armado_guirnalda"])
    patron = _patron(resuelto)
    assert cast(dict[str, object], armado["racimo"])["unidad"] == unidad, (
        "la unidad es la de la receta"
    )
    assert cast(dict[str, object], patron["base"])["modo"] in ("espiral", "anillos")
    assert patron["globos_por_racimo"] == UNIDAD_K[unidad]
    resueltos = cast(list[dict[str, object]], resuelto["armados_guirnalda"])
    assert all(
        len(cast(list[int], r["codigos"])) == UNIDAD_K[unidad]
        for r in cast(list[dict[str, object]], resueltos[0]["racimos"])
    )


@pytest.mark.anyio
async def test_el_armado_no_cambia_la_compra_del_patron_por_racimos() -> None:
    resuelto = await resolver(plan(guirnalda()), **AMBAS)
    firmado = cast(dict[str, object], resuelto["plan"])
    sin_armado = {
        **firmado,
        "estructuras": [
            _sin_armado_guirnalda(e) for e in cast(list[dict[str, object]], firmado["estructuras"])
        ],
    }
    quitado = await resolver(sin_armado)
    assert _total(quitado) == _total(resuelto) and lineas(quitado) == lineas(resuelto)
    # En esta guirnalda (0,6/0,4) el reparto por color tampoco cambia los paquetes.
    assert _total(resuelto) == _total(await resolver(plan(guirnalda()), completar_patrones=True))


def _sin_armado_guirnalda(estructura: Mapping[str, object]) -> dict[str, object]:
    return {k: v for k, v in estructura.items() if k != "armado_guirnalda"}


@pytest.mark.anyio
async def test_el_patron_por_racimos_es_punto_fijo() -> None:
    primera = await resolver(plan(guirnalda(densidad="sencilla", mezcla="clasica")), **AMBAS)
    segunda = await resolver(cast(dict[str, object], primera["plan"]))
    assert segunda["plan_hash"] == primera["plan_hash"]
    assert segunda["patrones_color"] == primera["patrones_color"]
    assert segunda["armados_guirnalda"] == primera["armados_guirnalda"]


@pytest.mark.anyio
async def test_sin_las_dos_banderas_todo_es_como_antes() -> None:
    base = await resolver(plan(guirnalda(densidad="sencilla", mezcla="clasica")))
    explicito = await resolver(
        plan(guirnalda(densidad="sencilla", mezcla="clasica")),
        completar_patrones=False,
        completar_armados_guirnalda=False,
    )
    assert base == {**explicito, "request_id": base["request_id"]}
    solo_patron = await resolver(
        plan(guirnalda(densidad="sencilla", mezcla="clasica")), completar_patrones=True
    )
    assert cast(dict[str, object], _patron(solo_patron)["base"])["modo"] == "espiral"
    assert (
        "globos_por_racimo" not in _patron(solo_patron) and "armados_guirnalda" not in solo_patron
    )
    solo_armado = await resolver(
        plan(guirnalda(densidad="sencilla", mezcla="clasica")), completar_armados_guirnalda=True
    )
    estructura = estructura_del_plan(solo_armado)
    assert "patron_color" not in estructura
    assert (
        cast(dict[str, object], cast(dict[str, object], estructura["armado_guirnalda"])["racimo"])[
            "unidad"
        ]
        == "trio"
    )


@pytest.mark.anyio
async def test_un_patron_declarado_no_se_vuelve_a_sugerir() -> None:
    declarado = {
        "version": "patron-color.v1",
        "origen": "decorador",
        "base": {
            "modo": "aleatorio",
            "pesos": [{"material": 0, "peso": 50}, {"material": 1, "peso": 50}],
            "semilla": 7,
        },
    }
    resuelto = await resolver(plan(guirnalda(densidad="sencilla", patron_color=declarado)), **AMBAS)
    assert _patron(resuelto)["base"] == declarado["base"]
    armado = cast(dict[str, object], estructura_del_plan(resuelto)["armado_guirnalda"])
    assert cast(dict[str, object], armado["racimo"])["unidad"] == "cuarteto", (
        "la unidad de su rejilla"
    )


@pytest.mark.anyio
async def test_si_el_patron_por_racimos_no_cabe_se_degrada_con_aviso(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original = plan_module.sugerir_patron

    def sin_racimos(estructura: object) -> dict[str, object]:
        if getattr(estructura, "racimo_armado", None) is not None:
            raise PatronColorInvalido("prueba", "El patrón por racimos no cabe.")
        return cast(dict[str, object], original(estructura))

    monkeypatch.setattr(plan_module, "sugerir_patron", sin_racimos)
    resuelto = await resolver(plan(guirnalda(densidad="sencilla", mezcla="clasica")), **AMBAS)
    assert cast(dict[str, object], _patron(resuelto)["base"])["modo"] == "espiral"
    armado = cast(dict[str, object], estructura_del_plan(resuelto)["armado_guirnalda"])
    assert cast(dict[str, object], armado["racimo"])["unidad"] == "cuarteto"
    supuestos = cast(list[str], cast(dict[str, object], resuelto["plan"])["supuestos"])
    assert any("patrón por racimos no cabe" in s for s in supuestos)


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


def test_la_cuerda_desnivelada_es_la_parabola_entre_dos_alturas() -> None:
    # Decisión 27. y = x² de (0, 0) a (1, 1) baja 0,25 bajo la recta y = x a mitad
    # de tramo: su largo es √5/2 + asinh(2)/4 = 1,4789…, un valor de libro.
    exacta = math.sqrt(5) / 2 + math.asinh(2) / 4
    sube = {"forma": "arco_caido", "caida_m": 0.25, "desnivel_m": 1}
    assert _garland_cord(1, sube) == pytest.approx(exacta, rel=1e-12)
    assert _garland_cord(1, {**sube, "desnivel_m": -1}) == pytest.approx(exacta, rel=1e-12), (
        "cae hacia la derecha o hacia la izquierda: el mismo largo"
    )
    # Sin desnivel, byte a byte la fórmula de antes (vectores dorados); con uno que
    # tiende a cero, tiende a ella.
    nivelada = {"forma": "arco_caido", "caida_m": 0.3}
    half = 1.25
    antes = math.sqrt(half * half + 4 * 0.3 * 0.3) + half * half / (2 * 0.3) * math.asinh(
        2 * 0.3 / half
    )
    assert _garland_cord(2.5, nivelada) == antes
    assert _garland_cord(2.5, {**nivelada, "desnivel_m": 1e-7}) == pytest.approx(antes, rel=1e-9)
    # Una U invertida de 1,5 m con 2,2 m de caída: la misma de siempre con desnivel 0.
    u = {"forma": "u_invertida", "caida_m": 2.2}
    assert _garland_cord(1.5, {**u, "desnivel_m": 1e-7}) == pytest.approx(4.78, abs=0.01)
    # Sin caída, la recta inclinada entre los extremos, en cualquier forma.
    for forma in ("recta", "curva", "ondulada", "arco_caido"):
        assert _garland_cord(2.5, {"forma": forma, "desnivel_m": -0.6}) == pytest.approx(
            math.hypot(2.5, 0.6)
        )
    # Colgada de tres puntos sobre la recta inclinada: dos tramos, cada uno con la
    # mitad del desnivel y la misma caída.
    tres = {"forma": "arco_caido", "caida_m": 0.3, "desnivel_m": -0.6, "puntos_de_anclaje": 3}
    tramo = {"forma": "arco_caido", "caida_m": 0.3, "desnivel_m": -0.3}
    assert _garland_cord(3, tres) == pytest.approx(2 * _garland_cord(1.5, tramo), rel=1e-12)
    # Más larga que la nivelada con la misma caída y que la recta inclinada.
    desnivelada = _garland_cord(2.5, {**nivelada, "desnivel_m": -0.6})
    assert desnivelada > max(_garland_cord(2.5, nivelada), math.hypot(2.5, 0.6))
    # Una forma que no cuelga no toma la caída, pero sí el desnivel.
    assert _garland_cord(2.5, {"forma": "ondulada", "caida_m": 0.5, "desnivel_m": -0.6}) == (
        pytest.approx(math.hypot(2.5, 0.6))
    )


def test_la_cuerda_arqueada_es_la_misma_parabola_reflejada() -> None:
    # Decisión 28: y = x² de (0, 0) a (1, 1), reflejada, es y = 2x - x²: se arquea 0,25
    # sobre la recta y = x. El mismo valor de libro, √5/2 + asinh(2)/4.
    exacta = math.sqrt(5) / 2 + math.asinh(2) / 4
    arriba = {"forma": "curva", "arqueo_m": 0.25, "desnivel_m": 1}
    assert _garland_cord(1, arriba) == pytest.approx(exacta, rel=1e-12)
    assert _garland_cord(1, {**arriba, "desnivel_m": -1}) == pytest.approx(exacta, rel=1e-12)
    # Simétrica en el signo de la flecha: el mismo largo a cualquier lado de la recta,
    # nivelada (la fórmula de antes, exacta) o desnivelada.
    for desnivel in (None, -0.9, -0.3, 0.4):
        extra = {} if desnivel is None else {"desnivel_m": desnivel}
        espejo = {} if desnivel is None else {"desnivel_m": -desnivel}
        sobre = _garland_cord(3.5, {"forma": "curva", "arqueo_m": 0.35, **extra})
        bajo = _garland_cord(3.5, {"forma": "arco_caido", "caida_m": 0.35, **espejo})
        assert sobre == bajo
        assert sobre == pytest.approx(
            _garland_cord(3.5, {"forma": "arco_caido", "caida_m": 0.35, **extra}), rel=1e-12
        )
        assert sobre > (3.5 if desnivel is None else math.hypot(3.5, desnivel))
    # Solo una curva se arquea: en otra forma el arqueo no cuenta, y sin él la curva
    # es la de siempre (el largo o la recta inclinada).
    assert _garland_cord(2.5, {"forma": "recta", "arqueo_m": 0.3}) == 2.5
    assert _garland_cord(2.5, {"forma": "curva"}) == 2.5
    assert _garland_cord(2.5, {"forma": "curva", "desnivel_m": -0.6}) == pytest.approx(
        math.hypot(2.5, 0.6)
    )


@pytest.mark.anyio
async def test_la_caida_alarga_la_cuerda_y_el_conteo_la_sigue() -> None:
    recta = await resolver(plan(guirnalda(mezcla="clasica", armado_guirnalda=_armado())))
    colgada = _armado(soporte="colgada", forma="arco_caido", caida_m=0.8, puntos_de_anclaje=2)
    caida = await resolver(plan(guirnalda(mezcla="clasica", armado_guirnalda=colgada)))
    cuerda = _garland_cord(2.5, colgada)
    estructura = cast(list[dict[str, object]], caida["estructuras"])[0]
    assert estructura["eje_m"] == round(cuerda, 2)
    assert _unidades(caida) > _unidades(recta) == 54
    assert _unidades(caida) == pytest.approx(54 * cuerda / 2.5, rel=0.05)
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
