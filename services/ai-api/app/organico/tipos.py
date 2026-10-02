"""Tipos y valores iniciales de las estructuras orgánicas.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/organico/tipos.ts``.

**Las claves van en camelCase, como en el original.** El ``Config`` es el mismo objeto que viaja por el enlace
del diseñador y el que escriben los vectores de oro: traducir los nombres aquí obligaría a traducirlos de
vuelta en cada frontera y sería el sitio donde se pierde un campo sin que nada falle.

Los tamaños y el inflado se reexportan de ``app.arco.tipos``, igual que el original los reexporta de
``../arco/tipos``: hay un solo catálogo de tamaños de globo.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal, TypedDict, cast

from app.arco.tipos import INFLADO_PULG, TAMANOS_GLOBO

__all__ = [
    "ACABADOS",
    "COLORES_INICIALES",
    "ESTILOS",
    "INFLADO_PULG",
    "REPARTOS",
    "TAMANOS_GLOBO",
    "Acabado",
    "Adornos",
    "Aspecto",
    "CapaOrg",
    "ColorOrg",
    "Colores",
    "ConfigOrg",
    "Estilo",
    "Forma",
    "ModoOrg",
    "Real",
    "Reparto",
    "Tamanos",
    "Volumen",
    "config_inicial",
    "diametro_m",
]

Acabado = Literal["mate", "cromado", "confeti", "transparente"]
Reparto = Literal["azar", "tramos", "racimos"]
ModoOrg = Literal["mezcla", "capas"]
Rol = Literal["base", "acento"]


class OpcionAcabado(TypedDict):
    valor: str
    texto: str


class OpcionReparto(TypedDict):
    valor: str
    texto: str
    ayuda: str


ACABADOS: list[OpcionAcabado] = [
    {"valor": "mate", "texto": "Mate"},
    {"valor": "cromado", "texto": "Cromado"},
    {"valor": "confeti", "texto": "Confeti"},
    {"valor": "transparente", "texto": "Transparente"},
]

REPARTOS: list[OpcionReparto] = [
    {
        "valor": "azar",
        "texto": "Al azar",
        "ayuda": "Mezcla equilibrada: ningún color se repite junto a sí mismo si se puede evitar.",
    },
    {
        "valor": "tramos",
        "texto": "Por tramos",
        "ayuda": "Un color domina cada tramo del arco, en el orden de la lista.",
    },
    {
        "valor": "racimos",
        "texto": "En racimos",
        "ayuda": "Cada racimo es de un solo color, como en los arreglos profesionales.",
    },
]


class ColorOrg(TypedDict):
    """Un color de la paleta. ``rol`` «acento» son globos sueltos repartidos entre los demás."""

    hex: str
    #: Proporción relativa (1–100). Se normaliza sola.
    peso: float
    acabado: str
    rol: str


class Forma(TypedDict):
    """Forma del arco orgánico (metros). La guirnalda tiene la suya en ``app.guirnalda.tipos``."""

    anchoM: float
    altoM: float
    cima: float
    curva: float
    ondulacion: float
    carga: float
    corte: float
    espejo: bool
    suelo: bool


class Volumen(TypedDict):
    """Grosor visible de la banda y cómo se agrupan los globos.

    En una guirnalda ``grosorPatasM`` es el grosor en los **extremos** y ``grosorCimaM`` el del **centro**.
    """

    grosorPatasM: float
    grosorCimaM: float
    irregularidad: float
    relleno: float
    #: Globos por racimo (2–6).
    racimo: float
    #: Fracción de globos que se salen de la banda (0–1).
    salientes: float


class Tamanos(TypedDict):
    """Mezcla de tamaños y cómo se infla cada globo."""

    #: Peso de cada tamaño (0–100), con el nominal en pulgadas como clave. Se normaliza sola.
    mezcla: dict[int, float]
    grandesAbajo: float
    inflado: float
    variacion: float


class Colores(TypedDict, total=False):
    lista: list[ColorOrg]
    reparto: str
    #: Difuminado entre tramos / pureza de los racimos (0–1).
    mezcla: float
    #: Solo lo pone el modo por capas: el tamaño de globo de cada color de la lista.
    tamanoDe: list[int]


class CapaOrg(TypedDict):
    """Una capa de trabajo: los globos de un tamaño y un color (índice en la paleta)."""

    tamano: int
    color: int
    peso: float
    rol: str


class Adornos(TypedDict):
    """Tallos de follaje y flores por metro de línea guía (0–3)."""

    follaje: float
    flores: float


class Aspecto(TypedDict):
    brillo: float
    sombra: float
    contorno: float
    #: Cuánto se oscurecen los globos del fondo (0–1).
    profundidad: float
    semilla: float


class Real(TypedDict):
    desperdicio: float
    precio: float


class ConfigOrg(TypedDict, total=False):
    """El diseño completo de un arco orgánico. ``modo``/``capas`` son opcionales (diseños anteriores)."""

    forma: Forma
    volumen: Volumen
    tamanos: Tamanos
    colores: Colores
    adornos: Adornos
    aspecto: Aspecto
    real: Real
    modo: str
    capas: list[CapaOrg]


def diametro_m(t: int, inflado: float = 1) -> float:
    """Diámetro (m) al que se infla un tamaño, sin variación."""
    return float(INFLADO_PULG[t] * inflado * 0.0254)


COLORES_INICIALES: list[ColorOrg] = [
    {"hex": "#2f5d50", "peso": 26, "acabado": "mate", "rol": "base"},
    {"hex": "#9fb59a", "peso": 30, "acabado": "mate", "rol": "base"},
    {"hex": "#efe4d0", "peso": 28, "acabado": "mate", "rol": "base"},
    {"hex": "#ee5a2f", "peso": 10, "acabado": "mate", "rol": "acento"},
    {"hex": "#d4af37", "peso": 6, "acabado": "cromado", "rol": "acento"},
]


def config_inicial() -> ConfigOrg:
    """El diseño de partida del arco orgánico."""
    return {
        "forma": {
            "anchoM": 4,
            "altoM": 2.6,
            "cima": 0.42,
            "curva": 2,
            "ondulacion": 0.3,
            "carga": 0.35,
            "corte": 1,
            "espejo": False,
            "suelo": True,
        },
        "volumen": {
            "grosorPatasM": 0.9,
            "grosorCimaM": 0.62,
            "irregularidad": 0.35,
            "relleno": 0.72,
            "racimo": 4,
            "salientes": 0.35,
        },
        "tamanos": {
            "mezcla": {5: 32, 9: 0, 12: 45, 18: 18, 24: 5, 36: 0},
            "grandesAbajo": 0.6,
            "inflado": 1,
            "variacion": 0.1,
        },
        "colores": {
            "lista": [dict(c) for c in COLORES_INICIALES],  # type: ignore[misc]
            "reparto": "azar",
            "mezcla": 0.5,
        },
        "adornos": {"follaje": 0.8, "flores": 0},
        "aspecto": {
            "brillo": 0.6,
            "sombra": 0.2,
            "contorno": 0.8,
            "profundidad": 0.5,
            "semilla": 11,
        },
        "real": {"desperdicio": 0.12, "precio": 0},
        "modo": "mezcla",
        "capas": [],
    }


@dataclass(frozen=True)
class Estilo:
    """Un estilo de partida: distinta densidad y grosor (ligero / estándar / lleno)."""

    id: str
    nombre: str
    ayuda: str
    aplicar: Callable[[ConfigOrg], ConfigOrg]


def _con_volumen(cfg: ConfigOrg, **campos: float) -> ConfigOrg:
    salida: dict[str, Any] = dict(cfg)
    salida["volumen"] = {**cfg["volumen"], **campos}
    return cast(ConfigOrg, salida)


def _estilo_focales(cfg: ConfigOrg) -> ConfigOrg:
    salida: dict[str, Any] = dict(
        _con_volumen(cfg, grosorPatasM=1.2, grosorCimaM=0.75, relleno=0.75)
    )
    salida["tamanos"] = {
        **cfg["tamanos"],
        "mezcla": {5: 28, 9: 0, 12: 36, 18: 22, 24: 11, 36: 3},
        "grandesAbajo": 0.85,
    }
    return cast(ConfigOrg, salida)


ESTILOS: list[Estilo] = [
    Estilo(
        "ligero",
        "Ligero",
        "Aireado y delgado, con espacio entre racimos. Cuesta menos globos.",
        lambda c: _con_volumen(
            c, grosorPatasM=0.7, grosorCimaM=0.5, relleno=0.5, racimo=3, irregularidad=0.45
        ),
    ),
    Estilo(
        "estandar",
        "Estándar",
        "El punto medio de una guirnalda profesional.",
        lambda c: _con_volumen(
            c, grosorPatasM=0.9, grosorCimaM=0.62, relleno=0.72, racimo=4, irregularidad=0.35
        ),
    ),
    Estilo(
        "lleno",
        "Lleno",
        "Denso y voluminoso, sin huecos.",
        lambda c: _con_volumen(
            c, grosorPatasM=1.15, grosorCimaM=0.85, relleno=0.9, racimo=5, irregularidad=0.25
        ),
    ),
    Estilo(
        "focales",
        "Con globos gigantes",
        "Añade globos R24 y R36 como puntos focales en las patas.",
        _estilo_focales,
    ),
]
