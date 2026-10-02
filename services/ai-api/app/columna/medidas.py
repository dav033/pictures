"""Medidas de la columna y lista de compra.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/columna/medidas.ts``. El criterio se define allá;
aquí solo se replica. Ver ``app/armado_columna.py`` y ``docs/architecture/decisions/0033-motor-de-columna-migrado.md``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from app.columna.js import _maximo, _techo
from app.columna.motor import Resultado
from app.columna.tipos import TAMANOS_GLOBO, Config, TamanoGlobo, diametro_m

# ---------------------------------------------------------------------------
# Medidas y compra (``medidas.ts``)
# ---------------------------------------------------------------------------


@dataclass
class Medidas:
    alto_cuerpo_m: float
    alto_total_m: float
    diametro_cm: float
    capas: int
    globos: int
    globos_por_metro: float
    #: La fórmula clásica: capas = alto / (0,8 · diámetro), con los globos por capa.
    formula_clasica: float
    diametros_cm: dict[TamanoGlobo, float]


def calcular_medidas(res: Resultado, cfg: Config) -> Medidas:
    # Por capas, cada capa lleva los suyos: se usa el promedio.
    n = (
        len(res.globos) / res.capas
        if cfg.modo == "capas" and res.capas > 0
        else cfg.columna.globos_capa
    )
    d_medio = sum(b.r * 2 for b in res.globos) / _maximo(1, len(res.globos))
    return Medidas(
        alto_cuerpo_m=res.alto_cuerpo_m,
        alto_total_m=res.alto_total_m,
        diametro_cm=res.diametro_m * 100,
        capas=res.capas,
        globos=len(res.globos),
        globos_por_metro=len(res.globos) / _maximo(0.1, res.alto_cuerpo_m),
        formula_clasica=n * (res.alto_cuerpo_m / (0.8 * d_medio)),
        diametros_cm={t: diametro_m(t, cfg.globo.inflado) * 100 for t in TAMANOS_GLOBO},
    )


@dataclass
class FilaCompra:
    color: str
    por_tamano: dict[TamanoGlobo, int]
    cantidad: int
    comprar: int
    #: Fila del remate: no forma parte del cuerpo.
    remate: bool = False


@dataclass
class Compra:
    filas: list[FilaCompra]
    tamanos: list[TamanoGlobo]
    total: int
    foil: str
    veces: int


def calcular_compra(res: Resultado, cfg: Config) -> Compra:
    """Materiales por color y tamaño, con el desperdicio redondeado hacia arriba en cada celda."""
    veces = int(cfg.real.cantidad)
    filas: dict[str, FilaCompra] = {}

    def sumar(color: str, nominal: TamanoGlobo, cantidad: int, remate: bool) -> None:
        clave = f"{'r' if remate else 'c'}|{color}"
        fila = filas.get(clave)
        if fila is None:
            fila = FilaCompra(color=color, por_tamano={}, cantidad=0, comprar=0, remate=remate)
            filas[clave] = fila
        total = cantidad * veces
        fila.por_tamano[nominal] = fila.por_tamano.get(nominal, 0) + total
        fila.cantidad += total
        fila.comprar += int(_techo(total * (1 + cfg.real.desperdicio)))

    for entrada in res.conteo:
        sumar(
            cast(str, entrada["color"]),
            cast(TamanoGlobo, entrada["nominal"]),
            cast(int, entrada["cantidad"]),
            False,
        )
    for entrada in res.remate.globos:
        sumar(
            cast(str, entrada["color"]),
            cast(TamanoGlobo, entrada["nominal"]),
            cast(int, entrada["cantidad"]),
            True,
        )
    lista = sorted(filas.values(), key=lambda f: 1 if f.remate else 0)
    tamanos = [t for t in TAMANOS_GLOBO if any(f.por_tamano.get(t, 0) > 0 for f in lista)]
    return Compra(
        filas=lista,
        tamanos=tamanos,
        total=sum(f.comprar for f in lista),
        foil=f"{veces} × {res.remate.foil}" if res.remate.foil else "",
        veces=veces,
    )
