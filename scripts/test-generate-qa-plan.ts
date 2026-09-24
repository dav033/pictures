import assert from "node:assert/strict";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { planBlueprint } from "@/lib/plan/blueprint";
import { buildApprovedSceneSpec, type SceneSpec } from "@/lib/ia/escena/scene-spec";
import { cajasDeEstructuras, ubicacionDeInstancia } from "@/lib/plan/ubicaciones";
import { compileProductPrompt } from "@/lib/ia/kagutsuchi/lora-product-runtime";
import { preflightLoraPrompt } from "@/lib/ia/kagutsuchi/lora-prompt-preflight";
import { PRODUCT_VOCABULARY } from "@/lib/lora/product-vocabulary-data";
import type { VisualContext } from "@/lib/ia/escena/visual-context";
import { planFijado } from "./lib/planes-fijados";

/**
 * Lo que queda de la verificación de "iteration 3, step 3" tras eliminar el QA
 * visual: la ubicación de instancias repetidas (`ubicaciones.ts`) y el
 * preflight del prompt LoRA para laterales repetidas un número par de veces.
 * Ninguna de las dos depende del observador visual que se borró; ambas siguen
 * vivas y necesitaban cobertura propia, así que este archivo se editó en vez
 * de borrarse. Deterministic, no network.
 *
 * El plan aprobado sale de `scripts/lib/planes-fijados.ts` (ADR-0023, paso 5:
 * Python es el único dueño del conteo). Este test nunca comprobó el resolutor;
 * sólo necesita un plan resuelto con una lateral repetida.
 * Run: npx tsx --conditions=react-server scripts/test-generate-qa-plan.ts
 */

const materiales = [
  { product_id: "P-GLOBOS", color: "rojo", participacion: 0.6, rol_material: "principal" },
  { product_id: "P-GLOBOS", color: "dorado", participacion: 0.4, rol_material: "secundario" },
];
const CONTEXT: VisualContext = { venueKind: "indoor", lightingKind: "night", palette: ["rojo", "dorado"] };

function approvedScene(fixture: string): { plan: PlanResuelto; scene: SceneSpec } {
  const { plan, materialEstimate } = planFijado(fixture);
  assert.equal(plan.sin_cobertura.length, 0);
  const blueprint = planBlueprint(plan);
  const scene = buildApprovedSceneSpec({
    blueprint,
    aspectRatio: "3:2",
    targetBoxes: Object.fromEntries(Object.entries(cajasDeEstructuras(plan.plan.estructuras)).map(([id, layout]) => [id, layout.bbox])),
    catalogProducts: Object.fromEntries(blueprint.elements.map((element) => [element.element_id, (element.model_decision?.bill_of_materials ?? []).map((line) => ({ id: line.catalog_product_id, name: line.catalog_product_id, description: "", category: "balloon", share: line.share, role: line.role }))])),
    materialEstimate,
    generationMode: "text_to_image",
    createdBy: "server_default",
    planHash: plan.plan_hash,
    catalogOnly: true,
  });
  return { plan, scene };
}

/** Mirror of the route's private officialStructuresDePlan (src/app/api/generate/route.ts), for the same prompt vocabulary as the catalog. */
function officialStructuresDePlan(plan: PlanResuelto): ReadonlyMap<string, string> {
  return new Map(plan.plan.estructuras.flatMap((estructura) => estructura.estructura_oficial ? [[estructura.estructura_id, estructura.estructura_oficial] as const] : []));
}

async function main(): Promise<void> {
  // 1. Ubicación de las instancias repetidas (ubicaciones.ts). Solo se
  //    reflejaban las laterales repetidas exactamente dos veces; cualquier
  //    otra repartía la caja en tajadas horizontales estrechas del mismo lado,
  //    lo que producía un render simétrico incorrecto.
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

  // 2. Una lateral repetida un número par de veces (el caso motivador: cuatro
  //    columnas, dos a cada lado) tiene que llegar entera hasta el preflight,
  //    que es lo que route.ts consulta antes de la llamada pagada. El
  //    compilador emitía la frase de par una vez POR PAR y
  //    `expectedBilateralPairs` emparejaba cada izquierda con la MISMA derecha,
  //    así que salía "relaciones bilaterales 1/2" -> LORA_PREFLIGHT_FAILED.
  for (const repeticiones of [2, 4, 6]) {
    const lateralRepetida = approvedScene(`qa-lateral-repetida-x${repeticiones}`);
    assert.equal(lateralRepetida.plan.estructuras.find((estructura) => estructura.estructura_id === "EST_02_COLUMNAS")?.repeticiones, repeticiones);
    const officialStructures = officialStructuresDePlan(lateralRepetida.plan);
    const caption = compileProductPrompt({ sceneSpec: lateralRepetida.scene, visualContext: CONTEXT, vocabulary: PRODUCT_VOCABULARY, trigger: "eventdecor_style_v2", officialStructures });
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
