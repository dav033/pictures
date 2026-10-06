import json, collections, statistics, itertools, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import analizar_resultados as A
R = json.load(open(f"{A.OUT}/metricas.json", encoding="utf-8"))
def modal(vals):
    c = collections.Counter(map(lambda v: json.dumps(v, sort_keys=True), vals)); m, n = c.most_common(1)[0]; return n/len(vals), json.loads(m)
def fams(run):
    s = set()
    for p in run["piezas"]:
        for n in p["colores_obs"] + p["colores_patron"]: s |= set(A.familias(n))
    return s
def jacc(a, b): return 1.0 if not a and not b else len(a & b)/len(a | b)
out = {}; md = []
for caso in sorted(A.V):
    for var in A.VARS:
        rs = sorted([r for r in R if r["caso"] == caso and r["var"] == var], key=lambda r: r["run"])
        if not rs: continue
        ev = [r["eval"] for r in rs]; n = len(rs)
        tipos = ["+".join(sorted(p["tipo"] for p in r["piezas"])) or "ninguna" for r in rs]
        incl = [[p["inclina"] for p in r["piezas"]] for r in rs]
        lados = ["+".join(p["posicion"] for p in r["piezas"]) or "-" for r in rs]
        sign = [i["signo_ok"] for e in ev for i in e["incl"]]; err = [i["err"] for e in ev for i in e["incl"]]
        pares = list(itertools.combinations([fams(r) for r in rs], 2))
        d = {
         "n": n, "tipos": tipos, "lados": lados, "inclinaciones": incl,
         "pct_n_piezas_ok": sum(e["n_piezas_ok"] for e in ev)/n, "pct_tipo_ok": sum(e["tipo_ok"] for e in ev)/n,
         "pct_tipo_exacto_ok": sum(e["tipo_exacto_ok"] for e in ev)/n, "pct_lado_ok": sum(e["lado_ok"] for e in ev)/n,
         "estab_tipos": modal(tipos)[0], "estab_tipo_modal": modal(tipos)[1], "estab_n_piezas": modal([len(r["piezas"]) for r in rs])[0],
         "estab_inclinacion": modal(incl)[0], "estab_lado": modal(lados)[0],
         "jaccard_familias_color": statistics.mean(jacc(a, b) for a, b in pares) if pares else None,
         "incl_signo_ok": (sum(sign)/len(sign)) if sign else None, "incl_mae_frac": (statistics.mean(err)) if err else None,
         "color_cobertura": statistics.mean(e["colores_verdad_cubiertos"] for e in ev),
         "color_faltantes": dict(collections.Counter(f for e in ev for f in e["colores_verdad_faltantes"])),
         "familias_inventadas": dict(collections.Counter(f for e in ev for f in e["familias_inventadas"])),
         "de_catalogo_medio": statistics.mean(x["de"] for e in ev for x in e["de_catalogo"]) if any(e["de_catalogo"] for e in ev) else None,
         "de_catalogo_max_medio": statistics.mean(max(x["de"] for x in e["de_catalogo"]) for e in ev if e["de_catalogo"]) if any(e["de_catalogo"] for e in ev) else None,
         "de_cluster_medio": statistics.mean(x["de"] for e in ev for x in e["de_cluster"]) if any(e["de_cluster"] for e in ev) else None,
         "r5_pred": [e["r5_pred"] for e in ev], "tamanos_leidos": [e["tamanos_leidos"] for e in ev],
         "patron_modo": [[p["patron_modo"] for p in r["piezas"]] for r in rs],
         "nombres": sorted(set(x for e in ev for x in e["nombres_pred"])),
         "usd": sum(r["usd"] for r in rs),
        }
        if caso == "case-003": d["orientacion_vertical_legible"] = [e.get("orientacion_vertical_legible") for e in ev]
        if caso == "case-006": d["centro_mesa_un_globo"] = [e.get("centro_mesa_un_globo") for e in ev]; d["centro_mesa_detectado"] = [e.get("centro_mesa_detectado") for e in ev]
        out[f"{caso}|{var}"] = d
json.dump(out, open(f"{A.OUT}/resumen-por-caso.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
# agregados por variante
agg = {}
for var in A.VARS:
    ks = [k for k in out if k.endswith(var)]
    f = lambda key: statistics.mean(out[k][key] for k in ks if out[k][key] is not None)
    agg[var] = {k: f(k) for k in ["pct_n_piezas_ok", "pct_tipo_ok", "pct_tipo_exacto_ok", "pct_lado_ok", "estab_tipos", "estab_n_piezas", "estab_inclinacion", "jaccard_familias_color", "color_cobertura", "incl_signo_ok", "incl_mae_frac", "de_catalogo_medio", "de_cluster_medio"]}
    agg[var]["usd"] = sum(out[k]["usd"] for k in ks)
json.dump(agg, open(f"{A.OUT}/agregado-por-variante.json", "w", encoding="utf-8"), indent=1)
for k, v in out.items():
    print(k, "| tipos", v["tipos"], "| lados", v["lados"], "| incl", v["inclinaciones"], f"| ok tipo {v['pct_tipo_ok']:.1f} n {v['pct_n_piezas_ok']:.1f} lado {v['pct_lado_ok']:.1f} | estab tipo {v['estab_tipos']:.1f} incl {v['estab_inclinacion']:.1f} | cobCol {v['color_cobertura']:.2f} jac {v['jaccard_familias_color'] if v['jaccard_familias_color'] is None else round(v['jaccard_familias_color'],2)} | falt {v['color_faltantes']} inv {v['familias_inventadas']} | deCat {v['de_catalogo_medio'] and round(v['de_catalogo_medio'],1)} | r5 {v['r5_pred']} | modo {v['patron_modo']}")
print(json.dumps(agg, indent=1))
