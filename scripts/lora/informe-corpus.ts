/**
 * Informe: ¿el caption que compila el LoRA habla como su corpus de entrenamiento?
 *
 * Compila un barrido de escenas (5 piezas focales × soportes × acentos × 6 paletas × 3 eventos, con productos
 * reales del vocabulario) y cuenta cada n-grama (1 a 3 palabras) del prompt contra las 345 captions de
 * `data/staging/lora-v007/captions`. Lista los que el corpus nunca vio, con el % de prompts que los llevan.
 * Una palabra que el LoRA no vio —o vio describiendo un piso— es pedirle que adivine (memoria «el corpus del
 * LoRA manda»; auditoría 2026-10-04, anexo (a) del PLAN-calidad-imagen.md).
 *
 * Solo informa: no falla ni escribe nada en el repositorio. Sin red y sin proveedores.
 *   npm run lora:informe-corpus [-- --trigger eventdecor_style_v3]
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SceneSpec } from "../../src/lib/ia/escena/scene-spec";
import { compileProductPrompt, type ElementSizeConfirmation } from "../../src/lib/ia/kagutsuchi/lora-product-runtime";
import { buildVisualContext } from "../../src/lib/ia/escena/visual-context";
import { ensureLoraTriggers } from "../../src/lib/ia/kagutsuchi/sempertex-lora";
import { PRODUCT_VOCABULARY } from "../../src/lib/lora/product-vocabulary-data";

const CAPDIR = join(process.cwd(), "data/staging/lora-v007/captions");
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\-' ]+/g, " ").replace(/\s+/g, " ").trim();
const corpus = " " + readdirSync(CAPDIR).filter((f) => f.endsWith(".txt")).map((f) => norm(readFileSync(join(CAPDIR, f), "utf8"))).join(" | ") + " ";
function freq(frase: string): number {
  const p = " " + norm(frase) + " ";
  let c = 0;
  for (let i = corpus.indexOf(p); i !== -1; i = corpus.indexOf(p, i + 1)) c++;
  return c;
}
type Elemento = SceneSpec["elements"][number];
const PRODUCTO_POR_COLOR: Record<string, string> = { dorado: "7109611258049", plateado: "20014244", rosado: "20010671", blanco: "7109565710529", fucsia: "7105908572353", crema: "10467043344577" };
function el(id: string, nombre: string, tipo: string, ub: string, rol: string, colores: string[], grupo?: string): Elemento {
  const productIds = colores.map((c) => PRODUCTO_POR_COLOR[c]!);
  return { element_id: id, name: nombre, category: tipo === "backdrop" ? "backdrop" : "balloon_structure", source_type: "catalog_backed", catalog_product_id: productIds[0], catalog_product_ids: productIds, required: true, quantity: { mode: "exact", min: 1, max: 1 }, target_bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.7 }, depth_layer: 10, resolved_colors: colores, visual_semantics: { structure_type: tipo, placement: ub, design_role: rol, repetition_group: grupo ?? id, density: "media" }, identity_constraints: [], relationships: [] } as unknown as Elemento;
}
function escena(e: Elemento[]): SceneSpec {
  return { schema_version: "1.0", generation_mode: "text_to_image", canvas: { aspect_ratio: "3:2", content_rect: { x: 0, y: 0, width: 1, height: 1 } }, venue: { preserve: [], protected_regions: [], editable_regions: [] }, elements: e, positive_prompt: { required_elements: [], composition: [], venue_preservation: [], photorealistic_integration: [] }, negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] }, metadata: { created_by: "server_default", plan_hash: "x" } } as unknown as SceneSpec;
}
const PALETAS = [["dorado"], ["rosado", "dorado"], ["blanco", "plateado"], ["rosado", "dorado", "plateado"], ["fucsia", "blanco", "dorado"], ["rosado", "crema", "dorado", "plateado"]];
const EVENTOS = [
  { tipo_evento: "XV años", estilo: "glamour", espacio: "salón", pedido: "XV años en un salón, estilo glamour" },
  { tipo_evento: "boda", estilo: "elegante", espacio: "jardín", pedido: "boda en jardín, elegante" },
  { tipo_evento: "cumpleaños", estilo: "divertido", espacio: "casa", pedido: "Cumpleaños infantil en casa" },
];
const sub = (p: string[], d: number, n: number) => Array.from({ length: Math.min(n, p.length) }, (_, i) => p[(d + i) % p.length]!);
const FOC = [(p: string[]) => [el("E1", "Arco orgánico", "arco", "arco_central", "focal", p)], (p: string[]) => [el("E1", "Semiarco", "semiarco", "arco_central", "focal", p)], (p: string[]) => [el("E1", "Pared", "pared", "fondo_pared", "focal", p)], (p: string[]) => [el("E1", "Guirnalda", "guirnalda", "fondo_pared", "focal", p)], (p: string[]) => [el("E1", "Columna", "columna", "arco_central", "focal", p)]];
const SOP = [() => [], (p: string[]) => [el("E2", "Columna izquierda", "columna", "lateral_izquierdo", "soporte", sub(p, 0, 2), "c"), el("E3", "Columna derecha", "columna", "lateral_derecho", "soporte", sub(p, 0, 2), "c")]];
const ACC = [() => [], (p: string[]) => [el("E5", "Centro de mesa", "centro_mesa", "sobre_mesa_principal", "acento", sub(p, 1, 2))], (p: string[]) => [el("E6", "Bouquet", "bouquet" as string, "piso_frontal", "acento", sub(p, 0, 2))]];
const TAM = ["R-5", "R-12", "R-18"];

const pedido = process.argv.indexOf("--trigger");
const TRIGGERS = pedido > 0 ? [process.argv[pedido + 1]!] : ["eventdecor_style_v3", "eventdecor_style_v2"];
for (const trigger of TRIGGERS) {
  const prompts: string[] = [];
  for (const f of FOC) for (const s of SOP) for (const a of ACC) for (const p of PALETAS) for (const ev of EVENTOS) {
    const els = [...f(p), ...s(p), ...a(p)];
    const ctx = buildVisualContext({ brief: { tipo_evento: ev.tipo_evento, estilo: ev.estilo, colores: p, espacio: ev.espacio }, userRequest: `${ev.pedido}, colores ${p.join(", ")}` });
    const sizes: ElementSizeConfirmation[] = els.flatMap((e, i) => (e.catalog_product_ids ?? []).flatMap((pid) => (i === 0 ? TAM : ["R-12"]).map((sizeCode) => ({ elementId: e.element_id, productId: pid, sizeCode }))));
    const r = compileProductPrompt({ sceneSpec: escena(els), visualContext: ctx, vocabulary: PRODUCT_VOCABULARY, sizeConfirmations: sizes, trigger });
    prompts.push(ensureLoraTriggers(r.prompt, [{ path: "informe", trigger, scale: 1 }]));
  }
  console.log(`\n== ${trigger}: ${prompts.length} prompts`);
  console.log(`   ejemplo: ${prompts.at(-1)}`);
  for (const n of [1, 2, 3]) {
    const veces = new Map<string, number>();
    for (const p of prompts) {
      const toks = norm(p).split(" ");
      const vistos = new Set<string>();
      for (let i = 0; i + n <= toks.length; i++) vistos.add(toks.slice(i, i + n).join(" "));
      for (const g of vistos) veces.set(g, (veces.get(g) ?? 0) + 1);
    }
    const nunca = [...veces.entries()].filter(([g]) => !/\d|eventdecor/.test(g) && freq(g) === 0).sort((a, b) => b[1] - a[1]);
    console.log(`   ${n}-gramas con 0 apariciones en el corpus (top 25, % de prompts): ` + nunca.slice(0, 25).map(([g, c]) => `"${g}" ${Math.round((100 * c) / prompts.length)}%`).join(", "));
  }
}
