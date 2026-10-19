"""Formas listas de bouquet: cuántos globos, la mezcla de tamaños, los especiales y cómo se acomodan.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/bouquet/formas.ts``.

Los colores del látex, las cintas y el peso son los que tenga el diseño. Los especiales toman sus colores de
los colores del diseño (los de acento primero), para que combinen.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TypedDict

from app.bouquet.tipos import ConfigRamo, Especial, especial_nuevo

__all__ = ["FORMAS_RAMO", "FormaListaRamo", "aplicar_forma_ramo"]


class FormaParcial(TypedDict):
    """Solo los campos de la forma que una forma lista cambia (no ``persona`` ni ``suelo``)."""

    modo: str
    grandes: str
    ancho: float
    niveles: float
    escalon: float
    apretado: float
    inclinacion: float
    desorden: float
    cintaM: float


class EspecialSinColor(TypedDict):
    """Un especial de una forma lista: como ``Especial`` pero sin color (lo toma del diseño)."""

    tipo: str
    cantidad: float
    cm: float
    numero: float
    contenido: str


@dataclass(frozen=True)
class FormaListaRamo:
    id: str
    nombre: str
    descripcion: str
    latex: float
    #: Solo los tamaños que lleva; los demás quedan en 0 al aplicarla.
    mezcla: dict[int, float]
    #: Especiales que lleva, sin color (toman los del diseño).
    especiales: list[EspecialSinColor]
    forma: FormaParcial
    semilla: float


def _esp(
    tipo: str,
    *,
    cantidad: float | None = None,
    cm: float | None = None,
    numero: float | None = None,
    contenido: str | None = None,
) -> EspecialSinColor:
    """Un especial de una forma lista: parte del recién añadido y le cambia lo que haga falta."""
    base = especial_nuevo(tipo)
    return {
        "tipo": base["tipo"],
        "cantidad": base["cantidad"] if cantidad is None else cantidad,
        "cm": base["cm"] if cm is None else cm,
        "numero": base["numero"] if numero is None else numero,
        "contenido": base["contenido"] if contenido is None else contenido,
    }


def _F(
    ancho: float,
    niveles: float,
    escalon: float,
    apretado: float,
    inclinacion: float,
    desorden: float,
    cinta_m: float,
) -> FormaParcial:
    """Forma de un ramo flotante: niveles de cinta larga."""
    return {
        "modo": "flotante",
        "grandes": "abajo",
        "ancho": ancho,
        "niveles": niveles,
        "escalon": escalon,
        "apretado": apretado,
        "inclinacion": inclinacion,
        "desorden": desorden,
        "cintaM": cinta_m,
    }


def _FS(
    ancho: float,
    altura: float,
    apretado: float,
    inclinacion: float,
    desorden: float,
    cinta_m: float,
    grandes: str = "abajo",
) -> FormaParcial:
    """Forma de un ramo a ras del suelo: cinta corta y globos grandes en montón.

    ``altura`` es cuánto sube el montón (el escalón).
    """
    return {
        "modo": "suelo",
        "grandes": grandes,
        "ancho": ancho,
        "niveles": 2,
        "escalon": altura,
        "apretado": apretado,
        "inclinacion": inclinacion,
        "desorden": desorden,
        "cintaM": cinta_m,
    }


FORMAS_RAMO: list[FormaListaRamo] = [
    FormaListaRamo(
        id="mini",
        nombre="Mini (3 globos)",
        descripcion="Tres globos en dos niveles; para una mesa o un detalle.",
        latex=3,
        mezcla={12: 100},
        especiales=[],
        forma=_F(1, 2, 0.8, 1, 0, 0.3, 0.7),
        semilla=3,
    ),
    FormaListaRamo(
        id="clasico",
        nombre="Clásico redondo (7)",
        descripcion="Siete globos en tres niveles, en un ramo redondo y compacto.",
        latex=7,
        mezcla={12: 75, 18: 25},
        especiales=[],
        forma=_F(1, 3, 0.75, 1, 0, 0.3, 1.1),
        semilla=5,
    ),
    FormaListaRamo(
        id="burbuja",
        nombre="Con burbuja arriba",
        descripcion="Una burbuja transparente con plumas coronando un ramo de látex.",
        latex=7,
        mezcla={12: 70, 18: 30},
        especiales=[_esp("burbuja", contenido="plumas", cm=61)],
        forma=_F(1, 3, 0.75, 1, 0, 0.3, 1.1),
        semilla=5,
    ),
    FormaListaRamo(
        id="numero",
        nombre="Con número foil",
        descripcion="Un número grande de foil arriba, con látex alrededor; para cumpleaños.",
        latex=6,
        mezcla={12: 80, 18: 20},
        especiales=[_esp("numero", numero=2, cm=86)],
        forma=_F(1, 3, 0.8, 1, 0, 0.3, 1.2),
        semilla=8,
    ),
    FormaListaRamo(
        id="alto",
        nombre="Alto y angosto",
        descripcion="Cuatro niveles de cinta en columna: sube más que ancho; para un rincón.",
        latex=10,
        mezcla={12: 85, 18: 15},
        especiales=[],
        forma=_F(0.6, 4, 0.9, 1, 0, 0.3, 1),
        semilla=4,
    ),
    FormaListaRamo(
        id="abanico",
        nombre="Abanico",
        descripcion="Dos niveles y más ancho que alto, abierto como un abanico.",
        latex=9,
        mezcla={12: 80, 18: 20},
        especiales=[],
        forma=_F(1.5, 2, 0.75, 0.95, 0, 0.35, 1.2),
        semilla=12,
    ),
    FormaListaRamo(
        id="cascada",
        nombre="Cascada",
        descripcion=(
            "Cintas de largos muy distintos: los globos quedan escalonados desde abajo hasta arriba."
        ),
        latex=8,
        mezcla={12: 70, 18: 30},
        especiales=[],
        forma=_F(0.9, 4, 1.15, 0.9, 0.3, 0.5, 1),
        semilla=6,
    ),
    FormaListaRamo(
        id="grande",
        nombre="Grande (15 globos)",
        descripcion="Quince globos en cuatro niveles: un ramo lleno para una entrada.",
        latex=15,
        mezcla={12: 70, 18: 30},
        especiales=[],
        forma=_F(1.1, 4, 0.7, 1.05, 0, 0.35, 1.2),
        semilla=9,
    ),
    FormaListaRamo(
        id="foil",
        nombre="Solo foil (estrellas y corazones)",
        descripcion='Cuatro globos de foil de 18" en dos niveles, sin látex.',
        latex=0,
        mezcla={12: 100},
        especiales=[
            _esp("estrella", cantidad=2),
            _esp("estrella", cantidad=1),
            _esp("corazon", cantidad=1),
        ],
        forma=_F(1, 2, 0.75, 1, 0, 0.3, 1),
        semilla=7,
    ),
    FormaListaRamo(
        id="inclinado",
        nombre="Inclinado",
        descripcion="El ramo se corre hacia un lado, como si lo empujara una corriente.",
        latex=9,
        mezcla={12: 80, 18: 20},
        especiales=[],
        forma=_F(1, 3, 0.75, 1, 0.9, 0.4, 1.1),
        semilla=14,
    ),
    # ---- A ras del suelo: globos grandes, cinta corta, en montón junto al peso ----
    FormaListaRamo(
        id="suelo-monticulo",
        nombre="Montículo de gigantes (7)",
        descripcion=(
            "Siete globos de 24″ y 36″ apilados junto al piso, con la cinta corta:"
            " el «floor bouquet» clásico."
        ),
        latex=7,
        mezcla={24: 40, 36: 60},
        especiales=[],
        forma=_FS(1, 0.7, 1.05, 0, 0.3, 0.15),
        semilla=11,
    ),
    FormaListaRamo(
        id="suelo-nube",
        nombre="Nube ancha (12)",
        descripcion=(
            "Doce globos de 18″ a 36″ en un montón bajo y ancho, para una esquina o el pie de"
            " una mesa."
        ),
        latex=12,
        mezcla={18: 30, 24: 50, 36: 20},
        especiales=[],
        forma=_FS(1.5, 0.55, 1.1, 0, 0.35, 0.12),
        semilla=6,
    ),
    FormaListaRamo(
        id="suelo-pila",
        nombre="Pila de esferas (9)",
        descripcion="Nueve globos de 24″ y 36″ muy apretados, como una pila de esferas cromadas.",
        latex=9,
        mezcla={24: 35, 36: 65},
        especiales=[],
        forma=_FS(1.4, 0.6, 1.15, 0, 0.25, 0.1),
        semilla=4,
    ),
    FormaListaRamo(
        id="suelo-numero",
        nombre="Número gigante y globos",
        descripcion=(
            "Un número de foil de 34″ sobre un montón de látex grande: la decoración de cumpleaños"
            " de piso."
        ),
        latex=6,
        mezcla={18: 40, 24: 60},
        especiales=[_esp("numero", numero=5, cm=86)],
        forma=_FS(1, 0.9, 1.05, 0, 0.3, 0.15),
        semilla=9,
    ),
    FormaListaRamo(
        id="suelo-burbuja",
        nombre="Burbuja gigante",
        descripcion="Una burbuja transparente de 36″ con confeti entre globos de látex de 24″.",
        latex=6,
        mezcla={18: 40, 24: 60},
        especiales=[_esp("burbuja", contenido="confeti", cm=91)],
        forma=_FS(1.1, 0.7, 1.05, 0, 0.3, 0.15),
        semilla=3,
    ),
    FormaListaRamo(
        id="suelo-foil",
        nombre="Foil gigante",
        descripcion=(
            "Una estrella y un corazón de 36″ con estrellas y corazones de 18″ alrededor, sin látex."
        ),
        latex=0,
        mezcla={12: 100},
        especiales=[
            _esp("estrella", cm=91),
            _esp("corazon", cm=91),
            _esp("estrella", cantidad=2),
            _esp("corazon", cantidad=2),
        ],
        forma=_FS(1.3, 0.7, 0.9, 0, 0.3, 0.15),
        semilla=2,
    ),
    FormaListaRamo(
        id="suelo-rincon",
        nombre="Rincón alto (2 m)",
        descripcion="Nueve globos de 18″ y 24″ en una torre angosta pegada al piso; para junto a una puerta.",
        latex=9,
        mezcla={18: 50, 24: 50},
        especiales=[],
        forma=_FS(0.55, 1.1, 1.05, 0, 0.3, 0.2),
        semilla=5,
    ),
    FormaListaRamo(
        id="suelo-inclinado",
        nombre="Gigantes inclinados",
        descripcion="Seis globos de 24″ y 36″ que se corren hacia un lado, como recostados sobre una pared.",
        latex=6,
        mezcla={24: 50, 36: 50},
        especiales=[],
        forma=_FS(1, 0.7, 1.05, 0.9, 0.35, 0.15),
        semilla=8,
    ),
]


def aplicar_forma_ramo(c: ConfigRamo, fl: FormaListaRamo) -> ConfigRamo:
    """Aplica una forma lista: cantidad, tamaños, especiales y cómo se acomodan.

    Los colores de látex, las cintas y el peso no se tocan.
    """
    # Los especiales toman los colores del diseño: primero los de acento y luego los demás.
    acentos = [k for k in c["colores"]["lista"] if k["rol"] == "acento"]
    paleta = [
        k["hex"] for k in [*acentos, *[k for k in c["colores"]["lista"] if k["rol"] != "acento"]]
    ]
    especiales: list[Especial] = []
    for i, e in enumerate(fl.especiales):
        color = paleta[i % len(paleta)] if paleta else "#d4af37"
        especiales.append(
            {
                "tipo": e["tipo"],
                "cantidad": e["cantidad"],
                "cm": e["cm"],
                "numero": e["numero"],
                "contenido": e["contenido"],
                "color": color,
            }
        )
    salida: ConfigRamo = dict(c)
    salida["latex"] = fl.latex
    salida["tamanos"] = {
        **c["tamanos"],
        "mezcla": {5: 0, 9: 0, 12: 0, 18: 0, 24: 0, 36: 0, **fl.mezcla},
    }
    salida["especiales"] = especiales
    salida["forma"] = {**c["forma"], **fl.forma}
    salida["aspecto"] = {**c["aspecto"], "semilla": fl.semilla}
    return salida
