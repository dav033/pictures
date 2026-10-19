"""El bouquet en la guía de escena (``app/guia_piezas/bouquet.py``).

- **Sin armado** sale el ramo del diseñador (``crear_disposicion``): un disco por globo que compra una
  instancia, en el color de su material, del tamaño del R12 inflado.
- **Con armado** sale la geometría del armado por partes: niveles, remate y número donde el armado dice.
- **De punta a punta**: el plan que la resolución completa con su receta llega a la guía como una pieza.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping
from typing import Any, cast

import pytest

from app.arco.tipos import INFLADO_PULG
from app.guia_escena import PlanGuiaEscenaRequest, guia_escena, hex_del_material, pieza_de_guia
from app.guia_piezas import globos_de_pieza
from app.guia_piezas.bouquet import NUMERO_PULG, REMATE_PULG, globos_de
from tests.test_plan_armado import _bouquet, _plan, _resolve

COLORES = ("#ff0000", "#00ff00", "#0000ff")
R12_M = INFLADO_PULG[12] * 0.0254 / 2


def _ramo(unidades: int, partes: tuple[float, ...], **extra: object) -> dict[str, object]:
    return {
        "estructura_id": "EST_BOUQUET",
        "nombre": "Bouquet",
        "tipo": "kit",
        "estructura_oficial": "bouquet",
        "rol_escena": "acento",
        "ubicacion": "sobre_mesa_principal",
        "medidas": {},
        "repeticiones": 1,
        "densidad": "media",
        "mezcla": "clasica",
        "unidades_declaradas": unidades,
        "materiales": [
            {
                "product_id": f"prod-{i}",
                "variant_id": f"var-{i}",
                "color": "blanco",
                "participacion": parte,
                "rol_material": "principal" if i == 0 else "secundario",
            }
            for i, parte in enumerate(partes)
        ],
        "porque": "Bouquet de prueba.",
        **extra,
    }


def _por_color(globos: list[tuple[float, float, float, str]]) -> Counter[str]:
    return Counter(tono for *_xyr, tono in globos)


# --- Sin armado: el ramo ----------------------------------------------------------------------


def test_un_disco_por_globo_comprado_en_el_color_de_su_material() -> None:
    globos = globos_de(_ramo(7, (3 / 7, 3 / 7, 1 / 7)), COLORES)

    assert globos is not None and len(globos) == 7
    assert _por_color(globos) == {"#ff0000": 3, "#00ff00": 3, "#0000ff": 1}
    assert all(r == pytest.approx(R12_M) for _x, _y, r, _hex in globos)


def test_las_repeticiones_se_dibujan_una_vez() -> None:
    globos = globos_de(_ramo(14, (3 / 7, 3 / 7, 1 / 7), repeticiones=2), COLORES)

    assert globos is not None and _por_color(globos) == {"#ff0000": 3, "#00ff00": 3, "#0000ff": 1}


def test_el_ramo_es_determinista_y_los_globos_no_se_encimen_de_mas() -> None:
    estructura = _ramo(12, (0.5, 0.25, 0.25))
    primero = globos_de(estructura, COLORES)

    assert primero is not None and primero == globos_de(estructura, COLORES)
    for i, (xa, ya, ra, _a) in enumerate(primero):
        for xb, yb, rb, _b in primero[i + 1 :]:
            # Capas distintas pueden montarse (el diseñador lo permite hasta un 42 %), nunca coincidir.
            assert ((xa - xb) ** 2 + (ya - yb) ** 2) ** 0.5 > (ra + rb) * 0.4


def test_un_bouquet_de_piso_queda_a_ras_del_suelo() -> None:
    globos = globos_de(_ramo(7, (0.5, 0.5), forma="piso"), COLORES)

    assert globos is not None and len(globos) == 7
    assert min(y - r for _x, y, r, _hex in globos) == pytest.approx(0.11, abs=0.05)


# --- Con armado: por partes ---------------------------------------------------------------------

TORRE = {
    "version": "armado-bouquet.v1",
    "origen": "sugerido",
    "variante": "base_aire",
    "niveles": [
        {"rol": "base", "unidad": "cuarteto", "cantidad": 1, "posiciones": [0, 0, 0, 0]},
        {"rol": "cuerpo", "unidad": "trio", "cantidad": 1, "posiciones": [1, 1, 1]},
    ],
    "remate": [2],
}


def test_el_armado_pone_cada_nivel_y_el_remate_arriba() -> None:
    globos = globos_de(_ramo(8, (0.5, 0.375, 0.125), armado_bouquet=TORRE), COLORES)

    assert globos is not None and _por_color(globos) == {"#ff0000": 4, "#00ff00": 3, "#0000ff": 1}
    base = [g for g in globos if g[3] == "#ff0000"]
    cuerpo = [g for g in globos if g[3] == "#00ff00"]
    remate = next(g for g in globos if g[3] == "#0000ff")
    assert max(y for _x, y, _r, _h in base) < min(y for _x, y, _r, _h in cuerpo)
    assert remate[1] > max(y for _x, y, _r, _h in cuerpo)
    assert remate[2] == pytest.approx(REMATE_PULG * 0.0254 / 2)
    # Base de aire: el bouquet arranca en el piso.
    assert min(y - r for _x, y, r, _h in globos) == pytest.approx(0.0, abs=0.06)


def test_el_numero_del_armado_va_donde_dice_su_disposicion() -> None:
    armado = {k: v for k, v in TORRE.items() if k != "remate"}
    armado["numero"] = {"digitos": [2], "disposicion": "arriba"}
    globos = globos_de(_ramo(8, (0.5, 0.375, 0.125), armado_bouquet=armado), COLORES)

    assert globos is not None and len(globos) == 8
    numero = next(g for g in globos if g[3] == "#0000ff")
    assert numero[2] == pytest.approx(NUMERO_PULG * 0.0254 / 2)
    assert numero[1] == max(y for _x, y, _r, _h in globos)


def test_un_armado_que_no_cuenta_la_compra_se_dibuja_como_ramo() -> None:
    # El armado coloca 8 globos y la pieza compra 9: manda la compra.
    globos = globos_de(_ramo(9, (0.5, 0.375, 0.125), armado_bouquet=TORRE), COLORES)

    assert globos is not None and len(globos) == 9
    assert all(r == pytest.approx(R12_M) for _x, _y, r, _h in globos)


# --- Lo que no es un bouquet --------------------------------------------------------------------


@pytest.mark.parametrize(
    "cambio",
    [
        {"estructura_oficial": "centro_mesa"},
        {"tipo": "centro_mesa"},
        {"estructura_oficial": None},
        {"materiales": []},
    ],
)
def test_lo_que_no_es_un_bouquet_no_se_dibuja(cambio: Mapping[str, object]) -> None:
    assert globos_de({**_ramo(7, (0.5, 0.5)), **cambio}, COLORES) is None


def test_el_paquete_de_piezas_descubre_el_bouquet() -> None:
    assert globos_de_pieza(_ramo(7, (0.5, 0.5)), COLORES) == globos_de(
        _ramo(7, (0.5, 0.5)), COLORES
    )


# --- De punta a punta ----------------------------------------------------------------------------


@pytest.mark.anyio
async def test_el_bouquet_resuelto_llega_a_la_guia_con_cada_globo_que_compra() -> None:
    resuelto = await _resolve(_plan(_bouquet()), completar_armados=True)
    plan_ = cast(dict[str, Any], resuelto["plan"])
    estructura = cast(dict[str, Any], plan_["estructuras"][0])
    assert estructura.get("armado_bouquet") is not None

    pieza = pieza_de_guia(estructura, ())
    assert not isinstance(pieza, str)
    discos = cast(list[dict[str, Any]], pieza["discos"])
    tonos = [hex_del_material(m) for m in estructura["materiales"]]
    # 3 R-12 blanco, 3 R-12 rosado y un corazón metalizado (``tests/test_plan_armado.py``).
    assert Counter(d["hex"] for d in discos) == {tonos[0]: 3, tonos[1]: 3, tonos[2]: 1}
    assert pieza["fuente"] == "dibujo"
    assert min(d["y_m"] - d["r_m"] for d in discos) == pytest.approx(0.0, abs=1e-3)

    peticion = PlanGuiaEscenaRequest.model_validate(
        {
            "context": {
                "schema_version": "operational.v1",
                "request_id": "00000000-0000-4000-8000-000000000b00",
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
    assert resultado["total_discos"] == 7
