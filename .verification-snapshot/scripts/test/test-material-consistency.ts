import assert from "node:assert/strict";
import { buildImagePrompt } from "../../src/lib/ia/uzume/build-image-prompt";
import {
  MaterialEstimateSchema,
  designQuantityForProduct,
  purchaseForProduct,
  validateMaterialEstimate,
} from "../../src/lib/materiales/estimacion";
import { planFijado } from "../lib/planes-fijados";
import type { SceneSpec } from "../../src/lib/ia/escena/scene-spec";

/**
 * Lo que sigue vivo en TypeScript del estimado de materiales: la validación de
 * frontera (`validateMaterialEstimate`) y las dos consultas que la UI y el
 * prompt hacen sobre un estimado ya calculado (`designQuantityForProduct`,
 * `purchaseForProduct`).
 *
 * Lo que este script probaba y ya no tiene sujeto (ADR-0023, pasos 5 y 6):
 *
 * - `physicalWarningsForPlan`: la puerta física por estructura (banda de
 *   globos/metro por eje y densidad, su escalado con la mezcla efectiva, el
 *   caso "pared + guirnalda" y el arco "solo R-24"). Portada a Python en el
 *   paso 4 y cubierta por `services/ai-api/tests/test_physical_gate.py`. Next
 *   conserva la política de bloqueo, no la medición: las advertencias llegan en
 *   `advertencias` con el prefijo `puerta_fisica:`.
 * - `estimateFromPlan` y `wasteOnlySavingsCop`: el cálculo del estimado y la
 *   atribución del ahorro a la merma. Son reglas de conteo, y Python es su
 *   único dueño desde el paso 5.
 * - El recálculo de fórmulas comerciales dentro de `validateMaterialEstimate`
 *   (paso 6). Lo que queda de esa puerta —esquema, no-negativos y capacidad ≥
 *   demanda por línea— se comprueba abajo sobre un estimado congelado.
 *
 * El estimado de entrada es el del plan congelado "pared + guirnalda"
 * (`scripts/lib/planes-fijados.ts`), el mismo escenario que motivó la puerta
 * física, para que las consultas se hagan sobre dos estructuras que suman su
 * demanda en un solo producto.
 * Run: npx tsx --conditions=react-server scripts/test/test-material-consistency.ts
 */

function main(): void {
  const { materialEstimate: estimate } = planFijado("material-pared-guirnalda");

  // --- Frontera: un estimado válido pasa la puerta ---------------------------
  assert.equal(validateMaterialEstimate(estimate).ok, true);

  // --- Las dos consultas que hacen la UI y el prompt -------------------------
  // La demanda de las dos estructuras se suma por producto, se busque por
  // producto o por variante.
  const demanda = estimate.balloons.reduce((sum, item) => sum + item.design_quantity, 0);
  assert.equal(designQuantityForProduct(estimate, "P-GLOBOS"), demanda);
  assert.equal(designQuantityForProduct(estimate, "V-BLANCO-12"), demanda);
  assert.equal(designQuantityForProduct(estimate, "P-INEXISTENTE"), 0);
  const compra = purchaseForProduct(estimate, "P-GLOBOS");
  assert.ok(compra, "la compra del único producto del plan se encuentra por product_id");
  assert.equal(purchaseForProduct(estimate, "V-BLANCO-12")?.variant_id, compra.variant_id);
  assert.equal(purchaseForProduct(estimate, "P-INEXISTENTE"), undefined);
  // Capacidad ≥ demanda con merma: es la invariante que la puerta comprueba.
  assert.ok(compra.purchase_quantity >= compra.required_quantity, `${compra.purchase_quantity} < ${compra.required_quantity}`);
  // Lo que sobra tras cubrir diseño + la reserva de merma realmente cubierta.
  assert.equal(compra.leftover_inventory, compra.purchase_quantity - compra.required_quantity);

  // --- Frontera: un estimado incoherente no pasa -----------------------------
  // Una compra que no cubre su propia demanda de diseño no es una compra real.
  const sinCapacidad = {
    ...estimate,
    purchases: estimate.purchases.map((item) => ({ ...item, purchase_quantity: item.design_quantity - 1 })),
  };
  const fallo = validateMaterialEstimate(sinCapacidad);
  assert.equal(fallo.ok, false, "capacidad por debajo de la demanda tiene que fallar");

  // Un negativo tampoco pasa la frontera, pero quien lo rechaza es el esquema:
  // desde el paso 6 `validateMaterialEstimate` solo comprueba el invariante que
  // el esquema no puede expresar (capacidad ≥ demanda), no los tipos.
  const negativo = {
    ...estimate,
    balloons: estimate.balloons.map((item, indice) => indice === 0 ? { ...item, design_quantity: -1 } : item),
  };
  assert.equal(MaterialEstimateSchema.safeParse(negativo).success, false, "una cantidad negativa tiene que fallar");

  // --- El estimado resuelto por el backend alimenta el prompt ----------------
  // Desde el paso 1 del ADR-0023 toda imagen sale de una propuesta aprobada, así
  // que estas comprobaciones parten del estimado del plan, no de una estimación
  // armada en TypeScript a partir de piezas sueltas.
  const scene = {
    schema_version: "1.0",
    generation_mode: "text_to_image",
    canvas: { aspect_ratio: "3:2", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
    venue: { preserve: [], protected_regions: [], editable_regions: [] },
    material_estimate: estimate,
    elements: [{
      element_id: "EST_02_PARED",
      name: "Pared de globos blanca",
      category: "balloon_structure",
      source_type: "catalog_backed",
      catalog_product_id: "P-GLOBOS",
      required: true,
      quantity: { mode: "exact", min: 1, max: 1 },
      target_bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.7 },
      depth_layer: 10,
      resolved_colors: ["blanco"],
      identity_constraints: ["Use the approved installed material estimate."],
      relationships: [],
    }],
    positive_prompt: { required_elements: ["one balloon wall"], composition: ["one focal installation"], venue_preservation: [], photorealistic_integration: [] },
    negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
    metadata: { created_by: "server_default" },
  } as unknown as SceneSpec;
  const prompt = buildImagePrompt({ sceneSpec: scene });
  assert.match(prompt, new RegExp(`approximately ${demanda} installed balloons`, "i"));
  assert.match(prompt, new RegExp(`Purchase capacity \\(${estimate.totals.purchase_quantity}\\) includes waste`, "i"));
  assert.match(prompt, /Neither surplus nor unused package units may appear/);
  assert.doesNotMatch(prompt, /use those 50 units/i);

  console.log("[PASS] material consistency — validación de frontera del estimado y consultas por producto; el estimado del plan aprobado alimenta el prompt");
}

try {
  main();
} catch (error: unknown) {
  console.error("[FAIL] material consistency", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
