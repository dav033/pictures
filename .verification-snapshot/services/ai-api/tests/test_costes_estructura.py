"""Consumo imputado por estructura (ADR-0023 §Riesgo).

Lo calculaba la tarjeta en TypeScript, así que el cliente leía un número que
ningún resolutor firmaba. Estos casos fijan la regla ahora que tiene dueño, y
sobre todo fijan lo que NO es: la suma de los consumos no es el total del plan,
porque los paquetes se compran una sola vez.
"""

from __future__ import annotations

from typing import Any

from app.plan import _imputed_structure_costs


def _estructura(estructura_id: str, *lineas: tuple[str, int]) -> dict[str, Any]:
    return {
        "estructura_id": estructura_id,
        "lineas": [{"variant_id": v, "unidades": u} for v, u in lineas],
    }


def _compra(variant_id: str, precio_paquete: int, unidades_paquete: int) -> dict[str, Any]:
    return {
        "variant_id": variant_id,
        "precio_paquete": precio_paquete,
        "unidades_paquete": unidades_paquete,
    }


def test_imputa_por_unidades_consumidas() -> None:
    costes = _imputed_structure_costs(
        [_estructura("EST_01_ARCO", ("V-A", 50))], [_compra("V-A", 10_000, 100)]
    )
    assert costes == [{"estructura_id": "EST_01_ARCO", "consumo_cop": 5_000}]


def test_suma_todas_las_lineas_de_la_estructura() -> None:
    costes = _imputed_structure_costs(
        [_estructura("EST_01_ARCO", ("V-A", 50), ("V-B", 25))],
        [_compra("V-A", 10_000, 100), _compra("V-B", 8_000, 50)],
    )
    assert costes == [{"estructura_id": "EST_01_ARCO", "consumo_cop": 9_000}]


def test_sin_compra_para_una_linea_no_inventa_cifra() -> None:
    """Media estructura imputada engaña más que no decir nada."""
    costes = _imputed_structure_costs(
        [_estructura("EST_01_ARCO", ("V-A", 50), ("V-SIN-COMPRA", 10))],
        [_compra("V-A", 10_000, 100)],
    )
    assert costes == [{"estructura_id": "EST_01_ARCO", "consumo_cop": None}]


def test_estructura_sin_lineas_no_imputa() -> None:
    costes = _imputed_structure_costs([{"estructura_id": "EST_01_KIT", "lineas": []}], [])
    assert costes == [{"estructura_id": "EST_01_KIT", "consumo_cop": None}]


def test_el_consumo_no_es_el_cobro() -> None:
    """Dos estructuras comparten el paquete: la suma imputada supera lo comprado.

    Un paquete de 100 unidades a 10.000 COP cubre las 60 + 40 unidades de las
    dos piezas. Se compra UNA vez (10.000 COP), y la imputación reparte esos
    mismos 10.000 entre ambas. Que sumen el precio de un paquete es correcto;
    lo que no se puede es leerlo como dos cobros.
    """
    costes = _imputed_structure_costs(
        [_estructura("EST_01_ARCO", ("V-A", 60)), _estructura("EST_02_COLUMNA", ("V-A", 40))],
        [_compra("V-A", 10_000, 100)],
    )
    assert costes == [
        {"estructura_id": "EST_01_ARCO", "consumo_cop": 6_000},
        {"estructura_id": "EST_02_COLUMNA", "consumo_cop": 4_000},
    ]
    assert sum(int(c["consumo_cop"] or 0) for c in costes) == 10_000
