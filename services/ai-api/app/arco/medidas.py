"""Medidas y compra de un arco.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/arco/medidas.ts``.
"""

from __future__ import annotations

import copy
from typing import Any, cast

from app.arco.limites import sanear
from app.arco.motor import Resultado
from app.arco.tipos import INFLADO_PULG, TAMANOS_GLOBO, Config
from app.motores.js import _techo

PULGADA_M = 0.0254


def calcular_medidas(res: Resultado) -> dict[str, float]:
    """Diámetro, grosor y densidad de globos, con la estimación de la fórmula profesional de cuartetos."""
    return {
        "diametroCm": res.diametroM * 100,
        "diametroPulg": res.diametroM / PULGADA_M,
        "grosorCm": res.grosorM * 100,
        "globosPorMetro": len(res.globos) / res.largoM,
        # N = 4,8 · L / d (L y d en la misma unidad).
        "formulaClasica": (4.8 * res.largoM) / res.diametroM,
    }


def grosor_por_tamano(cfg: Config) -> list[dict[str, float]]:
    """Grosor de la banda (m) que daría cada tamaño de globo con los ajustes actuales.

    Si con ese tamaño no cabrían tantos globos a lo ancho, se cuentan los que sí caben: es lo que pasaría al
    elegirlo.
    """
    salida: list[dict[str, float]] = []
    for nominal in TAMANOS_GLOBO:
        prueba: Config = copy.deepcopy(cfg)
        prueba["globo"]["nominal"] = nominal
        n = sanear(prueba)[0]["geometria"]["globosAncho"]
        d = INFLADO_PULG[nominal] * cfg["globo"]["inflado"] * PULGADA_M
        salida.append({"nominal": nominal, "diametroCm": d * 100, "grosorM": (n * d) / cfg["globo"]["tamano"]})
    return salida


def calcular_compra(res: Resultado, desperdicio: float) -> dict[str, Any]:
    """Cantidad a comprar por color, con el margen de desperdicio redondeado hacia arriba."""
    lineas = [
        {
            "color": linea["color"],
            "cantidad": linea["cantidad"],
            "comprar": int(_techo(int(linea["cantidad"]) * (1 + desperdicio))),
        }
        for linea in res.conteo
    ]
    return {"lineas": lineas, "total": sum(int(cast(int, linea["comprar"])) for linea in lineas)}
