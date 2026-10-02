"""Tipos y valores iniciales del diseñador de guirnaldas.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/guirnalda/tipos.ts``.

**Las claves van en camelCase, como en el original**: el ``ConfigGuir`` es el mismo objeto que viaja por el
enlace del diseñador y el que escriben los vectores de oro.
"""

from __future__ import annotations

from typing import TypedDict

from app.organico.tipos import COLORES_INICIALES, Adornos, Aspecto, Colores, Real, Tamanos, Volumen


class FormaGuir(TypedDict):
    """La línea de la guirnalda, en metros."""

    #: Largo de un extremo al otro.
    largoM: float
    #: Altura de la línea guía sobre el piso en el extremo izquierdo.
    alturaM: float
    #: Cuánto sube (+) o baja (−) el extremo derecho respecto al izquierdo.
    pendienteM: float
    #: Amplitud de la ondulación y cuántas ondas hay a lo largo.
    ondaM: float
    ondas: float
    #: Cuánto cuelga la línea entre los puntos de sujeción: 0 = tensa.
    colgadoM: float
    #: Cuántos festones (tramos colgados) forman la guirnalda.
    festones: float
    #: Lado más cargado: −1 izquierda, +1 derecha. Ese lado es más grueso y lleva los globos más grandes.
    carga: float
    #: Lo exige el motor compartido; una guirnalda nunca se voltea, así que `sanear` lo deja siempre en falso.
    espejo: bool
    suelo: bool
    #: Dibuja una persona de 1,70 m al lado para dar escala.
    persona: bool


class ConfigGuir(TypedDict):
    """El diseño completo de una guirnalda. No lleva ``modo``/``capas``: la guirnalda es siempre por mezcla."""

    forma: FormaGuir
    volumen: Volumen
    tamanos: Tamanos
    colores: Colores
    adornos: Adornos
    aspecto: Aspecto
    real: Real


def config_inicial() -> ConfigGuir:
    """El diseño de partida: 3 m de tira a 2,20 m de alto, con una ondulación suave y una persona al lado."""
    return {
        "forma": {
            "largoM": 3,
            "alturaM": 2.2,
            "pendienteM": 0,
            "ondaM": 0.12,
            "ondas": 1.5,
            "colgadoM": 0,
            "festones": 1,
            "carga": 0,
            "espejo": False,
            "suelo": True,
            "persona": True,
        },
        "volumen": {
            "grosorPatasM": 0.4,
            "grosorCimaM": 0.62,
            "irregularidad": 0.4,
            "relleno": 0.72,
            "racimo": 4,
            "salientes": 0.35,
        },
        "tamanos": {
            "mezcla": {5: 32, 9: 0, 12: 45, 18: 18, 24: 5, 36: 0},
            "grandesAbajo": 0.3,
            "inflado": 1,
            "variacion": 0.1,
        },
        "colores": {"lista": [dict(c) for c in COLORES_INICIALES], "reparto": "azar", "mezcla": 0.5},
        "adornos": {"follaje": 0.5, "flores": 0},
        "aspecto": {"brillo": 0.6, "sombra": 0.2, "contorno": 0.8, "profundidad": 0.5, "semilla": 11},
        "real": {"desperdicio": 0.12, "precio": 0},
    }
