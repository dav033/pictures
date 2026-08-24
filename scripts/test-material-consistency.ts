import assert from "node:assert/strict";
import { cotizarProductos } from "../src/lib/cotizacion/motor";
import { buildImagePrompt } from "../src/lib/ia/build-image-prompt";
import { evaluateSceneQa } from "../src/lib/ia/image-qa";
import { estimateFromMeasuredMaterials, designQuantityForProduct, purchaseForProduct } from "../src/lib/materiales/estimacion";
import type { Producto } from "../src/lib/types";
import type { SceneSpec } from "../src/lib/ia/scene-spec";

const products: Producto[] = [
  {
    id: "fashion-pink-r12",
    nombre: "Fashion rosado R-12",
    categoria: "Globo látex",
    estilos: [],
    colores: ["fashion rosado"],
    descripcion: "Globo redondo Fashion rosado.",
    precio: 17_100,
    unidadesPaquete: 50,
    paquetes: 1,
    tamanoCodigo: "R-12",
    forma: "redondo",
    diamPulg: 12,
  },
  {
    id: "rose-gold-r12",
    nombre: "Metal dorado rosa R-12",
    categoria: "Globo látex metalizado",
    estilos: [],
    colores: ["metal dorado rosa"],
    descripcion: "Globo redondo metalizado dorado rosa.",
    precio: 17_100,
    unidadesPaquete: 50,
    paquetes: 1,
    tamanoCodigo: "R-12",
    forma: "redondo",
    diamPulg: 12,
  },
  {
    id: "foil-heart",
    nombre: "Corazón foil",
    categoria: "Globo metalizado",
    estilos: [],
    colores: ["dorado rosa"],
    descripcion: "Corazón foil decorativo.",
    precio: 5_000,
    unidadesPaquete: 1,
    paquetes: 1,
    forma: "corazon",
  },
];

const estimate = estimateFromMeasuredMaterials({
  figura: "arco",
  anchoM: 4.5,
  altoM: 2.6,
  ejeM: 4.5,
  despiece: [
    { tamano: "R-12", pulgadas: 12, cantidad: 13, color: "fashion rosado" },
    { tamano: "R-12", pulgadas: 12, cantidad: 29, color: "metal dorado rosa" },
  ],
  totalGlobos: 42,
  supuestos: ["densidad lujosa (λ=4.5)"],
  confianza: "preliminar",
  aviso: "fixture",
}, products);

assert.equal(estimate.balloons.reduce((sum, line) => sum + line.design_quantity, 0), 42);
assert.equal(estimate.special_elements.reduce((sum, line) => sum + line.design_quantity, 0), 1);
assert.equal(designQuantityForProduct(estimate, "fashion-pink-r12"), 13);
assert.equal(designQuantityForProduct(estimate, "rose-gold-r12"), 29);
assert.equal(purchaseForProduct(estimate, "fashion-pink-r12")?.purchase_quantity, 50);
assert.equal(estimate.totals.purchase_quantity, 101);
assert.equal(estimate.totals.target_waste_reserve, 4);
assert.equal(estimate.totals.covered_waste_reserve, 4);
assert.equal(estimate.totals.uncovered_waste_reserve, 0);
assert.equal(estimate.totals.required_quantity, 47);
assert.equal(purchaseForProduct(estimate, "fashion-pink-r12")?.required_quantity, 17);
assert.equal(purchaseForProduct(estimate, "fashion-pink-r12")?.leftover_inventory, 33);
assert.equal(purchaseForProduct(estimate, "fashion-pink-r12")?.purchase_cost, 17_100);
assert.ok(estimate.warnings.some((warning) => /appears too low/i.test(warning)));

const zeroDimensionEstimate = estimateFromMeasuredMaterials({
  figura: "pared",
  anchoM: 0,
  altoM: 0,
  largoM: 0,
  ejeM: 0,
  despiece: [{ tamano: "R-12", pulgadas: 12, cantidad: 1, color: "fashion rosado" }],
  totalGlobos: 1,
  supuestos: [],
  confianza: "preliminar",
  aviso: "fixture with missing dimensions",
}, products);
assert.equal(zeroDimensionEstimate.design.installation_length_m, null);
assert.deepEqual(zeroDimensionEstimate.design.dimensions_m, { width: null, height: null, length: null });

const quote = cotizarProductos(products, estimate);
assert.deepEqual(quote.lineas.map((line) => line.cantidadNecesaria), [13, 29, 1]);
assert.deepEqual(quote.lineas.map((line) => line.sobrante), [37, 21, 0]);
assert.equal(quote.mermaPorcentaje, 8);

const scene = {
  schema_version: "1.0",
  generation_mode: "text_to_image",
  canvas: { aspect_ratio: "3:2", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
  venue: { preserve: [], protected_regions: [], editable_regions: [] },
  material_estimate: estimate,
  elements: [{
    element_id: "EST_01_ARCO",
    name: "Arco orgánico rosado y dorado rosa",
    category: "balloon_structure",
    source_type: "catalog_backed",
    catalog_product_id: "fashion-pink-r12",
    required: true,
    quantity: { mode: "exact", min: 43, max: 43 },
    target_bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.7 },
    depth_layer: 10,
    resolved_colors: ["fashion rosado", "metal dorado rosa"],
    identity_constraints: ["Use the approved installed material estimate."],
    relationships: [],
  }],
  positive_prompt: { required_elements: ["one organic arch"], composition: ["one focal installation"], venue_preservation: [], photorealistic_integration: [] },
  negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
  metadata: { created_by: "server_default" },
} as unknown as SceneSpec;
const prompt = buildImagePrompt({ sceneSpec: scene });
assert.match(prompt, /approximately 42 installed balloons/i);
assert.match(prompt, /Purchase capacity \(101\) includes waste/i);
assert.match(prompt, /Neither surplus nor unused package units may appear/i);
assert.doesNotMatch(prompt, /use those 50 units/i);

const qa = evaluateSceneQa(scene, { materialScaleConsistent: false, materialScaleReason: "render is clearly several times denser" }, estimate);
assert.equal(qa.pass, false);
assert.ok(qa.retry_reasons.some((reason) => /material scale mismatch/i.test(reason)));

console.log("[PASS] material consistency regression — installed 42 + 1 special, purchased capacity 101, visual prompt excludes package surplus");
