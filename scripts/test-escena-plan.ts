/**
 * Creativity -> image: the venue and time of day recorded in the approved plan
 * reach the visual context and the LoRA prompt of /api/generate, only where the
 * customer left them open (src/lib/ia/escena/visual-context.ts completarEscenaConPlan).
 * Run: npx tsx --conditions=react-server scripts/test-escena-plan.ts
 */
import assert from "node:assert/strict";
import type { NivelCreatividad } from "../src/lib/ia/escena/creatividad";
import { compileLoraCaption } from "../src/lib/ia/kagutsuchi/lora-caption-compiler";
import { findLoraPromptLanguageLeaks } from "../src/lib/ia/kagutsuchi/lora-prompt-preflight";
import { SceneSpecSchema } from "../src/lib/ia/escena/scene-spec";
import {
  buildLoraEnvironmentCues,
  buildVisualContext,
  buildVisualFailureConditions,
  buildVisualSceneLock,
  completarEscenaConPlan,
} from "../src/lib/ia/escena/visual-context";
import { PlanDecoracionSchema } from "../src/lib/plan/tipos";
import type { Brief } from "../src/lib/types";

let casos = 0;
function ok(nombre: string): void {
  casos += 1;
  console.log(`ok ${casos} - ${nombre}`);
}

function planCon(espacio: { tipo: string; fuente: "cliente" | "supuesto" | "foto" }, momentoDia?: string) {
  return PlanDecoracionSchema.parse({
    plan_version: "1.0",
    plan_id: "88888888-8888-4888-8888-888888888888",
    concepto: { titulo: "Cumpleaños dorado", descripcion: "Arco dorado.", paleta: ["dorado"], ...(momentoDia ? { momento_dia: momentoDia } : {}) },
    espacio,
    estructuras: [{
      estructura_id: "EST_01_ARCO", nombre: "Arco", tipo: "arco", rol_escena: "focal", ubicacion: "fondo_pared",
      medidas: { ancho_m: 3, alto_m: 2.4 }, repeticiones: 1, densidad: "media", mezcla: "organica_fina",
      materiales: [{ product_id: "P-GLOBO", participacion: 1, rol_material: "principal", color: "dorado" }], porque: "Prueba.",
    }],
    supuestos: [],
  });
}

const escena = SceneSpecSchema.parse({
  schema_version: "1.0",
  generation_mode: "text_to_image",
  canvas: { aspect_ratio: "3:2", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
  venue: { preserve: [], protected_regions: [], editable_regions: [] },
  elements: [{
    element_id: "EST_01_ARCO", name: "Arco", category: "balloon_structure", source_type: "reference_only", required: true,
    quantity: { mode: "exact", min: 1, max: 1 }, target_bbox: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 }, depth_layer: 10,
    resolved_colors: ["dorado"], visual_semantics: { structure_type: "arco", placement: "fondo_pared", design_role: "focal", repetition_group: "EST_01_ARCO", density: "media" },
    identity_constraints: [], relationships: [],
  }],
  positive_prompt: { required_elements: [], composition: [], venue_preservation: [], photorealistic_integration: [] },
  negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
  metadata: { created_by: "server_default", plan_hash: "plan-escena-test" },
});

/** Same composition as /api/generate: the plan completes the brief, then the context is built. */
function contextoGeneracion(input: { brief?: Brief; userRequest?: string; plan?: ReturnType<typeof planCon>; nivel: NivelCreatividad }) {
  return buildVisualContext({ brief: completarEscenaConPlan(input), userRequest: input.userRequest });
}
function promptLora(context: ReturnType<typeof buildVisualContext>): string {
  return compileLoraCaption({ sceneSpec: escena, visualContext: context, dialect: "scene_v004" }).prompt;
}

const GARDEN_CUE = /outdoor garden setting/;
const NIGHT_CUE = /unmistakable nighttime exposure/;
const HALL_CUE = /indoor event hall/;
const briefSinLugar: Brief = { tipo_evento: "cumpleaños", colores: ["dorado"] };
const pedidoSinLugar = "Quiero un arco dorado para el cumpleaños de mi hija";
const jardinDeNoche = planCon({ tipo: "jardín", fuente: "supuesto" }, "noche");

// 1. The scene the chat chose (level 4 suggestion "jardín / noche") reaches the image.
{
  const context = contextoGeneracion({ brief: briefSinLugar, userRequest: pedidoSinLugar, plan: jardinDeNoche, nivel: 4 });
  assert.equal(context.venue, "jardín");
  assert.equal(context.venueKind, "outdoor");
  assert.equal(context.lightingKind, "night");
  assert.match(buildVisualSceneLock(context), /MANDATORY VENUE: jardín/);
  assert.match(buildVisualSceneLock(context), /MANDATORY TIME OF DAY: noche/);
  assert.ok(buildLoraEnvironmentCues(context).some((cue) => GARDEN_CUE.test(cue)), "garden cue");
  assert.ok(buildVisualFailureConditions(context).some((failure) => /indoor room/.test(failure)), "an indoor room is a failure");
  const prompt = promptLora(context);
  assert.match(prompt, /garden/, prompt);
  assert.match(prompt, /nighttime/, prompt);
  assert.deepEqual(findLoraPromptLanguageLeaks(prompt), [], "the Spanish plan value never leaks into the LoRA prompt");
  // Before this change /api/generate ignored the plan: no venue, no lighting.
  const sinPlan = buildVisualContext({ brief: briefSinLugar, userRequest: pedidoSinLugar });
  assert.equal(sinPlan.venueKind, "unknown");
  assert.doesNotMatch(promptLora(sinPlan), /garden|nighttime/);
}
ok("plan jardín/noche sin lugar del cliente: el prompt LoRA lleva jardín exterior nocturno");

// 2. The customer's venue always wins, in the brief and in the request text.
{
  const porBrief = contextoGeneracion({ brief: { ...briefSinLugar, espacio: "salón" }, userRequest: pedidoSinLugar, plan: jardinDeNoche, nivel: 5 });
  assert.equal(porBrief.venue, "salón");
  assert.equal(porBrief.venueKind, "indoor");
  assert.match(promptLora(porBrief), HALL_CUE);
  assert.doesNotMatch(promptLora(porBrief), /garden/);
  assert.equal(porBrief.lightingKind, "night", "the time the customer left open still comes from the plan");

  const porTexto = contextoGeneracion({ brief: briefSinLugar, userRequest: "Un arco dorado para el cumpleaños en el salón comunal", plan: jardinDeNoche, nivel: 5 });
  assert.equal(porTexto.venueKind, "indoor");
  assert.doesNotMatch(porTexto.venue ?? "", /jard/);
  assert.match(promptLora(porTexto), HALL_CUE);
  assert.doesNotMatch(promptLora(porTexto), /garden/);
}
ok("el cliente dijo salón (brief o texto): manda el salón");

// 3. The customer's time of day always wins, in the brief and in the request text.
{
  const porBrief = contextoGeneracion({ brief: { ...briefSinLugar, momento_dia: "tarde" }, userRequest: pedidoSinLugar, plan: jardinDeNoche, nivel: 4 });
  assert.equal(porBrief.timeOfDay, "tarde");
  assert.equal(porBrief.lightingKind, "afternoon");
  assert.equal(porBrief.venue, "jardín", "the venue the customer left open still comes from the plan");
  assert.doesNotMatch(promptLora(porBrief), NIGHT_CUE);

  const porTexto = contextoGeneracion({ brief: briefSinLugar, userRequest: "Un arco dorado para un cumpleaños de día", plan: jardinDeNoche, nivel: 4 });
  assert.equal(porTexto.lightingKind, "day");
  assert.doesNotMatch(promptLora(porTexto), NIGHT_CUE);

  const porEstilo = contextoGeneracion({ brief: { ...briefSinLugar, estilo: "noche de gala" }, userRequest: pedidoSinLugar, plan: planCon({ tipo: "terraza", fuente: "supuesto" }, "día"), nivel: 4 });
  assert.equal(porEstilo.lightingKind, "night", "a time the context already reads from the brief is the customer's");
}
ok("el cliente dijo la hora (brief o texto): manda su hora");

// 4. Default level: an unguided assumption does not change existing generations.
{
  const antes = buildVisualContext({ brief: briefSinLugar, userRequest: pedidoSinLugar });
  const supuesto = contextoGeneracion({ brief: briefSinLugar, userRequest: pedidoSinLugar, plan: jardinDeNoche, nivel: 2 });
  assert.deepEqual(supuesto, antes, "level 2 ignores an assumed venue and a time without provenance");
  assert.equal(promptLora(supuesto), promptLora(antes));
  const foto = contextoGeneracion({ brief: briefSinLugar, userRequest: pedidoSinLugar, plan: planCon({ tipo: "terraza", fuente: "foto" }, "noche"), nivel: 2 });
  assert.deepEqual(foto, antes, "level 2 ignores a venue inferred from a photo");

  const cliente = contextoGeneracion({ brief: briefSinLugar, userRequest: pedidoSinLugar, plan: planCon({ tipo: "jardín", fuente: "cliente" }, "noche"), nivel: 2 });
  assert.equal(cliente.venue, "jardín", "a venue the customer stated earlier in the chat is applied at every level");
  assert.equal(cliente.lightingKind, "unspecified", "momento_dia has no provenance, so level 2 leaves it out");
}
ok("nivel 2: el supuesto del plan no cambia el prompt; lo que dijo el cliente sí llega");

// 5. Levels whose design rule fills the scene apply the plan's choice.
{
  const fiel = contextoGeneracion({ brief: briefSinLugar, userRequest: pedidoSinLugar, plan: planCon({ tipo: "interior", fuente: "supuesto" }), nivel: 0 });
  assert.equal(fiel.venueKind, "indoor", "level 0: neutral interior");
  assert.equal(fiel.lightingKind, "unspecified", "level 0: no time of day");
  const sobrio = contextoGeneracion({ brief: briefSinLugar, userRequest: pedidoSinLugar, plan: planCon({ tipo: "salón", fuente: "supuesto" }, "día"), nivel: 1 });
  assert.equal(sobrio.venueKind, "indoor");
  assert.equal(sobrio.lightingKind, "day");
  const foto = contextoGeneracion({ brief: briefSinLugar, userRequest: pedidoSinLugar, plan: planCon({ tipo: "terraza", fuente: "foto" }), nivel: 3 });
  assert.equal(foto.venue, "terraza");
  const abierto = contextoGeneracion({ brief: briefSinLugar, userRequest: pedidoSinLugar, plan: planCon({ tipo: "club campestre", fuente: "supuesto" }, "atardecer"), nivel: 5 });
  assert.equal(abierto.venue, "club campestre", "an unrecognized place keeps the open label");
  assert.equal(abierto.lightingKind, "sunset");
  assert.deepEqual(findLoraPromptLanguageLeaks(promptLora(abierto)), [], "an open venue label never reaches the LoRA prompt verbatim");
}
ok("niveles 0, 1, 3-5: la escena del plan llega; lugar abierto sin fuga de español");

// 6. Without an approved plan the brief is untouched.
assert.equal(completarEscenaConPlan({ brief: briefSinLugar, userRequest: pedidoSinLugar, nivel: 5 }), briefSinLugar);
assert.equal(completarEscenaConPlan({ userRequest: pedidoSinLugar, nivel: 5 }), undefined);
ok("sin plan aprobado el brief no cambia");

console.log(`\n${casos} casos OK (escena del plan -> imagen)`);
