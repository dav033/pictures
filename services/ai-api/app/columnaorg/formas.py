"""Formas y estilos listos de columna orgánica: la silueta, el relleno y la mezcla de tamaños, sin colores.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/columnaorg/formas.ts``.

Reproducen los tipos de columna de las fotos de eventos (torre delgada, cono, montículo, columna gruesa de entrada,
inclinada, serpenteante, aireada, con pila de gigantes). Los colores son los que tenga el diseño en ese momento:
aplicar una forma no los toca.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from app.columnaorg.tipos import ConfigCol, config_inicial
from app.organico.tipos import Tamanos, Volumen

__all__ = [
    "ESTILOS_COL",
    "FORMAS_COLUMNA",
    "EstiloCol",
    "FormaListaCol",
    "aplicar_forma_col",
    "config_inicial",
]


@dataclass(frozen=True)
class FormaListaCol:
    id: str
    nombre: str
    #: Qué tipo de columna es y dónde se usa, en una frase.
    descripcion: str
    #: Solo los campos de la silueta: alto, inclinación, serpenteo y ondulación.
    forma: dict[str, float]
    volumen: Volumen
    tamanos: Tamanos
    semilla: float


@dataclass(frozen=True)
class EstiloCol:
    """Cuánto se llena la columna: cambia el grosor, el relleno y los racimos (y los gigantes, en el último)."""

    id: str
    nombre: str
    ayuda: str
    aplicar: Callable[[ConfigCol], ConfigCol]


def _v(
    grosor_patas_m: float,
    grosor_cima_m: float,
    irregularidad: float,
    relleno: float,
    racimo: float,
    salientes: float,
) -> Volumen:
    """Grosor de la base, grosor de la punta, irregularidad, relleno, racimo y salientes."""
    return {
        "grosorPatasM": grosor_patas_m,
        "grosorCimaM": grosor_cima_m,
        "irregularidad": irregularidad,
        "relleno": relleno,
        "racimo": racimo,
        "salientes": salientes,
    }


def _armar(
    ident: str,
    nombre: str,
    descripcion: str,
    forma: dict[str, float],
    volumen: Volumen,
    mezcla: dict[int, float],
    grandes_abajo: float,
    semilla: float,
    variacion: float = 0.1,
) -> FormaListaCol:
    return FormaListaCol(
        id=ident,
        nombre=nombre,
        descripcion=descripcion,
        forma=forma,
        volumen=volumen,
        tamanos={
            "mezcla": {5: 0, 9: 0, 12: 0, 18: 0, 24: 0, 36: 0, **mezcla},
            "grandesAbajo": grandes_abajo,
            "inflado": 1,
            "variacion": variacion,
        },
        semilla=semilla,
    )


FORMAS_COLUMNA: list[FormaListaCol] = [
    _armar(
        "torre",
        "Torre delgada",
        "Alta y esbelta: base con globos grandes y un tallo de globos que se afina hacia arriba.",
        {"altoM": 2.4, "inclinacionM": 0.12, "serpenteoM": 0.1, "ondulacion": 0.3},
        _v(0.8, 0.42, 0.5, 0.7, 4, 0.35),
        {5: 30, 12: 40, 18: 24, 24: 6},
        0.85,
        11,
    ),
    _armar(
        "cono",
        "Cono",
        "Ancho abajo y en punta arriba, como un árbol; para los lados de un fondo de mesa.",
        {"altoM": 2, "inclinacionM": 0, "serpenteoM": 0, "ondulacion": 0.15},
        _v(1, 0.35, 0.25, 0.75, 4, 0.3),
        {5: 38, 12: 40, 18: 18, 24: 4},
        0.9,
        4,
    ),
    _armar(
        "monticulo",
        "Montículo bajo",
        "Una pila baja y ancha que se sienta en el suelo junto a un fondo o un cartel.",
        {"altoM": 0.95, "inclinacionM": 0.05, "serpenteoM": 0, "ondulacion": 0.2},
        _v(0.95, 0.5, 0.35, 0.7, 4, 0.4),
        {5: 30, 12: 36, 18: 26, 24: 8},
        0.9,
        8,
        variacion=0.12,
    ),
    _armar(
        "gruesa",
        "Columna gruesa de entrada",
        "Ancha y llena de arriba abajo, con muchos globos chicos entre los grandes.",
        {"altoM": 2.8, "inclinacionM": 0, "serpenteoM": 0.08, "ondulacion": 0.25},
        _v(1.15, 0.85, 0.35, 0.8, 5, 0.45),
        {5: 44, 12: 32, 18: 18, 24: 6},
        0.7,
        9,
        variacion=0.12,
    ),
    _armar(
        "inclinada",
        "Inclinada",
        "Sube torcida hacia un lado, como si se estirara hacia la esquina.",
        {"altoM": 2.4, "inclinacionM": 0.6, "serpenteoM": 0.05, "ondulacion": 0.2},
        _v(0.8, 0.5, 0.4, 0.68, 4, 0.35),
        {5: 30, 12: 42, 18: 22, 24: 6},
        0.8,
        6,
    ),
    _armar(
        "serpenteante",
        "Serpenteante (en S)",
        "La línea se curva a un lado y al otro, como una ola vertical.",
        {"altoM": 2.6, "inclinacionM": 0, "serpenteoM": 0.42, "ondulacion": 0.2},
        _v(0.75, 0.5, 0.4, 0.68, 4, 0.4),
        {5: 30, 12: 42, 18: 22, 24: 6},
        0.7,
        14,
    ),
    _armar(
        "aireada",
        "Delgada y aireada",
        "Poco relleno y racimos separados: se ve el aire entre los globos.",
        {"altoM": 2.4, "inclinacionM": 0.1, "serpenteoM": 0.12, "ondulacion": 0.4},
        _v(0.55, 0.4, 0.6, 0.42, 3, 0.6),
        {5: 15, 12: 50, 18: 30, 24: 5},
        0.5,
        3,
        variacion=0.14,
    ),
    _armar(
        "gigantes",
        "Con pila de gigantes",
        "La base es un montón de globos gigantes y de ahí sube un tallo delgado.",
        {"altoM": 2.2, "inclinacionM": 0.1, "serpenteoM": 0.1, "ondulacion": 0.3},
        _v(1.2, 0.5, 0.4, 0.7, 4, 0.4),
        {5: 26, 12: 34, 18: 26, 24: 12, 36: 2},
        1,
        21,
        variacion=0.12,
    ),
]


def aplicar_forma_col(c: ConfigCol, f: FormaListaCol) -> ConfigCol:
    """El diseño con la silueta, el volumen, los tamaños y la semilla de la forma. No toca colores ni adornos."""
    salida: ConfigCol = dict(c)
    salida["forma"] = {**c["forma"], **f.forma}
    salida["volumen"] = dict(f.volumen)
    salida["tamanos"] = dict(f.tamanos)
    salida["aspecto"] = {**c["aspecto"], "semilla": f.semilla}
    return salida


def _con_volumen(c: ConfigCol, **campos: float) -> ConfigCol:
    salida: ConfigCol = dict(c)
    salida["volumen"] = {**c["volumen"], **campos}
    return salida


def _estilo_gigantes(c: ConfigCol) -> ConfigCol:
    salida = _con_volumen(c, grosorPatasM=1.2, grosorCimaM=0.5, relleno=0.72)
    salida["tamanos"] = {
        **c["tamanos"],
        "mezcla": {5: 26, 9: 0, 12: 34, 18: 26, 24: 12, 36: 2},
        "grandesAbajo": 1,
    }
    return salida


ESTILOS_COL: list[EstiloCol] = [
    EstiloCol(
        "ligero",
        "Ligero",
        "Delgado y aireado, con espacio entre racimos.",
        lambda c: _con_volumen(
            c, grosorPatasM=0.6, grosorCimaM=0.4, relleno=0.5, racimo=3, irregularidad=0.5
        ),
    ),
    EstiloCol(
        "estandar",
        "Estándar",
        "El punto medio de una columna de eventos.",
        lambda c: _con_volumen(
            c, grosorPatasM=0.85, grosorCimaM=0.45, relleno=0.72, racimo=4, irregularidad=0.4
        ),
    ),
    EstiloCol(
        "lleno",
        "Lleno",
        "Denso y voluminoso, sin huecos.",
        lambda c: _con_volumen(
            c, grosorPatasM=1.1, grosorCimaM=0.7, relleno=0.9, racimo=5, irregularidad=0.3
        ),
    ),
    EstiloCol(
        "gigantes",
        "Con globos gigantes",
        'Añade globos de 24" y 36" en la base.',
        _estilo_gigantes,
    ),
]
