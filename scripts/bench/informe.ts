import fs from "node:fs";
import path from "node:path";
import type { CasoBenchmark, Corrida, FaseBenchmark } from "./tipos";

/**
 * Genera el informe HTML del benchmark a partir de todas las corridas que
 * existan en `reports/bench/<fase>/resultado.json`.
 *
 * El informe está pensado para crecer: con una sola corrida muestra la línea
 * base, y con varias muestra la evolución fase a fase sobre los MISMOS casos,
 * que es lo único que hace comparables los números.
 */

const ORDEN_FASES: FaseBenchmark[] = ["fase-0-linea-base", "fase-1", "fase-2", "fase-3", "fase-4", "fase-4b", "fase-5"];
const ETIQUETA_FASE: Record<FaseBenchmark, string> = {
  "fase-0-linea-base": "Baseline",
  "fase-1": "Phase 1",
  "fase-2": "Phase 2",
  "fase-3": "Phase 3",
  "fase-4": "Phase 4",
  "fase-4b": "Phase 4b (isolation)",
  "fase-5": "Phase 5",
};

function escapar(texto: string): string {
  return texto.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

export function cargarCorridas(raiz: string): Corrida[] {
  if (!fs.existsSync(raiz)) return [];
  const corridas: Corrida[] = [];
  for (const entrada of fs.readdirSync(raiz, { withFileTypes: true })) {
    if (!entrada.isDirectory()) continue;
    const archivo = path.join(raiz, entrada.name, "resultado.json");
    if (!fs.existsSync(archivo)) continue;
    corridas.push(JSON.parse(fs.readFileSync(archivo, "utf8")) as Corrida);
  }
  return corridas.sort((a, b) => ORDEN_FASES.indexOf(a.meta.fase) - ORDEN_FASES.indexOf(b.meta.fase));
}

/** Cuenta agregada por corrida: lo que se compara de un vistazo entre fases. */
function resumen(corrida: Corrida): { generan: number; preflight: number; tallas: number; perdidos: number; sinConcepto: number; qa: number; total: number } {
  const total = corrida.casos.length;
  return {
    total,
    generan: corrida.casos.filter((c) => c.imagen.final !== null).length,
    preflight: corrida.casos.filter((c) => c.preflight?.ok === true).length,
    tallas: corrida.casos.reduce((n, c) => n + (c.caption?.tallasOmitidas.length ?? 0), 0),
    perdidos: corrida.casos.reduce((n, c) => n + c.color.perdidos.length, 0),
    sinConcepto: corrida.casos.reduce((n, c) => n + (c.color.sinConcepto?.length ?? 0), 0),
    qa: corrida.casos.filter((c) => c.qa?.pass === true).length,
  };
}

function chips(valores: string[], clase = ""): string {
  if (!valores.length) return `<span class="vacio">—</span>`;
  return valores.map((v) => `<span class="chip ${clase}">${escapar(v)}</span>`).join("");
}

/** El informe muestra las miniaturas JPEG, no los PNG de la corrida. */
function miniatura(ruta: string): string {
  return path.basename(ruta).replace(/\.png$/i, ".jpg");
}

function bloqueCaso(caso: CasoBenchmark): string {
  const pre = caso.preflight;
  const estado = caso.imagen.final
    ? `<span class="estado ok">generó</span>`
    : `<span class="estado fallo">${escapar(caso.imagen.fallo ?? "sin imagen")}</span>`;
  return `
  <article class="caso">
    <header>
      <div class="caso-id">
        <span class="ref">${escapar(caso.referencia)}</span>
        <h3>${escapar(caso.titulo)}</h3>
        <span class="fixture">plan: <code>${escapar(caso.fixturePlan)}</code> · seed ${caso.semillaImagen}</span>
      </div>
      ${estado}
    </header>

    <div class="tira">
      <figure><img src="img/ref-${escapar(caso.referencia)}.jpg" alt="Reference photo ${escapar(caso.referencia)}"><figcaption>Reference</figcaption></figure>
      <figure><img src="img/espacio.jpg" alt="Space photo"><figcaption>Space</figcaption></figure>
      <figure>${caso.imagen.etapa1 ? `<img src="img/${escapar(miniatura(caso.imagen.etapa1))}" alt="LoRA stage 1">` : `<div class="hueco">—</div>`}<figcaption>Stage 1 · LoRA</figcaption></figure>
      <figure>${caso.imagen.final ? `<img src="img/${escapar(miniatura(caso.imagen.final))}" alt="Final composite">` : `<div class="hueco">—</div>`}<figcaption>Final · composited</figcaption></figure>
    </div>

    <dl class="pistas">
      <div><dt>Palette of the photo</dt><dd>${chips(caso.color.paletaCatalogo)}</dd></div>
      <div><dt>Measured share (pixels)</dt><dd>${caso.color.participaciones?.length ? caso.color.participaciones.map((p) => `<span class="chip">${escapar(p.color)} ${(p.share * 100).toFixed(0)}%</span>`).join("") : `<span class="vacio">not measured</span>`}</dd></div>
      <div><dt>No product concept exists</dt><dd>${chips(caso.color.sinConcepto ?? [], "malo")}</dd></div>
      <div><dt>Dropped by the search truncation</dt><dd>${chips(caso.color.perdidos, "malo")}</dd></div>
      <div><dt>Sizes dropped from the caption</dt><dd>${chips(caso.caption?.tallasOmitidas ?? [], "malo")}</dd></div>
      <div><dt>Preflight</dt><dd>${pre ? (pre.ok ? `<span class="chip bueno">ok</span>` : chips(pre.errores, "malo")) : `<span class="vacio">—</span>`}</dd></div>
      <div><dt>Visual QA</dt><dd>${caso.qa ? (caso.qa.pass ? `<span class="chip bueno">pass</span>` : chips(caso.qa.retryReasons.length ? caso.qa.retryReasons : ["fail"], "malo")) : `<span class="vacio">not run</span>`}</dd></div>
      <div><dt>Venue-aware placement</dt><dd>${caso.colocacion ? (caso.colocacion.fallo ? `<span class="chip malo">${escapar(caso.colocacion.fallo)}</span>` : `<span class="chip ${caso.colocacion.usada ? "bueno" : ""}">${caso.colocacion.usada ? "placed" : "fell back"}</span><span class="chip">${caso.colocacion.aperturas} openings</span><span class="chip">${caso.colocacion.paredesPlanas} walls</span><span class="chip">${caso.colocacion.obstaculos} obstacles</span><span class="chip">${caso.colocacion.anclasMetricas} anchors</span>`) : `<span class="vacio">not run</span>`}</dd></div>
    </dl>

    ${caso.caption ? `<details><summary>Caption sent to fal · ${caso.caption.longitud} of ${caso.caption.techo} chars</summary><pre>${escapar(caso.caption.texto)}</pre></details>` : ""}
    ${caso.juez ? `<div class="juez"><span>photorealism <b>${caso.juez.fotorrealismo}</b></span><span>colour fidelity <b>${caso.juez.fidelidadColor}</b></span><span>space fidelity <b>${caso.juez.fidelidadEspacio}</b></span><span>usable <b>${caso.juez.usable}</b></span><p>${escapar(caso.juez.peorDefecto)}</p></div>` : ""}
  </article>`;
}

/**
 * Las corridas anteriores a la fase 4 no guardaron sus banderas, así que una
 * diferencia entre ellas no se puede atribuir al código con certeza. Se dice,
 * en vez de dejar la celda vacía y aparentar que estaban apagadas.
 */
function etiquetaBanderas(corrida: Corrida): string {
  const banderas = corrida.meta.banderas;
  if (!banderas) return "not recorded";
  const activas = Object.entries(banderas)
    .filter(([, activa]) => activa)
    .map(([nombre]) => nombre.replace(/_V1$/, "").toLowerCase());
  return activas.length === 0 ? "all off" : activas.join(" · ");
}

function filaEvolucion(corrida: Corrida): string {
  const r = resumen(corrida);
  const celda = (n: number, total: number, invertido = false): string => {
    const bien = invertido ? n === 0 : n === total;
    return `<td class="num ${bien ? "bueno" : "malo"}">${n}${invertido ? "" : `/${total}`}</td>`;
  };
  return `<tr>
    <td class="fase">${ETIQUETA_FASE[corrida.meta.fase]}</td>
    <td class="mono">${escapar(corrida.meta.commit.slice(0, 7))}</td>
    <td class="mono flags">${escapar(etiquetaBanderas(corrida))}</td>
    ${celda(r.generan, r.total)}
    ${celda(r.preflight, r.total)}
    ${celda(r.tallas, r.total, true)}
    ${celda(r.sinConcepto, r.total, true)}
    ${celda(r.perdidos, r.total, true)}
    ${celda(r.qa, r.total)}
    <td class="num">${corrida.meta.gastoUsd === null ? "—" : `US$${corrida.meta.gastoUsd.toFixed(3)}`}</td>
  </tr>`;
}

export function generarInforme(corridas: Corrida[]): string {
  if (!corridas.length) throw new Error("No hay corridas que informar.");
  const ultima = corridas[corridas.length - 1]!;
  const m = ultima.meta;

  return `<title>Decoration Preview Benchmark</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;1,6..72,400&family=Source+Sans+3:wght@300;400;600&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
:root{
  --ground:#F7F7F9;--surface:#FFF;--sunk:#EFEFF3;--rule:#DCDBE3;--rule-soft:#E9E8EE;
  --ink:#17161C;--ink-soft:#4B4954;--ink-faint:#75727F;
  --burdeos:#8C2F3F;--slate:#4A6572;--verde:#2F6D5A;--dorado:#9A7118;
  --display:"Newsreader",Georgia,serif;--body:"Source Sans 3",system-ui,sans-serif;--mono:"JetBrains Mono",ui-monospace,Consolas,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --ground:#131218;--surface:#1B1A22;--sunk:#232230;--rule:#34323F;--rule-soft:#2A2936;
  --ink:#ECEAF1;--ink-soft:#B6B2C1;--ink-faint:#8B8797;
  --burdeos:#D8798B;--slate:#9BB2BE;--verde:#6FBFA4;--dorado:#D5AC55;}}
:root[data-theme="dark"]{
  --ground:#131218;--surface:#1B1A22;--sunk:#232230;--rule:#34323F;--rule-soft:#2A2936;
  --ink:#ECEAF1;--ink-soft:#B6B2C1;--ink-faint:#8B8797;
  --burdeos:#D8798B;--slate:#9BB2BE;--verde:#6FBFA4;--dorado:#D5AC55;}
body{background:var(--ground);color:var(--ink);font-family:var(--body);font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}
.page{max-width:1080px;margin:0 auto;padding:clamp(1.5rem,1rem+3vw,3rem) clamp(1rem,.6rem+2vw,2rem) 4rem;display:flex;flex-direction:column;gap:2.75rem}
h1,h2,h3{font-family:var(--display);font-weight:600;line-height:1.18;text-wrap:balance;margin:0}
h1{font-size:clamp(2rem,1.4rem+2.6vw,3rem);letter-spacing:-.015em}
h2{font-size:clamp(1.35rem,1.15rem+.9vw,1.85rem)}
p{margin:0;max-width:68ch}
code,.mono{font-family:var(--mono);font-size:.86em}
.eyebrow{font-family:var(--mono);font-size:.68rem;font-weight:600;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-faint)}
.meta{display:flex;flex-wrap:wrap;gap:.35rem 1.4rem;font-family:var(--mono);font-size:.72rem;color:var(--ink-faint);border-block:1px solid var(--rule);padding:.65rem 0}
.meta b{color:var(--ink-soft);font-weight:600}
section{display:flex;flex-direction:column;gap:1.25rem}
.head{display:flex;flex-direction:column;gap:.4rem}
.head p{color:var(--ink-soft)}
.alcance{font-size:.86rem;border-left:2px solid var(--dorado);padding-left:.85rem;color:var(--ink-faint)}
.alcance b{color:var(--ink-soft)}
table{border-collapse:collapse;width:100%;font-size:.9rem}
.tabla-wrap{overflow-x:auto}
th,td{text-align:left;padding:.5rem .85rem .5rem 0;border-bottom:1px solid var(--rule-soft)}
th{font-size:.72rem;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-faint);font-weight:600}
td.num,.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
td.fase{font-family:var(--display);font-weight:600}
td.flags{font-size:.74em;line-height:1.35;max-width:15rem;white-space:normal;opacity:.85}
td.bueno{color:var(--verde)}td.malo{color:var(--burdeos)}
.caso{border-left:3px solid var(--rule);padding:1.25rem 0 1.5rem 1.1rem;border-top:1px solid var(--rule-soft);display:flex;flex-direction:column;gap:1rem}
.caso header{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap}
.caso-id{display:flex;flex-direction:column;gap:.15rem}
.caso .ref{font-family:var(--mono);font-size:.7rem;color:var(--ink-faint);letter-spacing:.08em;text-transform:uppercase}
.caso h3{font-size:1.15rem}
.fixture{font-family:var(--mono);font-size:.72rem;color:var(--ink-faint)}
.estado{font-family:var(--mono);font-size:.66rem;font-weight:600;letter-spacing:.09em;text-transform:uppercase;padding:.16rem .45rem;border:1px solid currentColor;white-space:nowrap}
.estado.ok{color:var(--verde)}.estado.fallo{color:var(--burdeos)}
.tira{display:grid;grid-template-columns:repeat(2,1fr);gap:.7rem}
@media(min-width:760px){.tira{grid-template-columns:repeat(4,1fr)}}
.tira figure{margin:0;display:flex;flex-direction:column;gap:.35rem}
.tira img{width:100%;height:190px;object-fit:cover;border:1px solid var(--rule);display:block;background:var(--sunk)}
.hueco{width:100%;height:190px;border:1px dashed var(--rule);display:grid;place-items:center;color:var(--ink-faint);font-family:var(--mono)}
.tira figcaption{font-family:var(--mono);font-size:.66rem;letter-spacing:.07em;text-transform:uppercase;color:var(--ink-faint)}
.pistas{display:grid;gap:.55rem;margin:0}
@media(min-width:720px){.pistas{grid-template-columns:1fr 1fr}}
.pistas>div{display:flex;gap:.6rem;align-items:baseline;flex-wrap:wrap}
dt{font-size:.78rem;color:var(--ink-faint);min-width:13rem}
dd{margin:0;display:flex;flex-wrap:wrap;gap:.3rem}
.chip{font-family:var(--mono);font-size:.72rem;padding:.1rem .4rem;border:1px solid var(--rule);color:var(--ink-soft)}
.chip.malo{color:var(--burdeos);border-color:currentColor}
.chip.bueno{color:var(--verde);border-color:currentColor}
.vacio{color:var(--ink-faint)}
details{border-top:1px solid var(--rule-soft);padding-top:.6rem}
summary{cursor:pointer;font-family:var(--mono);font-size:.74rem;color:var(--ink-faint)}
pre{background:var(--sunk);border:1px solid var(--rule-soft);padding:.7rem .85rem;overflow-x:auto;margin:.6rem 0 0;font-family:var(--mono);font-size:.76rem;line-height:1.55;color:var(--ink-soft);white-space:pre-wrap}
.juez{display:flex;flex-wrap:wrap;gap:.3rem 1.2rem;font-size:.82rem;color:var(--ink-soft);border-left:2px solid var(--rule);padding-left:.8rem}
.juez b{font-family:var(--mono);color:var(--ink)}
.juez p{width:100%;font-size:.82rem;color:var(--ink-faint)}
footer{border-top:1px solid var(--rule);padding-top:1rem;font-size:.82rem;color:var(--ink-faint);display:flex;flex-direction:column;gap:.3rem}
:focus-visible{outline:2px solid var(--burdeos);outline-offset:2px}
</style>

<div class="page">
  <header class="head">
    <span class="eyebrow">Reference photo + space photo · measured end to end</span>
    <h1>What the preview pipeline does today</h1>
    <p>Four reference photos and one space photo, run through the current two-stage pipeline. The same four cases are re-run unchanged after every remediation phase, so the columns below can be read against each other.</p>
    <p class="alcance"><b>Scope, stated up front.</b> Production builds the scene from the <em>approved plan</em>, never from the reference photo (<span class="mono">route.ts:810</span>), and a plan requires the Python resolver, a catalog snapshot and an approval token. Reproducing that here would mean writing to the production database during an evaluation run, so the scene is instead a fixed commercial template — one focal arch and two lateral columns — coloured with the palette the analyser measured in each photo. The repository's frozen plan fixtures were tried first and rejected: their product ids are synthetic and the vocabulary cannot resolve them. Consequently quantities and prices are out of scope, and the shape of the scene is the same in every case by design, so that only what a phase fixes moves between runs. Everything else is the real pipeline: the production analyser, the production caption compiler at hybrid settings, the real preflight, the approved v004 LoRA, the real Gemini composite and the real visual QA.</p>
    <div class="meta">
      <span><b>Phase</b> ${ETIQUETA_FASE[m.fase]}</span>
      <span><b>Commit</b> ${escapar(m.commit.slice(0, 7))}</span>
      <span><b>Date</b> ${escapar(m.fecha.slice(0, 10))}</span>
      <span><b>LoRA</b> ${escapar(m.slotLora.artifactId)} (${escapar(m.slotLora.evaluationStatus)})</span>
      <span><b>Selection seed</b> ${m.semillaSeleccion}</span>
      <span><b>Spend</b> ${m.gastoUsd === null ? "—" : `US$${m.gastoUsd.toFixed(3)}`}</span>
    </div>
  </header>

  <section>
    <div class="head"><span class="eyebrow">Across phases</span><h2>Evolution</h2>
      <p>Every column is a count over the same four cases. <em>Sizes dropped</em> and both colour columns are totals, and zero is the target; the rest are out of four.</p>
    </div>
    <div class="tabla-wrap"><table>
      <thead><tr><th>Phase</th><th>Commit</th><th>Flags on</th><th>Produced an image</th><th>Passed preflight</th><th>Sizes dropped</th><th>Colours with no concept</th><th>Colours truncated away</th><th>QA pass</th><th>Spend</th></tr></thead>
      <tbody>${corridas.map(filaEvolucion).join("\n")}</tbody>
    </table></div>
  </section>

  <section>
    <div class="head"><span class="eyebrow">${ETIQUETA_FASE[m.fase]} · case by case</span><h2>The four cases</h2>
      <p>Reference and space are the inputs. Stage 1 is what the LoRA draws from the caption alone — no photo reaches it. Stage 2 is Gemini compositing that render onto the space.</p>
    </div>
    ${ultima.casos.map(bloqueCaso).join("\n")}
  </section>

  <footer>
    <p>Judge scores order cases <em>within a single call</em>; they are not an absolute metric and never compare across runs.</p>
    <p>Full diagnosis and the phased plan: <span class="mono">PLAN-IMAGE-AND-COLOR-FIDELITY.md</span>.</p>
  </footer>
</div>`;
}
