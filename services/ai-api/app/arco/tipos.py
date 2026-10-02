"""Tipos del diseñador de arcos. Todo el estado del diseño vive en un ``Config`` serializable.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/arco/tipos.ts``.

**Las claves van en camelCase, como en el original.** No es descuido: el ``Config`` es el mismo objeto que
viaja por el enlace del diseñador, el que guarda el navegador y el que escriben los vectores de oro. Traducir
los nombres aquí obligaría a traducirlos de vuelta en cada frontera y sería el sitio donde se pierde un campo
sin que nada falle. Lo que sí está en español son las funciones y los comentarios.
"""

from __future__ import annotations

from typing import Literal, TypedDict

Forma = Literal["alto", "semi", "herradura"]

PATRON_IDS: tuple[str, ...] = (
    "solido",
    "bloques",
    "apilado",
    "espiral",
    "espiralPunteada",
    "zigzag",
    "chevron",
    "diamante",
    "punteado",
    "franjas",
    "floral",
    "ombre",
    "arcoiris",
    "doslados",
)

#: Tamaños de globo redondo de látex de Sempertex (el número es la pulgada nominal).
TAMANOS_GLOBO: tuple[int, ...] = (5, 9, 12, 18, 24, 36)

#: Diámetro típico ya inflado para arcos, en pulgadas. Aproximado: se ajusta con «Inflado».
INFLADO_PULG: dict[int, float] = {5: 4, 9: 8, 12: 10.5, 18: 14, 24: 20, 36: 30}

#: El tamaño más usado del catálogo y el que el diseñador trae por defecto.
TAMANO_ESTANDAR = 12

#: Máximo de colores en la secuencia de una capa personalizada.
MAX_SECUENCIA_ARCO = 16

#: Alto (m) de una sección del arco por altura: más o menos un cuarteto de globos R12 (dos filas).
SECCION_M = 0.4


class Geometria(TypedDict):
    """Forma y tamaño del arco, en metros. El grosor NO se elige: sale del globo y de los globos a lo ancho."""

    forma: Forma
    anchoM: float
    altoM: float
    globosAncho: int
    suelo: bool


class Globo(TypedDict):
    """Qué globo se usa y cómo se ve el conjunto."""

    nominal: int
    inflado: float
    tamano: float
    ovalo: float
    separacion: float
    compensacion: float
    variacionTam: float
    variacionTono: float
    desorden: float
    brillo: float
    sombra: float
    contorno: float
    profundidad: float
    semilla: int


class Real(TypedDict):
    """Datos de compra."""

    desperdicio: float
    precio: float


class Secuencia(TypedDict):
    """Una capa o una sección personalizada: su propia secuencia de colores."""

    colores: list[str]


#: `None` = sigue el patrón.
CapaArco = Secuencia | None
SeccionArco = Secuencia | None


class Distribucion(TypedDict):
    """La distribución de un patrón: cuántos globos a lo ancho y el tamaño del arco con el que se armó."""

    globosAncho: int
    anchoM: float
    altoM: float


class Tamano(TypedDict):
    anchoM: float
    altoM: float


class Config(TypedDict, total=False):
    patron: str
    #: Las secciones por altura, de abajo hacia arriba (la primera es la del piso).
    secciones: list[SeccionArco]
    #: La última distribución que tuvo cada patrón, para no arrastrar la del anterior al cambiar.
    recuerdo: dict[str, Distribucion]
    #: El tamaño que tenía el arco al entrar al arcoíris.
    ultimoNormal: Tamano
    #: Las capas de afuera hacia adentro, una por globo a lo ancho.
    capas: list[CapaArco]
    geometria: Geometria
    globo: Globo
    real: Real
    #: Colores de cada patrón (se conservan al cambiar de patrón).
    colores: dict[str, list[str]]
    #: Opciones numéricas de cada patrón.
    opciones: dict[str, dict[str, float]]


class Control(TypedDict, total=False):
    """Descripción de un control numérico propio de un patrón."""

    clave: str
    etiqueta: str
    min: float
    max: float
    paso: float
    def_: float
    #: Se muestra como interruptor (0/1).
    interruptor: bool
    #: Se muestra como selección entre opciones; el valor es el índice (0, 1, 2…).
    seleccion: list[str]
    ayuda: str


class Lista(TypedDict):
    """Un patrón de lista de colores de longitud variable."""

    min: int
    max: int
    etiqueta: str


#: Arco «Grande» (4 × 2,5 m) con globos R12: con estos valores se leen bien todos los patrones.
GEOMETRIA_INICIAL: Geometria = {
    "forma": "herradura",
    "anchoM": 4,
    "altoM": 2.5,
    "globosAncho": 4,
    "suelo": True,
}

REAL_INICIAL: Real = {"desperdicio": 0.08, "precio": 0}

GLOBO_INICIAL: Globo = {
    "nominal": TAMANO_ESTANDAR,
    "inflado": 1,
    "tamano": 1.14,
    "ovalo": 1.06,
    "separacion": 1,
    "compensacion": 0.85,
    # Por defecto el arco es regular (como uno armado con cuartetos): sin azar en tamaño, posición ni giro.
    "variacionTam": 0,
    "variacionTono": 0.03,
    "desorden": 0,
    "brillo": 0.6,
    "sombra": 0.17,
    "contorno": 1,
    "profundidad": 0.8,
    "semilla": 7,
}
