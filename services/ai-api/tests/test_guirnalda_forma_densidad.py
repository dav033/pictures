"""Cada guirnalda con su camino, su forma y su densidad (2026-10-04).

- La **clásica** («Racimos de cuatro globos iguales en línea») no la arma el motor orgánico: la cuenta la fórmula
  y la reparte en racimos el armado por partes (ADR-0032), con la unidad de su densidad (tríos, cuartetos,
  quintetos). Cotización y guía salen de la misma resolución.
- La **orgánica** toma su línea del armado por partes que trae (recta, curva, ondulada, U invertida, arco caído)
  y su volumen del estilo del motor para su densidad (ligero / estándar / lleno).
- Una orgánica **sin armado del motor** la cuenta la fórmula (decisión del dueño del 2026-10-05, que deshizo la
  cuenta por la receta del motor del 2026-10-04) y la guía la dibuja por racimos sobre esa compra. La receta es
  lo que la confirmación le escribe; ya guardada, la cuenta el motor.

Criterios: ``clasificador-decoraciones/docs/investigacion-guirnalda.md`` (§ Guirnalda en un plan).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, cast

import pytest

from app.armado_estructura import (
    OMOIKANE_ARMADO_SCOPE,
    ArmadoEstructuraRequest,
    armado_guirnalda_de_receta,
    completar,
)
from app.armado_guirnalda import linea_del_motor
from app.guia_escena import pieza_de_guia
from app.guirnalda.formas import ESTILOS_GUIR, FORMAS_GUIRNALDA
from app.plan import contar_pieza, pieza_del_motor_resuelta, vista_previa_de_armado_guirnalda
from tests.guirnalda_datos import GUIRNALDA, guirnalda, plan

CONTEXTO: dict[str, object] = {
    "schema_version": "operational.v1",
    "request_id": "00000000-0000-4000-8000-0000000000b7",
    "correlation_id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
    "deadline_at": "2030-01-01T00:00:00Z",
    "deadline_ms": 5000,
    "scopes": [OMOIKANE_ARMADO_SCOPE],
    "body_sha256": "0" * 64,
}

#: Las cinco formas del armado por partes, con la geometría que cada una declara.
FORMAS: dict[str, dict[str, object]] = {
    "recta": {},
    "curva": {"arqueo_m": 0.3},
    "ondulada": {},
    "u_invertida": {"caida_m": 0.8},
    "arco_caido": {"caida_m": 0.5, "puntos_de_anclaje": 3},
}


def _por_partes(forma: str) -> dict[str, object]:
    return {
        "version": "armado-guirnalda.v1",
        "origen": "decorador",
        "soporte": "pared",
        "forma": forma,
        "racimo": {"unidad": "cuarteto", "tamano_pulg_base": 12},
        "relleno": None,
        "remates": [],
        **FORMAS[forma],
    }


def _completados(*estructuras: dict[str, object]) -> list[dict[str, Any]]:
    peticion = ArmadoEstructuraRequest(
        context=cast(Any, CONTEXTO),
        schema_version="omoikane-armado-estructura.v1",
        accion="completar",
        plan=plan(*estructuras),
    )
    return cast(list[dict[str, Any]], completar(peticion)["armados"])


def _armado_de(estructura: dict[str, object]) -> dict[str, Any]:
    [completado] = _completados(estructura)
    assert completado["clave"] == "armado_guirnalda_organica"
    return cast(dict[str, Any], completado["armado"])


def _discos(estructura: Mapping[str, object]) -> list[dict[str, Any]]:
    pieza = pieza_de_guia(estructura, ())
    assert not isinstance(pieza, str), pieza
    return cast(list[dict[str, Any]], pieza["discos"])


# --- La clásica ---------------------------------------------------------------------------------------


@pytest.mark.parametrize("forma", [None, *FORMAS])
def test_la_clasica_no_la_arma_el_motor_organico(forma: str | None) -> None:
    extra = {} if forma is None else {"armado_guirnalda": _por_partes(forma)}
    clasica = guirnalda(mezcla="clasica", **extra)

    assert _completados(clasica) == []
    assert pieza_del_motor_resuelta(clasica) is None
    contada = contar_pieza(clasica)
    assert contada.fuente == "formula"
    # La guía la dibuja por racimos con exactamente lo que se cotiza.
    assert len(_discos(clasica)) == contada.total_vigente


@pytest.mark.parametrize(
    ("densidad", "unidad"), [("sencilla", "trio"), ("media", "cuarteto"), ("lujosa", "quinteto")]
)
def test_la_densidad_de_la_clasica_es_su_unidad_de_racimo(densidad: str, unidad: str) -> None:
    vista = vista_previa_de_armado_guirnalda(
        plan(guirnalda(mezcla="clasica", densidad=densidad)), GUIRNALDA, None
    )
    armado = cast(Mapping[str, Any], vista.armado["armado"])
    assert armado["racimo"]["unidad"] == unidad


def test_la_clasica_mas_densa_nunca_lleva_menos_globos() -> None:
    totales = [
        contar_pieza(guirnalda(mezcla="clasica", densidad=d)).total_vigente
        for d in ("sencilla", "media", "lujosa")
    ]
    assert totales == sorted(totales) and totales[0] < totales[-1]


# --- La forma de la orgánica --------------------------------------------------------------------------


def test_cada_forma_va_a_la_linea_del_motor() -> None:
    ondulada = next(f for f in FORMAS_GUIRNALDA if f.id == "ondulada").forma
    assert linea_del_motor(_por_partes("recta")) == {"pendienteM": 0.0}
    assert linea_del_motor(_por_partes("ondulada")) == {
        "pendienteM": 0.0,
        "ondaM": ondulada["ondaM"],
        "ondas": ondulada["ondas"],
    }
    assert linea_del_motor(_por_partes("arco_caido")) == {
        "pendienteM": 0.0,
        "colgadoM": 0.5,
        "festones": 2.0,
    }
    assert linea_del_motor(_por_partes("u_invertida")) == {"pendienteM": 0.0, "colgadoM": -0.8}
    assert linea_del_motor(_por_partes("curva")) == {"pendienteM": 0.0, "colgadoM": -0.3}
    assert linea_del_motor({**_por_partes("recta"), "desnivel_m": 0.4})["pendienteM"] == 0.4


def test_cada_forma_de_la_organica_tiene_su_propia_guirnalda() -> None:
    firmas: dict[str, tuple[tuple[float, float, float], ...]] = {}
    for forma in FORMAS:
        estructura = guirnalda(armado_guirnalda=_por_partes(forma))
        armado = _armado_de(estructura)
        linea = _armado_de(guirnalda())["forma"]
        if forma == "recta":
            # La recta es la línea de partida del motor: la misma guirnalda que sin forma.
            assert armado["forma"] == linea
        else:
            assert armado["forma"] != linea
        assert armado["forma"]["festones"] == (2 if forma == "arco_caido" else 1)
        # La mezcla de tamaños sigue siendo la del plan, no la de una forma lista.
        assert armado["tamanos"]["mezcla"] == _armado_de(guirnalda())["tamanos"]["mezcla"]
        con_armado = {**estructura, "armado_guirnalda_organica": armado}
        discos = _discos(con_armado)
        assert len(discos) == contar_pieza(con_armado).total_vigente
        firmas[forma] = tuple((d["x_m"], d["y_m"], d["r_m"]) for d in discos)
    assert len(set(firmas.values())) == len(FORMAS)


def test_la_u_invertida_arquea_hacia_arriba_y_el_arco_caido_cuelga() -> None:
    u = _armado_de(guirnalda(armado_guirnalda=_por_partes("u_invertida")))["forma"]
    caido = _armado_de(guirnalda(armado_guirnalda=_por_partes("arco_caido")))["forma"]
    assert u["colgadoM"] < 0 < caido["colgadoM"]


# --- La densidad de la orgánica -----------------------------------------------------------------------


def test_la_densidad_de_la_organica_es_el_estilo_del_motor() -> None:
    estilos = {e.id: e for e in ESTILOS_GUIR}
    media = _armado_de(guirnalda())
    for densidad, estilo in (("sencilla", "ligero"), ("lujosa", "lleno")):
        armado = _armado_de(guirnalda(densidad=densidad))
        esperado = estilos[estilo].aplicar(cast(Any, {"volumen": dict(media["volumen"])}))
        assert armado["volumen"] == esperado["volumen"]
        # Solo el volumen: la línea y la mezcla son las de la media.
        assert armado["forma"] == media["forma"]
        assert armado["tamanos"] == media["tamanos"]


def _con_su_receta(estructura: dict[str, object]) -> dict[str, object]:
    """La guirnalda con la receta del motor que le escribe la confirmación, guardada: la cuenta el motor."""
    return {**estructura, "armado_guirnalda_organica": _armado_de(estructura)}


def test_la_organica_mas_densa_nunca_lleva_menos_globos() -> None:
    for mezcla in ("organica_fina", "organica_gruesa", "solo_grandes"):
        totales = [
            contar_pieza(_con_su_receta(guirnalda(mezcla=mezcla, densidad=d))).total_vigente
            for d in ("sencilla", "media", "lujosa")
        ]
        assert totales == sorted(totales) and totales[0] < totales[-1], mezcla


def test_la_lujosa_que_pasaria_del_tope_va_con_el_volumen_estandar() -> None:
    larga = {"largo_m": 6.0}
    [lujosa] = _completados(guirnalda(densidad="lujosa", medidas=larga))
    [media] = _completados(guirnalda(densidad="media", medidas=larga))
    assert lujosa["armado"]["volumen"] == media["armado"]["volumen"]
    assert any("densidad lujosa" in aviso for aviso in lujosa["avisos"])
    # Y nunca menos globos que la media, contadas por el motor con ese armado guardado.
    con_lujosa = {
        **guirnalda(densidad="lujosa", medidas=larga),
        "armado_guirnalda_organica": lujosa["armado"],
    }
    con_media = {
        **guirnalda(densidad="media", medidas=larga),
        "armado_guirnalda_organica": media["armado"],
    }
    assert contar_pieza(con_lujosa).total_vigente >= contar_pieza(con_media).total_vigente


# --- La orgánica sin armado ---------------------------------------------------------------------------


@pytest.mark.parametrize("forma", [None, "ondulada", "arco_caido"])
def test_sin_armado_la_cuenta_la_formula_y_la_receta_es_la_de_la_confirmacion(
    forma: str | None,
) -> None:
    """Sin armado del motor, la fórmula; la guía la dibuja por racimos con exactamente lo que se compra.

    Del 2026-10-04 al 2026-10-05 la resolución la armaba con la receta del motor (lujosa de 2,5 m: 204 globos)
    y contar la foto sobre ella tardaba minutos; el dueño lo revirtió. La receta sigue siendo la que la
    confirmación le escribe, y con ella guardada cuenta el motor y la guía lo dibuja.
    """
    extra = {} if forma is None else {"armado_guirnalda": _por_partes(forma)}
    estructura = guirnalda(**extra)

    assert armado_guirnalda_de_receta(estructura) == _armado_de(estructura)
    contada = contar_pieza(estructura)
    assert (contada.fuente, contada.total_motor) == ("formula", None)
    assert pieza_del_motor_resuelta(estructura) is None
    pieza = pieza_de_guia(estructura, ())
    assert not isinstance(pieza, str) and pieza["fuente"] == "dibujo"
    assert len(cast(list[object], pieza["discos"])) == contada.total_vigente

    armada = _con_su_receta(estructura)
    del_motor = contar_pieza(armada)
    assert del_motor.fuente == "motor"
    pieza = pieza_de_guia(armada, ())
    assert not isinstance(pieza, str) and pieza["fuente"] == "motor"
    assert len(cast(list[object], pieza["discos"])) == del_motor.total_vigente


def test_la_receta_no_es_para_lo_que_no_es_una_organica_sin_armado() -> None:
    assert armado_guirnalda_de_receta(guirnalda(mezcla="clasica")) is None
    con_armado = guirnalda()
    con_armado["armado_guirnalda_organica"] = _armado_de(guirnalda())
    assert armado_guirnalda_de_receta(con_armado) is None
    techo = guirnalda(estructura_oficial="techo_globos", ubicacion="techo")
    assert armado_guirnalda_de_receta(techo) is None
