"""Fase 6: vuelve a resolver con el código ACTUAL las peticiones de resolución capturadas y las compara con lo que
salió cuando se trazaron. Sin modelo, sin fal: solo el resolvedor Python y el catálogo real en lectura.

  cd demo-decoracion/services/ai-api
  uv run --system-certs --env-file ../../.env.local python ../../evaluacion/validacion-fase4/regresion-resolucion.py

Escribe `regresion-resolucion.json` junto a este archivo. No imprime credenciales.
"""

from __future__ import annotations

import asyncio
import glob
import json
import os
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, os.getcwd())

from app.catalog import CatalogStore  # noqa: E402
from app.plan import PlanResolutionRequest, resolve_plan  # noqa: E402


def resumen(resuelto: dict) -> dict:
    estructuras = {}
    for s in resuelto.get("estructuras", []):
        lineas = s.get("lineas", [])
        estructuras[s["estructura_id"]] = {
            "total": s.get("total_unidades"),
            "colores": sorted({str(l.get("color")) for l in lineas}),
            "productos": sorted({str(l.get("product_id")) for l in lineas}),
        }
    plan = resuelto.get("plan", {})
    armados = {}
    for s in plan.get("estructuras", []):
        forma = ((s.get("armado_arco_organico") or {}).get("forma")) if isinstance(s.get("armado_arco_organico"), dict) else None
        if forma:
            armados[s["estructura_id"]] = {"corte": forma.get("corte"), "anchoM": forma.get("anchoM")}
    return {
        "plan_hash": resuelto.get("plan_hash"),
        "total_cop": (resuelto.get("totales") or {}).get("total_cop") if isinstance(resuelto.get("totales"), dict) else None,
        "estructuras": estructuras,
        "armados_arco": armados,
    }


async def main() -> None:
    url = os.environ.get("CATALOG_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("falta la URL del catálogo en el entorno")
    store = CatalogStore(url)
    await store.start()
    filas = []
    try:
        for peticion_path in sorted(glob.glob(str(AQUI / "planes-*" / "caso-*" / "corrida-*" / "peticion-confirmar.json"))):
            carpeta = Path(peticion_path).parent
            nombre = str(carpeta.relative_to(AQUI)).replace("\\", "/")
            antes_path = carpeta / "plan-resuelto.json"
            if not antes_path.exists():
                continue
            antes = resumen(json.loads(antes_path.read_text(encoding="utf-8")))
            try:
                peticion = PlanResolutionRequest.model_validate(json.loads(Path(peticion_path).read_text(encoding="utf-8")))
                crudo = await resolve_plan(peticion, store)
                ahora = resumen(dict(crudo["plan_resuelto"]))  # type: ignore[arg-type]
                error = None
            except Exception as exc:  # noqa: BLE001 - se informa por fila
                ahora, error = None, f"{type(exc).__name__}: {str(exc)[:200]}"
            cambios = []
            if ahora:
                for clave in ("plan_hash", "total_cop"):
                    if antes[clave] != ahora[clave]:
                        cambios.append(clave)
                for eid, a in antes["estructuras"].items():
                    b = ahora["estructuras"].get(eid)
                    if b != a:
                        cambios.append(f"{eid}: {a} -> {b}")
                for eid, a in antes["armados_arco"].items():
                    if ahora["armados_arco"].get(eid) != a:
                        cambios.append(f"{eid} arco: {a} -> {ahora['armados_arco'].get(eid)}")
            filas.append({"corrida": nombre, "error": error, "cambios": cambios})
            print(f"{nombre}: {'ERROR ' + error if error else ('igual' if not cambios else str(len(cambios)) + ' cambios')}")
            for c in cambios:
                print("    ", c[:300])
    finally:
        await store.close()
    (AQUI / "regresion-resolucion.json").write_text(json.dumps(filas, ensure_ascii=False, indent=1), encoding="utf-8")


asyncio.run(main())
