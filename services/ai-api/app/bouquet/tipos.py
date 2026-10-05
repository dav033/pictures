"""Tipos y valores iniciales del diseñador de bouquets.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/bouquet/tipos.ts``.

**Las claves van en camelCase, como en el original**: el ``ConfigRamo`` es el mismo objeto que viaja por el
enlace del diseñador y el que escriben los vectores de oro.

Un ramillete de globos atados con cintas a un mismo punto, que flotan juntos sobre un peso en el piso. Los
globos van a distintas alturas (niveles de cinta) para que no se enreden; cada globo se gira para que su nudo
apunte al punto donde se juntan las cintas.
"""

from __future__ import annotations

from typing import Literal, TypedDict

from app.organico.tipos import COLORES_INICIALES, Aspecto, Colores, Real, Tamanos

__all__ = [
    "COLORES_INICIALES",
    "ESPECIALES",
    "MODOS",
    "NUMEROS",
    "TAMANOS_ESPECIAL",
    "Cinta",
    "ConfigRamo",
    "ContenidoBurbuja",
    "Especial",
    "FormaRamo",
    "ModoRamo",
    "Peso",
    "TipoEspecial",
    "TipoPeso",
    "config_inicial",
    "especial_nuevo",
]

TipoEspecial = Literal["burbuja", "estrella", "corazon", "redondo", "numero"]


class OpcionEspecial(TypedDict):
    valor: str
    texto: str
    ayuda: str


ESPECIALES: list[OpcionEspecial] = [
    {
        "valor": "burbuja",
        "texto": "Burbuja transparente",
        "ayuda": "Globo transparente grande; puede llevar confeti o plumas dentro.",
    },
    {"valor": "estrella", "texto": "Estrella foil", "ayuda": "Globo de foil en forma de estrella."},
    {"valor": "corazon", "texto": "Corazón foil", "ayuda": "Globo de foil en forma de corazón."},
    {"valor": "redondo", "texto": "Redondo foil", "ayuda": "Globo de foil redondo."},
    {
        "valor": "numero",
        "texto": "Número foil",
        "ayuda": "Globo de foil en forma de número (del 0 al 9).",
    },
]


class TamanoEspecial(TypedDict):
    cm: float
    texto: str


#: Tamaños comunes (cm) de cada especial: alto del foil o diámetro de la burbuja.
TAMANOS_ESPECIAL: dict[str, list[TamanoEspecial]] = {
    "burbuja": [
        {"cm": 46, "texto": "18″ · 46 cm"},
        {"cm": 56, "texto": "22″ · 56 cm"},
        {"cm": 61, "texto": "24″ · 61 cm"},
        {"cm": 91, "texto": "36″ · 91 cm"},
    ],
    "estrella": [
        {"cm": 46, "texto": "18″ · 46 cm"},
        {"cm": 91, "texto": "36″ · 91 cm"},
    ],
    "corazon": [
        {"cm": 46, "texto": "18″ · 46 cm"},
        {"cm": 91, "texto": "36″ · 91 cm"},
    ],
    "redondo": [
        {"cm": 46, "texto": "18″ · 46 cm"},
        {"cm": 91, "texto": "36″ · 91 cm"},
    ],
    "numero": [
        {"cm": 40, "texto": "16″ · 40 cm"},
        {"cm": 86, "texto": "34″ · 86 cm"},
    ],
}

ContenidoBurbuja = Literal["vacio", "confeti", "plumas"]


class Especial(TypedDict):
    """Un tipo de globo especial (foil o burbuja) y cuántos lleva el ramo."""

    tipo: str
    cantidad: float
    #: Alto del foil o diámetro de la burbuja (cm).
    cm: float
    color: str
    #: Solo para el número foil.
    numero: float
    #: Solo para la burbuja.
    contenido: str


#: Cómo se acomoda el ramo. «flotante»: los globos suben por niveles de cinta larga, como un ramo clásico.
#: «suelo»: un montón de globos grandes con la cinta corta, pegados al piso alrededor del peso.
ModoRamo = Literal["flotante", "suelo"]


class OpcionModo(TypedDict):
    valor: str
    texto: str
    ayuda: str


MODOS: list[OpcionModo] = [
    {
        "valor": "flotante",
        "texto": "Flotante",
        "ayuda": "Cintas largas y globos a distintas alturas; el ramo sube desde el peso.",
    },
    {
        "valor": "suelo",
        "texto": "A ras del suelo",
        "ayuda": (
            "Cintas cortas: los globos, grandes, forman un montón pegado al piso alrededor del peso."
        ),
    },
]


class FormaRamo(TypedDict):
    """Cómo se acomoda el ramo."""

    #: Flotante (niveles de cinta) o a ras del suelo (montón de globos grandes).
    modo: str
    #: Solo a ras del suelo: los globos grandes van abajo (cerca del peso) o arriba.
    grandes: str
    #: Cuán ancho es el ramo respecto a su alto (0,5 = alto y angosto; 1,6 = abanico).
    ancho: float
    #: Alturas distintas de cinta (1–4): con más niveles el ramo es más alto y se enreda menos.
    niveles: float
    #: Diferencia de largo de cinta entre un nivel y el siguiente, respecto al diámetro medio (0,5–1,2).
    escalon: float
    #: Cuánto se aprietan los globos entre sí (0,7 = sueltos, 1,2 = muy apretados).
    apretado: float
    #: Hacia dónde se inclina el ramo (−1 izquierda, +1 derecha).
    inclinacion: float
    desorden: float
    #: Largo de la cinta más corta, desde el peso hasta el nudo (m).
    cintaM: float
    #: Muestra una persona de 1,70 m junto al ramo para dar escala.
    persona: bool
    suelo: bool


class Cinta(TypedDict):
    tipo: str
    color: str


TipoPeso = Literal["regalo", "bolsa", "ninguno"]


class Peso(TypedDict):
    tipo: str
    color: str


class ConfigRamo(TypedDict):
    """El diseño completo de un bouquet."""

    #: Cuántos globos de látex redondos lleva (además de los especiales).
    latex: float
    tamanos: Tamanos
    colores: Colores
    especiales: list[Especial]
    forma: FormaRamo
    cinta: Cinta
    peso: Peso
    aspecto: Aspecto
    real: Real
    #: Cuántos ramos iguales se van a armar (multiplica los materiales).
    ramos: float


NUMEROS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]


def especial_nuevo(tipo: str, color: str = "#d4af37") -> Especial:
    """Un especial recién añadido: uno solo, del tamaño más chico de su tipo, con confeti si es burbuja."""
    return {
        "tipo": tipo,
        "cantidad": 1,
        "cm": TAMANOS_ESPECIAL[tipo][0]["cm"],
        "color": color,
        "numero": 1,
        "contenido": "confeti",
    }


def config_inicial() -> ConfigRamo:
    """El diseño de partida: siete globos de látex en tres niveles y una burbuja con plumas."""
    return {
        "latex": 7,
        "tamanos": {
            "mezcla": {5: 0, 9: 0, 12: 70, 18: 30, 24: 0, 36: 0},
            "grandesAbajo": 0.5,
            "inflado": 1,
            "variacion": 0.06,
        },
        "colores": {
            "lista": [
                {"hex": "#ffffff", "peso": 34, "acabado": "mate", "rol": "base"},
                {"hex": "#f4c7b5", "peso": 30, "acabado": "mate", "rol": "base"},
                {"hex": "#c98b6b", "peso": 20, "acabado": "cromado", "rol": "acento"},
                {"hex": "#f3e3c3", "peso": 16, "acabado": "confeti", "rol": "acento"},
            ],
            "reparto": "azar",
            "mezcla": 0.3,
        },
        "especiales": [{**especial_nuevo("burbuja", "#ffffff"), "contenido": "plumas"}],
        "forma": {
            "modo": "flotante",
            "grandes": "abajo",
            "ancho": 1,
            "niveles": 3,
            "escalon": 0.75,
            "apretado": 1,
            "inclinacion": 0,
            "desorden": 0.3,
            "cintaM": 1.1,
            "persona": True,
            "suelo": True,
        },
        "cinta": {"tipo": "rizada", "color": "#e6b8a2"},
        "peso": {"tipo": "regalo", "color": "#f6efe6"},
        "aspecto": {
            "brillo": 0.6,
            "sombra": 0.16,
            "contorno": 0.6,
            "profundidad": 0.35,
            "semilla": 5,
        },
        "real": {"desperdicio": 0.1, "precio": 0},
        "ramos": 1,
    }
