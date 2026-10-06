"""v18 frente a v19 sobre la línea base sin etiquetas (anexo E). Solo lectura local; sin red.

Reutiliza `analizar_resultados.py` (mismo criterio de tipo que dio 33/48 a v18) apuntado a
`resultados/crudos-sin-etiquetas`, y añade las métricas propias de v19:
- CASE-002: en cuántas corridas el patrón de cada semiarco empieza por el color que la foto tiene al PIE.
- CASE-007: tipos de las piezas (pared de globos frente a guirnalda).
"""
import collections
import json
import os
import re

LB = os.path.dirname(os.path.abspath(__file__))
fuente = open(f"{LB}/analizar_resultados.py", encoding="utf-8").read()
fuente = fuente.replace("resultados/crudos/", "resultados/crudos-sin-etiquetas/").replace("resultados/analisis", "resultados/analisis-v19")
fuente = fuente.replace('if __name__ == "__main__":', "if False:")
modulo: dict = {"__file__": f"{LB}/analizar_resultados.py", "__name__": "analizar_v19"}
exec(compile(fuente, "analizar_resultados.py", "exec"), modulo)

VARIANTES = ("v18-candidato", "v19-candidato", "v19b-candidato")
res = [r for r in modulo["main"]() if r["var"] in VARIANTES]
tabla = collections.defaultdict(lambda: collections.Counter())
for r in res:
    e = r["eval"]
    clave = (r["var"], r["caso"])
    tabla[clave]["n"] += 1
    if "error" in e:
        tabla[clave]["error"] += 1
        continue
    tabla[clave]["tipo_ok"] += int(bool(e.get("tipo_ok")))

print("caso       " + "".join(f"{v[:4]:>12}" for v in VARIANTES))
tot = collections.Counter()
for caso in sorted({c for _v, c in tabla}):
    celdas = []
    for v in VARIANTES:
        t = tabla[(v, caso)]; tot[v] += t["tipo_ok"]; tot[v + "n"] += t["n"]
        celdas.append(f"{t['tipo_ok']}/{t['n']}")
    print(f"{caso:10} " + "".join(f"{c:>12}" for c in celdas))
print("TOTAL      " + "".join(f"{str(tot[v]) + '/' + str(tot[v + 'n']):>12}" for v in VARIANTES))

# CASE-002: el color del pie. En la foto (verdad a ojo, anexo D): semiarco izquierdo rosado arriba y plata/blanco
# abajo; el derecho rosado arriba, plata en medio, rosado al pie. El "pie" del izquierdo es plata y el del derecho,
# ambiguo, así que se mide sobre el izquierdo (la caja más a la izquierda).
print("\nCASE-002, primer color del patrón del semiarco izquierdo (pie = plateado/gris/blanco):")
for var in VARIANTES:
    primeros = []
    for r in res:
        if r["var"] != var or r["caso"] != "case-002" or "error" in r["eval"]:
            continue
        semis = [p for p in r["piezas"] if p["tipo"] in ("half_arch", "column", "arch") and p.get("colores_patron")]
        if not semis:
            primeros.append(None)
            continue
        izq = min(semis, key=lambda p: (p["bbox"] or {}).get("x", 0.5) if isinstance(p["bbox"], dict) else 0.5)
        primeros.append(izq["colores_patron"][0])
    al_pie = sum(1 for c in primeros if c and re.search(r"plat|gris|blanc|transp", c))
    print(f"  {var}: {primeros} -> pie primero {al_pie}/{len(primeros)}")

print("\nCASE-007, tipos por corrida:")
for var in VARIANTES:
    tipos = [sorted(p["tipo"] for p in r["piezas"]) for r in res if r["var"] == var and r["caso"] == "case-007" and "error" not in r["eval"]]
    print(f"  {var}: {tipos}")
