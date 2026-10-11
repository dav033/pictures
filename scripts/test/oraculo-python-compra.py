"""Oráculo de la política de paquetes `python` del motor 3D (REQ-007, D-038).

Corre el código de Python que decide qué se compra sobre los grupos que le da la prueba por la entrada estándar e
imprime, por variante, los paquetes y la reserva que Python compraría. `app/presentaciones.py` (la combinación de
paquetes y `comprar_globo`) y `app/numeros.py` solo usan la biblioteca estándar y se importan tal cual; de
services/ai-api/app/plan.py, que necesita dependencias que no se instalan para esta prueba, se extraen SIN importarlo
`_consolidate` y sus ayudantes. La orquestación es la de `_reoptimize_presentations` y `_buy`.
"""

import __future__
import ast
import json
import math
import sys
import unicodedata
from collections.abc import Collection, Mapping, Sequence
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import cast

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "services" / "ai-api"))

from app.numeros import entero, numero  # noqa: E402
from app.presentaciones import comprar_globo  # noqa: E402

FUENTE = (RAIZ / "services" / "ai-api" / "app" / "plan.py").read_text(encoding="utf8")
NOMBRES = {"_mapping", "_mappings", "_text", "_round_half_up", "_normalize", "_format_number", "_consolidate", "_waste_extra_packages"}
MERMA = 0.08

espacio = {
    "math": math, "unicodedata": unicodedata, "Mapping": Mapping, "Sequence": Sequence, "Collection": Collection, "cast": cast,
    "Decimal": Decimal, "ROUND_HALF_UP": ROUND_HALF_UP, "MERMA": MERMA, "_number": numero, "_integer": entero,
    "PlanResolutionError": type("PlanResolutionError", (Exception,), {}),
}
arbol = ast.parse(FUENTE)
for nodo in arbol.body:
    if isinstance(nodo, ast.FunctionDef) and nodo.name in NOMBRES:
        modulo = ast.Module(body=[nodo], type_ignores=[])
        # Anotaciones diferidas: en Python < 3.14 las anotaciones de plan.py (p. ej. `Candidate`) se evaluarían al definir la función.
        exec(compile(ast.fix_missing_locations(modulo), "plan.py", "exec", flags=__future__.annotations.compiler_flag, dont_inherit=True), espacio)
faltan = NOMBRES - {n for n in espacio if n in NOMBRES}
if faltan:
    sys.exit(f"faltan en plan.py: {sorted(faltan)}")


class Candidato:
    def __init__(self, unidades: int, precio: int) -> None:
        self.units_per_package = unidades
        self.price = precio


entrada = json.load(sys.stdin)
salida = []
for caso in entrada:
    lineas = []
    paquetes = {}
    candidatos = {}
    para_reserva = set()
    reservas = {}
    objetivo = 0
    for grupo in caso["grupos"]:
        opciones = [{"variant_id": o["variantId"], "unidades_paquete": o["unidades"], "precio": o["precio"]} for o in grupo["opciones"]]
        comprada = comprar_globo(grupo["n"], opciones, MERMA)
        if comprada is None:
            continue
        para_reserva |= comprada.para_reserva
        objetivo += comprada.objetivo_reserva
        for compra in comprada.cobertura["compras"]:
            variante = compra["variant_id"]
            opcion = next(o for o in grupo["opciones"] if o["variantId"] == variante)
            candidatos[variante] = Candidato(opcion["unidades"], opcion["precio"])
            paquetes[variante] = paquetes.get(variante, 0) + compra["paquetes"]
            reservas[variante] = reservas.get(variante, 0) + comprada.reserva[variante]
            lineas.append({"variant_id": variante, "unidades": comprada.diseno[variante], "diam_pulg": grupo["diam"], "color": grupo["color"], "product_id": grupo["clave"]})
    estructura = {"estructura_id": "X", "lineas": lineas}
    compras, reserva, asignaciones = espacio["_consolidate"]([estructura], candidatos, paquetes, para_reserva, reservas, objetivo)
    salida.append({
        "compras": [{"variantId": c["variant_id"], "paquetes": c["paquetes"], "cantidad": c["design_quantity"], "reserva": c["waste_reserve"]} for c in compras],
        "reserva": reserva,
    })
print(json.dumps(salida))
