"""Analiza resultados/crudos contra verdad-visual.json. Solo lectura de archivos locales; sin red.
Salidas: resultados/analisis/metricas.json, tablas.md
"""
import json, glob, math, os, re, statistics, collections
LB = os.path.dirname(os.path.abspath(__file__))
V = {k.lower(): v for k, v in json.load(open(f"{LB}/verdad-visual.json", encoding="utf-8"))["casos"].items()}
OUT = f"{LB}/resultados/analisis"; os.makedirs(OUT, exist_ok=True)
VARS = ["v17-lectura-unica", "v16"]

# ---------- color: CIEDE2000 ----------
def hex2rgb(h): h = h.lstrip("#"); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
def lab(h):
    r, g, b = [c/255 for c in hex2rgb(h)]
    f = lambda c: ((c+0.055)/1.055)**2.4 if c > 0.04045 else c/12.92
    r, g, b = f(r), f(g), f(b)
    x = (0.4124564*r+0.3575761*g+0.1804375*b)/0.95047; y = 0.2126729*r+0.7151522*g+0.0721750*b; z = (0.0193339*r+0.1191920*g+0.9503041*b)/1.08883
    t = lambda v: v**(1/3) if v > 0.008856 else 7.787*v+16/116
    return 116*t(y)-16, 500*(t(x)-t(y)), 200*(t(y)-t(z))
def de00(h1, h2):
    L1, a1, b1 = lab(h1); L2, a2, b2 = lab(h2)
    C1 = math.hypot(a1, b1); C2 = math.hypot(a2, b2); Cb = (C1+C2)/2
    G = 0.5*(1-math.sqrt(Cb**7/(Cb**7+25**7)))
    a1p, a2p = (1+G)*a1, (1+G)*a2; C1p, C2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360; h2p = math.degrees(math.atan2(b2, a2p)) % 360
    dL = L2-L1; dC = C2p-C1p
    dh = 0 if C1p*C2p == 0 else (h2p-h1p if abs(h2p-h1p) <= 180 else (h2p-h1p-360 if h2p > h1p else h2p-h1p+360))
    dH = 2*math.sqrt(C1p*C2p)*math.sin(math.radians(dh/2))
    Lb = (L1+L2)/2; Cbp = (C1p+C2p)/2
    if C1p*C2p == 0: hb = h1p+h2p
    elif abs(h1p-h2p) <= 180: hb = (h1p+h2p)/2
    else: hb = (h1p+h2p+360)/2 if h1p+h2p < 360 else (h1p+h2p-360)/2
    T = 1-0.17*math.cos(math.radians(hb-30))+0.24*math.cos(math.radians(2*hb))+0.32*math.cos(math.radians(3*hb+6))-0.20*math.cos(math.radians(4*hb-63))
    dth = 30*math.exp(-((hb-275)/25)**2); Rc = 2*math.sqrt(Cbp**7/(Cbp**7+25**7))
    Sl = 1+0.015*(Lb-50)**2/math.sqrt(20+(Lb-50)**2); Sc = 1+0.045*Cbp; Sh = 1+0.015*Cbp*T; Rt = -math.sin(math.radians(2*dth))*Rc
    return math.sqrt((dL/Sl)**2+(dC/Sc)**2+(dH/Sh)**2+Rt*(dC/Sc)*(dH/Sh))

# ---------- nombres de color -> familia ----------
FAM = [
 ("rosegold", r"rose ?gold|oro rosa|dorado rosa|rosa dorado|cobre rosado|copper pink"),
 ("transparent", r"clear|transparen|cristal|crystal|glass|bubble|burbuja"),
 ("silver", r"silver|plat[ao]|plateado|chrome grey|steel"),
 ("gold", r"gold|dorado|oro\b|champ|champagne|mustard"),
 ("burgundy", r"burgundy|merlot|wine|vino|borgo|maroon|bordeaux|plum|ciruela|oxblood|cranberry"),
 ("mauve", r"mauve|malva|lilac|lila\b|lavender|lavanda|purple|morado|violet|orchid|dusk"),
 ("coral", r"coral|salmon|salm[oó]n|terracotta|rust"),
 ("fuchsia", r"fuchsia|fucsia|hot pink|magenta|raspberry"),
 ("pink", r"pink|rosa\b|rosad|rose\b|blush|dusty rose|rubor|rosé"),
 ("peach", r"peach|durazno|apricot|nude|beige|sand|cream|crema|tan\b|champagne|ivory|marfil|taupe"),
 ("white", r"white|blanc|pearl|nacar|nácar|ivory"),
 ("navy", r"navy|marino|naval|midnight|dark blue|azul oscuro|indigo|índigo"),
 ("blue", r"blue|azul|celeste|sky|cielo|periwinkle|cornflower|royal|turquo|aqua|cyan"),
 ("teal", r"teal"),
 ("green", r"green|verde|mint|menta|sage|eucalypt|olive|emerald|lime"),
 ("yellow", r"yellow|amarillo|lemon|limón"),
 ("orange", r"orange|naranja|tangerine|copper|cobre|bronze|bronce|rust|terracotta"),
 ("brown", r"brown|caf[eé]|chocolate|mocha|moca|coffee|bronze|bronce|walnut|nogal|cognac|tan\b"),
 ("black", r"black|negro|onyx|charcoal"),
 ("grey", r"gr[ae]y|gris|slate|ash|stone|graphite"),
]
def familias(nombre):
    n = nombre.lower(); out = []
    for f, rx in FAM:
        if re.search(rx, n):
            out.append(f)
    # el patron especifico gana: 'rose gold' no cuenta como gold ni pink; 'dusty rose'->pink; 'light blue' -> blue (no navy)
    if "rosegold" in out: out = [o for o in out if o not in ("gold", "pink", "peach", "orange", "brown")]
    if "navy" in out: out = [o for o in out if o != "blue"]
    if "fuchsia" in out: out = [o for o in out if o != "pink"] + ["pink"]
    if "pearl" in n and "white" not in out and len(out) == 0: out.append("white")
    return list(dict.fromkeys(out))
# familias de verdad por caso y pieza (nombre de verdad -> familias aceptables)
TRUTH_FAM = {
 "case-001": {"dorado cromado": ["gold"]},
 "case-002": {"rosa pastel": ["pink"], "gris azulado claro": ["grey", "blue", "mauve"], "plata": ["silver"], "blanco nacar": ["white"], "transparente": ["transparent"]},
 "case-003": {"crema/blanco": ["white", "peach"], "dorado champan": ["gold", "peach"], "rosa empolvado": ["pink", "peach", "mauve", "brown", "coral"], "bronce/moca": ["brown", "orange", "burgundy"]},
 "case-004": {"coral": ["coral", "orange"], "rosa pastel": ["pink", "fuchsia"], "blanco": ["white"], "malva/lila": ["mauve"], "plata": ["silver"]},
 "case-005": {"fucsia / rosa fuerte": ["fuchsia", "pink"], "azul medio (cornflower/cielo)": ["blue"], "rosa claro": ["pink"], "azul claro/cielo": ["blue"]},
 "case-006": {"merlot / borgona": ["burgundy", "mauve"], "plata cromada": ["silver"], "blanco nacar": ["white"], "rosa palido": ["pink", "peach"], "malva/ciruela": ["mauve", "burgundy"], "gris metalico / negro": ["grey", "black", "silver"]},
 "case-007": {"blanco/verde menta muy claro": ["white", "green"], "azul polvo": ["blue"], "durazno": ["peach", "orange", "coral"], "dorado cromado": ["gold"], "cobre/naranja mate (un globo grande)": ["orange", "brown"]},
 "case-008": {"amarillo": ["yellow"], "naranja": ["orange"], "naranja cobrizo": ["orange", "coral", "brown"], "durazno/neon": ["peach", "orange", "coral"], "verde oscuro metalico": ["green"], "naranja translucido (globo grande)": ["orange", "transparent"]},
}
# familias que NO existen en la referencia (inventadas si aparecen)
def truth_colors(caso):
    t = V[caso]; res = []
    for k in ("colores", "colores_compartidos", "colores_arco"):
        if k in t: res += t[k]
    for p in t["piezas"]: res += p.get("colores", [])
    seen = {}
    for c in res: seen[c["nombre"]] = c
    return list(seen.values())
def truth_allowed(caso):
    return set(f for fs in TRUTH_FAM[caso].values() for f in fs)

# ---------- parseo de la salida ----------
def oneof(v, vals):
    t = re.sub(r"[\s-]+", "_", str(v).strip().lower()) if isinstance(v, str) else ""
    return t if t in vals else None
INCL = {"none": 0, "slight": 0.22, "strong": 0.45}
def parse_struct(st):
    typ = oneof(st.get("structure_type") or st.get("type"), ["arch","half_arch","column","garland","balloon_wall","centerpiece","ceiling_installation","cluster","sculpture","bouquet","hoop"])
    if not typ: return None
    ov = oneof(st.get("top_overhang"), ["none","slight","strong"]); vert = typ in ("half_arch","column")
    res = typ
    if vert and ov: res = "half_arch" if ov == "strong" else "column"
    curves = oneof(st.get("curves_toward"), ["left","right","none"]) or "none"
    incl = 0 if (curves == "none" or not ov) else (-1 if curves == "left" else 1)*INCL[ov]
    return {"tipo": res, "tipo_modelo": typ, "posicion": oneof(st.get("horizontal_position") or st.get("position"), ["left","center","right","full_width"]) or "center",
            "curves_toward": curves, "top_overhang": ov, "inclina": incl, "outline": st.get("outline"), "density": st.get("density"), "mirrors": st.get("mirrors_element")}

def cargar():
    runs = []
    for f in sorted(glob.glob(f"{LB}/resultados/crudos/*/case-*/run-*.json")):
        d = json.load(open(f, encoding="utf-8"))
        var, caso, run = f.replace("\\", "/").split("/")[-3:]
        run = int(re.search(r"\d+", run).group())
        args = [p["args"] for p in d["pases"] if p["args"]]
        piezas = []
        if d.get("error") is None and args:
            raw = args[-1]["images"][0]["elements"]; bp = d["blueprint"]["elements"]
            lect = d.get("lecturasCrudas") or {}
            colorp = {p["elementId"]: p for p in (d.get("analisisColor") or {}).get("piezas", [])}
            for i, el in enumerate(bp):
                if el["category"] != "balloon_structure" or not el["approved"]: continue
                idx = int(el["element_id"].rsplit("E", 1)[1]) - 1
                r = raw[idx] if idx < len(raw) else {}
                st = parse_struct(r.get("structure") or {}) if r.get("structure") else None
                if not st: continue
                lec = lect.get(el["element_id"], {}) or r.get("lecturas", {}) or {}
                cp = colorp.get(el["element_id"], {})
                piezas.append({"id": el["element_id"], "nombre": el["name"], "bbox": el["reference_bbox"], **st,
                    "colores_obs": el["appearance"]["observed_colors"], "colores_patron": (lec.get("patron_color") or {}).get("colores", []),
                    "patron_modo": (lec.get("patron_color") or {}).get("modo"), "tamanos_leidos": (lec.get("patron_color") or {}).get("tamanos"),
                    "conteo": lec.get("conteo"), "armado_guirnalda": lec.get("armado_guirnalda"),
                    "cluster_hex": [(c["hex"], c["parte"], (c.get("cruce") or {}).get("candidatas", [{}])[0]) for c in cp.get("colores", [])],
                    "repeticion": (el.get("visual_semantics") or {}).get("repetition_group")})
        elementos_no_globos = [e["name"] for e in (args[-1]["images"][0]["elements"] if args else []) if e.get("category") != "balloon_structure"]
        rawdict = {"n_elem_total": len(args[-1]["images"][0]["elements"]) if args else 0}
        runs.append({"var": var, "caso": caso, "run": run, "error": d.get("error"), "meta": d["meta"], "usos": [p["uso"] for p in d["pases"]], "piezas": piezas, "n_pases": len(d["pases"])})
    return runs

# ---------- comparacion con la verdad ----------
def match_piezas(pred, truth):
    """mejor emparejamiento (fuerza bruta) maximizando tipo aceptable + lado."""
    import itertools
    best = (-1, [])
    n = min(len(pred), len(truth))
    for perm in itertools.permutations(range(len(truth)), n):
        for sel in itertools.combinations(range(len(pred)), n):
            s = 0
            for pi, ti in zip(sel, perm):
                if pred[pi]["tipo"] in truth[ti]["tipo_detector_aceptables"]: s += 2
                if pred[pi]["posicion"] in (truth[ti].get("lado_aceptables") or [truth[ti].get("lado")]): s += 1
            if s > best[0]: best = (s, list(zip(sel, perm)))
    return best[1]

def evaluar(run):
    caso = run["caso"]; T = V[caso]; tp = T["piezas"]; P = run["piezas"]
    m = {"n_piezas_pred": len(P), "n_piezas_ok": len(P) == T["n_piezas"]}
    pares = match_piezas(P, tp) if P else []
    m["tipos_pred"] = sorted(p["tipo"] for p in P)
    # tipo multiconjunto: todos los tipos verdad cubiertos 1:1 por aceptables y mismo n
    m["tipo_ok"] = bool(P) and len(P) == len(tp) and all(P[pi]["tipo"] in tp[ti]["tipo_detector_aceptables"] for pi, ti in pares) and len(pares) == len(tp)
    m["tipo_exacto_ok"] = bool(P) and len(P) == len(tp) and all(P[pi]["tipo"] == tp[ti]["tipo_detector"] for pi, ti in pares) and len(pares) == len(tp)
    m["lado_ok"] = bool(pares) and all(P[pi]["posicion"] in (tp[ti].get("lado_aceptables") or [tp[ti].get("lado")]) for pi, ti in pares if tp[ti].get("lado"))
    incl = []
    for pi, ti in pares:
        tf = tp[ti].get("inclinacion_frac")
        if tf is None: continue
        pf = P[pi]["inclina"]; rng = tp[ti].get("inclinacion_rango_deg")
        incl.append({"pred": pf, "verdad": tf, "err": abs(pf-tf), "signo_ok": (abs(tf) < 0.08 and abs(pf) < 0.01) or (pf*tf > 0)})
    m["incl"] = incl
    if caso == "case-003":
        ori = []
        for p in P:
            if p["tipo"] in ("column", "half_arch", "arch"): ori.append(True)
            elif p["tipo"] == "garland":
                ag = p.get("armado_guirnalda") or {}; lc = ag.get("linea_central")
                if lc:
                    dx = abs(lc["extremo_derecho"]["x"]-lc["extremo_izquierdo"]["x"])*320; dy = abs(lc["extremo_derecho"]["y"]-lc["extremo_izquierdo"]["y"])*480
                    ori.append(dy > dx)
                else: ori.append(None)
            else: ori.append(False)
        m["orientacion_vertical_legible"] = ori
    # colores por nombre
    pred_f = collections.Counter(); pred_names = []
    for p in P:
        for n in p["colores_obs"] + p["colores_patron"]:
            pred_names.append(n)
            for f in familias(n): pred_f[f] += 1
    tf_map = TRUTH_FAM[caso]; permitidas = truth_allowed(caso)
    pf2 = set(pred_f) | ({"green","blue"} if "teal" in pred_f else set())
    cubiertas = [k for k, fs in tf_map.items() if any(f in pf2 for f in fs)]
    m["colores_verdad_cubiertos"] = len(cubiertas)/len(tf_map); m["colores_verdad_faltantes"] = [k for k in tf_map if k not in cubiertas]
    inventadas = sorted(f for f in pred_f if f not in permitidas and f not in ("transparent",) and not (f == "teal" and ({"green","blue"} & permitidas)))
    m["familias_inventadas"] = inventadas
    # nombres pred (union) para la tabla
    m["nombres_pred"] = sorted(set(n.lower() for n in pred_names))
    # DeltaE00: color de verdad con hex -> mas cercano entre clusters medidos de las piezas (a) y hex del globo de catalogo (b)
    de_a, de_b = [], []
    clus = [(h, parte) for p in P for h, parte, cand in p["cluster_hex"] if parte >= 0.03]
    cat = [cand["hexGlobo"] for p in P for h, parte, cand in p["cluster_hex"] if parte >= 0.03 and cand.get("hexGlobo")]
    for c in truth_colors(caso):
        if not c.get("hex_medido") or not clus: continue
        de_a.append({"color": c["nombre"], "de": min(de00(c["hex_medido"], h) for h, _ in clus)})
        if cat: de_b.append({"color": c["nombre"], "de": min(de00(c["hex_medido"], h) for h in cat)})
    m["de_cluster"] = de_a; m["de_catalogo"] = de_b
    # tamanos / R5
    chico = []; est = []
    for p in P:
        c = p["conteo"]
        if c:
            ch = sum(x.get("proporcion", 0) for x in c.get("por_tamano", []) if x.get("clase") == "chico")
            chico.append(ch); est.append(c.get("estimado_total"))
    m["r5_pred"] = (max(chico) >= 0.1) if chico else None; m["chico_prop"] = chico; m["estimado_total"] = est
    m["tamanos_leidos"] = [p["tamanos_leidos"] for p in P]
    # centro de mesa (caso 6): pieza centerpiece con globos <=2
    if caso == "case-006":
        cm = [p for p in P if p["tipo"] == "centerpiece"]
        m["centro_mesa_detectado"] = bool(cm)
        m["centro_mesa_un_globo"] = bool(cm) and all((p["conteo"] or {}).get("estimado_total") in (1, 2) or (p["conteo"] or {}).get("globos_visibles") == 1 for p in cm)
        m["centro_mesa_conteo"] = [(p["conteo"] or {}).get("estimado_total") for p in cm]
        m["centro_mesa_colores"] = [p["colores_obs"] for p in cm]
    return m

def main():
    runs = cargar(); res = []
    for r in runs:
        e = evaluar(r) if not r["error"] else {"error": r["error"]}
        res.append({"var": r["var"], "caso": r["caso"], "run": r["run"], "usd": r["meta"]["usd_reportado"], "n_pases": r["n_pases"], "piezas": [{k: p[k] for k in ("tipo","tipo_modelo","posicion","curves_toward","top_overhang","inclina","outline","density","colores_obs","colores_patron","patron_modo","tamanos_leidos","repeticion","bbox")} | {"conteo": p["conteo"], "clusters": [(h, round(pa, 3), cd.get("nombreCompleto"), cd.get("acabado"), cd.get("deltaE")) for h, pa, cd in p["cluster_hex"]]} for p in r["piezas"]], "eval": e})
    json.dump(res, open(f"{OUT}/metricas.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return res

if __name__ == "__main__":
    r = main(); print(len(r), "corridas analizadas")
