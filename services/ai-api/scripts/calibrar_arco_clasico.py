"""Compara el conteo del arco armado contra la fórmula de densidad que cotiza hoy.

Sirve para elegir las dos perillas del armado (globos por anillo y separación
entre anillos) que corresponden a cada densidad comercial, de modo que pasar el
arco clásico de la fórmula al armado **no mueva el precio**. Es una herramienta
de calibración: no cambia nada, solo imprime la tabla.

    uv run --directory services/ai-api python scripts/calibrar_arco_clasico.py

La fórmula de hoy se llama de ``app.plan`` en vez de copiarse: una copia sería
un segundo dueño de la misma cifra y la comparación dejaría de valer en cuanto
una de las dos cambiara.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.arco_clasico import (  # noqa: E402
    MAX_GLOBOS_ANILLO,
    MIN_GLOBOS_ANILLO,
    Arco,
    armar,
)
from app.plan import _total_globos  # noqa: E402

#: Arcos de catálogo, en metros. Son los tamaños que pide la gente: un arco de
#: entrada, uno de mesa de pastel y uno grande de escenario.
CASOS: tuple[tuple[str, float, float], ...] = (
    ("chico 2,5 × 2,2", 2.5, 2.2),
    ("mediano 3,0 × 2,4", 3.0, 2.4),
    ("estándar 4,0 × 2,5", 4.0, 2.5),
    ("ancho 5,0 × 2,8", 5.0, 2.8),
    ("grande 6,0 × 3,0", 6.0, 3.0),
)

DENSIDADES = ("sencilla", "media", "lujosa")
PASOS = (0.70, 0.75, 0.80, 0.85, 0.90)


def formula(ancho_m: float, alto_m: float, densidad: str) -> int:
    """Lo que cotiza hoy un arco clásico de esas medidas."""
    _eje, total = _total_globos(
        "arco",
        {"ancho_m": ancho_m, "alto_m": alto_m},
        densidad,
        "clasica",
        "arco",
    )
    return total


def armado(ancho_m: float, alto_m: float, k: int, paso: float) -> int:
    return armar(
        Arco(
            ancho_m=ancho_m,
            alto_m=alto_m,
            pulgadas=12,
            globos_por_anillo=k,
            paso_anillo_diametros=paso,
        )
    ).total


def main() -> None:
    print("Arco clásico: conteo armado contra la fórmula de densidad (R-12)\n")
    print("Fórmula de hoy (globos):")
    encabezado = f"{'caso':<20}" + "".join(f"{d:>10}" for d in DENSIDADES)
    print(encabezado)
    for nombre, ancho, alto in CASOS:
        fila = f"{nombre:<20}" + "".join(
            f"{formula(ancho, alto, d):>10}" for d in DENSIDADES
        )
        print(fila)

    print("\nArmado con paso 0,80 diámetros, por globos por anillo:")
    print(f"{'caso':<20}" + "".join(f"{'k=' + str(k):>8}" for k in range(MIN_GLOBOS_ANILLO, MAX_GLOBOS_ANILLO + 1)))
    for nombre, ancho, alto in CASOS:
        print(
            f"{nombre:<20}"
            + "".join(
                f"{armado(ancho, alto, k, 0.80):>8}"
                for k in range(MIN_GLOBOS_ANILLO, MAX_GLOBOS_ANILLO + 1)
            )
        )

    print("\nDesvío del armado contra la fórmula, por densidad (%):")
    for densidad in DENSIDADES:
        print(f"\n  {densidad}")
        print(
            f"  {'k / paso':<10}" + "".join(f"{paso:>9.2f}" for paso in PASOS)
        )
        for k in range(MIN_GLOBOS_ANILLO, MAX_GLOBOS_ANILLO + 1):
            celdas = []
            for paso in PASOS:
                desvios = [
                    100 * (armado(ancho, alto, k, paso) / formula(ancho, alto, densidad) - 1)
                    for _nombre, ancho, alto in CASOS
                ]
                medio = sum(desvios) / len(desvios)
                celdas.append(f"{medio:>+9.1f}")
            print(f"  k={k:<8}" + "".join(celdas))

    print(
        "\nEl mejor par por densidad es el de desvío medio más cercano a cero;"
        "\nla banda de un anillo mide 2,41 diámetros con k=4 y crece con k, así"
        "\nque un k alto deja de ser un arco y pasa a ser una columna gorda."
    )


if __name__ == "__main__":
    main()
