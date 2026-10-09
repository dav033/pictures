"""Oráculo de la política de paquetes `python` del motor 3D (REQ-007).

Extrae de services/ai-api/app/plan.py, SIN importarlo (necesita dependencias que no se instalan para esta prueba), las
funciones que deciden qué se compra, `_optimizar_cobertura` y `_consolidate`, y las ejecuta sobre los grupos que le da la
prueba por la entrada estándar. Imprime, por variante, los paquetes y la reserva que Python compraría.
"""

import ast
import json
import math
import sys
import unicodedata
from collections.abc import Mapping, Sequence
from decimal import ROUND_HALF_UP, Decimal
from math import isfinite
from pathlib import Path
from typing import cast

RAIZ = Path(__file__).resolve().parents[2]
FUENTE = (RAIZ / "services" / "ai-api" / "app" / "plan.py").read_text(encoding="utf8")
NOMBRES = {"_mapping", "_mappings", "_text", "_number", "_integer", "_round_half_up", "_normalize", "_format_number", "_optimizar_cobertura", "_consolidate"}

espacio = {
    "math": math, "unicodedata": unicodedata, "Mapping": Mapping, "Sequence": Sequence, "cast": cast, "Decimal": Decimal,
    "ROUND_HALF_UP": ROUND_HALF_UP, "isfinite": isfinite, "MERMA": 0.08,
    "PlanResolutionError": type("PlanResolutionError", (Exception,), {}),
}
arbol = ast.parse(FUENTE)
for nodo in arbol.body:
    if isinstance(nodo, ast.FunctionDef) and nodo.name in NOMBRES:
        modulo = ast.Module(body=[nodo], type_ignores=[])
        exec(compile(ast.fix_missing_locations(modulo), "plan.py", "exec"), espacio)
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
    for grupo in caso["grupos"]:
        cobertura = espacio["_optimizar_cobertura"](
            grupo["n"],
            [{"variant_id": o["variantId"], "unidades_paquete": o["unidades"], "precio": o["precio"]} for o in grupo["opciones"]],
        )
        restante = grupo["n"]
        for compra in cobertura["compras"]:
            asignado = min(restante, compra["paquetes"] * compra["unidades_paquete"])
            if asignado <= 0:
                continue
            opcion = next(o for o in grupo["opciones"] if o["variantId"] == compra["variant_id"])
            candidatos[compra["variant_id"]] = Candidato(opcion["unidades"], opcion["precio"])
            paquetes[compra["variant_id"]] = paquetes.get(compra["variant_id"], 0) + compra["paquetes"]
            lineas.append({"variant_id": compra["variant_id"], "unidades": asignado, "diam_pulg": grupo["diam"], "color": grupo["color"], "product_id": grupo["clave"]})
            restante -= asignado
    estructura = {"estructura_id": "X", "lineas": lineas}
    compras, reserva, asignaciones = espacio["_consolidate"]([estructura], candidatos, paquetes)
    salida.append({
        "compras": [{"variantId": c["variant_id"], "paquetes": c["paquetes"], "cantidad": c["design_quantity"], "reserva": c["waste_reserve"]} for c in compras],
        "reserva": reserva,
    })
print(json.dumps(salida))
