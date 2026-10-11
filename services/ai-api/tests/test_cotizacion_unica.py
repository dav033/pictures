"""D-038 (cotización única): la misma lista de materiales cuesta lo mismo en todas las superficies.

La allowlist decide qué globos usa el plan; en qué paquetes se compran es una decisión de compra, la misma que toma
el motor 3D (``planearCompra``). El resolutor compra entre TODAS las presentaciones del mismo globo, y cada globo
(talla y color) lleva su propia reserva: ``ceil(n × 0,08)``, cubierta con el diseño en una sola combinación.

La fixture compartida ``contracts/domain/v1/golden/cotizacion-unica/`` (la genera
``scripts/motor/generar-cotizacion-unica.ts`` con la regla de TypeScript) ata los dos lados: con la allowlist reducida
a un solo paquete por globo, el resolutor compra los mismos paquetes, con la misma reserva, por el mismo total.
"""

from __future__ import annotations

import itertools
import json
import math
from pathlib import Path
from typing import cast

import pytest

from app.plan import Candidate, _buy, _normalize, resolve_plan
from app.presentaciones import optimizar_cobertura
from tests.test_plan import FakePlanStore, _request, _row

FIXTURE = (
    Path(__file__).resolve().parents[3]
    / "contracts"
    / "domain"
    / "v1"
    / "golden"
    / "cotizacion-unica"
)
CASOS = sorted(FIXTURE.glob("*.json"))


def _presentacion(
    variant_id: str, unidades: int, precio: int, **cambios: object
) -> dict[str, object]:
    return {**_row(variant_id=variant_id), "unidades_paq": unidades, "precio": precio, **cambios}


def _compras(resultado: dict[str, object]) -> dict[str, int]:
    resuelto = cast(dict[str, object], resultado["plan_resuelto"])
    return {
        str(compra["variant_id"]): int(cast(int, compra["paquetes"]))
        for compra in cast(list[dict[str, object]], resuelto["compras"])
    }


def _total(resultado: dict[str, object]) -> int:
    resuelto = cast(dict[str, object], resultado["plan_resuelto"])
    return int(cast(int, cast(dict[str, object], resuelto["totales"])["total_cop"]))


# El arco de la fixture lleva 136 R-12 rojos; su reserva es ceil(136 × 0,08) = 11: se compran 147 de una vez.


@pytest.mark.anyio
async def test_compra_entre_todos_los_paquetes_del_globo_aunque_la_allowlist_traiga_uno() -> None:
    # Con la allowlist en el ×50 compraba 3 × 50 (36 000). Con el ×12 a 2 000, 147 salen en 13 × 12 = 26 000.
    filas = [_presentacion("var-rojo-12", 50, 12000), _presentacion("var-rojo-12-x12", 12, 2000)]

    resultado = await resolve_plan(_request(), FakePlanStore(filas))

    assert _compras(resultado) == {"var-rojo-12-x12": 13}
    assert _total(resultado) == 26000


@pytest.mark.anyio
async def test_diseno_y_reserva_se_cubren_en_una_sola_combinacion() -> None:
    # 2 × 50 + 3 × 12 = 136 justos (34 500) no dejan sobrante; un ×12 suelto para la reserva daba 38 000, más que los
    # 3 × 50 (36 000) que cubren los 147 de una vez.
    filas = [_presentacion("var-rojo-12", 50, 12000), _presentacion("var-rojo-12-x12", 12, 3500)]

    resultado = await resolve_plan(_request(), FakePlanStore(filas))

    assert _compras(resultado) == {"var-rojo-12": 3}
    assert _total(resultado) == 36000


@pytest.mark.anyio
async def test_otro_globo_no_es_una_presentacion_aunque_sea_del_mismo_producto() -> None:
    # Otra talla, otra forma u otro color real de la variante no son paquetes del mismo globo: no se compran.
    filas = [
        _presentacion("var-rojo-12", 50, 12000),
        _presentacion("var-rojo-9-x12", 12, 1000, diam_pulg=9, codigo_tamano="R-9"),
        _presentacion("var-rojo-corazon-x12", 12, 1000, forma="corazon"),
        _presentacion("var-azul-12-x12", 12, 1000, colores_variante=["azul"]),
    ]

    resultado = await resolve_plan(_request(), FakePlanStore(filas))

    assert _compras(resultado) == {"var-rojo-12": 3}
    assert _total(resultado) == 36000


def test_la_fixture_compartida_trae_casos_de_las_cuatro_fuentes() -> None:
    origenes = {json.loads(ruta.read_text(encoding="utf-8"))["origen"] for ruta in CASOS}
    assert origenes == {"motor", "python", "sintetico", "catalogo"}


def _candidatos(caso: dict[str, object]) -> list[Candidate]:
    return [
        Candidate(
            product_id=str(linea["productId"]),
            variant_id=str(presentacion["variantId"]),
            sku=None,
            sku_original=None,
            source_snapshot_id=str(caso["snapshot"]),
            source_variant_id=None,
            inventory_quantity=None,
            unidades_inferidas=None,
            title=f"{linea['formatoId']} {linea['codigo']}",
            price=int(cast(int, presentacion["precio"])),
            units_per_package=int(cast(int, presentacion["unidadesPaq"])),
            size_code=str(linea["formatoId"]),
            shape="redondo",
            diameter_inches=float(cast(float, linea["diamPulg"])),
            colors=(_normalize(str(linea["color"])),),
            variant_colors=(_normalize(str(linea["color"])),),
            finishes=(),
            image=None,
        )
        for linea in cast(list[dict[str, object]], caso["lineas"])
        for presentacion in cast(list[dict[str, object]], linea["presentaciones"])
    ]


@pytest.mark.parametrize("ruta", CASOS, ids=[ruta.stem for ruta in CASOS])
def test_el_resolutor_compra_lo_mismo_que_la_regla_de_typescript(ruta: Path) -> None:
    caso = cast(dict[str, object], json.loads(ruta.read_text(encoding="utf-8")))
    lineas = cast(list[dict[str, object]], caso["lineas"])
    candidatos = _candidatos(caso)
    por_producto: dict[str, list[Candidate]] = {}
    for candidato in candidatos:
        por_producto.setdefault(candidato.product_id, []).append(candidato)
    # La allowlist trae solo el paquete más grande de cada globo: el resto lo encuentra la regla única.
    allowlist: dict[str, set[str]] = {}
    estructura_lineas: list[dict[str, object]] = []
    for linea in lineas:
        presentaciones = cast(list[dict[str, object]], linea["presentaciones"])
        mayor = max(
            presentaciones, key=lambda p: (int(cast(int, p["unidadesPaq"])), str(p["variantId"]))
        )
        allowlist[str(linea["productId"])] = {str(mayor["variantId"])}
        estructura_lineas.append(
            {
                "estructura_id": "EST_01",
                "origen": {"kind": "estructura", "id": "EST_01"},
                "product_id": linea["productId"],
                "variant_id": mayor["variantId"],
                "color": linea["color"],
                "forma": "redondo",
                "diam_pulg": float(cast(float, linea["diamPulg"])),
                "tamano_codigo": linea["formatoId"],
                "unidades": linea["cantidad"],
                "sustitucion": None,
            }
        )
    estructuras: list[dict[str, object]] = [
        {"estructura_id": "EST_01", "lineas": estructura_lineas}
    ]

    compras, reserva = _buy(
        estructuras, por_producto, {c.variant_id: c for c in candidatos}, allowlist
    )

    esperado = cast(dict[str, object], caso["esperado"])
    assert sum(int(cast(int, compra["subtotal"])) for compra in compras) == esperado["total"]
    assert {
        str(compra["variant_id"]): (
            compra["paquetes"],
            compra["design_quantity"],
            compra["waste_reserve"],
            compra["additional_package_for_waste"],
        )
        for compra in compras
    } == {
        str(compra["variantId"]): (
            compra["paquetes"],
            compra["cantidad"],
            compra["reserva"],
            compra["paraReserva"],
        )
        for compra in cast(list[dict[str, object]], esperado["compras"])
    }
    reserva_esperada = cast(dict[str, int], esperado["reserva"])
    assert reserva["target_waste_reserve"] == reserva_esperada["objetivo"]
    assert reserva["covered_waste_reserve"] == reserva_esperada["cubierta"]
    assert reserva["uncovered_waste_reserve"] == reserva_esperada["sinCubrir"]
    assert reserva["natural_package_surplus"] == reserva_esperada["excedenteNatural"]


_JUEGOS = [
    [("A12", 12, 3963), ("B20", 20, 6029), ("C50", 50, 13037)],
    [("A12", 12, 3500), ("B50", 50, 12000)],
    [("A06", 6, 7199), ("B50", 50, 51854)],
    [("A03", 3, 10124)],
    [("A12", 12, 2000), ("B20", 20, 3000), ("C50", 50, 9000), ("D80", 80, 13000)],
]


def _busqueda_completa(
    objetivo: int, juego: list[tuple[str, int, int]]
) -> tuple[int, int, int, str]:
    """Todas las combinaciones de paquetes hasta cubrir: el oráculo del optimizador."""
    mejor: tuple[int, int, int, str] | None = None
    rangos = [range(math.ceil(objetivo / unidades) + 2) for _id, unidades, _precio in juego]
    for paquetes in itertools.product(*rangos):
        capacidad = sum(p * unidades for p, (_id, unidades, _precio) in zip(paquetes, juego))
        if capacidad < objetivo:
            continue
        elegidas = [(id_, p, precio) for p, (id_, _u, precio) in zip(paquetes, juego) if p > 0]
        clave = (
            sum(p * precio for _id, p, precio in elegidas),
            capacidad - objetivo,
            sum(paquetes),
            "|".join(id_ for id_, _p, _precio in elegidas),
        )
        if mejor is None or clave < mejor:
            mejor = clave
    assert mejor is not None
    return mejor


@pytest.mark.parametrize("juego", _JUEGOS, ids=[str(len(juego)) for juego in _JUEGOS])
def test_el_optimizador_da_lo_mismo_que_la_busqueda_completa(
    juego: list[tuple[str, int, int]],
) -> None:
    opciones: list[dict[str, object]] = [
        {"variant_id": id_, "unidades_paquete": unidades, "precio": precio}
        for id_, unidades, precio in juego
    ]
    for objetivo in range(1, 161):
        resultado = optimizar_cobertura(objetivo, opciones)
        assert resultado is not None
        compras = cast(list[dict[str, object]], resultado["compras"])
        obtenido = (
            resultado["costo"],
            resultado["sobrante"],
            resultado["paquetes"],
            "|".join(str(compra["variant_id"]) for compra in compras),
        )
        assert obtenido == _busqueda_completa(objetivo, juego), objetivo


def test_link_o_loon_6_y_660_no_son_el_mismo_globo() -> None:
    # Revisión 3: LOL 6 y LOL 660 tienen 6″ de diámetro, pero LOL 660 es el eslabón largo. Un plan que eligió LOL 660
    # ×20 (34 Verde Selva) salía con un ×50 de LOL 6 a 7 857 COP: son 2 × LOL 660 ×20, 28 082 COP.
    def candidato(variante: str, talla: str, unidades: int, precio: int) -> Candidate:
        return Candidate(
            product_id="P-LOL-VERDE",
            variant_id=variante,
            sku=None,
            sku_original=None,
            source_snapshot_id="S",
            source_variant_id=None,
            inventory_quantity=None,
            unidades_inferidas=None,
            title=f"Link-O-Loon Verde Selva — {talla} / PAQUETE X {unidades}",
            price=precio,
            units_per_package=unidades,
            size_code=talla,
            shape="link",
            diameter_inches=6.0,
            colors=("verde",),
            variant_colors=("verde",),
            finishes=(),
            image=None,
        )

    candidatos = [
        candidato("V-LOL6-X50", "LOL 6", 50, 7857),
        candidato("V-LOL660-X20", "LOL 660", 20, 14041),
        candidato("V-LOL660-X50", "LOL 660", 50, 32336),
    ]
    linea = {
        "estructura_id": "EST_01",
        "origen": {"kind": "estructura", "id": "EST_01"},
        "product_id": "P-LOL-VERDE",
        "variant_id": "V-LOL660-X20",
        "color": "verde",
        "forma": "link",
        "diam_pulg": 6.0,
        "tamano_codigo": "LOL 660",
        "unidades": 34,
        "sustitucion": None,
    }
    estructuras: list[dict[str, object]] = [{"estructura_id": "EST_01", "lineas": [linea]}]

    compras, _reserva = _buy(
        estructuras,
        {"P-LOL-VERDE": candidatos},
        {c.variant_id: c for c in candidatos},
        {"P-LOL-VERDE": {"V-LOL660-X20"}},
    )

    assert {str(c["variant_id"]): c["paquetes"] for c in compras} == {"V-LOL660-X20": 2}
    assert sum(int(cast(int, c["subtotal"])) for c in compras) == 28082
    lineas = cast(list[dict[str, object]], estructuras[0]["lineas"])
    assert {linea["tamano_codigo"] for linea in lineas} == {"LOL 660"}
