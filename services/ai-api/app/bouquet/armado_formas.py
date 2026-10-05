"""Formas listas del bouquet por partes: cómo se arma y qué es cada material.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/bouquet/armado-formas.ts``.

Variante, niveles, remate y números, y el tipo y el tamaño de cada material (látex, metalizado, burbuja o
número). Los colores y acabados no van aquí: al aplicar una forma se conservan los del diseño y solo cambia la
estructura.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TypedDict

from app.bouquet.armado import ARMADO_VERSION, ArmadoBouquetV1, ConfigArmado, MaterialArmado

__all__ = ["FORMAS_ARMADO", "FormaArmado", "aplicar_forma_armado"]


class MaterialParcial(TypedDict):
    """Qué es un material, sin color ni acabado (los pone el diseño)."""

    tipo: str
    tamanoPulg: float
    digito: str


@dataclass(frozen=True)
class FormaArmado:
    id: str
    nombre: str
    descripcion: str
    #: El armado sin ``version`` ni ``origen``, que los pone ``aplicar_forma_armado``.
    armado: ArmadoBouquetV1
    #: Qué es cada material a cuyo índice apunta el armado.
    materiales: list[MaterialParcial]


def _latex(tamano_pulg: float = 12) -> MaterialParcial:
    return {"tipo": "latex", "tamanoPulg": tamano_pulg, "digito": ""}


def _numero(digito: str, tamano_pulg: float = 16) -> MaterialParcial:
    return {"tipo": "numero", "tamanoPulg": tamano_pulg, "digito": digito}


FORMAS_ARMADO: list[FormaArmado] = [
    FormaArmado(
        id="aire-numero",
        nombre="Apilado de aire con número",
        descripcion=(
            "Dos cuartetos de látex apilados sobre una base de aire, con un número foil arriba:"
            " la pieza de mesa de la foto."
        ),
        armado={
            "variante": "base_aire",
            "niveles": [
                {"rol": "base", "unidad": "cuarteto", "cantidad": 1, "posiciones": [0, 0, 0, 0]},
                {"rol": "cuerpo", "unidad": "cuarteto", "cantidad": 1, "posiciones": [1, 1, 1, 1]},
            ],
            "numero": {"digitos": [2], "disposicion": "arriba"},
        },
        materiales=[_latex(), _latex(), _numero("5")],
    ),
    FormaArmado(
        id="aire-torre",
        nombre="Torre de aire con remate",
        descripcion="Tres cuartetos apilados y un globo metalizado arriba.",
        armado={
            "variante": "base_aire",
            "niveles": [
                {"rol": "base", "unidad": "cuarteto", "cantidad": 1, "posiciones": [0, 0, 0, 0]},
                {"rol": "cuerpo", "unidad": "cuarteto", "cantidad": 1, "posiciones": [1, 1, 1, 1]},
                {"rol": "cuerpo", "unidad": "cuarteto", "cantidad": 1, "posiciones": [0, 0, 0, 0]},
            ],
            "remate": [2],
        },
        materiales=[
            _latex(),
            _latex(),
            {"tipo": "metalizado", "tamanoPulg": 18, "digito": ""},
        ],
    ),
    FormaArmado(
        id="aire-ancha",
        nombre="Base ancha de aire",
        descripcion="Dos cuartetos lado a lado como base, un trío encima y un látex grande de remate.",
        armado={
            "variante": "base_aire",
            "niveles": [
                {"rol": "base", "unidad": "cuarteto", "cantidad": 2, "posiciones": [0, 0, 0, 0]},
                {"rol": "cuerpo", "unidad": "trio", "cantidad": 1, "posiciones": [1, 1, 1]},
            ],
            "remate": [2],
        },
        materiales=[_latex(), _latex(), _latex(18)],
    ),
    FormaArmado(
        id="aire-lados",
        nombre="Dos cifras a los lados",
        descripcion=(
            "Una torre de aire con un número foil de pie a cada lado (por ejemplo, la edad de dos"
            " cifras)."
        ),
        armado={
            "variante": "base_aire",
            "niveles": [
                {"rol": "base", "unidad": "cuarteto", "cantidad": 1, "posiciones": [0, 0, 0, 0]},
                {"rol": "cuerpo", "unidad": "trio", "cantidad": 1, "posiciones": [1, 1, 1]},
            ],
            "numero": {"digitos": [2, 3], "disposicion": "lados"},
        },
        materiales=[_latex(), _latex(), _numero("2"), _numero("0")],
    ),
    FormaArmado(
        id="aire-abajo",
        nombre="Número de pie, abajo",
        descripcion="El número foil va de pie en la base y los globos se apoyan encima.",
        armado={
            "variante": "base_aire",
            "niveles": [
                {"rol": "base", "unidad": "cuarteto", "cantidad": 1, "posiciones": [0, 0, 0, 0]},
                {"rol": "cuerpo", "unidad": "pareja", "cantidad": 1, "posiciones": [1, 1]},
            ],
            "numero": {"digitos": [2], "disposicion": "abajo"},
        },
        materiales=[_latex(), _latex(), _numero("8")],
    ),
    FormaArmado(
        id="helio-apilado",
        nombre="Helio apilado en tríos",
        descripcion=(
            "Capas de tres globos con helio, una sobre otra, y un metalizado arriba, atadas a una"
            " pesa."
        ),
        armado={
            "variante": "helio_apilado",
            "niveles": [
                {"rol": "capa", "unidad": "trio", "cantidad": 1, "posiciones": [0, 0, 0]},
                {"rol": "capa", "unidad": "trio", "cantidad": 1, "posiciones": [1, 1, 1]},
                {"rol": "capa", "unidad": "trio", "cantidad": 1, "posiciones": [0, 0, 0]},
            ],
            "remate": [2],
        },
        materiales=[
            _latex(),
            _latex(),
            {"tipo": "metalizado", "tamanoPulg": 18, "digito": ""},
        ],
    ),
    FormaArmado(
        id="helio-escalonado",
        nombre="Helio escalonado (5 piezas)",
        descripcion=(
            "Globos con helio a alturas distintas de cinta alrededor de una pareja y una burbuja"
            " arriba."
        ),
        armado={
            "variante": "helio_escalonado",
            "niveles": [
                {"rol": "alrededor", "unidad": "suelto", "cantidad": 4, "posiciones": [0]},
                {"rol": "acento", "unidad": "pareja", "cantidad": 1, "posiciones": [1, 1]},
            ],
            "remate": [2],
        },
        materiales=[
            _latex(),
            _latex(),
            {"tipo": "burbuja", "tamanoPulg": 22, "digito": ""},
        ],
    ),
]

#: Paleta con la que se rellenan los materiales que un diseño todavía no tenía.
PALETA = [
    "#7a4bb0",
    "#d9a9cf",
    "#c3c7cd",
    "#d4af37",
    "#2f6fc0",
    "#3f9b5b",
    "#e8853a",
    "#eeaec1",
]


def aplicar_forma_armado(c: ConfigArmado, fa: FormaArmado) -> ConfigArmado:
    """Aplica una forma: cambia la estructura y el tipo de cada material.

    Los colores y acabados del diseño se conservan.
    """
    materiales: list[MaterialArmado] = []
    for i, m in enumerate(fa.materiales):
        previo = c["materiales"][i] if i < len(c["materiales"]) else None
        if previo is not None:
            color = previo["color"]
            acabado = previo["acabado"]
        else:
            color = PALETA[i % len(PALETA)]
            acabado = "cromado" if m["tipo"] in ("numero", "metalizado") else "mate"
        materiales.append(
            {
                "tipo": m["tipo"],
                "tamanoPulg": m["tamanoPulg"],
                "digito": m["digito"],
                "color": color,
                "acabado": acabado,
            }
        )
    armado: ArmadoBouquetV1 = {
        "version": ARMADO_VERSION,
        "origen": "decorador",
        **fa.armado,
    }
    return {"armado": armado, "materiales": materiales}
