"""Paridad de la distancia cromatica entre TypeScript y Python.

Lee la tabla del contrato exportado y aplica exactamente la formula de
`_chromatic_distance` en `services/ai-api/app/catalog.py`, para comprobar que el
contrato lleva lo necesario y que los dos runtimes dan el mismo numero.

No importa `catalog.py` entero a proposito: eso arrastraria asyncpg y el resto
del servicio. Lo que se verifica aqui es la tabla y la formula, que es donde los
dos lados pueden divergir.

    python scripts/verificar-paridad-color.py
"""

import json
import math
import pathlib
import sys

CONTRATO = pathlib.Path("contracts/domain/v1/catalog-search.schema.json")
tabla = json.loads(CONTRATO.read_text(encoding="utf-8")).get("x-tonos-colores-catalogo", {})
lab = tabla.get("lab", {})
escala = tabla.get("escala", 100)
umbral = tabla.get("delta_e_maximo", 45) / escala


def distancia(pedido: str, candidato: str) -> float:
    if pedido == candidato:
        return 0.0
    a, b = lab.get(pedido), lab.get(candidato)
    if a is None or b is None:
        return umbral
    return min(math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b, strict=True))) / escala, 1.0)


def mas_cercano(pedido: str, presentes: list[str]) -> str | None:
    if not presentes:
        return None
    mejor = min(presentes, key=lambda c: (distancia(pedido, c), c))
    return None if distancia(pedido, mejor) >= umbral else mejor


# Valores medidos en TypeScript con los mismos pares.
ESPERADO_DISTANCIA = {
    ("naranja", "cafe"): 0.511,
    ("dorado", "crema"): 0.562,
    ("fucsia", "rosado"): 0.481,
    ("violeta", "morado"): 0.190,
    ("rojo", "rojo"): 0.0,
}
ESPERADO_SUSTITUCION = {
    ("burdeos", ("amarillo", "azul", "blanco", "rojo", "verde")): "rojo",
    ("frambuesa", ("amarillo", "azul", "blanco", "rojo", "verde")): None,
    ("gris", ("negro", "plateado", "blanco", "dorado")): "plateado",
}

fallos = 0
print(f"colores en la tabla: {len(lab)} · umbral: {umbral:.3f}")
for (uno, otro), esperado in ESPERADO_DISTANCIA.items():
    obtenido = distancia(uno, otro)
    ok = abs(obtenido - esperado) < 0.002
    fallos += 0 if ok else 1
    print(f"  {'ok ' if ok else 'FAIL'} {uno} vs {otro}: {obtenido:.3f} (TypeScript: {esperado:.3f})")
for (pedido, presentes), esperado in ESPERADO_SUSTITUCION.items():
    obtenido = mas_cercano(pedido, list(presentes))
    ok = obtenido == esperado
    fallos += 0 if ok else 1
    print(f"  {'ok ' if ok else 'FAIL'} {pedido} -> {obtenido} (TypeScript: {esperado})")

if fallos:
    print(f"\n{fallos} divergencia(s) entre Python y TypeScript")
    sys.exit(1)
print("\n[PASS] Python y TypeScript calculan la misma distancia cromatica")
