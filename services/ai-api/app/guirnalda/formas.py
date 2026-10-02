"""Formas y estilos listos de guirnalda: la línea, el grosor, el relleno y la mezcla de tamaños, sin colores.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/guirnalda/formas.ts``.

Reproducen los tipos de guirnalda de las fotos de eventos (recta sobre la pared, festones colgados, nube,
diagonal, a lo largo del piso). Los colores y los adornos son los que tenga el diseño en ese momento: aplicar
una forma no los toca.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from app.guirnalda.tipos import ConfigGuir, config_inicial
from app.organico.tipos import Tamanos, Volumen

__all__ = ["ESTILOS_GUIR", "FORMAS_GUIRNALDA", "EstiloGuir", "FormaListaGuir", "aplicar_forma_guir", "config_inicial"]


@dataclass(frozen=True)
class FormaListaGuir:
    id: str
    nombre: str
    #: Qué tipo de guirnalda es y dónde se usa, en una frase.
    descripcion: str
    #: Solo los campos de la línea: ni `espejo`, ni `suelo`, ni `persona`, que son del diseño.
    forma: dict[str, float]
    volumen: Volumen
    tamanos: Tamanos
    semilla: float


@dataclass(frozen=True)
class EstiloGuir:
    """Cuánto se llena la guirnalda: cambia el grosor, el relleno y los racimos."""

    id: str
    nombre: str
    ayuda: str
    aplicar: Callable[[ConfigGuir], ConfigGuir]


def _v(
    grosor_patas_m: float,
    grosor_cima_m: float,
    irregularidad: float,
    relleno: float,
    racimo: float,
    salientes: float,
) -> Volumen:
    """Grosor en los extremos, grosor en el centro, irregularidad, relleno, racimo y salientes."""
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
    semilla: float,
    grandes_abajo: float = 0.3,
    variacion: float = 0.1,
) -> FormaListaGuir:
    return FormaListaGuir(
        id=ident,
        nombre=nombre,
        descripcion=descripcion,
        forma={
            "largoM": 3,
            "alturaM": 2.2,
            "pendienteM": 0,
            "ondaM": 0.06,
            "ondas": 1,
            "colgadoM": 0,
            "festones": 1,
            "carga": 0,
            **forma,
        },
        volumen=volumen,
        tamanos={
            "mezcla": {5: 0, 9: 0, 12: 0, 18: 0, 24: 0, 36: 0, **mezcla},
            "grandesAbajo": grandes_abajo,
            "inflado": 1,
            "variacion": variacion,
        },
        semilla=semilla,
    )


FORMAS_GUIRNALDA: list[FormaListaGuir] = [
    _armar(
        "recta",
        "Recta en la pared",
        "Una tira horizontal con una ondulación suave, como la que enmarca un fondo o una mesa.",
        {"largoM": 3, "alturaM": 2.2, "ondaM": 0.06, "ondas": 1},
        _v(0.4, 0.62, 0.35, 0.72, 4, 0.35),
        {5: 32, 12: 45, 18: 18, 24: 5},
        11,
    ),
    _armar(
        "ondulada",
        "Ondulada",
        "Sube y baja a lo largo de la pared, como una ola.",
        {"largoM": 3.6, "alturaM": 2.1, "ondaM": 0.25, "ondas": 2.5},
        _v(0.4, 0.58, 0.4, 0.7, 4, 0.4),
        {5: 30, 12: 46, 18: 20, 24: 4},
        7,
    ),
    _armar(
        "feston",
        "Festón colgante",
        "Delgada y colgada entre dos puntos, formando una U; para sobre una mesa o una puerta.",
        {"largoM": 2.4, "alturaM": 2.4, "colgadoM": 0.45, "festones": 1, "ondaM": 0.03},
        _v(0.3, 0.42, 0.3, 0.7, 3, 0.3),
        {5: 30, 12: 56, 18: 14},
        5,
    ),
    _armar(
        "doble-feston",
        "Doble festón",
        "Dos U seguidas colgadas de tres puntos; para paredes largas.",
        {"largoM": 4, "alturaM": 2.5, "colgadoM": 0.4, "festones": 2, "ondaM": 0.03},
        _v(0.32, 0.46, 0.35, 0.7, 4, 0.3),
        {5: 28, 12: 52, 18: 20},
        9,
    ),
    _armar(
        "diagonal",
        "Diagonal",
        "Sube en pendiente, como sobre una baranda o una escalera.",
        {"largoM": 3.2, "alturaM": 1.1, "pendienteM": 1.1, "ondaM": 0.08, "ondas": 1.5},
        _v(0.4, 0.58, 0.35, 0.7, 4, 0.35),
        {5: 30, 12: 46, 18: 20, 24: 4},
        3,
    ),
    _armar(
        "larga",
        "Larga y delgada",
        "Cinco o seis metros de una tira angosta, para recorrer toda una pared.",
        {"largoM": 6, "alturaM": 2.3, "ondaM": 0.14, "ondas": 3},
        _v(0.32, 0.44, 0.4, 0.7, 4, 0.3),
        {5: 26, 12: 60, 18: 14},
        14,
    ),
    _armar(
        "gruesa",
        "Gruesa y llena",
        "Ancha y voluminosa, sin huecos, con muchos globos chicos entre los grandes.",
        {"largoM": 3, "alturaM": 2.2, "ondaM": 0.1, "ondas": 1.5},
        _v(0.6, 0.95, 0.3, 0.85, 5, 0.45),
        {5: 44, 12: 32, 18: 18, 24: 6},
        8,
        variacion=0.12,
    ),
    _armar(
        "nube",
        "Nube",
        "Un montón corto y grueso que se afina en las puntas, pegado a la pared.",
        {"largoM": 2.2, "alturaM": 2, "ondaM": 0},
        _v(0.35, 0.9, 0.35, 0.8, 5, 0.4),
        {5: 24, 12: 40, 18: 28, 24: 8},
        6,
        grandes_abajo=0.4,
    ),
    _armar(
        "cargada",
        "Cargada a un lado",
        "Más gruesa y con los globos más grandes en un extremo, y ligera en el otro.",
        {"largoM": 3.4, "alturaM": 2.2, "ondaM": 0.1, "ondas": 1.5, "carga": 0.85},
        _v(0.4, 0.8, 0.4, 0.7, 4, 0.4),
        {5: 26, 12: 36, 18: 24, 24: 12, 36: 2},
        12,
        grandes_abajo=0.7,
    ),
    _armar(
        "aireada",
        "Aireada",
        "Poco relleno y racimos separados: se ve el aire entre los globos.",
        {"largoM": 3.6, "alturaM": 2.2, "ondaM": 0.14, "ondas": 2},
        _v(0.35, 0.52, 0.6, 0.42, 3, 0.6),
        {5: 15, 12: 50, 18: 30, 24: 5},
        4,
        variacion=0.14,
    ),
    _armar(
        "piso",
        "A lo largo del piso",
        "Tendida sobre el suelo, con globos grandes en los extremos; para el frente de una mesa.",
        {"largoM": 3.2, "alturaM": 0.45, "ondaM": 0.05, "ondas": 1},
        _v(0.55, 0.78, 0.4, 0.72, 4, 0.4),
        {5: 26, 12: 34, 18: 26, 24: 12, 36: 2},
        21,
        grandes_abajo=0.8,
    ),
]


def aplicar_forma_guir(c: ConfigGuir, f: FormaListaGuir) -> ConfigGuir:
    """El diseño con la línea, el volumen, los tamaños y la semilla de la forma. No toca colores ni adornos."""
    salida: ConfigGuir = dict(c)
    salida["forma"] = {**c["forma"], **f.forma}
    salida["volumen"] = dict(f.volumen)
    salida["tamanos"] = dict(f.tamanos)
    salida["aspecto"] = {**c["aspecto"], "semilla": f.semilla}
    return salida


def _con_volumen(c: ConfigGuir, **campos: float) -> ConfigGuir:
    salida: ConfigGuir = dict(c)
    salida["volumen"] = {**c["volumen"], **campos}
    return salida


def _estilo_gigantes(c: ConfigGuir) -> ConfigGuir:
    salida = _con_volumen(c, grosorPatasM=0.55, grosorCimaM=0.85, relleno=0.72)
    salida["tamanos"] = {
        **c["tamanos"],
        "mezcla": {5: 26, 9: 0, 12: 34, 18: 26, 24: 12, 36: 2},
        "grandesAbajo": 0.7,
    }
    return salida


ESTILOS_GUIR: list[EstiloGuir] = [
    EstiloGuir(
        "ligero",
        "Ligero",
        "Delgado y aireado, con espacio entre racimos.",
        lambda c: _con_volumen(c, grosorPatasM=0.32, grosorCimaM=0.44, relleno=0.5, racimo=3, irregularidad=0.5),
    ),
    EstiloGuir(
        "estandar",
        "Estándar",
        "El punto medio de una guirnalda de eventos.",
        lambda c: _con_volumen(c, grosorPatasM=0.4, grosorCimaM=0.62, relleno=0.72, racimo=4, irregularidad=0.35),
    ),
    EstiloGuir(
        "lleno",
        "Lleno",
        "Denso y voluminoso, sin huecos.",
        lambda c: _con_volumen(c, grosorPatasM=0.55, grosorCimaM=0.9, relleno=0.9, racimo=5, irregularidad=0.28),
    ),
    EstiloGuir(
        "gigantes",
        "Con globos gigantes",
        'Añade globos de 24" y 36" como puntos focales.',
        _estilo_gigantes,
    ),
]
