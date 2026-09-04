import assert from "node:assert/strict";
import { buildImagePrompt } from "../src/lib/ia/build-image-prompt";
import { buildVisualContext, buildVisualSceneLock } from "../src/lib/ia/visual-context";
import { parseEventIntent } from "../src/lib/rag/query-parser/parse-event";
import { expandIntentToProgram, selectSceneRecipeId } from "../src/lib/scene/recipes";
import type { SceneSpec } from "../src/lib/ia/scene-spec";
import { extraerRestriccionesUsuario, validarCardinalidadEventoAbierto, validarRestriccionesPlan } from "../src/lib/plan/restricciones";
import { PlanDecoracionSchema } from "../src/lib/plan/tipos";

const request = "evento carnaval de las luciérnagas azul y dorado R-12 hasta $50.000";
const intent = parseEventIntent(request);

// Known occasion labels preserve customer accents/spelling too. UI and plan
// audit must not leak taxonomy slugs such as `revelacion_genero`.
const knownIntent = parseEventIntent("revelación de género azul y rosado");
assert.equal(knownIntent.event_label, "revelación de género");
assert.equal(knownIntent.event_type, "open");

// C5: unknown celebration stays open, keeps customer wording, and never uses
// the wedding recipe as a compatibility default.
assert.equal(intent.event_label, "evento carnaval de las luciérnagas");
assert.equal(intent.event_type, "open");
assert.equal(intent.event_family, "other");
assert.equal(intent.original_request, request);
assert.ok(intent.palette.includes("azul"));
assert.ok(intent.palette.includes("dorado"));
assert.ok(intent.hard_constraints.some((constraint) => constraint.key === "color"));
assert.ok(intent.hard_constraints.some((constraint) => constraint.key === "diametro_pulgadas"));
assert.equal(intent.budget_cop, 50_000);

const recipeId = selectSceneRecipeId(intent);
assert.match(recipeId, /^generic_(?:indoor|outdoor)_event@1$/);
assert.notEqual(recipeId, "wedding_ceremony_garden@1");

const program = expandIntentToProgram(intent, recipeId);
assert.equal(program.event_label, intent.event_label);
assert.equal(program.original_request, intent.original_request);
assert.equal(program.recipe_id, recipeId.split("@")[0]);
assert.ok(program.slots.length >= 3, "receta genérica debe conservar composición mínima");

// C6: free event label and approved-plan authority reach visual context/prompt;
// adaptable products remain explicitly non-exact and no unsupported props are
// authorized by an open event name.
const visualContext = buildVisualContext({
  userRequest: request,
  eventLabel: intent.event_label ?? undefined,
  confirmedMotifs: ["luciérnagas"],
  pieceMatchLevels: [{ piece: "arco azul", match_level: "adaptable" }],
  approvedPlan: ["arco focal de globos"],
  approvedMaterials: ["globo látex azul", "globo látex dorado"],
});
assert.equal(visualContext.eventLabel, intent.event_label);
assert.match(visualContext.eventCue ?? "", /evento carnaval de las luciérnagas/i);
assert.match(buildVisualSceneLock(visualContext), /EVENT LABEL \(FREE TEXT\): evento carnaval de las luciérnagas/i);

const sceneSpec = {
  elements: [{
    element_id: "CATALOG_01",
    name: "arco focal de globos azul y dorado",
    category: "balloon_structure",
    source_type: "catalog_backed",
    required: true,
    quantity: { mode: "exact", min: 1, max: 1 },
    target_bbox: { x: 0.15, y: 0.12, width: 0.7, height: 0.7 },
    depth_layer: 10,
    resolved_colors: ["azul", "dorado"],
    identity_constraints: ["arco focal aprobado"],
    relationships: [],
  }],
} as unknown as SceneSpec;
const prompt = buildImagePrompt({ sceneSpec, visualContext });
assert.match(prompt, /OPEN EVENT LABEL: evento carnaval de las luciérnagas/i);
assert.match(prompt, /ORIGINAL CUSTOMER REQUEST \(TRACEABILITY\)/i);
assert.match(prompt, /arco azul=adaptable/i);
assert.match(prompt, /Never render adaptable as exact/i);
assert.match(prompt, /invent no signage, readable text, props, flowers, furniture, or accessories/i);

// C7: cardinality contract remains explicit for open-event proposals with
// two through five approved structures. Material units must not be mistaken
// for extra structures by the image provider.
for (const count of [2, 3, 4, 5]) {
  const openScene = {
    ...sceneSpec,
    elements: Array.from({ length: count }, (_, index) => ({
      ...(sceneSpec.elements[0]!),
      element_id: `EST_${String(index + 1).padStart(2, "0")}_OPEN`,
      name: `estructura abierta ${index + 1}`,
      target_bbox: { x: 0.05 + (index % 3) * 0.3, y: 0.1 + Math.floor(index / 3) * 0.35, width: 0.25, height: 0.3 },
    })),
  } as SceneSpec;
  const openPrompt = buildImagePrompt({ sceneSpec: openScene, visualContext });
  assert.match(openPrompt, new RegExp(`exactly ${count} distinct installed structure`));
  assert.equal((openPrompt.match(/EXACTLY ONE physical installed structure/g) ?? []).length, count);
}

// E2E contract guards: hard palette survives grammatical variants and an open
// event cannot be quoted as a two-structure composition when inventory exists.
const restricciones = extraerRestriccionesUsuario("festival Lunaria verde y blanca");
assert.deepEqual(new Set(restricciones.colores.map((color) => color.valor)), new Set(["verde", "blanco"]));
const estructuraBase = {
  nombre: "Estructura",
  tipo: "arco" as const,
  rol_escena: "focal" as const,
  ubicacion: "arco_central" as const,
  medidas: { ancho_m: 2, alto_m: 2 },
  densidad: "media" as const,
  mezcla: "organica_fina" as const,
  materiales: [{ product_id: "P-1", participacion: 1, rol_material: "principal" as const, color: "plateado" }],
  porque: "Prueba determinista",
};
const planDos = PlanDecoracionSchema.parse({
  plan_version: "1.0",
  plan_id: "55555555-5555-4555-8555-555555555555",
  concepto: { titulo: "Lunaria", descripcion: "Prueba", paleta: ["plateado"], ocasion: "festival Lunaria" },
  espacio: { tipo: "interior", fuente: "supuesto" },
  estructuras: [{ ...estructuraBase, estructura_id: "EST_01_ARCO" }, { ...estructuraBase, estructura_id: "EST_02_ARCO", rol_escena: "soporte" as const, ubicacion: "lateral_izquierdo" as const }],
  supuestos: [],
  restricciones,
});
assert.equal(validarCardinalidadEventoAbierto(planDos, "open", "festival Lunaria verde y blanca", true).length, 1);
assert.ok(validarRestriccionesPlan(planDos, restricciones).some((error) => /verde|blanco/i.test(error)));
assert.equal(validarCardinalidadEventoAbierto(planDos, "open", "solo un arco verde", true).length, 0);

console.log("[PASS] open intent plan/generation: parser + recipe + visual traceability");
