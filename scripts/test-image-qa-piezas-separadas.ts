import assert from "node:assert/strict";
import { planBlueprint } from "@/lib/plan/blueprint";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { buildApprovedSceneSpec, type SceneSpec } from "@/lib/ia/scene-spec";
import { cajasDeEstructuras } from "@/lib/plan/ubicaciones";
import { compileLoraCaption } from "@/lib/ia/lora-caption-compiler";
import { buildImagePrompt } from "@/lib/ia/build-image-prompt";
import type { VisualContext } from "@/lib/ia/visual-context";
import { planFijado } from "./lib/planes-fijados";

/**
 * Lo que queda de la regresión I13 (2026-09-14) tras eliminar el QA visual: la
 * separación de piezas laterales (semiarco a un lado, columna al otro, con
 * hueco) sigue siendo una regla del compilador LoRA y del prompt de imagen
 * Gemini, con el mismo dueño de la regla (`officialStructures`, construido a
 * partir de `estructura_oficial` como en `src/app/api/generate/route.ts`). El
 * observador visual que además preguntaba y evaluaba la separación ya no
 * existe; lo que este archivo comprobaba de él se borró con él.
 * Determinista y sin red: plan congelado (`scripts/lib/planes-fijados.ts`, ADR-0023
 * paso 5) -> planBlueprint -> SceneSpec -> prompt LoRA / prompt de imagen.
 * Run: npx tsx --conditions=react-server scripts/test-image-qa-piezas-separadas.ts
 */

type PlanAprobado = { escena: SceneSpec; officialStructures: ReadonlyMap<string, string> };

/** Mirror of the route's private officialStructuresDePlan (src/app/api/generate/route.ts), for the same prompt vocabulary as the catalog. */
function officialStructuresDePlan(plan: PlanResuelto): ReadonlyMap<string, string> {
  return new Map(plan.plan.estructuras.flatMap((estructura) => estructura.estructura_oficial ? [[estructura.estructura_id, estructura.estructura_oficial] as const] : []));
}

function planAprobado(fixture: string): PlanAprobado {
  const { plan: resultado, materialEstimate } = planFijado(fixture);
  assert.equal(resultado.sin_cobertura.length, 0, "el plan debe resolver sin huecos de cobertura");
  const blueprint = planBlueprint(resultado);
  const cajas = cajasDeEstructuras(resultado.plan.estructuras);
  const escena = buildApprovedSceneSpec({
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
  // Los datos del plan aprobado que route.ts pasa al compilador del prompt.
  return { escena, officialStructures: officialStructuresDePlan(resultado) };
}

function todosPresentes(scene: SceneSpec): string[] {
  return scene.elements.map((element) => element.element_id);
}

const CONTEXTO: VisualContext = { venueKind: "indoor", lightingKind: "night", palette: ["rojo", "dorado"] };
const PROMPT_PIDE_SEPARACION = /stand apart with an open gap between them/;

/**
 * Paridad entre el prompt LoRA y el prompt de imagen Gemini: ambos piden el
 * hueco separado justo cuando el plan tiene piezas laterales distintas, con
 * los mismos datos del plan aprobado (`officialStructures`). Mientras el
 * compilador tenga su copia privada de la regla (separatePiecesPhrase), esta
 * comprobación es la que detecta que diverjan.
 */
function paridadConPrompt(caso: string, { escena, officialStructures }: PlanAprobado, pideSeparacion: boolean): void {
  for (const dialect of ["product_v007", "scene_v004"] as const) {
    const prompt = compileLoraCaption({ sceneSpec: escena, visualContext: CONTEXTO, officialStructures, dialect }).prompt;
    assert.equal(PROMPT_PIDE_SEPARACION.test(prompt), pideSeparacion, `${caso} (${dialect}): el prompt LoRA ${pideSeparacion ? "debe" : "no debe"} pedir separación: ${prompt}`);
  }
  const promptGemini = buildImagePrompt({ sceneSpec: escena, officialStructures });
  assert.equal(/SEPARATE SIDE PIECES:/.test(promptGemini), pideSeparacion, `${caso}: el prompt de imagen ${pideSeparacion ? "debe" : "no debe"} pedir el hueco abierto`);
}

async function main(): Promise<void> {
  // Caso de referencia: semiarco alto a la derecha, columna baja a la izquierda.
  const planSeparadas = planAprobado("piezas-separadas");
  const separadas = planSeparadas.escena;
  assert.deepEqual(todosPresentes(separadas).sort(), ["EST_01_SEMIARCO", "EST_02_COLUMNA"]);

  // Par simétrico (una estructura lateral con repeticiones 2): el compilador lo
  // describe como par a ambos lados, no como piezas separadas.
  const planParSimetrico = planAprobado("piezas-par-simetrico");
  const parSimetrico = planParSimetrico.escena;
  assert.deepEqual(todosPresentes(parSimetrico).sort(), ["EST_01_ARCO", "EST_02_SEMIARCOS#1", "EST_02_SEMIARCOS#2"]);

  // Dos columnas distintas en lados opuestos: nunca se leen como un arco (misma regla que el compilador).
  const planDosColumnas = planAprobado("piezas-dos-columnas");

  // Paridad LoRA/Gemini en todos los casos, incluidas las variantes declaradas
  // en `estructura_oficial`, que mandan sobre el nombre (estructuras-oficiales.ts)
  // y deciden qué laterales forman un par.
  paridadConPrompt("semiarco y columna", planSeparadas, true);
  paridadConPrompt("par simétrico", planParSimetrico, false);
  paridadConPrompt("dos columnas", planDosColumnas, false);

  // Dos semiarcos de alturas distintas (lora-run-v004-1000): no son un par, son dos piezas.
  const dosSemiarcos = planAprobado("piezas-dos-semiarcos");
  paridadConPrompt("dos semiarcos de alturas distintas", dosSemiarcos, true);

  // Variantes declaradas distintas con nombres neutros: el prompt las describe
  // como dos piezas; sin el mapa del plan se leerían como par simétrico.
  const variantesDistintas = planAprobado("piezas-variantes-distintas");
  paridadConPrompt("variantes declaradas distintas", variantesDistintas, true);

  // Misma variante declarada aunque un nombre diga "asimétrico": el prompt los
  // describe como par.
  const mismaVariante = planAprobado("piezas-misma-variante");
  paridadConPrompt("misma variante declarada", mismaVariante, false);

  // Estructura repetida (`<estructura_id>#<n>`): cada instancia hereda la variante declarada.
  const parAsimetrico = planAprobado("piezas-par-asimetrico");
  paridadConPrompt("par repetido con variante declarada", parAsimetrico, false);
  console.log("[PASS] paridad: el prompt LoRA y el prompt de imagen piden el hueco separado justo cuando las variantes declaradas del plan marcan piezas distintas");

  // Cardinalidad por tipo de estructura, no por subcadena del nombre:
  // "Semiarco…" y "Marco circular…" se contaban como arcos completos ("render
  // exactly 2 arches") y el resto de tipos salían como el token interno.
  const cardinalidad = planAprobado("piezas-cardinalidad");
  const promptCardinalidad = buildImagePrompt({ sceneSpec: cardinalidad.escena, officialStructures: cardinalidad.officialStructures });
  const contrato = promptCardinalidad.split("\n").find((linea) => linea.startsWith("CARDINALITY CONTRACT"))!;
  assert.doesNotMatch(contrato, /\d+ arches/, contrato);
  assert.match(contrato, /1 half-arch/, contrato);
  assert.match(contrato, /1 circular hoop/, contrato);
  assert.match(contrato, /1 column/, contrato);
  assert.doesNotMatch(contrato, /balloon_structure/, "ningún token interno llega al modelo");
  // La forma abierta del semiarco viaja con la instancia, igual que la del arco.
  assert.match(promptCardinalidad, /one-sided half-arch rising from the floor on one side and ending in open air; never closed into a full arch/);
  // Y el semiarco a la izquierda con la columna a la derecha piden el hueco.
  assert.match(promptCardinalidad, /SEPARATE SIDE PIECES: Semiarco izquierdo on the left and Columna derecha on the right/);
  assert.doesNotMatch(promptCardinalidad, /SEPARATE SIDE PIECES:[^\n]*EST_\d/, "la cláusula usa nombres legibles, no ids");
  // Varias instancias del mismo tipo se pluralizan bien.
  const parDeSemiarcos = planAprobado("piezas-par-de-semiarcos");
  assert.match(buildImagePrompt({ sceneSpec: parDeSemiarcos.escena, officialStructures: parDeSemiarcos.officialStructures }), /render exactly 2 half-arches/);
  console.log("[PASS] cardinalidad: semiarco, aro y columna se cuentan por tipo declarado, no por el nombre");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
