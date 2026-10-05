"""La guirnalda clásica y el arco de patrón en la guía de escena (``app/guia_piezas/clasica.py``).

- **La guirnalda clásica** (mezcla ``clasica`` o con armado por partes, sin armado del motor) sale con los
  globos que el plan compra, racimo por racimo, con el color que el patrón le pone a cada globo.
- **El arco que solo trae su patrón** ya no es de este módulo: lo arma la resolución del plan con el motor del
  arco clásico (``plan.armado_arco_de_patron``), con los colores en el orden del patrón, y la guía lo dibuja
  por la puerta del motor con **los mismos globos que se cotizan**.
- Lo que no es de este módulo devuelve ``None``, y todo es determinista.
"""

from __future__ import annotations

import asyncio
from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any, cast

import pytest

from app.guia_escena import PlanGuiaEscenaRequest, guia_escena, hex_del_material, pieza_de_guia
from app.guia_piezas import clasica
from app.guia_piezas.clasica import globos_de
from app.plan import pieza_del_motor_resuelta, vista_previa_de_armado_guirnalda
from tests.guirnalda_datos import lineas, material, plan, resolver

GUIRNALDA = "EST_01_GUIRNALDA"
ARCO = "EST_02_ARCO"


def _materiales(*colores: str) -> list[dict[str, object]]:
    parte = round(1 / len(colores), 4)
    return [material(color, parte, principal=i == 0) for i, color in enumerate(colores)]


def _pieza(
    estructura_id: str,
    tipo: str,
    oficial: str | None,
    medidas: Mapping[str, float],
    colores: Sequence[str] = ("rosado", "blanco"),
    mezcla: str = "clasica",
    **extra: object,
) -> dict[str, object]:
    pieza: dict[str, object] = {
        "estructura_id": estructura_id,
        "nombre": estructura_id,
        "tipo": tipo,
        "rol_escena": "focal",
        "ubicacion": "fondo_pared",
        "medidas": dict(medidas),
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": mezcla,
        "materiales": _materiales(*colores),
        "porque": "Pieza de prueba.",
        **extra,
    }
    if oficial is not None:
        pieza["estructura_oficial"] = oficial
    return pieza


def _guirnalda(colores: Sequence[str] = ("rosado", "blanco"), **extra: object) -> dict[str, object]:
    return _pieza(GUIRNALDA, "guirnalda", "guirnalda", {"largo_m": 2.5}, colores, **extra)


def _arco(
    colores: Sequence[str] = ("rosado", "blanco", "dorado"), **extra: object
) -> dict[str, object]:
    return _pieza(ARCO, "arco", "arco", {"ancho_m": 3, "alto_m": 2.4}, colores, **extra)


def _patron(base: Mapping[str, object], **extra: object) -> dict[str, object]:
    return {"version": "patron-color.v1", "origen": "decorador", "base": dict(base), **extra}


def _armado(forma: str, **extra: object) -> dict[str, object]:
    return {
        "version": "armado-guirnalda.v1",
        "origen": "decorador",
        "soporte": "pared",
        "forma": forma,
        "racimo": {"unidad": "cuarteto", "tamano_pulg_base": 12},
        "relleno": None,
        "remates": [],
        **extra,
    }


ANILLOS = _patron({"modo": "anillos", "secuencia": [0, 1, 2], "largo": 1})
ESPIRAL = _patron({"modo": "espiral", "racimo": [0, 1, 0, 1], "trazo": "espiral"})


def _colores(estructura: Mapping[str, object]) -> list[str]:
    return [
        hex_del_material(m) for m in cast(Sequence[Mapping[str, object]], estructura["materiales"])
    ]


def _globos(estructura: Mapping[str, object]) -> list[tuple[float, float, float, str]]:
    globos = globos_de(estructura, _colores(estructura))
    assert globos, estructura["estructura_id"]
    return globos


def _racimos(globos: Sequence[tuple[float, float, float, str]]) -> list[list[str]]:
    """En una guirnalda recta, cada racimo es una columna de globos con la misma ``x``: de izquierda a derecha."""
    por_x: dict[float, list[str]] = {}
    for x, _y, _r, tono in globos:
        por_x.setdefault(round(x, 6), []).append(tono)
    return [por_x[x] for x in sorted(por_x)]


def _comprados(estructura: dict[str, object]) -> Counter[str]:
    """Lo que la resolución del plan compra de la pieza, por color del globo inflado."""
    resuelto = asyncio.run(resolver(plan(estructura)))
    hex_por_color = {
        str(m["color"]): hex_del_material(m)
        for m in cast(Sequence[Mapping[str, object]], estructura["materiales"])
    }
    cuenta: Counter[str] = Counter()
    for linea in lineas(resuelto):
        cuenta[hex_por_color[str(linea["color"])]] += int(cast(int, linea["unidades"]))
    return cuenta


# --- Qué estructuras caían a `sin_dibujo` ---------------------------------------------------------------


@pytest.mark.parametrize(
    "estructura",
    [
        _guirnalda(),
        _guirnalda(patron_color=ANILLOS, colores=("rosado", "blanco", "dorado")),
        _pieza(GUIRNALDA, "guirnalda", None, {"largo_m": 2.5}),
    ],
    ids=["receta", "patron", "sin-oficial"],
)
def test_lo_que_caia_sin_dibujo_ahora_tiene_discos(estructura: dict[str, object]) -> None:
    # Sin armado del motor, la puerta de la resolución no la arma y no tiene dibujo esquemático.
    assert pieza_del_motor_resuelta(estructura) is None

    pieza = pieza_de_guia(estructura, ())

    assert not isinstance(pieza, str), pieza
    assert pieza["fuente"] == "dibujo"
    discos = cast(list[dict[str, Any]], pieza["discos"])
    assert discos and all(0.01 < d["r_m"] < 0.5 for d in discos)
    # El marco local de la guía: abajo en 0 y centrado.
    assert min(d["y_m"] - d["r_m"] for d in discos) == pytest.approx(0, abs=1e-3)
    izquierda = min(d["x_m"] - d["r_m"] for d in discos)
    derecha = max(d["x_m"] + d["r_m"] for d in discos)
    assert izquierda == pytest.approx(-derecha, abs=1e-3)
    assert {d["hex"] for d in discos} <= set(_colores(estructura))


# --- La guirnalda clásica ------------------------------------------------------------------------------


def test_la_guirnalda_tiene_exactamente_lo_que_el_plan_compra() -> None:
    for estructura in (
        _guirnalda(colores=("dorado", "blanco")),
        _guirnalda(patron_color=ANILLOS, colores=("rosado", "blanco", "dorado")),
        _guirnalda(patron_color=ESPIRAL),
    ):
        comprado = _comprados(estructura)
        globos = _globos(estructura)

        assert Counter(tono for *_xyr, tono in globos) == comprado, estructura.get("patron_color")


def test_cada_racimo_lleva_los_colores_del_patron_en_su_orden() -> None:
    rosado, blanco, dorado = _colores(_guirnalda(colores=("rosado", "blanco", "dorado")))

    anillos = _racimos(
        _globos(_guirnalda(patron_color=ANILLOS, colores=("rosado", "blanco", "dorado")))
    )
    # Anillos de un racimo por color, en el orden de la secuencia, de izquierda a derecha.
    assert all(len(set(racimo)) == 1 for racimo in anillos)
    assert [racimo[0] for racimo in anillos] == [
        (rosado, blanco, dorado)[i % 3] for i in range(len(anillos))
    ]

    al_reves = _racimos(
        _globos(
            _guirnalda(
                patron_color=_patron({"modo": "anillos", "secuencia": [2, 0, 1], "largo": 1}),
                colores=("rosado", "blanco", "dorado"),
            )
        )
    )
    assert [racimo[0] for racimo in al_reves[:3]] == [dorado, rosado, blanco]

    # La espiral: cada cuarteto lleva los dos colores, dos y dos.
    espiral = _racimos(_globos(_guirnalda(patron_color=ESPIRAL)))
    assert all(sorted(Counter(racimo).values()) == [2, 2] for racimo in espiral)


def test_los_racimos_son_cuartetos_de_la_columna_clasica_a_lo_largo() -> None:
    estructura = _guirnalda()
    resuelto = vista_previa_de_armado_guirnalda(plan(estructura), GUIRNALDA, None).armado
    racimos = cast(list[Mapping[str, Any]], resuelto["racimos"])
    sueltos = sum(int(s["cantidad"]) for s in cast(list[Mapping[str, Any]], resuelto["sueltos"]))

    globos = _globos(estructura)

    # Los sueltos van entre racimos: los de los racimos son los cuartetos, uno por columna de la línea recta.
    en_racimos = [racimo for racimo in _racimos(globos) if len(racimo) == 4]
    assert len(en_racimos) == len(racimos)
    assert len(globos) == 4 * len(racimos) + sueltos
    # A lo largo: más ancha que alta, y del largo del plan (más el medio globo de cada punta).
    ancho = max(x + r for x, _y, r, _t in globos) - min(x - r for x, _y, r, _t in globos)
    alto = max(y + r for _x, y, r, _t in globos) - min(y - r for _x, y, r, _t in globos)
    assert 2.5 <= ancho <= 2.5 + 0.35 and alto < ancho / 3


def test_la_forma_del_armado_por_partes_dobla_la_linea() -> None:
    def alto(armado: Mapping[str, object]) -> float:
        globos = _globos(_guirnalda(armado_guirnalda=dict(armado)))
        return max(y + r for _x, y, r, _t in globos) - min(y - r for _x, y, r, _t in globos)

    recta = alto(_armado("recta"))
    # La línea se dobla tanto como dice el armado; los racimos la muestrean y en las puntas inclinadas el
    # anillo se tumba con ella, así que el alto del conjunto se acerca a la flecha sin ser exacto.
    assert alto(_armado("arco_caido", caida_m=0.5)) == pytest.approx(recta + 0.5, abs=0.15)
    assert alto(_armado("u_invertida", caida_m=0.8)) == pytest.approx(recta + 0.8, abs=0.15)
    assert alto(_armado("curva", arqueo_m=0.3)) == pytest.approx(recta + 0.3, abs=0.15)
    assert alto(_armado("ondulada")) > recta + 0.3

    # Festones entre tres puntos: dos U, con el punto del medio arriba.
    globos = _globos(
        _guirnalda(armado_guirnalda=_armado("arco_caido", caida_m=0.5, puntos_de_anclaje=3))
    )

    def altura_en(x: float) -> float:
        return sum(y for gx, y, _r, _t in globos if abs(gx - x) < 0.15) / max(
            1, sum(1 for gx, _y, _r, _t in globos if abs(gx - x) < 0.15)
        )

    assert altura_en(0.625) < altura_en(1.25) - 0.2
    assert altura_en(1.875) < altura_en(1.25) - 0.2


def test_relleno_y_remates_entran_en_la_guirnalda() -> None:
    estructura = _guirnalda(
        mezcla="organica_fina",
        armado_guirnalda=_armado(
            "recta",
            relleno={"material": 1, "proporcion": 0.2},
            remates=[{"material": 0, "posicion": "cada_n"}],
        ),
    )
    comprado = _comprados(estructura)
    globos = _globos(estructura)

    assert Counter(tono for *_xyr, tono in globos) == comprado
    radios = sorted({round(r, 4) for _x, _y, r, _t in globos})
    # Globos chicos del relleno, los de los racimos y los grandes del remate.
    assert len(radios) >= 3


# --- El arco que solo trae su patrón: lo arma la resolución -------------------------------------------


def _discos_del_motor(estructura: Mapping[str, object]) -> list[tuple[float, float, float, str]]:
    """Los discos de la guía de un arco de patrón, que salen de la puerta del motor de la resolución."""
    pieza = pieza_de_guia(estructura, ())
    assert not isinstance(pieza, str), pieza
    assert pieza["fuente"] == "motor"
    return [
        (float(d["x_m"]), float(d["y_m"]), float(d["r_m"]), str(d["hex"]))
        for d in cast(list[dict[str, Any]], pieza["discos"])
    ]


def _pie_izquierdo(globos: Sequence[tuple[float, float, float, str]]) -> str:
    """El color del globo más bajo del pie izquierdo: donde arranca el patrón del arco."""
    centro = (min(x for x, *_ in globos) + max(x for x, *_ in globos)) / 2
    return min((g for g in globos if g[0] < centro), key=lambda g: (g[1], g[0]))[3]


def test_el_arco_de_patron_sale_de_la_puerta_del_motor() -> None:
    estructura = _arco(patron_color=ANILLOS)
    # Ya no cae a este módulo: la resolución lo arma con el motor del arco clásico.
    assert globos_de(estructura, _colores(estructura)) is None
    del_motor = pieza_del_motor_resuelta(estructura)
    assert del_motor is not None and del_motor[0] == "arco"
    assert _discos_del_motor(estructura)


def test_el_arco_asimetrico_no_es_del_arco_de_patrones() -> None:
    """El arco de patrones del diseñador solo es simétrico: el asimétrico lo arma el orgánico al confirmar.

    Antes la resolución lo armaba simétrico con el motor clásico y la guía lo dibujaba así. Sin armado no es de
    este módulo ni del motor clásico; con el que la confirmación le escribe, es del orgánico.
    """
    estructura = _pieza(
        ARCO, "arco", "arco_asimetrico", {"ancho_m": 3, "alto_m": 2.4}, patron_color=ESPIRAL
    )
    assert globos_de(estructura, _colores(estructura)) is None
    assert pieza_del_motor_resuelta(estructura) is None


def test_el_arco_de_la_guia_tiene_exactamente_lo_que_el_plan_compra() -> None:
    """La guía y la cotización del mismo plan: los mismos globos, del mismo color (antes, 88 frente a 132)."""
    for estructura in (
        _arco(patron_color=ANILLOS),
        _arco(patron_color=_patron({"modo": "anillos", "secuencia": [2, 0, 1], "largo": 1})),
        _arco(colores=("dorado", "blanco"), patron_color=ESPIRAL),
    ):
        discos = _discos_del_motor(estructura)
        assert Counter(tono for *_xyr, tono in discos) == _comprados(estructura)


def test_el_arco_sale_del_motor_con_los_colores_en_el_orden_del_patron() -> None:
    rosado, blanco, dorado = _colores(_arco())

    globos = _discos_del_motor(_arco(patron_color=ANILLOS))
    assert {tono for *_xyr, tono in globos} == {rosado, blanco, dorado}
    assert _pie_izquierdo(globos) == rosado

    al_reves = _discos_del_motor(
        _arco(patron_color=_patron({"modo": "anillos", "secuencia": [2, 0, 1], "largo": 1}))
    )
    assert _pie_izquierdo(al_reves) == dorado


def test_el_arco_es_el_que_armaria_el_motor_con_sus_medidas() -> None:
    pieza = pieza_de_guia(_arco(patron_color=ANILLOS), ())

    assert not isinstance(pieza, str)
    # Las medidas del plan, como cualquier arco del motor: 3 m de ancho y su alto.
    assert pieza["ancho_m"] == pytest.approx(3.0, abs=1e-3)
    assert pieza["alto_m"] == pytest.approx(2.4, rel=0.05)


def test_dos_materiales_del_mismo_color_no_se_confunden_en_el_arco() -> None:
    estructura = _arco(
        colores=("rosado", "rosado"),
        patron_color=_patron({"modo": "anillos", "secuencia": [1, 0], "largo": 1}),
    )
    # Mismo color: el disco no distingue el material, pero el arco se arma con los dos.
    assert len(_discos_del_motor(estructura)) > 0


# --- Lo que no es de este módulo -----------------------------------------------------------------------


@pytest.mark.parametrize(
    "estructura",
    [
        _pieza(GUIRNALDA, "guirnalda", "techo_globos", {"ancho_m": 3, "alto_m": 3}),
        _arco(),
        _arco(mezcla="organica_fina", patron_color=ANILLOS),
        _pieza(
            "EST_03_SEMIARCO",
            "semiarco",
            "semiarco",
            {"ancho_m": 2, "alto_m": 2},
            patron_color=ESPIRAL,
        ),
        _pieza("EST_04_COLUMNA", "columna", "columna", {"alto_m": 1.8}, patron_color=ESPIRAL),
        _pieza("EST_05_PARED", "pared", "pared_organica", {"ancho_m": 2, "alto_m": 2}),
    ],
    ids=[
        "techo",
        "arco-sin-patron",
        "arco-organico",
        "semiarco",
        "columna",
        "pared",
    ],
)
def test_lo_que_no_es_suyo_devuelve_none(estructura: dict[str, object]) -> None:
    assert globos_de(estructura, _colores(estructura)) is None


def test_con_el_armado_del_motor_manda_el_motor() -> None:
    # La pieza con armado del motor nunca llega al módulo: sale de la puerta de la resolución.
    from tests.test_guia_escena import _con_armados

    con_armado = cast(
        list[dict[str, object]],
        _con_armados(_guirnalda(mezcla="organica_fina"), _arco(patron_color=ANILLOS))[
            "estructuras"
        ],
    )
    for estructura in con_armado:
        assert not clasica.es_guirnalda_clasica(estructura)
        pieza = pieza_de_guia(estructura, ())
        assert not isinstance(pieza, str) and pieza["fuente"] == "motor"


# --- Determinista y de punta a punta -------------------------------------------------------------------


def test_es_determinista() -> None:
    guirnalda = _guirnalda(patron_color=ESPIRAL)
    assert _globos(guirnalda) == _globos(guirnalda)
    for estructura in (guirnalda, _arco(patron_color=ANILLOS)):
        assert pieza_de_guia(estructura, ()) == pieza_de_guia(estructura, ())


def test_la_guia_de_escena_las_incluye_y_no_las_omite() -> None:
    plan_ = plan(
        _guirnalda(patron_color=ANILLOS, colores=("rosado", "blanco", "dorado")),
        _arco(patron_color=ESPIRAL),
    )
    peticion = PlanGuiaEscenaRequest.model_validate(
        {
            "context": {
                "schema_version": "operational.v1",
                "request_id": "00000000-0000-4000-8000-000000000c1a",
                "correlation_id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
                "deadline_at": "2030-01-01T00:00:00Z",
                "deadline_ms": 5000,
                "body_sha256": "a" * 64,
                "scopes": ["plan.guia_escena"],
            },
            "schema_version": "plan-guia-escena.v1",
            "plan": plan_,
        }
    )

    resultado = guia_escena(peticion)

    assert resultado["omitidas"] == []
    piezas = {p["estructura_id"]: p for p in cast(list[dict[str, Any]], resultado["piezas"])}
    assert set(piezas) == {GUIRNALDA, ARCO}
    # La guirnalda clásica sale de este módulo; el arco de patrón, de la puerta del motor de la resolución.
    assert piezas[GUIRNALDA]["fuente"] == "dibujo"
    assert piezas[ARCO]["fuente"] == "motor"
    assert resultado["total_discos"] == sum(len(p["discos"]) for p in piezas.values())
