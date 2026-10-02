"""Formas listas de arco orgánico: la disposición completa (forma, grosor, relleno y mezcla), sin colores.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/organico/formas.ts``.

Reproducen los tipos de arreglo que se ven en fotos de eventos; los colores son los que tenga el diseño en ese
momento. La guirnalda tiene sus propias formas en ``app.guirnalda.formas``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.organico.tipos import Forma, Tamanos, Volumen, config_inicial


@dataclass(frozen=True)
class FormaLista:
    id: str
    nombre: str
    #: Qué tipo de arreglo es y dónde se usa, en una frase.
    descripcion: str
    forma: Forma
    volumen: Volumen
    tamanos: Tamanos
    semilla: float


def _v(
    grosor_patas_m: float,
    grosor_cima_m: float,
    irregularidad: float,
    relleno: float,
    racimo: float,
    salientes: float,
) -> Volumen:
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
    forma: dict[str, Any],
    volumen: Volumen,
    mezcla: dict[int, float],
    grandes_abajo: float,
    semilla: float,
    variacion: float = 0.1,
) -> FormaLista:
    base = config_inicial()
    return FormaLista(
        id=ident,
        nombre=nombre,
        descripcion=descripcion,
        forma={**base["forma"], "corte": 1, "espejo": False, **forma},
        volumen=volumen,
        tamanos={
            "mezcla": {5: 0, 9: 0, 12: 0, 18: 0, 24: 0, 36: 0, **mezcla},
            "grandesAbajo": grandes_abajo,
            "inflado": 1,
            "variacion": variacion,
        },
        semilla=semilla,
    )


FORMAS_LISTAS: list[FormaLista] = [
    _armar(
        "estandar",
        "Arco completo estándar",
        "Arco de dos patas con la cima un poco corrida y un lado más cargado.",
        {"anchoM": 4, "altoM": 2.6, "cima": 0.42, "curva": 2, "ondulacion": 0.3, "carga": 0.35},
        _v(0.9, 0.62, 0.35, 0.72, 4, 0.35),
        {5: 32, 12: 45, 18: 18, 24: 5},
        0.6,
        11,
    ),
    _armar(
        "simetrico",
        "Arco simétrico",
        "Las dos patas iguales y la cima centrada; el más clásico.",
        {"anchoM": 3.6, "altoM": 2.6, "cima": 0.5, "curva": 2, "ondulacion": 0.1, "carga": 0},
        _v(0.8, 0.7, 0.2, 0.7, 4, 0.25),
        {5: 28, 12: 46, 18: 22, 24: 4},
        0.5,
        2,
    ),
    _armar(
        "entrada",
        "Arco de entrada lleno",
        "Grueso y alto, con muchísimos globos chicos entre los grandes; para entradas y fachadas.",
        {"anchoM": 3.4, "altoM": 3, "cima": 0.55, "curva": 2.4, "ondulacion": 0.5, "carga": 0.3},
        _v(1, 0.8, 0.4, 0.8, 6, 0.5),
        {5: 50, 12: 28, 18: 14, 24: 8},
        0.7,
        9,
        variacion=0.12,
    ),
    _armar(
        "puerta",
        "Marco de puerta",
        "Delgado y cuadrado, con racimos apretados y los globos más grandes abajo.",
        {"anchoM": 2.4, "altoM": 2.1, "cima": 0.5, "curva": 3.2, "ondulacion": 0.08, "carga": 0},
        _v(0.52, 0.4, 0.4, 0.78, 5, 0.2),
        {5: 26, 12: 60, 18: 14},
        0.92,
        3,
        variacion=0.08,
    ),
    _armar(
        "fondo-fotos",
        "Arco abierto de fondo de fotos",
        "Ancho y de grosor medio, para enmarcar un fondo o una mesa de postres.",
        {"anchoM": 4.3, "altoM": 2.8, "cima": 0.46, "curva": 2.4, "ondulacion": 0.25, "carga": 0.2},
        _v(0.78, 0.62, 0.35, 0.6, 4, 0.35),
        {5: 20, 12: 40, 18: 26, 24: 14},
        0.5,
        12,
    ),
    _armar(
        "asimetrico",
        "Arco asimétrico de racimos",
        "Cima corrida hacia un lado y una pata mucho más cargada que la otra.",
        {"anchoM": 3.8, "altoM": 2.5, "cima": 0.36, "curva": 2.2, "ondulacion": 0.25, "carga": -0.4, "corte": 0.86},
        _v(0.95, 0.62, 0.3, 0.82, 5, 0.3),
        {5: 20, 12: 44, 18: 22, 24: 12, 36: 2},
        0.5,
        17,
    ),
    _armar(
        "medio-pila",
        "Medio arco con pila en el suelo",
        "Una pata gruesa con globos gigantes de anclaje que sube y se afina hacia el otro lado.",
        {"anchoM": 3.4, "altoM": 2.5, "cima": 0.4, "curva": 2.1, "ondulacion": 0.35, "carga": -0.7, "corte": 0.82},
        _v(1.15, 0.6, 0.4, 0.68, 4, 0.4),
        {5: 30, 12: 38, 18: 22, 24: 8, 36: 2},
        0.9,
        21,
        variacion=0.12,
    ),
    _armar(
        "medio-corto",
        "Medio arco corto sobre la puerta",
        "Sube por un lado y termina en el aire antes de bajar; se apoya en un marco.",
        {"anchoM": 3.3, "altoM": 2.3, "cima": 0.5, "curva": 2.2, "ondulacion": 0.3, "carga": -0.6, "corte": 0.68},
        _v(0.9, 0.5, 0.4, 0.56, 4, 0.35),
        {5: 26, 12: 40, 18: 27, 24: 7},
        0.8,
        4,
        variacion=0.12,
    ),
    _armar(
        "medio-aireado",
        "Medio arco aireado de globos grandes",
        "Pocas piezas y mucho aire: globos grandes en una cadena delgada.",
        {"anchoM": 2.7, "altoM": 2.5, "cima": 0.32, "curva": 2.3, "ondulacion": 0.3, "carga": -0.3, "corte": 0.74},
        _v(0.66, 0.52, 0.3, 0.6, 3, 0.3),
        {5: 8, 12: 38, 18: 46, 24: 8},
        0.3,
        5,
        variacion=0.14,
    ),
    _armar(
        "focales",
        "Arco con globos focales",
        'Globos de 24" repartidos como puntos de atención sobre una base más tranquila.',
        {"anchoM": 3.4, "altoM": 2.4, "cima": 0.34, "curva": 2.2, "ondulacion": 0.3, "carga": -0.5, "corte": 0.78},
        _v(1.05, 0.8, 0.35, 0.68, 4, 0.35),
        {5: 16, 12: 36, 18: 30, 24: 16, 36: 2},
        0.4,
        8,
    ),
    _armar(
        "racimos-sueltos",
        "Racimos sueltos",
        "Grupos separados por espacios; muy aireado y con muchos globos que se salen.",
        {"anchoM": 3.6, "altoM": 2.5, "cima": 0.45, "curva": 2.1, "ondulacion": 0.5, "carga": 0.2},
        _v(0.62, 0.5, 0.6, 0.4, 3, 0.7),
        {5: 14, 12: 50, 18: 32, 24: 4},
        0.4,
        6,
        variacion=0.14,
    ),
]
