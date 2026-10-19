"""Tipos y valores iniciales del diseñador de columnas orgánicas.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/columnaorg/tipos.ts``.

**Las claves van en camelCase, como en el original**: el ``ConfigCol`` es el mismo objeto que viaja por el enlace
del diseñador y el que escriben los vectores de oro.
"""

from __future__ import annotations

from typing import TypedDict

from app.organico.tipos import COLORES_INICIALES, Adornos, Aspecto, Colores, Real, Tamanos, Volumen


class FormaCol(TypedDict):
    """La línea de la columna, en metros."""

    #: Alto de la columna.
    altoM: float
    #: Cuánto se corre la punta hacia un lado; negativo = hacia la izquierda.
    inclinacionM: float
    #: Amplitud de la S con que serpentea la línea.
    serpenteoM: float
    #: Cuánto tiembla la línea (0 = recta).
    ondulacion: float
    #: Campos que el motor compartido espera; una columna no los usa (``sanear`` los deja en 0 y en falso).
    carga: float
    espejo: bool
    suelo: bool
    #: Muestra una persona de 1,70 m junto a la columna para dar escala.
    persona: bool


class CoronaCol(TypedDict):
    """Globo grande sobre la punta."""

    activa: bool
    tamano: int
    color: str


class ConfigCol(TypedDict):
    """El diseño completo de una columna orgánica. No lleva ``modo``/``capas``: siempre es por mezcla."""

    forma: FormaCol
    volumen: Volumen
    tamanos: Tamanos
    colores: Colores
    adornos: Adornos
    aspecto: Aspecto
    real: Real
    corona: CoronaCol


def config_inicial() -> ConfigCol:
    """El diseño de partida: 2,20 m, base de 85 cm y punta de 45 cm, con una persona al lado."""
    return {
        "forma": {
            "altoM": 2.2,
            "inclinacionM": 0.12,
            "serpenteoM": 0.1,
            "ondulacion": 0.3,
            "carga": 0,
            "espejo": False,
            "suelo": True,
            "persona": True,
        },
        "volumen": {
            "grosorPatasM": 0.85,
            "grosorCimaM": 0.45,
            "irregularidad": 0.4,
            "relleno": 0.72,
            "racimo": 4,
            "salientes": 0.35,
        },
        "tamanos": {
            "mezcla": {5: 32, 9: 0, 12: 42, 18: 20, 24: 6, 36: 0},
            "grandesAbajo": 0.8,
            "inflado": 1,
            "variacion": 0.1,
        },
        "colores": {
            "lista": [dict(c) for c in COLORES_INICIALES],
            "reparto": "azar",
            "mezcla": 0.5,
        },
        "adornos": {"follaje": 0.6, "flores": 0},
        "aspecto": {
            "brillo": 0.6,
            "sombra": 0.2,
            "contorno": 0.8,
            "profundidad": 0.5,
            "semilla": 11,
        },
        "real": {"desperdicio": 0.12, "precio": 0},
        "corona": {"activa": False, "tamano": 24, "color": "#efe4d0"},
    }
