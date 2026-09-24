/**
 * Plan scene -> image, review regressions of completarEscenaConPlan
 * (src/lib/ia/escena/visual-context.ts): a place the customer named in free text and a
 * venue photo keep winning over the plan's assumed scene, the chat and the
 * generation read "specified" from text/brief with one function (the chat does
 * not pass its venue photo yet), and the levels that fill the
 * scene are the levels whose chat rule asks for one (creatividad.ts).
 * Run: npx tsx --conditions=react-server scripts/test/test-escena-plan-imagen.ts
 */
import assert from "node:assert/strict";
import { buildImagePrompt } from "../../src/lib/ia/uzume/build-image-prompt";
import { NIVELES_CREATIVIDAD, sugerenciaEscena, type NivelCreatividad } from "../../src/lib/ia/escena/creatividad";
import { compileLoraCaption } from "../../src/lib/ia/kagutsuchi/lora-caption-compiler";
import { findLoraPromptLanguageLeaks } from "../../src/lib/ia/kagutsuchi/lora-prompt-preflight";
import { bloqueCreatividad } from "../../src/lib/ia/omoikane/prompt-sistema";
import { SceneSpecSchema, type SceneSpec } from "../../src/lib/ia/escena/scene-spec";
import { buildVisualContext, buildVisualSceneLock, completarEscenaConPlan, escenaEspecificada, type EscenaDelPlan } from "../../src/lib/ia/escena/visual-context";
import type { Brief } from "../../src/lib/types";

let casos = 0;
function ok(nombre: string): void {
  casos += 1;
  console.log(`ok ${casos} - ${nombre}`);
}

function escenaPlan(tipo: string, fuente: EscenaDelPlan["espacio"]["fuente"], momentoDia?: string): EscenaDelPlan {
  return { espacio: { tipo, fuente }, concepto: momentoDia ? { momento_dia: momentoDia } : {} };
}

function sceneSpec(generationMode: SceneSpec["generation_mode"]): SceneSpec {
  return SceneSpecSchema.parse({
    schema_version: "1.0",
    generation_mode: generationMode,
    canvas: { aspect_ratio: "3:2", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
    venue: { ...(generationMode === "edit_venue" ? { source_image_id: "VENUE_01" } : {}), preserve: [], protected_regions: [], editable_regions: [] },
    elements: [{
      element_id: "EST_01_ARCO", name: "Arco", category: "balloon_structure", source_type: "reference_only", required: true,
      quantity: { mode: "exact", min: 1, max: 1 }, target_bbox: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 }, depth_layer: 10,
      resolved_colors: ["dorado"], visual_semantics: { structure_type: "arco", placement: "fondo_pared", design_role: "focal", repetition_group: "EST_01_ARCO", density: "media" },
      identity_constraints: [], relationships: [],
    }],
    positive_prompt: { required_elements: [], composition: [], venue_preservation: [], photorealistic_integration: [] },
    negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
    metadata: { created_by: "server_default", plan_hash: "plan-escena-imagen-test" },
  });
}

/** Same composition as /api/generate: the plan completes the brief, then the context is built. */
function contextoGeneracion(input: { brief?: Brief; userRequest: string; plan: EscenaDelPlan; nivel: NivelCreatividad; fotoEspacio?: boolean }) {
  return buildVisualContext({ brief: completarEscenaConPlan(input), userRequest: input.userRequest });
}

const brief: Brief = { tipo_evento: "cumpleaños", colores: ["dorado"] };
const jardinDeNoche = escenaPlan("jardín", "supuesto", "noche");
const primerSorteo = () => 0;

// 1. A place the customer named outside the known venue patterns keeps winning.
{
  const piscina = "Quiero un arco dorado para el cumpleaños en la piscina del conjunto";
  const context = contextoGeneracion({ brief, userRequest: piscina, plan: jardinDeNoche, nivel: 4 });
  assert.equal(context.venue, "piscina del conjunto", "the customer's place, not the plan's assumed garden");
  assert.notEqual(context.venueKind, "outdoor");
  assert.match(buildVisualSceneLock(context), /MANDATORY VENUE: piscina del conjunto/);
  assert.doesNotMatch(buildVisualSceneLock(context), /jard/);
  assert.equal(context.lightingKind, "night", "the time the customer left open still comes from the plan");
  const lora = compileLoraCaption({ sceneSpec: sceneSpec("text_to_image"), visualContext: context, dialect: "scene_v004" }).prompt;
  assert.doesNotMatch(lora, /garden/, lora);
  assert.deepEqual(findLoraPromptLanguageLeaks(lora), [], "the open place never reaches the LoRA prompt verbatim");

  const iglesia = contextoGeneracion({ brief: { tipo_evento: "boda" }, userRequest: "Decoración para una boda en la iglesia", plan: escenaPlan("salón", "supuesto", "día"), nivel: 1 });
  assert.equal(iglesia.venue, "iglesia");
  assert.notEqual(iglesia.venueKind, "indoor", "the level-1 assumed hall does not replace the church");

  const club = contextoGeneracion({ brief, userRequest: "Un arco para el cumpleaños en el club", plan: escenaPlan("terraza", "cliente"), nivel: 2 });
  assert.equal(club.venue, "club", "what the request says wins even over a plan venue recorded as the customer's");

  // The chat reads "specified" with the same function, so it suggests no other venue.
  for (const texto of [piscina, "Decoración para una boda en la iglesia", "baby shower en el colegio de noche"]) {
    assert.equal(escenaEspecificada(texto).lugar, true, texto);
    assert.equal(sugerenciaEscena(4, escenaEspecificada(texto), primerSorteo)?.lugar, undefined, texto);
  }
}
ok("un lugar del cliente fuera de los patrones conocidos (piscina, iglesia, club) gana al plan");

// 2. Bounded exception: an "en ..." complement that is not a place does not block the plan's scene.
{
  for (const texto of [
    "Un arco para el cumpleaños en tonos pastel",
    "Un arco en dorado y blanco",
    "globos en colores pastel para un baby shower",
    "un arco para poner en la entrada",
    "algo en la mesa de postres",
    "globos dorados para usar en la fiesta",
    "un arco en la noche",
    "cumpleaños en diciembre",
  ]) {
    assert.equal(escenaEspecificada(texto).lugar, false, texto);
    assert.equal(sugerenciaEscena(4, escenaEspecificada(texto), primerSorteo)?.lugar, "jardín", `the chat still suggests a venue: ${texto}`);
    const context = contextoGeneracion({ brief, userRequest: texto, plan: jardinDeNoche, nivel: 4 });
    assert.equal(context.venue, "jardín", texto);
    assert.equal(context.venueKind, "outdoor", texto);
  }
}
ok("un complemento que no es lugar (tonos, colores, la entrada, la fiesta) no bloquea la escena del plan");

// 2b. Everyday punctuation and several "en" complements: every "en <det> <place>" of every clause counts.
{
  for (const [texto, lugar] of [
    ["Quiero un arco dorado para el cumpleaños en la piscina.", "piscina"],
    ["Arco para la boda en la iglesia, somos 80", "iglesia"],
    ["Quiero globos en dorado para el cumpleaños en la piscina", "piscina"],
    ["globos para mi fiesta en la noche de gala en el club", "club"],
    ["Un arco en tonos pastel; la fiesta es en el colegio de mis hijos!", "colegio de mis hijos"],
  ] as const) {
    assert.equal(escenaEspecificada(texto).lugar, true, texto);
    assert.equal(sugerenciaEscena(4, escenaEspecificada(texto), primerSorteo)?.lugar, undefined, `the chat suggests no other venue: ${texto}`);
    const context = contextoGeneracion({ brief, userRequest: texto, plan: jardinDeNoche, nivel: 4 });
    assert.equal(context.venue, lugar, texto);
    assert.notEqual(context.venueKind, "outdoor", texto);
    assert.doesNotMatch(buildVisualSceneLock(context), /jard/, texto);
  }

  // A complement with a determiner that is not a place is not a venue: the chat still suggests one.
  for (const texto of ["arco en el estilo boho", "en mi opinión algo sobrio", "un arco en la forma de corazón", "globos en el tono del vestido"]) {
    assert.equal(escenaEspecificada(texto).lugar, false, texto);
    assert.equal(sugerenciaEscena(4, escenaEspecificada(texto), primerSorteo)?.lugar, "jardín", `the chat still suggests a venue: ${texto}`);
    const context = contextoGeneracion({ brief, userRequest: texto, plan: jardinDeNoche, nivel: 4 });
    assert.equal(context.venue, "jardín", texto);
    assert.match(buildVisualSceneLock(context), /MANDATORY VENUE: jardín/, texto);
  }
}
ok("puntuación, varios \"en\" y complementos con determinante que no son lugar");

// 3. A venue photo is the venue: the plan never forces an assumed place or time on it.
{
  const texto = "Decora mi espacio para el cumpleaños de mi hija, adjunto la foto";
  assert.deepEqual(escenaEspecificada(texto, {}, { fotoEspacio: true }), { lugar: true, momento: true });
  // Contract of the shared reading only: /api/chat does not pass its venue photo
  // yet (see escenaEspecificada), so this does not prove the chat skips the suggestion.
  assert.equal(sugerenciaEscena(4, escenaEspecificada(texto, {}, { fotoEspacio: true }), primerSorteo), undefined, "a caller that passes the venue photo gets no scene suggestion");

  const sinPlan = buildVisualContext({ brief, userRequest: texto });
  for (const plan of [jardinDeNoche, escenaPlan("salón", "foto", "día"), escenaPlan("terraza", "cliente", "atardecer")]) {
    for (const nivel of NIVELES_CREATIVIDAD) {
      const context = contextoGeneracion({ brief, userRequest: texto, plan, nivel, fotoEspacio: true });
      assert.deepEqual(context, sinPlan, `nivel ${nivel}, fuente ${plan.espacio.fuente}`);
    }
  }
  const prompt = buildImagePrompt({ sceneSpec: sceneSpec("edit_venue"), visualContext: contextoGeneracion({ brief, userRequest: texto, plan: jardinDeNoche, nivel: 4, fotoEspacio: true }) });
  assert.match(prompt, /Edit the supplied venue photo/);
  assert.doesNotMatch(prompt, /MANDATORY VENUE|MANDATORY TIME OF DAY/);
  assert.doesNotMatch(prompt, /indoor room, visible interior ceiling/);
  assert.doesNotMatch(prompt, /daylight, bright daytime windows/);

  const deNoche = contextoGeneracion({ brief, userRequest: `${texto}, es de noche`, plan: escenaPlan("salón", "supuesto", "día"), nivel: 4, fotoEspacio: true });
  assert.equal(deNoche.lightingKind, "night", "a time the customer states still reaches the prompt");
}
ok("con foto del espacio el plan no impone lugar ni hora; lo que dice el cliente sí llega");

// 4. The levels that fill the scene are exactly the levels whose chat rule asks for one.
for (const nivel of NIVELES_CREATIVIDAD) {
  const reglaDeEscenaEnChat = /\blugar\b/.test(bloqueCreatividad(nivel));
  const completada = completarEscenaConPlan({ brief, userRequest: "Arco dorado", plan: escenaPlan("terraza", "supuesto", "tarde"), nivel });
  assert.equal(completada?.espacio === "terraza", reglaDeEscenaEnChat, `nivel ${nivel}: venue`);
  assert.equal(completada?.momento_dia === "tarde", reglaDeEscenaEnChat, `nivel ${nivel}: time of day`);
}
ok("chat y generación leen la misma regla de escena por nivel");

console.log(`\n${casos} casos OK (escena del plan -> imagen, revisión)`);
