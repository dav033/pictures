"""Fase 4: estabilidad del plan entre corridas (mismo blueprint por corrida, chat real de Gemini).

Lee validacion-fase4/planes/caso-N/corrida-K/{plan-resuelto,resumen}.json y escribe ESTABILIDAD.md.
Solo lectura; no llama a ningún proveedor.
"""
from __future__ import annotations

import itertools
import json
import os
import re
import statistics

D = os.path.dirname(os.path.abspath(__file__))
P = f"{D}/planes"


def cargar(c: int, k: int, nombre: str):
    try:
        return json.load(open(f"{P}/caso-{c}/corrida-{k}/{nombre}", encoding="utf-8"))
    except Exception:
        return None


def producto(titulo: str) -> str:
    return re.sub(r"\s+.\s+R-\d+.*$", "", titulo).replace("B2b Globo Latex Redondo ", "").strip()


def jaccard(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if a | b else 1.0


filas = ["| Caso | Planes | Tipos por corrida | Unidades por corrida | CV unidades | Jaccard productos | Control específico | Gasto US$ |", "|---|---|---|---|---|---|---|---|"]
total_usd = 0.0
for c in range(1, 9):
    tipos, unidades, productos, controles, usd, ok = [], [], [], [], 0.0, 0
    for k in (1, 2, 3):
        r = cargar(c, k, "resumen.json")
        if r:
            usd += float(r.get("usd_reportado") or 0)
        plan = cargar(c, k, "plan-resuelto.json")
        if not plan:
            tipos.append("—"); continue
        ok += 1
        est = plan["plan"]["estructuras"]
        tipos.append("+".join(sorted(str(e.get("estructura_oficial") or e["tipo"]) for e in est)))
        unidades.append(sum(int(e.get("total_unidades") or 0) for e in plan["estructuras"]))
        productos.append({producto(x["titulo"]) for x in plan.get("compras", [])})
        if c == 2:
            controles.append("ReflexRosado" if any("Reflex Rosado" in p for p in productos[-1]) else "sin Reflex Rosado")
        if c == 6:
            centros = [e for e in est if e["tipo"] == "centro_mesa"]
            res = {e["estructura_id"]: e for e in plan["estructuras"]}
            controles.append("centro=" + ",".join(str(res[e["estructura_id"]].get("total_unidades")) for e in centros) if centros else "sin centro")
        if c == 1:
            col = [e for e in est if "columna" in str(e.get("estructura_oficial") or e["tipo"])]
            incl = [((e.get("armado_columna_organica") or {}).get("forma") or {}).get("inclinacionM") for e in col]
            controles.append(f"inclinacionM={incl}")
    cv = (statistics.pstdev(unidades) / statistics.mean(unidades)) if len(unidades) > 1 and statistics.mean(unidades) else 0.0
    jac = statistics.mean(jaccard(a, b) for a, b in itertools.combinations(productos, 2)) if len(productos) > 1 else None
    total_usd += usd
    filas.append(f"| CASE-00{c} | {ok}/3 | {' · '.join(tipos)} | {', '.join(map(str, unidades))} | {cv:.2f} | {'—' if jac is None else f'{jac:.2f}'} | {'; '.join(controles) or '—'} | {usd:.3f} |")

open(f"{D}/ESTABILIDAD.md", "w", encoding="utf-8").write(
    "# Fase 4 · Estabilidad del plan (3 corridas por caso, blueprint v18 limpio)\n\n"
    + "\n".join(filas)
    + f"\n\nGasto total estimado del chat: US${total_usd:.3f} (tokens reportados × tabla de precios; no es factura).\n"
)
print("\n".join(filas)); print(f"total US${total_usd:.3f}")
