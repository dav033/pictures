/**
 * Colores reales de Sempertex en los prompts de imagen (2026-10-04):
 * - `referenciaDelCatalogo` entiende la palabra del catálogo («reflex») y la del analizador («cromado»).
 * - Gemini recibe UN bloque con código, Pantone y color del globo inflado para todas las piezas con globos.
 * - El caption de FLUX base nombra el color con la referencia de la lámina, sin ninguna cifra.
 */
import assert from "node:assert/strict";
import type { SceneSpec } from "../../src/lib/ia/escena/scene-spec";
import { bloqueColoresExactos } from "../../src/lib/ia/uzume/build-image-prompt";
import { compileProductPrompt } from "../../src/lib/ia/kagutsuchi/lora-product-runtime";
import { buildVisualContext } from "../../src/lib/ia/escena/visual-context";
import { referenciaDelCatalogo, referenciaDelTitulo } from "../../src/lib/plan/referencia-sempertex";
import { colorDeReferencia } from "../../src/lib/lora/vocabulario-base";

// 1. La referencia que se compra.
assert.equal(referenciaDelCatalogo("dorado", "reflex")?.codigo, "970", "la palabra del catálogo elige Reflex");
assert.equal(referenciaDelCatalogo("dorado", "cromado")?.codigo, "970", "la del analizador también");
assert.equal(referenciaDelCatalogo("dorado", "metalizado")?.codigo, "570");
assert.equal(referenciaDelCatalogo("champagne", "mate"), null, "un color que la lámina no nombra no se inventa");
assert.equal(referenciaDelCatalogo("blanco", "mate")?.pms, null, "los neutros no tienen Pantone");
console.log("[PASS] referenciaDelCatalogo: Reflex, Metal, neutros y colores que no están en la lámina");

// 2. El bloque de Gemini.
const linea = (color: string, finish: string, indice: number) => ({ structure_id: "E1", product_id: `p${indice}`, variant_id: `v${indice}`, color, finish, size_inches: 12, shape: "redondo", design_quantity: 10, waste_reserve: 0, required_quantity: 10, waste_adjusted_quantity: 10 });
const bloque = bloqueColoresExactos({ material_estimate: { balloons: [linea("dorado", "reflex", 0), linea("blanco", "fashion", 1), linea("dorado", "reflex", 2), linea("champagne", "mate", 3), linea("dorado", "metalizado", 4)] } } as never);
const filas = bloque.split("\n").slice(1);
assert.equal(filas.length, 3, bloque);
assert.match(filas[0]!, /^- dorado, high-shine chrome: Sempertex 970 .*PANTONE 10444, inflated balloon color #a08344\.$/);
assert.ok(!filas[0]!.includes(referenciaDelCatalogo("dorado", "reflex")!.hexTinta), "el hex es el del globo inflado, no la tinta");
assert.doesNotMatch(filas[1]!, /PANTONE/, "el blanco no lleva Pantone");
assert.match(filas[2]!, /Sempertex 570/, "el mismo color con otro acabado es otra referencia");
assert.match(bloque, /never write any of these codes in the image/);
assert.equal(bloqueColoresExactos({ material_estimate: { balloons: [linea("champagne", "mate", 0)] } } as never), "", "sin referencias no hay bloque");
console.log("[PASS] bloque de colores exactos: una vez por color, en orden, con Pantone y el globo inflado");

// 2b. UI-2d (CASE-005/007 de images-judge): el tono lo dice el producto comprado, no el color grueso.
const azulRey = referenciaDelCatalogo("azul rey", "fashion");
assert.ok(azulRey && azulRey.codigo !== referenciaDelCatalogo("azul", "fashion")!.codigo, "«azul» a secas es otra referencia (la 040)");
assert.equal(referenciaDelTitulo("B2b Globo Latex Redondo Fashion Azul Rey", "fashion")?.codigo, azulRey!.codigo);
assert.equal(referenciaDelTitulo("Globo Latex Redondo Fashion Azul", "fashion")?.codigo, referenciaDelCatalogo("azul", "fashion")!.codigo, "sin tono, la del color");
assert.equal(referenciaDelTitulo("Globo Duo Azul Rey Rosado", "fashion"), null, "dos tonos: ninguno");
assert.equal(referenciaDelTitulo(undefined, "fashion"), null);
const conTitulos = bloqueColoresExactos(
  { material_estimate: { balloons: [linea("azul", "fashion", 0), linea("azul", "fashion", 1)] } } as never,
  new Map([["p0", "B2b Globo Latex Redondo Fashion Azul Rey"], ["p1", "B2b Globo Latex Redondo Fashion Azul"]]),
);
assert.equal(conTitulos.split("\n").length, 3, `dos tonos de azul, dos líneas: ${conTitulos}`);
assert.match(conTitulos, new RegExp(`Sempertex ${azulRey!.codigo} `), conTitulos);
assert.equal(bloqueColoresExactos({ material_estimate: { balloons: [linea("azul", "fashion", 0)] } } as never), bloqueColoresExactos({ material_estimate: { balloons: [linea("azul", "fashion", 0)] } } as never, new Map()), "sin títulos, el bloque de siempre");
console.log("[PASS] colores exactos: el tono del producto comprado manda sobre el color grueso");

// 3. El caption base: el color de la lámina, matizado por el globo medido, y ninguna cifra.
assert.equal(colorDeReferencia(referenciaDelCatalogo("dorado", "reflex")!), "gold", "sin «chrome»: el acabado se escribe aparte");
assert.equal(colorDeReferencia(referenciaDelCatalogo("azul", "pastel dusk")!), "dusty light blue", "sin «pastel», nombre de línea");
const DORADO = "7109611258049";
const escena = {
  schema_version: "1.0", generation_mode: "text_to_image",
  canvas: { aspect_ratio: "3:2", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
  venue: { preserve: [], protected_regions: [], editable_regions: [] },
  elements: [{ element_id: "E1", name: "Arco", category: "balloon_structure", source_type: "catalog_backed", catalog_product_id: DORADO, catalog_product_ids: [DORADO], required: true, quantity: { mode: "exact", min: 1, max: 1 }, target_bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.7 }, depth_layer: 10, resolved_colors: ["verde"], visual_semantics: { structure_type: "arco", placement: "arco_central", design_role: "focal", repetition_group: "E1", density: "media" }, identity_constraints: [], relationships: [] }],
  positive_prompt: { required_elements: [], composition: [], venue_preservation: [], photorealistic_integration: [] },
  negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
  // La línea del estimado dice qué se compra: un verde Fashion, aunque el producto del vocabulario sea dorado.
  material_estimate: { balloons: [{ ...linea("verde", "fashion", 0), product_id: DORADO }] },
  metadata: { created_by: "server_default", plan_hash: "x" },
} as unknown as SceneSpec;
const caption = compileProductPrompt({ sceneSpec: escena, visualContext: buildVisualContext({}), sizeConfirmations: [] }).prompt;
assert.match(caption, /green/, `el caption base conserva el color del plan: ${caption}`);
assert.doesNotMatch(caption, /PANTONE|Sempertex|#[0-9a-f]{6}|\b\d{3,}\b/i, `ninguna cifra en el caption: ${caption}`);
console.log("[PASS] caption base: color legible del plan y sin cifras comerciales");
