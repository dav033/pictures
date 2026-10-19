"""Flores de globo como adorno de cualquier pieza: cuántos globos y de qué talla (dueño, 2026-10-07).

Una flor es un grupito de globos de 5″: ``petalos`` globos de un color (3 por defecto) y, si el plan lo pide, un
globo de centro de otro. Se suman ``cantidad`` veces a una pieza, **por pieza**: con ``repeticiones: 2`` cada una
lleva las suyas. El contrato y sus reglas son de ``src/lib/plan/flores-pieza.ts`` (``x-reglas-flores`` del esquema
exportado); aquí solo se leen.

Python es el dueño de las cantidades: este módulo dice cuántos globos lleva cada parte de la flor y qué variante del
catálogo los sirve (R-5; sin R-5 del producto, la talla redonda más cercana del mismo producto y color, con aviso), y
``plan.py`` escribe sus líneas —marcadas con ``adorno: "flor"``— junto a las del cuerpo, así que se compran por
paquete como cualquier otra.

Puro: sin red ni catálogo propio (los candidatos llegan de ``plan.py``).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Generic, Protocol, TypeVar, cast

from app.generated_models import contract_schema

_REGLAS = cast(Mapping[str, object], contract_schema("PlanDecoracion")["x-reglas-flores"])
#: Talla de un globo de flor (R-5).
PULGADAS_FLOR = float(cast(float, _REGLAS["pulgadas"]))
#: Pétalos de una flor cuando el plan no dice cuántos.
PETALOS_POR_DEFECTO = int(cast(int, _REGLAS["petalos_por_defecto"]))
#: Marca de las líneas de las flores en ``plan-resuelto.v1`` (``lineas[].adorno``).
ADORNO_FLOR = str(_REGLAS["adorno"])


class CandidatoFlor(Protocol):
    """Lo que la elección de talla necesita de un candidato del catálogo (``plan.Candidate``)."""

    @property
    def variant_id(self) -> str: ...

    @property
    def shape(self) -> str | None: ...

    @property
    def diameter_inches(self) -> float | None: ...

    @property
    def colors(self) -> tuple[str, ...]: ...


C = TypeVar("C", bound=CandidatoFlor)


@dataclass(frozen=True, slots=True)
class ParteFlor:
    """Una parte de las flores de una pieza: los pétalos o los centros, con todas sus unidades."""

    parte: str
    product_id: str
    color: str | None
    unidades: int


def partes_de_flores(flores: Mapping[str, object], repeticiones: int) -> list[ParteFlor]:
    """Los globos de las flores de una pieza: pétalos y, si los hay, centros, ya por sus repeticiones.

    ``flores`` es el adorno tal como lo trae el plan (validado contra el contrato). Cada flor lleva ``petalos``
    globos de pétalo y un centro; ``cantidad`` flores por pieza y ``repeticiones`` piezas.
    """
    cantidad = int(cast(int, flores.get("cantidad") or 0))
    petalos = int(cast(int, flores.get("petalos") or PETALOS_POR_DEFECTO))
    veces = max(1, repeticiones) * max(0, cantidad)
    partes: list[ParteFlor] = []
    for parte, por_flor in (("petalo", petalos), ("centro", 1)):
        material = flores.get(parte)
        if not isinstance(material, Mapping):
            continue
        product_id = material.get("product_id")
        color = material.get("color")
        if not isinstance(product_id, str) or not product_id.strip() or veces * por_flor <= 0:
            continue
        partes.append(
            ParteFlor(
                parte=parte,
                product_id=product_id.strip(),
                color=color.strip() if isinstance(color, str) and color.strip() else None,
                unidades=veces * por_flor,
            )
        )
    return partes


@dataclass(frozen=True, slots=True)
class TallaFlor(Generic[C]):
    """El candidato que sirve una parte de la flor y si es la talla pedida (R-5) o la más cercana."""

    candidato: C
    exacta: bool


def elegir_talla(
    candidatos: Sequence[C],
    color: str | None,
    unidades: int,
    costo: Callable[[C, int], int],
    normalizar: Callable[[str], str],
) -> TallaFlor[C] | None:
    """El globo redondo del producto que sirve la flor: R-5 si lo hay; si no, la talla redonda más cercana.

    Solo globos redondos del mismo producto (los que la allowlist admite: ``candidatos`` ya viene filtrado) y del
    color pedido si el producto tiene ese color en alguna variante; si ninguna variante lo nombra, el color no filtra
    (un Silk Blanco Nácar sin color de variante sigue siendo el pétalo perlado que el plan pidió). Entre las de la
    misma talla, la de menor costo de paquete para estas unidades (como ``plan._choose``); empate, la talla menor, que
    es la más parecida a una flor de 5″.
    """
    redondos = [
        candidato
        for candidato in candidatos
        if candidato.shape == "redondo"
        and candidato.diameter_inches is not None
        and candidato.diameter_inches > 0
    ]
    if color:
        buscado = normalizar(color)
        del_color = [candidato for candidato in redondos if buscado in candidato.colors]
        if del_color:
            redondos = del_color
    if not redondos:
        return None
    distancia = min(
        abs(cast(float, candidato.diameter_inches) - PULGADAS_FLOR) for candidato in redondos
    )
    cercanos = [
        candidato
        for candidato in redondos
        if abs(cast(float, candidato.diameter_inches) - PULGADAS_FLOR) == distancia
    ]
    elegido = min(
        cercanos,
        key=lambda candidato: (
            cast(float, candidato.diameter_inches),
            costo(candidato, unidades),
            candidato.variant_id,
        ),
    )
    return TallaFlor(candidato=elegido, exacta=elegido.diameter_inches == PULGADAS_FLOR)


def es_linea_de_flor(linea: Mapping[str, object]) -> bool:
    """¿La línea es de las flores (adorno) y no del cuerpo de la pieza?"""
    return linea.get("adorno") == ADORNO_FLOR


def lineas_del_cuerpo(lineas: Sequence[Mapping[str, object]]) -> list[Mapping[str, object]]:
    """Las líneas del cuerpo de la pieza, sin las de sus flores: lo que cuentan la mezcla, la densidad y la puerta."""
    return [linea for linea in lineas if not es_linea_de_flor(linea)]
