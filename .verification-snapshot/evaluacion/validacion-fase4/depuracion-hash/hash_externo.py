"""Recalcula plan_hash desde los JSON guardados (como plan.py:4086-4101)."""
import hashlib, json, sys

def h(plan, pr, snap_id):
    snapshot = {"catalog_snapshot_id": snap_id, "estructuras": pr["estructuras"], "compras": pr["compras"], "total_cop": pr["totales"]["total_cop"]}
    c = json.dumps({"plan": plan, "snapshot": snapshot}, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(c.encode()).hexdigest()

def floats(o, p=""):
    out = []
    if isinstance(o, dict):
        for k, v in o.items(): out += floats(v, f"{p}.{k}")
    elif isinstance(o, list):
        for i, v in enumerate(o): out += floats(v, f"{p}[{i}]")
    elif isinstance(o, float) and o.is_integer():
        out.append(p)
    return out

base = sys.argv[1]
rr = json.load(open(f"{base}/re-resuelto.json", encoding="utf-8"))
rr = rr[0] if isinstance(rr, list) else rr
pr = rr["payload"]["plan_resuelto"]; sid = rr["payload"]["catalog_snapshot_id"]
print("re-resuelto declarado", pr["plan_hash"][:12], "recalculado", h(pr["plan"], pr, sid)[:12])
pf = json.load(open(f"{base}/plan-resuelto.json", encoding="utf-8"))
print("firmado     declarado", pf["plan_hash"][:12], "recalculado", h(pf["plan"], pf, sid)[:12])
print("floats enteros en re-resuelto (plan+snapshot):", floats({"plan": pr["plan"], "e": pr["estructuras"], "c": pr["compras"]})[:20])
