import assert from "node:assert/strict";
import type { Pool } from "pg";
import { resolverPlan } from "@/lib/plan/resolver";
import { PlanDecoracionSchema } from "@/lib/plan/tipos";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { planBlueprint } from "@/app/api/generate/route";
import { buildApprovedSceneSpec, type SceneSpec } from "@/lib/ia/scene-spec";
import { cajasDeEstructuras, ubicacionDeInstancia } from "@/lib/plan/ubicaciones";
import { estimateFromPlan } from "@/lib/materiales/estimacion";
import { buildCorrectiveRetryPrompt, buildQaObserverPrompt, type SceneQaObservation } from "@/lib/ia/image-qa";
import { buildImagePrompt, FINAL_OUTPUT_REMINDER } from "@/lib/ia/build-image-prompt";
import { approvedPlanQaInputs, buildGenerationQa, type QaObserver } from "@/lib/ia/generation-qa";
import { compileProductPrompt } from "@/lib/ia/lora-product-runtime";
import { preflightLoraPrompt } from "@/lib/ia/lora-prompt-preflight";
import { PRODUCT_VOCABULARY } from "@/lib/lora/product-vocabulary-data";
import type { VisualContext } from "@/lib/ia/visual-context";

/**
 * Iteration 3, step 3 wiring: /api/generate must hand the approved plan to the
 * visual QA (observer instruction and evaluation) and compile the LoRA prompt
 * with the same plan map, or the separate-side-pieces question is never asked
 * in production. Deterministic, no network: the observer is injected.
 * Run: npx tsx --conditions=react-server scripts/test-generate-qa-plan.ts
 */

const rows = [
  { product_id: "P-GLOBOS", variant_id: "V-R-12-ROJO", sku: "SKU-R-12-ROJO", producto_titulo: "Globo rojo", variante_titulo: "R-12", precio: 10000, unidades_paq: 50, disponible: true, producto_disponible: true, codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, colores_producto: ["rojo"], colores_variante: ["rojo"], descripcion: "Globo látex rojo R-12." },
  { product_id: "P-GLOBOS", variant_id: "V-R-12-DORADO", sku: "SKU-R-12-DORADO", producto_titulo: "Globo dorado", variante_titulo: "R-12", precio: 10500, unidades_paq: 50, disponible: true, producto_disponible: true, codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, colores_producto: ["dorado"], colores_variante: ["dorado"], descripcion: "Globo látex dorado metalizado R-12." },
];
// Same mocked pool shape as scripts/test-image-qa-piezas-separadas.ts: the resolver only reads `rows`.
const pool = { query: async () => ({ rows }) } as unknown as Pool;
const whitelist = new Map<string, ReadonlySet<string>>([["P-GLOBOS", new Set(rows.map((row) => row.variant_id))]]);
const materiales = [
  { product_id: "P-GLOBOS", color: "rojo", participacion: 0.6, rol_material: "principal" },
  { product_id: "P-GLOBOS", color: "dorado", participacion: 0.4, rol_material: "secundario" },
];
const IMAGE = { base64: "iVBORw0KGgo=", mime: "image/png" };
const HASHES = { planHash: "plan-hash", sceneSpecHash: "scene-hash" };
const CONTEXT: VisualContext = { venueKind: "indoor", lightingKind: "night", palette: ["rojo", "dorado"] };

const ESTRUCTURAS_BASE = [
  { estructura_id: "EST_01_SEMIARCO", nombre: "Semiarco derecho", tipo: "semiarco", rol_escena: "focal", ubicacion: "lateral_derecho", medidas: { ancho_m: 1.2, alto_m: 2.2 }, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales, porque: "Pieza principal a un lado." },
  { estructura_id: "EST_02_COLUMNA", nombre: "Columna izquierda", tipo: "columna", rol_escena: "soporte", ubicacion: "lateral_izquierdo", medidas: { alto_m: 1.8 }, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales, porque: "Pieza baja al otro lado, separada." },
];

async function approvedScene(estructuras: unknown[] = ESTRUCTURAS_BASE, planId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"): Promise<{ plan: PlanResuelto; scene: SceneSpec }> {
  const declared = PlanDecoracionSchema.parse({
    plan_version: "1.0",
    plan_id: planId,
    concepto: { titulo: "Cumpleaños rojo y dorado", descripcion: "Piezas de globos en el salón.", paleta: ["rojo", "dorado"] },
    espacio: { tipo: "salón", fuente: "supuesto" },
    estructuras,
    supuestos: [],
  });
  const plan = await resolverPlan(pool, declared, whitelist);
  assert.equal(plan.sin_cobertura.length, 0);
  const blueprint = planBlueprint(plan);
  const scene = buildApprovedSceneSpec({
    blueprint,
    aspectRatio: "3:2",
    targetBoxes: Object.fromEntries(Object.entries(cajasDeEstructuras(plan.plan.estructuras)).map(([id, layout]) => [id, layout.bbox])),
    catalogProducts: Object.fromEntries(blueprint.elements.map((element) => [element.element_id, (element.model_decision?.bill_of_materials ?? []).map((line) => ({ id: line.catalog_product_id, name: line.catalog_product_id, description: "", category: "balloon", share: line.share, role: line.role }))])),
    materialEstimate: estimateFromPlan(plan),
    generationMode: "text_to_image",
    createdBy: "server_default",
    planHash: plan.plan_hash,
    catalogOnly: true,
  });
  return { plan, scene };
}

/** Observer double: records the instruction built from exactly what the generation QA handed it. */
function recordingObserver(verdict: SceneQaObservation["sidePiecesSeparation"]): { observe: QaObserver; instructions: string[] } {
  const instructions: string[] = [];
  const observe: QaObserver = async (sceneSpec, _image, estimate, _telemetria, _signal, _force, plan) => {
    instructions.push(buildQaObserverPrompt(sceneSpec, estimate, plan));
    return { presentElementIds: sceneSpec.elements.map((element) => element.element_id), sidePiecesSeparation: verdict };
  };
  return { observe, instructions };
}

async function main(): Promise<void> {
  const { plan, scene } = await approvedScene();
  const qaPlan = approvedPlanQaInputs(plan);
  assert.ok(qaPlan, "an approved plan yields QA plan inputs");

  // 1. With the approved plan, the observer is asked about the separation and "merged" fails.
  const merged = recordingObserver("merged");
  const failed = await buildGenerationQa({ sceneSpec: scene, image: IMAGE, hashes: HASHES, plan: qaPlan, force: true, observe: merged.observe });
  assert.equal(merged.instructions.length, 1);
  assert.match(merged.instructions[0]!, /separate_side_pieces/, "the generation QA asks the observer about separate side pieces");
  assert.match(merged.instructions[0]!, /EST_01_SEMIARCO/);
  assert.match(merged.instructions[0]!, /EST_02_COLUMNA/);
  assert.equal(failed.pass, false, JSON.stringify(failed.retry_reasons));
  assert.ok(failed.retry_reasons.some((reason) => /merged into one arch/.test(reason)), JSON.stringify(failed.retry_reasons));
  assert.equal(failed.composition.separate_side_pieces_ok, false);
  assert.equal(failed.confidence, "vision_assisted");
  assert.equal(failed.plan_hash, HASHES.planHash);
  assert.equal(failed.scene_spec_hash, HASHES.sceneSpecHash);
  console.log("[PASS] generation QA: approved semiarco+columna plan asks about separation and 'merged' -> pass=false");

  const separate = recordingObserver("separate");
  const passed = await buildGenerationQa({ sceneSpec: scene, image: IMAGE, hashes: HASHES, plan: qaPlan, force: true, observe: separate.observe });
  assert.equal(passed.pass, true, JSON.stringify(passed.retry_reasons));
  assert.equal(passed.composition.separate_side_pieces_ok, true);
  console.log("[PASS] generation QA: 'separate' -> pass=true");

  // 2. Without an approved plan there is nothing to pair: no question, no criterion.
  assert.equal(approvedPlanQaInputs(undefined), undefined);
  const noPlan = recordingObserver("merged");
  const unplanned = await buildGenerationQa({ sceneSpec: scene, image: IMAGE, hashes: { sceneSpecHash: "scene-hash" }, plan: approvedPlanQaInputs(undefined), force: true, observe: noPlan.observe });
  assert.doesNotMatch(noPlan.instructions[0]!, /separate_side_pieces/);
  assert.equal(unplanned.pass, true, JSON.stringify(unplanned.retry_reasons));
  console.log("[PASS] generation QA: no approved plan -> separation neither asked nor evaluated");

  // 3. No observation (QA disabled or provider unavailable): unknown, never a fabricated pass.
  const unobserved = await buildGenerationQa({ sceneSpec: scene, image: IMAGE, hashes: HASHES, plan: qaPlan, force: false, observe: async () => null });
  assert.equal(unobserved.pass, null);
  assert.equal(unobserved.confidence, "unknown");
  assert.equal(unobserved.observed_instances, null);
  console.log("[PASS] generation QA: no observation -> pass=null, confidence=unknown");

  // 4. Corrective retry: readable names and placement instead of ids, inserted
  //    before FINAL_OUTPUT_REMINDER instead of concatenated after it.
  const conDetalle = await buildGenerationQa({
    sceneSpec: scene,
    image: IMAGE,
    hashes: HASHES,
    plan: qaPlan,
    force: true,
    observe: async (sceneSpec) => ({
      presentElementIds: sceneSpec.elements.map((element) => element.element_id),
      appearanceFailures: ["EST_01_SEMIARCO"],
      appearanceDetails: [{ element_id: "EST_01_SEMIARCO", aspect: "color_proportion", note: "el dorado ocupa la mitad de la pieza" }],
    }),
  });
  assert.equal(conDetalle.pass, false);
  const correccion = buildCorrectiveRetryPrompt(conDetalle, scene);
  assert.doesNotMatch(correccion, /EST_\d|CATALOG_/, correccion);
  assert.match(correccion, /“Semiarco derecho” in the .+ area of the composition/, correccion);
  assert.match(correccion, /the approved color shares are inverted/, correccion);
  assert.match(correccion, /observed: el dorado ocupa la mitad de la pieza/, correccion);
  const promptReintento = buildImagePrompt({ sceneSpec: scene, correctiveInstruction: correccion });
  assert.ok(promptReintento.endsWith(FINAL_OUTPUT_REMINDER), "el recordatorio final sigue siendo lo último que lee el modelo");
  assert.ok(promptReintento.includes("CORRECTIVE RETRY — HIGHEST PRIORITY"), promptReintento.slice(-800));
  assert.ok(promptReintento.indexOf("CORRECTIVE RETRY") < promptReintento.indexOf(FINAL_OUTPUT_REMINDER));
  assert.equal(buildCorrectiveRetryPrompt(passed, scene), "", "una imagen conforme no lleva instrucción correctiva");

  //    La nota la escribe el observador, cuya propia instrucción le enumera los
  //    element_id, así que citarlos en ella es el caso normal: también hay que
  //    traducirlos, y tachar los que no existan en la escena.
  const conIdsEnLaNota = await buildGenerationQa({
    sceneSpec: scene,
    image: IMAGE,
    hashes: HASHES,
    plan: qaPlan,
    force: true,
    observe: async (sceneSpec) => ({
      presentElementIds: sceneSpec.elements.map((element) => element.element_id),
      appearanceFailures: ["EST_01_SEMIARCO"],
      appearanceDetails: [{ element_id: "EST_01_SEMIARCO", aspect: "color_proportion", note: "EST_01_SEMIARCO shows CATALOG_01 gold on half of the piece, unlike EST_99_FANTASMA" }],
    }),
  });
  const correccionConIds = buildCorrectiveRetryPrompt(conIdsEnLaNota, scene);
  assert.doesNotMatch(correccionConIds, /EST_\d|EST_[A-Z]|CATALOG_|VENUE_|EDIT_/, correccionConIds);
  assert.match(correccionConIds, /observed: “Semiarco derecho” in the .+ shows gold on half of the piece, unlike\./, correccionConIds);
  console.log("[PASS] corrective retry: nombres legibles, sin ids (tampoco en la nota del observador) y antes del recordatorio final");

  // 5. Ubicación de las instancias repetidas (ubicaciones.ts). Solo se
  //    reflejaban las laterales repetidas exactamente dos veces; cualquier
  //    otra repartía la caja en tajadas horizontales estrechas del mismo lado,
  //    y el QA marcaba como fallo de ubicación un render simétrico correcto.
  const estructura = (ubicacion: string, repeticiones: number) => ({
    estructura_id: "EST_01", nombre: "Columnas", tipo: "columna", rol_escena: "soporte",
    ubicacion, repeticiones, medidas: { alto_m: 1.8 }, densidad: "media", mezcla: "clasica", materiales, porque: "x",
  } as unknown as Parameters<typeof cajasDeEstructuras>[0][number]);
  const centro = (caja: { x: number; width: number }) => Number((caja.x + caja.width / 2).toFixed(6));

  // Dos laterales: exactamente igual que antes, declarando cualquiera de los dos lados.
  const parIzquierda = cajasDeEstructuras([estructura("lateral_izquierdo", 2)]);
  const parDerecha = cajasDeEstructuras([estructura("lateral_derecho", 2)]);
  for (const instancia of ["EST_01#1", "EST_01#2"]) {
    assert.deepEqual(parIzquierda[instancia], parDerecha[instancia], "declarar cualquier lateral produce la misma geometría (entra en el plan_hash)");
  }
  assert.deepEqual(parIzquierda["EST_01#1"]!.bbox, { x: 0.04, y: 0.28, width: 0.24, height: 0.62 });
  assert.deepEqual(parIzquierda["EST_01#2"]!.bbox, { x: 0.72, y: 0.28, width: 0.24, height: 0.62 });

  // Cuatro laterales: dos por lado, en espejo, separadas en profundidad y altura.
  const cuatro = cajasDeEstructuras([estructura("lateral_izquierdo", 4)]);
  const lados = [1, 2, 3, 4].map((n) => centro(cuatro[`EST_01#${n}`]!.bbox));
  assert.deepEqual(lados.map((cx) => cx < 0.5 ? "izq" : "der"), ["izq", "der", "izq", "der"]);
  assert.equal(lados[0]! + lados[1]!, 1, "la primera pareja es simétrica");
  assert.equal(lados[2]! + lados[3]!, 1, "la segunda pareja también");
  assert.ok(cuatro["EST_01#1"]!.bbox.width > 0.2, `sin tajadas horizontales estrechas: ${cuatro["EST_01#1"]!.bbox.width}`);
  assert.notDeepEqual(cuatro["EST_01#3"]!.bbox, cuatro["EST_01#1"]!.bbox, "las dos del mismo lado se separan");
  assert.equal(cuatro["EST_01#3"]!.bbox.x, cuatro["EST_01#1"]!.bbox.x, "se separan en profundidad y altura, no de lado");
  assert.ok(cuatro["EST_01#3"]!.depthLayer > cuatro["EST_01#1"]!.depthLayer);
  assert.deepEqual([0, 1, 2, 3].map((indice) => ubicacionDeInstancia(estructura("lateral_izquierdo", 4), indice)), ["lateral_izquierdo", "lateral_derecho", "lateral_izquierdo", "lateral_derecho"]);

  // Impares: sin par que repartir, se conserva el comportamiento actual.
  const tres = cajasDeEstructuras([estructura("lateral_izquierdo", 3)]);
  assert.ok([1, 2, 3].every((n) => centro(tres[`EST_01#${n}`]!.bbox) < 0.5));
  assert.deepEqual([0, 1, 2].map((indice) => ubicacionDeInstancia(estructura("lateral_izquierdo", 3), indice)), ["lateral_izquierdo", "lateral_izquierdo", "lateral_izquierdo"]);

  // Ubicaciones centradas ×2: en espejo alrededor de x = 0,5 (piso_frontal daba "left" y "center").
  for (const ubicacion of ["piso_frontal", "arco_central", "fondo_pared", "mesas_invitados", "zona_central", "recorrido_suelo"]) {
    const cajas = cajasDeEstructuras([estructura(ubicacion, 2)]);
    const izquierda = centro(cajas["EST_01#1"]!.bbox);
    const derecha = centro(cajas["EST_01#2"]!.bbox);
    assert.equal(Number((izquierda + derecha).toFixed(6)), 1, `${ubicacion}: las dos instancias son simétricas`);
    assert.ok(izquierda < derecha, `${ubicacion}: la #1 va a la izquierda de la #2`);
  }
  // El caso citado: piso_frontal ×2 daba "left" y "center" (0.324 y 0.644).
  const frontal = cajasDeEstructuras([estructura("piso_frontal", 2)]);
  assert.ok(centro(frontal["EST_01#1"]!.bbox) < 0.34 && centro(frontal["EST_01#2"]!.bbox) > 0.66, JSON.stringify(frontal));

  // Cajas de un solo lado por definición: no se tocan.
  for (const ubicacion of ["entrada", "esquina", "vegetacion", "pared_lateral"]) {
    const cajas = cajasDeEstructuras([estructura(ubicacion, 2)]);
    const base = cajas.EST_01!.bbox;
    assert.equal(cajas["EST_01#1"]!.bbox.x, base.x, `${ubicacion} conserva el reparto actual`);
    assert.equal(cajas["EST_01#1"]!.bbox.width, base.width / 2 * 0.9, `${ubicacion} conserva el reparto actual`);
    assert.ok(centro(cajas["EST_01#2"]!.bbox) < 0.5, `${ubicacion} sigue siendo una ubicación de un solo lado`);
  }
  console.log("[PASS] ubicaciones: laterales pares reparten a los dos lados y las centradas ×2 van en espejo");

  // 6. One owner: the prompt compiled with the same plan map asks the image model for the gap.
  const compiled = compileProductPrompt({ sceneSpec: scene, visualContext: CONTEXT, vocabulary: PRODUCT_VOCABULARY, trigger: "eventdecor_style_v2", officialStructures: qaPlan.officialStructures });
  assert.match(compiled.prompt, /stand apart with an open gap between them/, compiled.prompt);
  console.log("[PASS] the LoRA prompt compiled with the same plan inputs requests the separation QA checks");

  // 7. Una lateral repetida un número par de veces (el caso motivador: cuatro
  //    columnas, dos a cada lado) tiene que llegar entera hasta el preflight,
  //    que es lo que route.ts consulta antes de la llamada pagada. El
  //    compilador emitía la frase de par una vez POR PAR y
  //    `expectedBilateralPairs` emparejaba cada izquierda con la MISMA derecha,
  //    así que salía "relaciones bilaterales 1/2" -> LORA_PREFLIGHT_FAILED.
  for (const repeticiones of [2, 4, 6]) {
    const lateralRepetida = await approvedScene([
      { estructura_id: "EST_01_ARCO", nombre: "Arco principal", tipo: "arco", rol_escena: "focal", ubicacion: "arco_central", medidas: { ancho_m: 3, alto_m: 2.6 }, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales, porque: "Pieza focal." },
      { estructura_id: "EST_02_COLUMNAS", nombre: "Columnas laterales", tipo: "columna", rol_escena: "soporte", ubicacion: "lateral_izquierdo", medidas: { alto_m: 1.8 }, repeticiones, densidad: "media", mezcla: "clasica", materiales, porque: "Columnas a los dos lados." },
    ], "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
    const planLateral = approvedPlanQaInputs(lateralRepetida.plan)!;
    const caption = compileProductPrompt({ sceneSpec: lateralRepetida.scene, visualContext: CONTEXT, vocabulary: PRODUCT_VOCABULARY, trigger: "eventdecor_style_v2", officialStructures: planLateral.officialStructures });
    // Todas las instancias del mismo grupo son UNA instrucción espejo, no la misma frase repetida.
    const bilaterales = caption.clauses.filter((clause) => clause.bilateral);
    assert.equal(bilaterales.length, 1, JSON.stringify(caption.clauses.map((clause) => clause.elementIds)));
    assert.equal(bilaterales[0]!.elementIds.length, repeticiones);
    const frase = repeticiones === 2 ? "one standing on the left and one on the right" : `${["", "one", "two", "three"][repeticiones / 2]} standing on each side`;
    assert.equal(caption.prompt.split(frase).length - 1, 1, caption.prompt);
    const preflight = preflightLoraPrompt({ sceneSpec: lateralRepetida.scene, clauses: caption.clauses, prompt: caption.prompt, triggers: ["eventdecor_style_v2"], vocabulary: PRODUCT_VOCABULARY });
    assert.equal(preflight.ok, true, `repeticiones=${repeticiones}: ${JSON.stringify(preflight.errors)}`);
    assert.deepEqual(preflight.relationships, { expected: repeticiones / 2, represented: repeticiones / 2 });
  }
  console.log("[PASS] laterales repetidas ×2, ×4 y ×6: una sola cláusula espejo que pasa el preflight LoRA");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
