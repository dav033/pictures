"""Medidas, helio, peso que hay que sujetar y lista de compra de un bouquet.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/bouquet/medidas.ts``.

Lo que hay aquí no está en el motor orgánico porque solo un ramo lo necesita: un ramo **flota**, así que hay
que saber cuánto helio lleva y con cuánto peso se sujeta. Las fórmulas son las del original, con sus tablas de
fabricante citadas en cada línea.
"""

from __future__ import annotations

from typing import Any, TypedDict

from app.bouquet.motor import ResultadoRamo
from app.bouquet.tipos import ESPECIALES, ConfigRamo, Especial
from app.motores import mate
from app.motores.js import _maximo, _numero, _redondear, _techo, _to_fixed
from app.organico.tipos import TAMANOS_GLOBO, diametro_m

__all__ = [
    "TANQUE_FIESTA_PIE3",
    "MedidasRamo",
    "calcular_compra",
    "calcular_medidas",
    "gramos_especial",
    "gramos_latex",
    "litros_especial",
    "litros_latex",
    "peso_texto",
    "vuela_latex",
]

#: Lo que pesa un globo de látex sin inflar (g), aproximado: los gigantes de 36″ pesan unos 75 g.
MASA_LATEX: dict[int, float] = {5: 1, 9: 2.3, 12: 3.5, 18: 8, 24: 22, 36: 75}


def gramos_latex(nominal: int, inflado: float) -> float:
    """Fuerza neta hacia arriba de un globo de látex (g), que es lo que hay que sujetar con el peso.

    El helio empuja ≈ 1 g por litro y el propio globo pesa. Para el látex de 11–12″ da unos 10 g (la tabla de
    Qualatex dice 10 g) y para el de 16″ unos 34 g. Con los gigantes (24″ ≈ 75 g, 36″ ≈ 255 g) la tabla de
    pesos de los fabricantes se queda corta, por eso se calcula así.
    """
    return float(_maximo(1, litros_latex(nominal, inflado) - MASA_LATEX[nominal]))


def vuela_latex(nominal: int, inflado: float) -> bool:
    """Si un globo de látex de este tamaño **vuela** con helio.

    Es lo mismo que preguntar si el helio que cabe dentro empuja más de lo que pesa el globo. Un R-5 inflado a
    4″ lleva 0,79 L (0,79 g de empuje) y el látex pesa 1 g: **empuje neto −0,21 g**, o sea que se hunde. Por
    eso Qualatex lo publica como «air-fill, n/a» y no le da tiempo de flote: un globo de 5″ es un globo de
    aire, va atado al cuerpo del ramo o a la base.

    No es una tabla: sale de la misma fórmula de ``litros_latex``, así que si cambia el inflado la respuesta
    cambia con él.
    """
    return litros_latex(nominal, inflado) - MASA_LATEX[nominal] > 0


def gramos_especial(e: Especial) -> float:
    """Fuerza neta de un foil o una burbuja (g).

    Tablas de los fabricantes (foil de 18″ 15 g, de 36″ ≈ 40 g; burbuja de 22″ 18 g) y escala.
    """
    if e["tipo"] == "burbuja":
        return float(18 * mate.pow(e["cm"] / 56, 2.6))
    return float(15 * mate.pow(e["cm"] / 46, 1.5))


def peso_texto(g: float) -> str:
    """Peso en gramos o en kilos, como se dice en una tienda."""
    if g >= 1000:
        return f"{_to_fixed(g / 1000, 1).replace('.', ',')} kg"
    return f"{_numero(_redondear(g))} g"


def litros_latex(nominal: int, inflado: float) -> float:
    """Litros de helio de un globo de látex: 14,2 L (0,5 pie³) para el de 11–12″, según el diámetro inflado."""
    return float(14.2 * mate.pow(diametro_m(nominal, inflado) / diametro_m(12, 1), 3))


def litros_especial(e: Especial) -> float:
    """Litros de helio de un especial (aproximado): 14 L el foil de 18″, 27 L la burbuja de 22″."""
    if e["tipo"] == "burbuja":
        return float(27 * mate.pow(e["cm"] / 56, 2.6))
    tipo = e["tipo"]
    if tipo == "estrella":
        factor = 0.8
    elif tipo == "corazon":
        factor = 0.85
    elif tipo == "numero":
        factor = 0.32
    else:
        factor = 1.0
    return float(14 * mate.pow(e["cm"] / 46, 3) * factor)


_PIE3 = 28.317
#: Tanque desechable de fiesta: 14,9 pie³.
TANQUE_FIESTA_PIE3 = 14.9


class MedidasRamo(TypedDict):
    altoM: float
    anchoM: float
    altoGlobosM: float
    globos: int
    latex: int
    especiales: int
    cintasM: float
    heliolitros: float
    heliopie3: float
    #: Fracción de un tanque de fiesta de 14,9 pie³ que gasta el ramo.
    tanques: float
    #: Gramos netos que levantan los globos.
    levantaG: float
    #: El peso mínimo que los sujeta (con 25 % de margen).
    pesoMinG: float
    diametrosCm: dict[int, float]


def calcular_medidas(res: ResultadoRamo, cfg: ConfigRamo) -> MedidasRamo:
    """Lo que se le enseña al cliente: tamaño, cuántos globos, helio y con cuánto peso se sujeta."""
    litros = 0.0
    gramos = 0.0
    latex = 0
    esp = 0
    for g in res.globos:
        if g.clase == "latex" and g.nominal:
            latex += 1
            # Un globo que no vuela es un globo de aire: no consume helio ni tira hacia arriba, así que no
            # entra ni en el tanque ni en el peso. Antes se le cobraba su helio y se le sumaba el gramo que
            # inventa el `_maximo(1, …)` de `gramos_latex`, que para un R-5 no existe: su empuje es negativo.
            if vuela_latex(g.nominal, cfg["tamanos"]["inflado"]):
                litros += litros_latex(g.nominal, cfg["tamanos"]["inflado"])
                gramos += gramos_latex(g.nominal, cfg["tamanos"]["inflado"])
        elif g.especial is not None:
            esp += 1
            litros += litros_especial(g.especial)
            gramos += gramos_especial(g.especial)
    return {
        "altoM": res.altoM,
        "anchoM": res.anchoM,
        "altoGlobosM": res.altoGlobosM,
        "globos": len(res.globos),
        "latex": latex,
        "especiales": esp,
        "cintasM": res.cintasM,
        "heliolitros": litros,
        "heliopie3": litros / _PIE3,
        "tanques": litros / _PIE3 / TANQUE_FIESTA_PIE3,
        "levantaG": gramos,
        "pesoMinG": float(_techo((gramos * 1.25) / 5) * 5),
        "diametrosCm": {t: diametro_m(t, cfg["tamanos"]["inflado"]) * 100 for t in TAMANOS_GLOBO},
    }


class FilaEspecial(TypedDict):
    """Un especial en la lista de compra."""

    texto: str
    color: str
    cantidad: float


_NOMBRE_ESPECIAL: dict[str, str] = {e["valor"]: e["texto"] for e in ESPECIALES}


def _texto_especial(tipo: str, numero: float, cm: float) -> str:
    """Cómo se lee un especial en la lista de compra: «Número foil 5 de 86 cm»."""
    cifra = f" {_numero(numero)}" if tipo == "numero" else ""
    return f"{_NOMBRE_ESPECIAL.get(tipo, '')}{cifra} de {_numero(cm)} cm"


def calcular_compra(res: ResultadoRamo, cfg: ConfigRamo, ramos: float) -> dict[str, Any]:
    """Materiales: látex por color y tamaño (con desperdicio), especiales, cinta y peso.

    Todo multiplicado por la cantidad de ramos. El desperdicio se redondea hacia arriba **en cada celda**,
    como en el resto del sistema: es lo que se pide al proveedor.
    """
    filas: dict[int, dict[str, Any]] = {}
    for c in res.conteo:
        fila = filas.get(c["indice"])
        if fila is None:
            fila = {
                "color": c["color"],
                "acabado": c["acabado"],
                "indice": c["indice"],
                "porTamano": {},
                "cantidad": 0,
                "comprar": 0,
            }
        total = c["cantidad"] * ramos
        fila["porTamano"][c["nominal"]] = fila["porTamano"].get(c["nominal"], 0) + total
        fila["cantidad"] += total
        fila["comprar"] += _techo(total * (1 + cfg["real"]["desperdicio"]))
        filas[c["indice"]] = fila
    lista = sorted(filas.values(), key=lambda f: int(f["indice"]))
    tamanos = [t for t in TAMANOS_GLOBO if any(f["porTamano"].get(t, 0) > 0 for f in lista)]
    especiales: list[FilaEspecial] = [
        {
            "texto": _texto_especial(e["tipo"], e["numero"], e["cm"]),
            "color": e["color"],
            "cantidad": e["cantidad"] * ramos,
        }
        for e in res.especiales
    ]
    total_comprar = 0.0
    for fila in lista:
        total_comprar += fila["comprar"]
    return {
        "filas": lista,
        "tamanos": tamanos,
        "total": total_comprar,
        "ramas": 0,
        "flores": 0,
        "especiales": especiales,
        # Cinta a comprar (m): la de los globos más las colas, con 10 % de margen.
        "cintaM": _techo(res.cintasM * ramos * 1.1 * 10) / 10,
        "ramos": ramos,
    }
