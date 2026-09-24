import assert from "node:assert/strict";
import { planBlueprint } from "@/lib/plan/blueprint";
import { buildApprovedSceneSpec } from "@/lib/ia/escena/scene-spec";
import { cajasDeEstructuras } from "@/lib/plan/ubicaciones";
import { buildVisualContext } from "@/lib/ia/escena/visual-context";
import { compileLoraCaption } from "@/lib/ia/kagutsuchi/lora-caption-compiler";
import { preflightLoraPrompt } from "@/lib/ia/kagutsuchi/lora-prompt-preflight";
import { planFijadoDesdeVector } from "../lib/vectores-golden";

/**
 * Fixture end-to-end real: PlanResuelto -> planBlueprint -> SceneSpec ->
 * compileLoraCaption. Verifica que la cadena completa preserve
 * tipo/ubicación/rol de la estructura y los colores realmente comprados, no
 * solo los fixtures sintéticos de scripts/test/test-lora-caption-compiler.ts.
 *
 * El plan es un **plan congelado**: sale del bloque `expected` de un vector
 * dorado (`planFijadoDesdeVector`), no de volver a resolverlo. Aquí el plan es
 * el medio, no el sujeto —lo que se prueba es el caption—, así que atarlo al
 * resolutor TypeScript, que el paso 5 del ADR-0023 borra, no aportaba nada; y
 * el oráculo congelado mantiene la prueba offline, sin el servicio Python.
 */

async function main(): Promise<void> {
  // Vector 19: un solo arco central con dos colores reales de variante (Reflex
  // Plata y Fashion Gris). Se elige por eso: un elemento en la escena y colores
  // que vienen de la variante comprada, que es lo que la cadena debe conservar.
  const { vector, plan: resultado, materialEstimate } = planFijadoDesdeVector("19-gris-no-es-plateado");
  assert.equal(resultado.sin_cobertura.length, 0, "el plan debe resolver sin huecos de cobertura");

  const blueprint = planBlueprint(resultado);
  const arco = blueprint.elements.find((element) => element.element_id === "EST_01_ARCO");
  assert.ok(arco, "el blueprint debe conservar el elemento EST_01_ARCO");
  assert.equal(arco!.visual_semantics?.structure_type, "arco", "debe preservar el tipo canónico declarado en el plan");
  assert.equal(arco!.visual_semantics?.placement, "arco_central", "debe preservar la ubicación canónica declarada en el plan");
  assert.equal(arco!.visual_semantics?.design_role, "focal", "debe preservar el rol visual declarado en el plan");
  assert.deepEqual(new Set(arco!.appearance.observed_colors), new Set(["plateado", "gris"]), "debe traer los colores reales resueltos por variante");

  const cajas = cajasDeEstructuras(resultado.plan.estructuras);
  const targetBoxes = Object.fromEntries(Object.entries(cajas).map(([id, layout]) => [id, layout.bbox]));
  const catalogProducts = Object.fromEntries(
    blueprint.elements
      .filter((element) => element.source_type === "catalog_backed")
      .map((element) => [
        element.element_id,
        (element.model_decision?.bill_of_materials ?? []).map((linea) => {
          const row = vector.catalog_rows.find((candidate) => candidate.variant_id === linea.catalog_product_id || candidate.product_id === linea.catalog_product_id);
          return { id: linea.catalog_product_id, name: row?.producto_titulo ?? linea.catalog_product_id, description: row?.descripcion ?? "", category: "balloon", colors: row?.colores_variante, share: linea.share, role: linea.role };
        }),
      ]),
  );

  const sceneSpec = buildApprovedSceneSpec({
    blueprint,
    aspectRatio: "3:2",
    targetBoxes,
    catalogProducts,
    materialEstimate,
    generationMode: "text_to_image",
    createdBy: "server_default",
    planHash: resultado.plan_hash,
    catalogOnly: true,
  });
  assert.equal(sceneSpec.elements.length, 1);
  assert.equal(sceneSpec.elements[0]!.visual_semantics?.structure_type, "arco", "el SceneSpec debe recibir la semántica canónica sin perderla en buildApprovedSceneSpec");

  const visualContext = buildVisualContext({ brief: { tipo_evento: "cumpleaños" } });
  const compilation = compileLoraCaption({ sceneSpec, visualContext });
  assert.ok(compilation.prompt.includes("arch"), "el caption debe traducir 'arco' a 'arch' en inglés");
  assert.ok(compilation.prompt.length <= 750, "el caption no debe superar el límite duro de 750 caracteres");
  assert.doesNotMatch(compilation.prompt, /balloon installation/, "un tipo conocido (arco) nunca debe degradar a 'balloon installation' genérico");

  const preflight = preflightLoraPrompt({ sceneSpec, clauses: compilation.clauses, prompt: compilation.prompt });
  assert.equal(preflight.ok, true, `el preflight debe pasar para este plan real: ${preflight.errors.join("; ")}`);

  console.log("[PASS] PlanResuelto -> planBlueprint -> SceneSpec -> compileLoraCaption preserva tipo/ubicación/rol end-to-end");
  console.log(`caption: ${compilation.prompt}`);

  await parDeColumnasLaterales();
}

/**
 * Regresión (2026-09-14, plan real de chat con loraMode training_1): el modelo
 * declara "dos columnas a los lados" como UNA estructura `lateral_izquierdo`
 * con `repeticiones: 2`. Las dos instancias quedaban a la izquierda: el caption
 * decía "standing on the left side" y el QA marcaba
 * `placement failure EST_02_COLUMNAS#2` (5 casos en plan_audit_log).
 *
 * Vector 20: arco central más "Columnas laterales" (`lateral_izquierdo`,
 * `repeticiones: 2`), que es exactamente la forma del incidente.
 */
async function parDeColumnasLaterales(): Promise<void> {
  const { plan: resultado, materialEstimate } = planFijadoDesdeVector("20-tamanos-obligatorios");
  assert.equal(resultado.sin_cobertura.length, 0);

  const blueprint = planBlueprint(resultado);
  const columna1 = blueprint.elements.find((element) => element.element_id === "EST_02_COLUMNA#1");
  const columna2 = blueprint.elements.find((element) => element.element_id === "EST_02_COLUMNA#2");
  assert.equal(columna1?.visual_semantics?.placement, "lateral_izquierdo");
  assert.equal(columna2?.visual_semantics?.placement, "lateral_derecho", "la segunda instancia del par va a la derecha");

  const cajas = cajasDeEstructuras(resultado.plan.estructuras);
  const izquierda = cajas["EST_02_COLUMNA#1"]!.bbox;
  const derecha = cajas["EST_02_COLUMNA#2"]!.bbox;
  assert.ok(izquierda.x + izquierda.width <= 0.5, `#1 en la mitad izquierda: ${JSON.stringify(izquierda)}`);
  assert.ok(derecha.x >= 0.5, `#2 en la mitad derecha: ${JSON.stringify(derecha)}`);
  assert.ok(Math.abs(izquierda.x - (1 - derecha.x - derecha.width)) < 1e-9, "las cajas del par son simétricas");

  // Declarar el par como lateral_derecho produce el mismo par.
  const cajasDerecha = cajasDeEstructuras(resultado.plan.estructuras.map((estructura) => estructura.estructura_id === "EST_02_COLUMNA" ? { ...estructura, ubicacion: "lateral_derecho" as const } : estructura));
  assert.deepEqual(cajasDerecha["EST_02_COLUMNA#1"], cajas["EST_02_COLUMNA#1"]);
  assert.deepEqual(cajasDerecha["EST_02_COLUMNA#2"], cajas["EST_02_COLUMNA#2"]);

  const sceneSpec = buildApprovedSceneSpec({
    blueprint,
    aspectRatio: "3:2",
    targetBoxes: Object.fromEntries(Object.entries(cajas).map(([id, layout]) => [id, layout.bbox])),
    catalogProducts: Object.fromEntries(blueprint.elements.map((element) => [element.element_id, (element.model_decision?.bill_of_materials ?? []).map((linea) => ({ id: linea.catalog_product_id, name: linea.catalog_product_id, description: "", category: "balloon", share: linea.share, role: linea.role }))])),
    materialEstimate,
    generationMode: "text_to_image",
    createdBy: "server_default",
    planHash: resultado.plan_hash,
    catalogOnly: true,
  });
  const compilation = compileLoraCaption({ sceneSpec, visualContext: buildVisualContext({ brief: { tipo_evento: "cumpleaños" } }) });
  assert.match(compilation.prompt, /one standing on the left and one on the right/, compilation.prompt);
  assert.doesNotMatch(compilation.prompt, /standing on the left side/);
  const preflight = preflightLoraPrompt({ sceneSpec, clauses: compilation.clauses, prompt: compilation.prompt });
  assert.equal(preflight.ok, true, preflight.errors.join("; "));
  assert.deepEqual(preflight.relationships, { expected: 1, represented: 1 });

  console.log("[PASS] columnas con repeticiones 2 en un lateral → par izquierda/derecha simétrico, caption bilateral y preflight 1/1");
  console.log(`caption: ${compilation.prompt}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
