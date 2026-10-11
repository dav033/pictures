"""Qué paquetes compra un plan: entre cuáles elige y la combinación más barata que cubre lo que pide.

D-038 (cotización única, 2026-10-10): la allowlist decide QUÉ globos usa un plan (producto, talla, color), que es una
decisión de diseño. En qué paquetes se compran (×3, ×6, ×12, ×20, ×50, ×80) es una decisión de compra, y la misma lista
de materiales tiene que costar lo mismo en todas las superficies. La allowlist traía los paquetes que la búsqueda
devolvió ese turno (o los ×50 de las ideas guardadas), así que el mismo globo costaba distinto según la búsqueda. Ahora
se compra entre TODAS las presentaciones que la tienda vende del mismo globo, y cada globo (talla y color) lleva su propia
reserva, cubierta con su diseño en una sola combinación (``comprar_globo``), como el motor 3D (``planearCompra`` de
``src/lib/globos3d/motor/plan-de-compra.ts``). La fixture ``contracts/domain/v1/golden/cotizacion-unica/`` fija que los
dos lados compren los mismos paquetes por el mismo total.

Puro: los candidatos llegan de ``plan.py``.
"""

from __future__ import annotations

import math
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol, TypeVar, cast

from app.numeros import entero, numero


def optimizar_cobertura(
    unidades_objetivo: int | float,
    opciones: Sequence[Mapping[str, object]],
    merma: float = 0.0,
    necesidad: int | None = None,
) -> dict[str, object] | None:
    """Cheapest mix of presentations covering the units, by bounded search.

    With ``necesidad`` (the design balloons of the line) a mix may use at most that many presentations: every
    presentation bought must carry at least one design balloon (``comprar_globo`` gives each one first).
    """
    candidatas: list[dict[str, object]] = []
    for option in opciones:
        variant_id = option.get("variant_id")
        units_per_package = entero(option.get("unidades_paquete"))
        price = numero(option.get("precio"))
        if (
            not isinstance(variant_id, str)
            or units_per_package is None
            or units_per_package <= 0
            or price is None
            or price <= 0
        ):
            continue
        min_packages = numero(option.get("min_paquetes"))
        normalized_min = max(0, math.floor(min_packages or 0))
        normalized_price: int | float = int(price) if price.is_integer() else price
        candidatas.append(
            {
                "variant_id": variant_id,
                "unidades_paquete": units_per_package,
                "precio": normalized_price,
                "min_paquetes": normalized_min,
            }
        )
    candidatas.sort(key=lambda item: cast(str, item["variant_id"]))
    if unidades_objetivo <= 0 or not candidatas:
        return None

    unidades_con_merma = math.ceil(unidades_objetivo * (1 + merma))
    min_units_per_package = min(int(cast(int, item["unidades_paquete"])) for item in candidatas)
    max_paquetes = max(
        1,
        max(int(cast(int, item["min_paquetes"])) for item in candidatas),
        math.ceil(unidades_con_merma / min_units_per_package) + 2,
    )
    mejor: dict[str, object] | None = None

    def visitar(indice: int, restantes: float, elegidas: list[dict[str, object]]) -> None:
        nonlocal mejor
        if indice == len(candidatas):
            if restantes > 0:
                return
            compras = [item for item in elegidas if int(cast(int, item["paquetes"])) > 0]
            if necesidad is not None and len(compras) > necesidad:
                return
            capacidad = sum(int(cast(int, item["capacidad"])) for item in compras)
            costo = sum(
                int(cast(int, item["paquetes"])) * cast(int | float, item["precio"])
                for item in compras
            )
            candidato: dict[str, object] = {
                "unidades_objetivo": unidades_objetivo,
                "unidades_con_merma": unidades_con_merma,
                "costo": costo,
                "sobrante": capacidad - unidades_objetivo,
                "paquetes": sum(int(cast(int, item["paquetes"])) for item in compras),
                "compras": compras,
            }
            if mejor is None:
                mejor = candidato
                return
            mejor_key = (
                cast(int | float, mejor["costo"]),
                cast(int | float, mejor["sobrante"]),
                cast(int, mejor["paquetes"]),
                "|".join(
                    cast(str, item["variant_id"])
                    for item in cast(list[dict[str, object]], mejor["compras"])
                ),
            )
            candidate_key = (
                cast(int | float, candidato["costo"]),
                cast(int | float, candidato["sobrante"]),
                cast(int, candidato["paquetes"]),
                "|".join(cast(str, item["variant_id"]) for item in compras),
            )
            if candidate_key < mejor_key:
                mejor = candidato
            return

        option = candidatas[indice]
        units_per_package = int(cast(int, option["unidades_paquete"]))
        min_packages = int(cast(int, option["min_paquetes"]))
        max_for_option = min(
            max_paquetes,
            max(min_packages, math.ceil(restantes / units_per_package) + 1),
        )
        if indice == len(candidatas) - 1:
            # En la última presentación, más paquetes que los que faltan solo suben el costo: basta el mínimo que
            # cubre. Mismo resultado que el recorrido completo, sin su costo cúbico en cantidades grandes (D-038).
            fewest = max(0, math.ceil(restantes / units_per_package))
            if 0 < fewest < min_packages:
                fewest = min_packages
            if fewest <= max_for_option:
                visitar(
                    indice + 1,
                    restantes - fewest * units_per_package,
                    [
                        *elegidas,
                        {**option, "paquetes": fewest, "capacidad": fewest * units_per_package},
                    ],
                )
            return
        for packages in range(max_for_option + 1):
            if packages > 0 and packages < min_packages:
                continue
            capacity = packages * units_per_package
            visitar(
                indice + 1,
                restantes - capacity,
                [
                    *elegidas,
                    {**option, "paquetes": packages, "capacidad": capacity},
                ],
            )

    visitar(0, float(unidades_con_merma), [])
    return mejor


def _compras(cobertura: Mapping[str, object]) -> Sequence[Mapping[str, object]]:
    return cast(Sequence[Mapping[str, object]], cobertura["compras"])


@dataclass(frozen=True, slots=True)
class CompraDeGlobo:
    """Lo que se compra de un globo del plan (producto, talla, forma y color) para su diseño y su reserva."""

    #: La combinación de ``optimizar_cobertura`` (``compras`` en orden de variante).
    cobertura: Mapping[str, object]
    #: Globos del diseño que lleva cada variante: todas llevan al menos uno.
    diseno: dict[str, int]
    #: Globos de reserva que cubre cada variante.
    reserva: dict[str, int]
    #: Variantes con más paquetes que los que pedía el diseño solo (``additional_package_for_waste``).
    para_reserva: frozenset[str]
    #: La reserva del globo: ``ceil(necesidad × merma)``.
    objetivo_reserva: int


#: Lo que se paga de más por los repuestos de un globo: hasta 10 000 COP, o hasta el 10 % de lo que cuesta su diseño.
TOPE_RESERVA_COP = 10_000
TOPE_RESERVA_PARTES = 10


def _costo(cobertura: Mapping[str, object]) -> int:
    return int(cast(int, cobertura["costo"]))


def comprar_globo(
    necesidad: int, opciones: Sequence[Mapping[str, object]], merma: float
) -> CompraDeGlobo | None:
    """D-038: el diseño y los repuestos de ESTE globo (talla y color), sin pagar de más por los repuestos.

    A quien se le revienta un rojo de 12″ le hace falta un rojo de 12″: la reserva es de cada globo, ``ceil(n × merma)``,
    no una para todo el plan. Se busca la combinación de paquetes que cubre ``n + reserva`` de una vez; se compra si
    cuesta sobre el diseño solo como mucho ``max(10 000 COP, 10 % del diseño)``. Si cuesta más (un ×25 entero para dos
    repuestos de 24″), se compra el diseño solo, la reserva usa lo que sobre de sus paquetes y lo que falte queda
    dicho como no cubierto. Cada variante lleva primero un globo del diseño y el resto del diseño se reparte en orden
    de variante; la reserva cubre lo que queda. Mismo algoritmo que ``comprarGlobo`` de ``plan-de-compra.ts``.
    """
    if necesidad <= 0:
        return None
    objetivo_reserva = math.ceil(necesidad * merma)
    solo_diseno = optimizar_cobertura(necesidad, opciones)
    if solo_diseno is None:
        return None
    cobertura = solo_diseno
    con_reserva = optimizar_cobertura(necesidad + objetivo_reserva, opciones, necesidad=necesidad)
    if con_reserva is not None:
        extra = _costo(con_reserva) - _costo(solo_diseno)
        if extra <= TOPE_RESERVA_COP or extra * TOPE_RESERVA_PARTES <= _costo(solo_diseno):
            cobertura = con_reserva
    antes = {
        str(compra["variant_id"]): int(cast(int, compra["paquetes"]))
        for compra in _compras(solo_diseno)
    }
    compras = _compras(cobertura)
    diseno: dict[str, int] = {}
    resto = necesidad - len(compras)
    for compra in compras:
        extra = min(resto, int(cast(int, compra["capacidad"])) - 1)
        diseno[str(compra["variant_id"])] = 1 + extra
        resto -= extra
    reserva: dict[str, int] = {}
    pendiente = objetivo_reserva
    for compra in compras:
        variante = str(compra["variant_id"])
        cubierta = min(pendiente, int(cast(int, compra["capacidad"])) - diseno[variante])
        reserva[variante] = cubierta
        pendiente -= cubierta
    para_reserva = frozenset(
        str(compra["variant_id"])
        for compra in compras
        if int(cast(int, compra["paquetes"])) > antes.get(str(compra["variant_id"]), 0)
    )
    return CompraDeGlobo(cobertura, diseno, reserva, para_reserva, objetivo_reserva)


class Presentacion(Protocol):
    @property
    def product_id(self) -> str: ...

    @property
    def variant_id(self) -> str: ...

    @property
    def diameter_inches(self) -> float | None: ...

    @property
    def shape(self) -> str | None: ...

    @property
    def size_code(self) -> str | None: ...

    @property
    def variant_colors(self) -> tuple[str, ...]: ...


P = TypeVar("P", bound=Presentacion)


def mismo_globo(referencia: Presentacion, otra: Presentacion) -> bool:
    """Otra presentación del globo de ``referencia``: mismo producto, talla, forma y color real de la variante.

    El color real de la variante se exige además del producto: un producto puede vender colores distintos como
    variantes de la misma talla, y esos no son el mismo globo. Y la talla es su código, no solo el diámetro: LOL 6 y
    LOL 660 miden 6″, pero el segundo es el eslabón largo (revisión 3 de D-038).
    """
    return (
        otra.product_id == referencia.product_id
        and otra.size_code == referencia.size_code
        and otra.diameter_inches == referencia.diameter_inches
        and otra.shape == referencia.shape
        and otra.variant_colors == referencia.variant_colors
    )


def presentaciones_del_globo(
    referencia: P | None, candidatos: Sequence[P], permitidas: Collection[str]
) -> list[P]:
    """Los paquetes entre los que se compra: los de la allowlist y cualquier otro del mismo globo."""
    return [
        candidato
        for candidato in candidatos
        if candidato.variant_id in permitidas
        or (referencia is not None and mismo_globo(referencia, candidato))
    ]


__all__ = [
    "CompraDeGlobo",
    "Presentacion",
    "TOPE_RESERVA_COP",
    "TOPE_RESERVA_PARTES",
    "comprar_globo",
    "mismo_globo",
    "optimizar_cobertura",
    "presentaciones_del_globo",
]
