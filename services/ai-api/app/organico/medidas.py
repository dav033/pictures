"""Medidas, densidad y lista de compra de una estructura orgánica.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/organico/medidas.ts``.
"""

from __future__ import annotations

from typing import Any

from app.motores import mate
from app.motores.js import _techo
from app.organico.motor import ResultadoOrg
from app.organico.tipos import TAMANOS_GLOBO, diametro_m

M_A_PIES = 3.28084


def calcular_medidas(res: ResultadoOrg, cfg: dict[str, Any]) -> dict[str, Any]:
    """Lo que se le enseña al cliente: tamaño, grosor en centímetros y globos por metro y por pie."""
    n = len(res.globos)
    return {
        "anchoM": res.anchoM,
        "altoM": res.altoM,
        "largoM": res.largoM,
        "grosorPatasCm": res.grosorPatasM * 100,
        "grosorCimaCm": res.grosorCimaM * 100,
        "globosPorMetro": n / res.largoM,
        "globosPorPie": n / (res.largoM * M_A_PIES),
        "capas": res.capas,
        "diametrosCm": {t: diametro_m(t, cfg["tamanos"]["inflado"]) * 100 for t in TAMANOS_GLOBO},
    }


#: Rangos de globos por pie que se citan en el oficio, para situar el diseño.
REFERENCIA_POR_PIE: list[dict[str, Any]] = [
    {"max": 10, "texto": "Ligero (hasta 10 por pie)"},
    {"max": 17, "texto": "Estándar (11–17 por pie)"},
    {"max": mate.inf, "texto": "Lleno (más de 17 por pie)"},
]


def etiqueta_densidad(por_pie: float) -> str:
    """En qué rango del oficio cae la densidad del diseño."""
    return next((r["texto"] for r in REFERENCIA_POR_PIE if por_pie <= r["max"]), "")


def calcular_compra(res: ResultadoOrg, cfg: dict[str, Any]) -> dict[str, Any]:
    """Materiales por color y por tamaño, con el desperdicio redondeado hacia arriba **en cada celda**.

    Celda por celda, no sobre el total: es lo que se pide al proveedor, y un paquete de un color no cubre la
    merma de otro.
    """
    filas: dict[int, dict[str, Any]] = {}
    for c in res.conteo:
        fila = filas.get(c["indice"])
        if fila is None:
            fila = {
                "color": c["color"],
                "acabado": c["acabado"],
                "indice": c["indice"],
                "porTamano": {},
                "cantidad": 0,
                "comprar": 0,
            }
            if c.get("remate"):
                fila["remate"] = True
            filas[c["indice"]] = fila
        fila["porTamano"][c["nominal"]] = fila["porTamano"].get(c["nominal"], 0) + c["cantidad"]
        fila["cantidad"] += c["cantidad"]
        fila["comprar"] += _techo(c["cantidad"] * (1 + cfg["real"]["desperdicio"]))
        filas[c["indice"]] = fila
    lista = sorted(filas.values(), key=lambda f: f["indice"])
    return {
        "filas": lista,
        "tamanos": [t for t in TAMANOS_GLOBO if res.porTamano[t] > 0],
        "total": sum(f["comprar"] for f in lista),
        "ramas": len(res.ramas),
        "flores": len(res.flores),
    }
