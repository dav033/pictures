"""El aro y el bouquet en la guía de escena: su estructura visible, sus formas y su densidad.

- **Densidad del aro**: el puerto de ``dibujar_circulo`` contra los vectores de oro del clasificador
  (``vectores-aro-densidad.json``, de ``clasificador-decoraciones/scripts/migracion/vectores-aro-densidad.ts``):
  mismo SVG byte a byte en cada forma y densidad, ``media`` igual que sin densidad y más densa nunca con menos globos.
- **Lo que no es globo**: el anillo de metal, el poste, la base y el forro del aro, y el anillo y el poste del mini
  aro, se capturan sin tocar el SVG de la UI y llegan a la guía como ``trazos`` y ``rellenos``. Un aro parcial ya no
  sale igual que uno con fondo, y un aro doble son dos aros con su poste.
- **Bouquet**: sus seis formas (la lámina del clasificador) se dibujan distintas; la caja sorpresa lleva su caja y
  el de helio su bolsa de peso y sus cintas; la densidad reparte el ramo de helio sin cambiar cuántos globos lleva.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from collections.abc import Mapping
from pathlib import Path
from typing import Any, cast

import pytest

from app.dibujo_estructura import dibujo_de, globos_y_estructura_de
from app.guia_escena import PlanGuiaEscenaRequest, guia_escena, pieza_de_guia
from app.guia_piezas import ContextoPieza, MaterialGuia
from app.guia_piezas.bouquet import cantidades_por_instancia, pieza_de
from app.plan import PlanResolutionError
from app.plan_armado_comun import validar_plan
from app.referencias.dibujos import (
    ArcoDibujo,
    DatosDibujo,
    ElipseDibujo,
    LineaDibujo,
    PoligonoDibujo,
    con_globos_y_estructura,
    dibujar_circulo,
)
from tests.test_guia_escena import _pieza
from tests.test_guia_pieza_bouquet import COLORES, _ramo
from tests.test_plan_armado import _bouquet, _plan

GOLDEN = (
    Path(__file__).resolve().parents[3]
    / "contracts"
    / "domain"
    / "v1"
    / "golden"
    / "dibujos"
    / "vectores-aro-densidad.json"
)
VECTORES: list[Mapping[str, Any]] = json.loads(GOLDEN.read_text(encoding="utf-8"))["vectores"]

FORMAS_ARO = (None, "organico", "parcial", "con-fondo", "clasico", "doble", "media-luna")
FORMAS_BOUQUET = ("helio", "piso", "burbuja", "con-numero", "caja", "relleno")
DENSIDADES = ("sencilla", "media", "lujosa")
METAL = "#c9d1cc"
TELA = "#efe9e1"
MEZCLA = (
    {"diam_pulg": 12, "forma": "redondo", "unidades": 60, "pct": 60},
    {"diam_pulg": 5, "forma": "redondo", "unidades": 40, "pct": 40},
)


def _aro(forma: str | None, densidad: str = "media") -> dict[str, object]:
    pieza = _pieza("EST_ARO", "arco", "aro_circular", {"diametro_m": 2})
    pieza["densidad"] = densidad
    if forma is not None:
        pieza["forma"] = forma
    return pieza


def _mini_aro(densidad: str = "media") -> dict[str, object]:
    pieza = _pieza("EST_CENTRO", "centro_mesa", "centro_mesa", {})
    return {**pieza, "forma": "mini-aro", "densidad": densidad}


def _guia(estructura: Mapping[str, object]) -> dict[str, Any]:
    pieza = pieza_de_guia(estructura, MEZCLA)
    assert not isinstance(pieza, str)
    return cast(dict[str, Any], pieza)


# --- Densidad del aro: el oráculo del clasificador -----------------------------------------------------------


@pytest.mark.parametrize("vector", VECTORES, ids=[str(v["nombre"]) for v in VECTORES])
def test_el_aro_con_densidad_es_el_del_clasificador(vector: Mapping[str, Any]) -> None:
    datos = cast(
        DatosDibujo,
        {
            **vector["datos"],
            "mezcla": {int(k): float(v) for k, v in vector["datos"]["mezcla"].items()},
        },
    )
    dibujo = dibujar_circulo(vector["forma"], None, datos)

    assert (dibujo["ancho"], dibujo["alto"]) == (vector["ancho"], vector["alto"])
    assert len(dibujo["svg"]) == vector["largo"]
    assert hashlib.sha256(dibujo["svg"].encode("utf-8")).hexdigest() == vector["sha256"]
    assert len(re.findall("<ellipse", dibujo["svg"])) == vector["elipses"]


def test_el_oraculo_del_aro_cumple_la_regla_de_la_densidad() -> None:
    por_forma: dict[object, dict[object, Mapping[str, Any]]] = {}
    for vector in VECTORES:
        por_forma.setdefault(vector["forma"], {})[vector["densidad"]] = vector
    assert set(por_forma) == set(FORMAS_ARO)
    for casos in por_forma.values():
        assert casos["media"]["sha256"] == casos[None]["sha256"], "media es el dibujo de siempre"
        assert casos["sencilla"]["elipses"] < casos["media"]["elipses"] < casos["lujosa"]["elipses"]


@pytest.mark.parametrize("forma", FORMAS_ARO)
def test_la_guia_del_aro_lleva_mas_globos_cuanto_mas_densa(forma: str | None) -> None:
    discos = [len(_guia(_aro(forma, densidad))["discos"]) for densidad in DENSIDADES]
    sin_densidad = {k: v for k, v in _aro(forma).items() if k != "densidad"}

    assert discos[0] < discos[1] < discos[2]
    assert _guia(sin_densidad)["discos"] == _guia(_aro(forma, "media"))["discos"]


# --- Lo que no es globo: capturado sin tocar el SVG de la UI ---------------------------------------------------


@pytest.mark.parametrize(
    "estructura",
    [*[_aro(f) for f in FORMAS_ARO], _mini_aro()],
    ids=[*map(str, FORMAS_ARO), "mini-aro"],
)
def test_capturar_la_estructura_no_cambia_el_dibujo(estructura: dict[str, object]) -> None:
    dibujo = dibujo_de(estructura, MEZCLA)
    capturado, _globos, elementos = con_globos_y_estructura(
        lambda: cast(Any, dibujo_de(estructura, MEZCLA))
    )

    assert dibujo is not None and capturado == dibujo
    assert elementos, "un aro siempre tiene su marco"


def _arcos(elementos: list[Any]) -> list[ArcoDibujo]:
    return [e for e in elementos if isinstance(e, ArcoDibujo)]


def test_cada_aro_trae_su_marco_su_poste_y_su_base() -> None:
    for forma in (None, "organico", "parcial", "con-fondo", "clasico"):
        resultado = globos_y_estructura_de(_aro(forma), MEZCLA)
        assert resultado is not None
        _globos, elementos = resultado
        anillo = _arcos(elementos)
        assert [(a.cx, a.cy, a.r, a.hasta - a.desde, a.hex) for a in anillo] == [
            (0, 1.25, 1, 360, METAL)
        ]
        postes = [e for e in elementos if isinstance(e, LineaDibujo)]
        assert [(p.y1, p.y2) for p in postes] == [(0.25, 0)], "del aro al piso"
        assert any(isinstance(e, ElipseDibujo) and e.cy == 0 and e.hex == METAL for e in elementos)


def test_el_aro_parcial_y_el_con_fondo_ya_no_salen_iguales() -> None:
    parcial = _guia(_aro("parcial"))
    con_fondo = _guia(_aro("con-fondo"))

    assert parcial["discos"] == con_fondo["discos"], "la guirnalda es la misma"
    forros = [r for r in con_fondo["rellenos"] if r["hex"] == TELA]
    assert len(forros) == 1 and forros[0]["forma"] == "elipse"
    assert not [r for r in parcial["rellenos"] if r["hex"] == TELA]


def test_el_aro_doble_son_dos_aros_con_su_poste() -> None:
    _globos, elementos = cast(tuple[Any, list[Any]], globos_y_estructura_de(_aro("doble"), MEZCLA))

    assert sorted((a.cx, a.r) for a in _arcos(elementos)) == [(-0.62, 0.72), (0.62, 0.72)]
    assert len([e for e in elementos if isinstance(e, LineaDibujo)]) == 2


def test_la_media_luna_trae_su_tela_y_su_marco() -> None:
    _globos, elementos = cast(
        tuple[Any, list[Any]], globos_y_estructura_de(_aro("media-luna"), MEZCLA)
    )

    telas = [e for e in elementos if isinstance(e, PoligonoDibujo)]
    assert len(telas) == 1 and telas[0].hex == TELA and 3 <= len(telas[0].puntos) <= 64
    assert {(a.desde, a.hasta) for a in _arcos(elementos)} == {(70, 290), (90, 270)}
    # La tela es la luna creciente que se abre a la derecha: todo a la izquierda del borde del aro.
    assert max(x for x, _y in telas[0].puntos) == pytest.approx(0.342, abs=1e-3)
    assert min(x for x, _y in telas[0].puntos) == pytest.approx(-1, abs=1e-3)


def test_el_mini_aro_trae_su_anillo_y_su_poste_sobre_la_mesa() -> None:
    pieza = _guia(_mini_aro())

    anillos = [t for t in pieza["trazos"] if t["forma"] == "arco"]
    postes = [t for t in pieza["trazos"] if t["forma"] == "linea"]
    assert len(anillos) == 1 and anillos[0]["r_m"] == pytest.approx(0.3)
    assert len(postes) == 1


def test_la_caja_del_aro_cuenta_su_marco_y_llega_al_piso() -> None:
    pieza = _guia(_aro("parcial"))
    xs = [d["x_m"] + s * d["r_m"] for d in pieza["discos"] for s in (-1, 1)]
    anillo = next(t for t in pieza["trazos"] if t["forma"] == "arco")
    poste = next(t for t in pieza["trazos"] if t["forma"] == "linea")

    # La guirnalda parcial cubre la mitad izquierda; el marco entero entra en la caja de la pieza.
    assert anillo["cx_m"] + anillo["r_m"] <= pieza["ancho_m"] / 2 + 1e-3
    assert anillo["cx_m"] + anillo["r_m"] > max(xs)
    # El poste baja hasta el piso, que queda a la altura de la mitad de la base (``ry`` 0,05 m).
    assert min(poste["y1_m"], poste["y2_m"]) == pytest.approx(0.05, abs=1e-3)


# --- Bouquet: sus formas, su pesa, sus cintas y su densidad ----------------------------------------------------


def _firma(pieza: Any) -> tuple[object, ...]:
    return (
        tuple(sorted((round(x, 3), round(y, 3), round(r, 3), t) for x, y, r, t in pieza.globos)),
        pieza.anclaje,
        tuple(type(e).__name__ for e in pieza.elementos),
        tuple(e.puntos for e in pieza.elementos if isinstance(e, PoligonoDibujo)),
    )


def test_cada_forma_del_bouquet_se_dibuja_distinta() -> None:
    firmas = {
        forma: _firma(pieza_de(_ramo(7, (3 / 7, 3 / 7, 1 / 7), forma=forma), COLORES))
        for forma in FORMAS_BOUQUET
    }

    assert len(set(firmas.values())) == len(FORMAS_BOUQUET)


def test_todas_las_formas_dibujan_lo_que_se_compra() -> None:
    for forma in FORMAS_BOUQUET:
        for densidad in DENSIDADES:
            estructura = _ramo(7, (3 / 7, 3 / 7, 1 / 7), forma=forma, densidad=densidad)
            pieza = pieza_de(estructura, COLORES)
            assert pieza is not None
            assert Counter(t for *_xyr, t in pieza.globos) == {
                "#ff0000": 3,
                "#00ff00": 3,
                "#0000ff": 1,
            }
            assert sum(cantidades_por_instancia(estructura)) == len(pieza.globos)


def test_la_caja_sorpresa_lleva_su_caja_y_el_de_helio_su_bolsa_y_sus_cintas() -> None:
    caja = pieza_de(_ramo(7, (3 / 7, 3 / 7, 1 / 7), forma="caja"), COLORES)
    helio = pieza_de(_ramo(7, (3 / 7, 3 / 7, 1 / 7), forma="helio"), COLORES)
    assert caja is not None and helio is not None

    pesa_caja = [e for e in caja.elementos if isinstance(e, PoligonoDibujo)]
    pesa_helio = [e for e in helio.elementos if isinstance(e, PoligonoDibujo)]
    # La caja de regalo: un rectángulo del color principal; la bolsa de peso, su silueta de ocho puntos.
    assert len(pesa_caja) == 1 and len(pesa_caja[0].puntos) == 4 and pesa_caja[0].hex == "#ff0000"
    assert len(pesa_helio) == 1 and len(pesa_helio[0].puntos) == 8
    for pieza in (caja, helio):
        cintas = [e for e in pieza.elementos if isinstance(e, LineaDibujo)]
        assert len(cintas) == len(pieza.globos), "una cinta por globo"
        assert (
            min(
                y
                for _x, y in [
                    p for e in pieza.elementos if isinstance(e, PoligonoDibujo) for p in e.puntos
                ]
            )
            == 0
        )


def test_la_burbuja_de_la_forma_la_lleva_el_material_que_menos_globos_compra() -> None:
    sin_contexto = pieza_de(_ramo(7, (3 / 7, 3 / 7, 1 / 7), forma="burbuja"), COLORES)
    todo_latex = ContextoPieza(materiales=tuple(MaterialGuia("latex", 12) for _ in range(3)))
    con_contexto = pieza_de(_ramo(7, (3 / 7, 3 / 7, 1 / 7), forma="burbuja"), COLORES, todo_latex)
    assert sin_contexto is not None and con_contexto is not None

    burbuja = max(sin_contexto.globos, key=lambda g: g[2])
    assert burbuja[3] == "#0000ff" and burbuja[2] > 0.25, (
        "la burbuja de 61 cm, del material de 1 globo"
    )
    assert max(r for _x, _y, r, _t in con_contexto.globos) < 0.2, (
        "si se sabe que todo es látex, no hay burbuja"
    )


def test_la_densidad_reparte_el_ramo_de_helio_sin_cambiar_cuantos_globos_lleva() -> None:
    def pieza(forma: str | None, densidad: str) -> Any:
        extra: dict[str, object] = {"densidad": densidad}
        if forma is not None:
            extra["forma"] = forma
        return pieza_de(_ramo(7, (3 / 7, 3 / 7, 1 / 7), **extra), COLORES)

    for forma in (None, "helio", "caja"):
        firmas = [_firma(pieza(forma, d)) for d in DENSIDADES]
        assert len(set(firmas)) == 3, forma
        alturas = [
            max(y + r for _x, y, r, _t in pieza(forma, d).globos)
            - min(y - r for _x, y, r, _t in pieza(forma, d).globos)
            for d in DENSIDADES
        ]
        assert alturas[0] < alturas[1] < alturas[2], (
            "ligero, estándar y lleno: dos, tres y cuatro niveles"
        )
    assert _firma(pieza(None, "media")) == _firma(
        pieza_de(_ramo(7, (3 / 7, 3 / 7, 1 / 7)), COLORES)
    )
    for forma in ("piso", "burbuja", "con-numero", "relleno"):
        assert len({_firma(pieza(forma, d)) for d in DENSIDADES}) == 1, (
            "las demás formas ya dicen cómo se acomodan"
        )


def test_las_cintas_del_bouquet_flotante_bajan_hasta_la_pesa_en_el_piso() -> None:
    pieza = _guia(_ramo(7, (3 / 7, 3 / 7, 1 / 7), forma="helio"))

    assert pieza["anclaje"] == "flotante"
    assert min(d["y_m"] - d["r_m"] for d in pieza["discos"]) == pytest.approx(0, abs=1e-3)
    pesa = pieza["rellenos"][0]["puntos"]
    assert min(p["y_m"] for p in pesa) == pytest.approx(-pieza["elevacion_m"], abs=2e-3)
    assert len(pieza["trazos"]) == len(pieza["discos"])


def test_el_contrato_admite_las_formas_del_bouquet_y_la_guia_las_publica() -> None:
    for forma in FORMAS_BOUQUET:
        plan_ = _plan(_bouquet(forma=forma))
        validar_plan(plan_)
        peticion = PlanGuiaEscenaRequest.model_validate(
            {
                "context": {
                    "schema_version": "operational.v1",
                    "request_id": "00000000-0000-4000-8000-000000000b01",
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
        pieza = cast(list[dict[str, Any]], resultado["piezas"])[0]
        assert pieza["trazos"] and pieza["rellenos"]
    with pytest.raises(PlanResolutionError):
        validar_plan(_plan(_bouquet(forma="mini-aro")))


def test_el_aro_colgado_en_la_pared_no_lleva_poste_ni_base() -> None:
    """CASE-007 (2026-10-06): un ``hoop`` que la foto muestra colgado llega con ``mezclas[].colgada``.

    En la guía cuelga de la pared: su marco sí, el poste y la base que lo ponían de pie no, y publica el anclaje
    ``pared``. De pie subía la franja de piso hasta la mitad del lienzo. El aro de pie sigue con los tres.
    """
    pieza = pieza_de_guia(_aro("organico"), MEZCLA, {"colgada": True})
    assert not isinstance(pieza, str)
    colgado = cast(dict[str, Any], pieza)
    assert colgado["anclaje"] == "pared"
    assert colgado.get("trazos"), "el marco del aro se sigue viendo"
    assert all(
        min(t.get("y1_m", 1), t.get("y2_m", 1)) > 1e-6
        for t in colgado["trazos"]
        if t["forma"] == "linea"
    ), "sin poste"
    assert not [
        r for r in colgado.get("rellenos", []) if r["forma"] == "elipse" and r["cy_m"] <= 1e-6
    ], "sin base"
    de_pie = _guia(
        _aro("organico")
    )  # también en `fondo_pared` (el de la prueba): sin la foto, de pie
    assert "anclaje" not in de_pie
    assert any(t["forma"] == "linea" for t in de_pie["trazos"]), "el aro de pie conserva su poste"
