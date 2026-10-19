/**
 * Juez automático de parecido foto → imagen final. Versión 2. Código en `evaluacion/juez/`; fotos, cachés y
 * resultados en `DATOS/juez/` (`evaluacion/rutas.ts`). Las rutas de un manifiesto son relativas a `DATOS/juez/`.
 *
 * Dos jueces independientes, cada uno activable por separado:
 *
 * 1. Juez de análisis (`--analisis si|no`, por defecto `si`): analiza la foto y la imagen generada con el MISMO
 *    reconocedor de producción (ruta real `/api/references/analyze`, en proceso, sin caché del servicio) y compara
 *    pieza a pieza. Novedades de la v2:
 *    - referencia estable: la foto se analiza `--n-ref` veces (por defecto 3) y la nota es la media frente a cada
 *      análisis; en los 8 casos de la línea base el tipo y el lado de la foto vienen de `linea-base/verdad-visual.json`
 *      y su paleta de `hex-medidos-verdad.json` (medida a mano fuera del velo lila);
 *    - color por distancia CIELAB (ΔE76) entre hex, no por coincidencia de nombre;
 *    - escala: fracción del lienzo que ocupa la decoración (unión de cajas) frente a la de la foto;
 *    - topología: piezas que la foto tiene separadas y la imagen une (o al revés).
 * 2. Juez visual (`--visual codex|gemini|no`, por defecto `no`): manda foto + imagen en UNA llamada al CLI local de Codex
 *    (`gpt-6-luna`, razonamiento `medium`), con `visual-prompt.txt` y la salida forzada por `visual-esquema.json`.
 *    `--n-visual` repeticiones por pareja (por defecto 1). Si el CLI no tiene sesión, se avisa y se sigue sin él.
 *
 * Todo se guarda por sha256 (`analisis/`, `visual/`): una imagen o una pareja nunca se paga dos veces.
 *
 *   cd <repo> && npx tsx --env-file=.env.local --conditions=react-server evaluacion/juez/juez.ts \
 *     --manifiesto evaluacion/juez/manifiestos/manifiesto.json --max-llamadas 40 [--visual codex] [--n-visual 1]
 *
 * Telemetría y escrituras a Postgres bloqueadas. Escribe `resultados.json` (o `--salida`) y una tabla por consola.
 */
import { DATOS, REPO } from "../rutas";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const AQUI = `${DATOS}/juez`;
/** Lo que es código o dato de referencia vive en el repositorio; las cachés, los resultados y las fotos, en `DATOS`. */
const CODIGO = __dirname.replace(/\\/g, "/");
const LB = `${CODIGO}/../linea-base`;
const imp = (rel: string) => import(pathToFileURL(resolve(REPO, rel)).href);
const arg = (n: string, d: string) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : d; };

type Caja = { x: number; y: number; width: number; height: number };
type Elemento = {
  element_id: string; approved: boolean; category: string; name: string; reference_bbox: Caja;
  visual_semantics?: { structure_type?: string; placement?: string };
  appearance?: { measured_colors?: Array<{ color: string; share: number }>; resolved_colors?: string[]; observed_colors?: string[] };
};
type Blueprint = { source_images: Array<{ aspect_ratio?: number }>; elements: Elemento[] };
type Lab = [number, number, number];
type Pieza = { tipo: string; lado: "left" | "center" | "right"; colores: Array<{ lab: Lab; peso: number }>; aspecto: number | null; caja: Caja | null; nombre: string };
type Entrada = { id: string; grupo: string; ref: string; img: string };

// Tipos que el plan trata igual o que el reconocedor confunde sin consecuencia para el parecido.
const EQUIVALENTES: Record<string, string> = { columna: "vertical", semiarco: "vertical", arco: "arco", guirnalda: "guirnalda", pared: "pared", kit: "racimo", bouquet: "racimo", centro_mesa: "racimo" };
// Enum del detector (verdad-visual) → structure_type del blueprint.
const TIPO_VERDAD: Record<string, string> = { column: "columna", half_arch: "semiarco", arch: "arco", hoop: "aro", centerpiece: "centro_mesa", garland: "guirnalda", balloon_wall: "pared", cluster: "kit", bouquet: "bouquet", ceiling_installation: "techo" };

// ---------- color ----------
function hexALab(hex: string): Lab {
  const n = parseInt(hex.replace("#", ""), 16);
  const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = f(0.2126 * r + 0.7152 * g + 0.0722 * b), z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const deltaE = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** 1 si ΔE ≤ 10 (mismo color a ojo), 0 si ΔE ≥ 45 (otro color), lineal entre medias. */
const simColor = (a: Lab, b: Lab) => Math.max(0, Math.min(1, (45 - deltaE(a, b)) / 35));

/** Parecido de paletas, simétrico: cada color de una paleta busca su mejor pareja en la otra, ponderado por peso. */
function parecidoColor(a: Pieza["colores"], b: Pieza["colores"]): number {
  if (!a.length || !b.length) return 0;
  const lado = (p: Pieza["colores"], q: Pieza["colores"]) => {
    const tot = p.reduce((s, c) => s + c.peso, 0) || 1;
    return p.reduce((s, c) => s + (c.peso / tot) * Math.max(...q.map((d) => simColor(c.lab, d.lab))), 0);
  };
  return (lado(a, b) + lado(b, a)) / 2;
}

// ---------- piezas ----------
function lado(caja: Caja): "left" | "center" | "right" {
  const centro = caja.x + caja.width / 2;
  return centro < 0.4 ? "left" : centro > 0.6 ? "right" : "center";
}

function piezas(bp: Blueprint, hex: Record<string, string>): Pieza[] {
  const proporcion = bp.source_images[0]?.aspect_ratio ?? 1;
  return bp.elements.filter((e) => e.approved && e.category === "balloon_structure" && e.visual_semantics?.structure_type).map((e) => {
    const medidos = e.appearance?.measured_colors?.length ? e.appearance.measured_colors : (e.appearance?.resolved_colors ?? []).map((c, _i, t) => ({ color: c, share: 1 / t.length }));
    const colores = medidos.filter((m) => hex[m.color]).map((m) => ({ lab: hexALab(hex[m.color]!), peso: m.share }));
    return {
      tipo: e.visual_semantics!.structure_type!, lado: lado(e.reference_bbox), colores, caja: e.reference_bbox,
      aspecto: e.reference_bbox.height / Math.max(1e-6, e.reference_bbox.width * proporcion), nombre: e.name,
    };
  });
}

/** Verdad fija de la línea base: tipo y lado por pieza; la paleta medida del caso se reparte a todas las piezas. */
function piezasDeVerdad(caso: string): Pieza[] | null {
  const verdad = JSON.parse(readFileSync(`${LB}/verdad-visual.json`, "utf8")) as { casos: Record<string, { piezas: Array<{ tipo_detector: string; lado: string }> }> };
  const c = verdad.casos[caso];
  if (!c) return null;
  const num = String(Number(caso.replace(/\D/g, "")));
  const hexes = JSON.parse(readFileSync(`${LB}/hex-medidos-verdad.json`, "utf8")) as Record<string, [string, number]>;
  const paleta = Object.entries(hexes).filter(([k]) => k.split(" ")[0] === num && !/sombra/.test(k)).map(([, [h, n]]) => ({ lab: hexALab(h), peso: n }));
  return c.piezas.map((p) => ({
    tipo: TIPO_VERDAD[p.tipo_detector] ?? p.tipo_detector, lado: (p.lado === "left" || p.lado === "right" ? p.lado : "center"),
    colores: paleta, aspecto: null, caja: null, nombre: p.tipo_detector,
  }));
}

function puntuarPar(r: Pieza, g: Pieza): number {
  const tipo = r.tipo === g.tipo ? 1 : EQUIVALENTES[r.tipo] && EQUIVALENTES[r.tipo] === EQUIVALENTES[g.tipo] ? 0.6 : 0;
  const ladoOk = r.lado === g.lado ? 1 : 0;
  return 0.4 * tipo + 0.25 * ladoOk + 0.35 * parecidoColor(r.colores, g.colores);
}

/** Mejor emparejamiento (fuerza bruta: pocas piezas). */
function emparejar(ref: Pieza[], gen: Pieza[]): Array<[number, number, number]> {
  let mejor: Array<[number, number, number]> = [];
  let mejorSuma = -1;
  const usados = new Set<number>();
  const actual: Array<[number, number, number]> = [];
  const rec = (i: number) => {
    if (i === ref.length) {
      const suma = actual.reduce((s, [, , p]) => s + p, 0);
      if (suma > mejorSuma) { mejorSuma = suma; mejor = [...actual]; }
      return;
    }
    rec(i + 1);
    for (let j = 0; j < gen.length; j += 1) {
      if (usados.has(j)) continue;
      usados.add(j); actual.push([i, j, puntuarPar(ref[i]!, gen[j]!)]);
      rec(i + 1);
      actual.pop(); usados.delete(j);
    }
  };
  rec(0);
  return mejor;
}

// ---------- escala y topología ----------
function union(cajas: Caja[]): Caja | null {
  if (!cajas.length) return null;
  const x0 = Math.min(...cajas.map((c) => c.x)), y0 = Math.min(...cajas.map((c) => c.y));
  const x1 = Math.max(...cajas.map((c) => c.x + c.width)), y1 = Math.max(...cajas.map((c) => c.y + c.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
/** 1 si la decoración ocupa la misma fracción del lienzo; 0 si una es 2,5 veces la otra (o más). */
function escala(R: Pieza[], G: Pieza[]): { nota: number; ref: number; gen: number } | null {
  const ur = union(R.flatMap((p) => (p.caja ? [p.caja] : []))), ug = union(G.flatMap((p) => (p.caja ? [p.caja] : [])));
  if (!ur || !ug) return null;
  const ar = ur.width * ur.height, ag = ug.width * ug.height;
  return { nota: 1 - Math.min(1, Math.abs(Math.log(ag / Math.max(1e-6, ar))) / Math.log(2.5)), ref: +ar.toFixed(3), gen: +ag.toFixed(3) };
}
const separadas = (a: Caja, b: Caja) => Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width) > 0.02;
/** Fracción de parejas de piezas emparejadas cuya separación (hueco horizontal > 2 % del lienzo) se conserva. */
function topologia(R: Pieza[], G: Pieza[], pares: Array<[number, number, number]>): number | null {
  let total = 0, rotas = 0;
  for (let a = 0; a < pares.length; a += 1) for (let b = a + 1; b < pares.length; b += 1) {
    const [ri, gi] = pares[a]!, [rj, gj] = pares[b]!;
    const cr1 = R[ri]!.caja, cr2 = R[rj]!.caja, cg1 = G[gi]!.caja, cg2 = G[gj]!.caja;
    if (!cr1 || !cr2 || !cg1 || !cg2) continue;
    total += 1;
    if (separadas(cr1, cr2) !== separadas(cg1, cg2)) rotas += 1;
  }
  return total ? 1 - rotas / total : null;
}

function evaluar(R: Pieza[], G: Pieza[], cajasRef: Pieza[]) {
  const pares = emparejar(R, G).filter(([, , p]) => p > 0.25);
  const faltan = R.length - pares.length;
  const sobran = G.length - pares.length;
  const media = (f: (i: number, j: number) => number) => pares.length ? pares.reduce((s, [i, j]) => s + f(i, j), 0) / pares.length : 0;
  const tipo = media((i, j) => (R[i]!.tipo === G[j]!.tipo ? 1 : 0));
  const ladoOk = media((i, j) => (R[i]!.lado === G[j]!.lado ? 1 : 0));
  const color = media((i, j) => parecidoColor(R[i]!.colores, G[j]!.colores));
  // Forma, escala y topología necesitan cajas: si la referencia es la verdad fija, se toman del análisis de la foto.
  const conCaja = R.every((p) => p.caja) ? R : cajasRef;
  const paresCaja = conCaja === R ? pares : emparejar(conCaja, G).filter(([, , p]) => p > 0.25);
  const formas = paresCaja.flatMap(([i, j]) => { const a = conCaja[i]!.aspecto, b = G[j]!.aspecto; return a && b ? [1 - Math.min(1, Math.abs(Math.log(a / b)) / Math.log(3))] : []; });
  const forma = formas.length ? formas.reduce((s, v) => s + v, 0) / formas.length : 0;
  const esc = escala(conCaja, G);
  const topo = topologia(conCaja, G, paresCaja);
  const cobertura = R.length ? pares.length / R.length : 1;
  const penalSobran = Math.min(1, sobran * 0.25);
  const parcial = 0.3 * tipo + 0.15 * ladoOk + 0.25 * color + 0.1 * forma + 0.1 * (esc?.nota ?? 0.5) + 0.1 * (topo ?? 1);
  const nota = 100 * Math.max(0, cobertura * parcial - 0.2 * penalSobran);
  return {
    nota, piezas_ref: R.map((p) => `${p.tipo}/${p.lado}`), piezas_gen: G.map((p) => `${p.tipo}/${p.lado}`),
    faltan, sobran, tipo, lado: ladoOk, color, forma, escala: esc?.nota ?? null, area_ref: esc?.ref ?? null, area_gen: esc?.gen ?? null, topologia: topo,
  };
}
type Eval = ReturnType<typeof evaluar>;
function promediar(evals: Eval[]): Eval {
  const m = (k: keyof Eval) => { const v = evals.map((e) => e[k]).filter((x): x is number => typeof x === "number"); return v.length ? +(v.reduce((s, x) => s + x, 0) / v.length).toFixed(2) : null; };
  const base = evals[0]!;
  return { ...base, nota: Math.round(m("nota")!), tipo: m("tipo")!, lado: m("lado")!, color: m("color")!, forma: m("forma")!, escala: m("escala"), topologia: m("topologia"), faltan: m("faltan")!, sobran: m("sobran")!, area_ref: m("area_ref"), area_gen: m("area_gen") };
}

// ---------- juez visual (Codex local) ----------
const MODELO_VISUAL = arg("--modelo-visual", "gpt-6-luna");
const ESFUERZO_VISUAL = arg("--esfuerzo-visual", "medium");
type Visual = { nota: number; composicion: number; geometria: number; colores: number; orden_color: number; escala: number; densidad: number; orientacion: number; topologia: number; piezas_faltan: string[]; piezas_sobran: string[]; atrezo_inventado: string[]; defectos: string[] };

/**
 * Lo que la verdad visual de la línea base dice de la foto (piezas, lado, orientación e inclinación), para que el
 * juez no lea mal la foto: con el 002 corregido, Gemini creyó que las dos piezas se unían por arriba y lo penalizó,
 * contra el usuario y contra la verdad. Vacío fuera de la línea base.
 */
function contextoVerdad(ref: string): string {
  const m = /[\\/]linea-base[\\/].*case-(\d{3})-ref\.png$/.exec(ref);
  if (!m) return "";
  const verdad = JSON.parse(readFileSync(`${LB}/verdad-visual.json`, "utf8")) as { casos: Record<string, { n_piezas?: number; piezas: Array<{ tipo_detector: string; lado: string; inclinacion_deg?: number | null; orientacion?: string; densidad?: string }> }> };
  const caso = verdad.casos[`CASE-${m[1]}`];
  if (!caso) return "";
  const piezas = caso.piezas.map((p, i) => `- Pieza ${i + 1}: ${p.tipo_detector}, lado ${p.lado}${p.inclinacion_deg != null ? `, inclinada ${p.inclinacion_deg}° respecto de la vertical` : ""}${p.densidad ? `, densidad ${p.densidad}` : ""}. ${p.orientacion ?? ""}`);
  return `\n\nDESCRIPCIÓN DE REFERENCIA DE LA FOTO (revisada; úsala para leer la IMAGEN 1, no la contradigas): ${caso.piezas.length} pieza(s) de globos SEPARADAS entre sí.\n${piezas.join("\n")}`;
}

function codexConSesion(): boolean {
  const r = spawnSync("codex", ["login", "status"], { shell: true, encoding: "utf8" });
  return r.status === 0 && !/not logged in/i.test(`${r.stdout}${r.stderr}`);
}

function juezVisual(ref: string, img: string, k: number): Visual | null {
  const prompt = readFileSync(`${CODIGO}/visual-prompt.txt`, "utf8") + contextoVerdad(ref);
  const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
  const clave = sha(`${sha(readFileSync(ref))}|${sha(readFileSync(img))}|${sha(prompt)}|${sha(readFileSync(`${CODIGO}/visual-esquema.json`))}|${MODELO_VISUAL}|${ESFUERZO_VISUAL}|${k}`);
  const cache = `${AQUI}/visual/${clave}.json`;
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8")) as Visual;
  const salida = `${AQUI}/visual/${clave}.tmp.json`;
  const r = spawnSync("codex", [
    "exec", "-m", MODELO_VISUAL, "-c", `model_reasoning_effort=${ESFUERZO_VISUAL}`, "-s", "read-only", "--skip-git-repo-check", "--ephemeral", "--ignore-rules",
    "-C", `"${AQUI}/visual"`, "--output-schema", `"${CODIGO}/visual-esquema.json"`, "-o", `"${salida}"`, "-i", `"${ref}"`, "-i", `"${img}"`, "-",
  ], { shell: true, input: prompt, encoding: "utf8", timeout: 600_000 });
  if (r.status !== 0 || !existsSync(salida)) { console.log(`[sin juez visual] ${basename(img)} status=${r.status} ${(r.stderr ?? "").split("\n").filter(Boolean).slice(-1)[0] ?? ""}`); return null; }
  const v = JSON.parse(readFileSync(salida, "utf8")) as Visual;
  writeFileSync(cache, JSON.stringify(v, null, 1));
  return v;
}

/** Mismo juez visual con Gemini (provisional mientras Codex no tenga sesión). Clave de caché propia. */
async function juezVisualGemini(ref: string, img: string, k: number, png: (b: Buffer) => Promise<Buffer>, contar: () => void): Promise<Visual | null> {
  const prompt = readFileSync(`${CODIGO}/visual-prompt.txt`, "utf8") + contextoVerdad(ref);
  const modelo = arg("--modelo-gemini", "gemini-3.6-flash");
  const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
  const clave = sha(`${sha(readFileSync(ref))}|${sha(readFileSync(img))}|${sha(prompt)}|${sha(readFileSync(`${CODIGO}/visual-esquema.json`))}|${modelo}|${k}`);
  const cache = `${AQUI}/visual/gemini-${clave}.json`;
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8")) as Visual;
  contar();
  const parte = async (ruta: string) => ({ inlineData: { mimeType: "image/png", data: (await png(readFileSync(ruta))).toString("base64") } });
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
    method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY ?? "" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${prompt}\n\nResponde SOLO con un JSON que cumpla este esquema:\n${readFileSync(`${CODIGO}/visual-esquema.json`, "utf8")}` }, { text: "IMAGEN 1 (foto de referencia):" }, await parte(ref), { text: "IMAGEN 2 (imagen generada):" }, await parte(img)] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  const cuerpo = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const texto = cuerpo.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  try {
    const v = JSON.parse(texto) as Visual;
    if (typeof v.nota !== "number") throw new Error("sin nota");
    writeFileSync(cache, JSON.stringify(v, null, 1));
    return v;
  } catch { console.log(`[sin juez visual gemini] ${basename(img)} status=${res.status}`); return null; }
}

function promedioVisual(vs: Visual[]) {
  const m = (k: keyof Visual) => +(vs.reduce((s, v) => s + (v[k] as number), 0) / vs.length).toFixed(1);
  return {
    n: vs.length, nota: m("nota"), nota_min: Math.min(...vs.map((v) => v.nota)), nota_max: Math.max(...vs.map((v) => v.nota)),
    composicion: m("composicion"), geometria: m("geometria"), colores: m("colores"), orden_color: m("orden_color"), escala: m("escala"),
    densidad: m("densidad"), orientacion: m("orientacion"), topologia: m("topologia"),
    atrezo_inventado: [...new Set(vs.flatMap((v) => v.atrezo_inventado))], defectos: vs[0]!.defectos,
  };
}

async function main(): Promise<void> {
  const usarAnalisis = arg("--analisis", "si") !== "no";
  let usarVisual = arg("--visual", "no") === "codex";
  const usarGemini = arg("--visual", "no") === "gemini";
  const nRef = Number(arg("--n-ref", "3"));
  const nVisual = Number(arg("--n-visual", "1"));
  if (usarVisual && !codexConSesion()) { console.log("[juez visual] el CLI de Codex no tiene sesión (ejecuta `codex login`); sigo sin juez visual"); usarVisual = false; }
  const sharp = createRequire(resolve(REPO, "package.json"))("sharp") as (b: Buffer) => { rotate: () => { resize: (o: object) => { png: () => { toBuffer: () => Promise<Buffer> } } } };
  const aPng = (b: Buffer) => sharp(b).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  let llamadasVisual = 0;
  const maxVisual = Number(arg("--max-visual", "40"));
  const contarVisual = () => { if (llamadasVisual >= maxVisual) throw new Error("JUEZ_TOPE: juez visual bloqueado por el tope declarado"); llamadasVisual += 1; };
  mkdirSync(`${AQUI}/analisis`, { recursive: true });
  mkdirSync(`${AQUI}/visual`, { recursive: true });

  let analizar: ((ruta: string, k: number) => Promise<Blueprint | null>) | null = null;
  let llamadas = 0;
  const maxLlamadas = Number(arg("--max-llamadas", "40"));
  let hexObservables: Record<string, string> = {};
  if (usarAnalisis) {
    delete process.env.DATABASE_URL;
    delete process.env.CATALOG_DATABASE_URL;
    (globalThis as { __ragPool?: unknown }).__ragPool = { query: async () => ({ rows: [], rowCount: 0 }), on: () => undefined, end: async () => undefined };
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (/generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com/.test(url) && (init?.method ?? "GET") === "POST") {
        if (llamadas >= maxLlamadas) throw new Error("JUEZ_TOPE: llamada bloqueada por el tope declarado");
        llamadas += 1;
      }
      return fetchOriginal(input, init);
    }) as typeof fetch;
    await imp("src/lib/ia/nucleo/telemetria-llamadas.ts");
    const core = await import(pathToFileURL(resolve(REPO, "packages/agente-core/src/index.ts")).href) as { configurarPersistenciaTelemetria: (x: undefined) => void };
    core.configurarPersistenciaTelemetria(undefined);
    hexObservables = ((await imp("src/lib/rag/taxonomy/v2.ts")) as { HEX_COLORES_OBSERVABLES: Record<string, string> }).HEX_COLORES_OBSERVABLES;
    const { POST } = await imp("src/app/api/references/analyze/route.ts") as { POST: (r: Request) => Promise<Response> };
    analizar = async (ruta, k) => {
      const crudo = readFileSync(ruta);
      const sha = createHash("sha256").update(crudo).digest("hex");
      // La lectura 0 conserva la clave de la v1 (su caché sigue valiendo); las demás añaden el índice.
      const cache = `${AQUI}/analisis/${sha}${k ? `-${k}` : ""}.json`;
      if (existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8")) as Blueprint;
      // Como la interfaz: PNG con el lado mayor a 1600 px.
      const png = await aPng(crudo);
      const res = await POST(new Request("http://localhost/api/references/analyze", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ images: [{ base64: png.toString("base64"), mime: "image/png" }], sinCache: true }),
      }));
      const cuerpo = await res.json() as { blueprint?: Blueprint };
      if (!res.ok || !cuerpo.blueprint) { console.log(`[sin análisis] ${ruta} status=${res.status}`); return null; }
      writeFileSync(cache, JSON.stringify(cuerpo.blueprint, null, 1));
      return cuerpo.blueprint;
    };
  }

  const manifiesto = JSON.parse(readFileSync(resolve(arg("--manifiesto", `${CODIGO}/manifiestos/manifiesto.json`)), "utf8")) as Entrada[];
  const resultados: Array<Record<string, unknown>> = [];
  for (const e of manifiesto) {
    const ref = resolve(AQUI, e.ref), img = resolve(AQUI, e.img);
    if (!existsSync(ref) || !existsSync(img)) { console.log(`[sin imagen] ${e.id} ${e.grupo}`); continue; }
    const fila: Record<string, unknown> = { ...e };
    let linea = `${e.id.padEnd(6)} ${e.grupo.padEnd(8)}`;
    if (analizar) {
      const gen = await analizar(img, 0);
      const refs: Blueprint[] = [];
      for (let k = 0; k < nRef; k += 1) { const b = await analizar(ref, k); if (b) refs.push(b); }
      if (gen && refs.length) {
        const G = piezas(gen, hexObservables);
        const m = /^case-(\d{3})-ref\.png$/.exec(basename(ref));
        const verdad = ref.replace(/\\/g, "/").includes("/linea-base/") && m ? piezasDeVerdad(`CASE-${m[1]}`) : null;
        const evals = refs.map((b) => { const deFoto = piezas(b, hexObservables); return evaluar(verdad ?? deFoto, G, deFoto); });
        const a = promediar(evals);
        Object.assign(fila, { analisis: { ...a, ref_estable: verdad ? "verdad" : `n=${refs.length}`, notas_por_lectura: evals.map((x) => Math.round(x.nota)) } });
        linea += ` A ${String(a.nota).padStart(3)} [${evals.map((x) => Math.round(x.nota)).join(",")}] tipo ${a.tipo} lado ${a.lado} color ${a.color} forma ${a.forma} esc ${a.escala} topo ${a.topologia} f${a.faltan}/s${a.sobran}`;
      }
    }
    if (usarVisual || usarGemini) {
      const vs: Visual[] = [];
      for (let k = 0; k < nVisual; k += 1) { const v = usarVisual ? juezVisual(ref, img, k) : await juezVisualGemini(ref, img, k, aPng, contarVisual); if (v) vs.push(v); }
      if (vs.length) { const v = promedioVisual(vs); fila.visual = v; linea += ` | V ${v.nota} (${v.nota_min}-${v.nota_max}) comp ${v.composicion} geo ${v.geometria} col ${v.colores} orden ${v.orden_color} esc ${v.escala} dens ${v.densidad} ori ${v.orientacion} topo ${v.topologia}`; }
    }
    resultados.push(fila);
    console.log(linea);
  }
  writeFileSync(resolve(arg("--salida", `${AQUI}/resultados.json`)), JSON.stringify(resultados, null, 1));
  console.log(`[fin] llamadas de visión Gemini: ${llamadas}/${maxLlamadas}${usarVisual ? ` · juez visual ${MODELO_VISUAL}/${ESFUERZO_VISUAL}` : ""}${usarGemini ? ` · juez visual Gemini ${llamadasVisual}/${maxVisual}` : ""}`);
}

void main();
