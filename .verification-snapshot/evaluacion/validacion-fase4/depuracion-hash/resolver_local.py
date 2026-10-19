"""Resuelve en proceso una petición plan-resolution.v1 guardada y vuelca el JSON canónico que se hashea.

Uso (desde services/ai-api): uv run --system-certs --env-file ../../.env.local python <este> <peticion.json> <salida-prefijo>
No imprime configuración. Solo lee el catálogo (Postgres) en modo lectura.
"""
import asyncio, hashlib, json, sys
sys.path.insert(0, ".")
import app.plan as plan_mod
from app.main import Settings
from app.catalog import CatalogStore
from app.plan import PlanResolutionRequest

capturas = []
class _Shim:
    def __getattr__(self, n): return getattr(hashlib, n)
    def sha256(self, data=b"", *a, **k):
        capturas.append(data)
        return hashlib.sha256(data, *a, **k)
plan_mod.hashlib = _Shim()

async def main(path, out):
    body = json.load(open(path, encoding="utf-8"))
    req = PlanResolutionRequest.model_validate(body)
    store = CatalogStore(Settings.from_env().catalog_database_url)
    await store.start()
    try:
        res = await plan_mod.resolve_plan(req, store)
    finally:
        await store.close()
    pr = res["plan_resuelto"]
    canon = [c for c in capturas if c.startswith(b'{"plan":')]
    print("plan_hash", pr["plan_hash"], "capturas canon", len(canon))
    for i, c in enumerate(canon):
        print(" canon", i, hashlib.sha256(c).hexdigest()[:12], len(c))
    open(out + ".canon.json", "wb").write(canon[-1])
    open(out + ".resultado.json", "w", encoding="utf-8").write(json.dumps(res, ensure_ascii=False))

asyncio.run(main(sys.argv[1], sys.argv[2]))
