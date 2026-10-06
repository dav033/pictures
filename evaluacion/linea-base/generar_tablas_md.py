import json, os, glob, collections
import analizar_resultados as A
R = json.load(open(f"{A.OUT}/metricas.json", encoding="utf-8")); S = json.load(open(f"{A.OUT}/resumen-por-caso.json", encoding="utf-8"))
L = ["# Tablas por corrida (generado por generar_tablas_md.py; hex y verdad en verdad-visual.json)", ""]
for caso in sorted(A.V):
    t = A.V[caso]
    L += [f"## {caso.upper()}  (verdad: {t['n_piezas']} pieza(s): " + "; ".join(f"{p['tipo_detector']} {p.get('lado','')} incl {p.get('inclinacion_frac')}" for p in t["piezas"]) + ")", ""]
    for var in A.VARS:
        rs = sorted([r for r in R if r["caso"] == caso and r["var"] == var], key=lambda r: r["run"])
        L += [f"### {var}", "", "| corrida | piezas (tipo / lado / inclin. frac) | nombres de color leidos | modo patron | prop. 'chico' (conteo) | total estim. | ΔE00 medio vs hex de catalogo | familias faltantes | familias sin base |", "|---|---|---|---|---|---|---|---|---|"]
        for r in rs:
            e = r["eval"]
            piezas = "<br>".join(f"{p['tipo']} / {p['posicion']} / {p['inclina']:+.2f}" for p in r["piezas"]) or "(ninguna)"
            de = [x["de"] for x in e["de_catalogo"]]
            ch = ",".join(f"{c:.2f}" for c in e["chico_prop"]) or "n/d"
            L.append(f"| {r['run']} | {piezas} | {', '.join(e['nombres_pred'])} | {'/'.join(str(p['patron_modo']) for p in r['piezas'])} | {ch} | {e['estimado_total']} | {(sum(de)/len(de)) if de else float('nan'):.1f} | {', '.join(e['colores_verdad_faltantes']) or '-'} | {', '.join(e['familias_inventadas']) or '-'} |")
        s = S[f"{caso}|{var}"]
        L += ["", f"Estabilidad: tipo modal {s['estab_tipos']:.0%}, n piezas {s['estab_n_piezas']:.0%}, inclinacion {s['estab_inclinacion']:.0%}, lado {s['estab_lado']:.0%}, Jaccard familias de color {s['jaccard_familias_color']:.2f}. Aciertos: n piezas {s['pct_n_piezas_ok']:.0%}, tipo aceptable {s['pct_tipo_ok']:.0%}, tipo exacto {s['pct_tipo_exacto_ok']:.0%}, lado {s['pct_lado_ok']:.0%}, cobertura de colores {s['color_cobertura']:.0%}.", ""]
open(f"{A.OUT}/tablas.md", "w", encoding="utf-8").write("\n".join(L))
# costo total
tot = 0
for f in glob.glob(f"{A.LB}/resultados/**/costo-corrida-*.json", recursive=True):
    c = json.load(open(f)); print(f.split("resultados")[1], round(c["gastado_usd_a_partir_de_tokens_reportados"], 4), c["llamadas_de_analisis"]); tot += c["gastado_usd_a_partir_de_tokens_reportados"]
print("total", round(tot, 4))
