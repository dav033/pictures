import assert from "node:assert/strict";
import type { SceneSpec } from "../src/lib/ia/scene-spec";
import { compileLoraCaption, translateLoraColor } from "../src/lib/ia/lora-caption-compiler";
import { findLoraPromptLanguageLeaks, preflightLoraPrompt } from "../src/lib/ia/lora-prompt-preflight";
import { buildLoraImagePromptV1 } from "../src/lib/ia/build-image-prompt";
import { buildVisualContext } from "../src/lib/ia/visual-context";

type ElementOptions = {
  id: string;
  name: string;
  type: "arco" | "semiarco" | "guirnalda" | "columna" | "pared" | "centro_mesa" | "backdrop" | "kit" | "accesorio";
  placement: "fondo_pared" | "arco_central" | "sobre_mesa_principal" | "lateral_izquierdo" | "lateral_derecho" | "piso_frontal" | "mesas_invitados" | "entrada" | "techo";
  role?: "focal" | "soporte" | "acento";
  group?: string;
  colors?: string[];
  finishes?: string[];
  dimensions?: { width?: number; height?: number; length?: number };
};

function element(options: ElementOptions): SceneSpec["elements"][number] {
  return {
    element_id: options.id,
    name: options.name,
    category: options.type === "backdrop" ? "backdrop" : "balloon_structure",
    source_type: "reference_only",
    required: true,
    quantity: { mode: "exact", min: 1, max: 1 },
    target_bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.7 },
    depth_layer: 10,
    resolved_colors: options.colors ?? ["rosado"],
    resolved_finishes: options.finishes,
    visual_semantics: {
      structure_type: options.type,
      placement: options.placement,
      design_role: options.role ?? (options.type === "backdrop" ? "soporte" : "acento"),
      repetition_group: options.group ?? options.id,
      ...(options.dimensions ? { dimensions_m: options.dimensions } : {}),
      density: "media",
    },
    identity_constraints: [],
    relationships: [],
  };
}

function scene(elements: SceneSpec["elements"][number][]): SceneSpec {
  return {
    schema_version: "1.0",
    generation_mode: "text_to_image",
    canvas: { aspect_ratio: "3:2", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
    venue: { preserve: [], protected_regions: [], editable_regions: [] },
    elements,
    positive_prompt: { required_elements: [], composition: [], venue_preservation: [], photorealistic_integration: [] },
    negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
    metadata: { created_by: "server_default", plan_hash: "plan-test" },
  } as SceneSpec;
}

function check(input: { spec: SceneSpec; request?: string }) {
  const compilation = compileLoraCaption({
    sceneSpec: input.spec,
    visualContext: buildVisualContext({ userRequest: input.request ?? "cumpleaños en salón" }),
  });
  const report = preflightLoraPrompt({ sceneSpec: input.spec, clauses: compilation.clauses, prompt: compilation.prompt });
  assert.equal(report.ok, true, report.errors.join("; "));
  assert.equal((compilation.prompt.match(/eventdecor_style_v2/gi) ?? []).length, 1);
  assert.ok(compilation.prompt.length <= 750, `prompt demasiado largo: ${compilation.prompt.length}`);
  assert.doesNotMatch(compilation.prompt, /EST_|CATALOG_|SKU|precio|paquete/i);
  return { compilation, report };
}

assert.equal(translateLoraColor("azul rey"), "blue");
assert.equal(translateLoraColor("verde esmeralda"), "green");

const canonicalLabel = "round latex balloon in gold with a Reflex high-shine finish";
const canonicalSpec = scene([element({ id: "CANONICAL", name: "Arco", type: "arco", placement: "arco_central", role: "focal" })]);
const canonicalPresence = compileLoraCaption({
  sceneSpec: canonicalSpec,
  visualContext: buildVisualContext({ userRequest: "cumpleaños en salón" }),
  productConcepts: [{ elementId: "CANONICAL", conceptId: "fixture.canonical.product", canonicalLabel }],
});
assert.ok(canonicalPresence.prompt.includes(canonicalLabel), "la etiqueta canónica debe aparecer literalmente");

const canonicalDeduplication = compileLoraCaption({
  sceneSpec: scene([
    element({ id: "CANONICAL_DUP_A", name: "Arco", type: "arco", placement: "arco_central", role: "focal", group: "same-product" }),
    element({ id: "CANONICAL_DUP_B", name: "Arco", type: "arco", placement: "arco_central", role: "soporte", group: "same-product" }),
  ]),
  visualContext: buildVisualContext({ userRequest: "cumpleaños en salón" }),
  productConcepts: [
    { elementId: "CANONICAL_DUP_A", conceptId: "fixture.canonical.product", canonicalLabel },
    { elementId: "CANONICAL_DUP_B", conceptId: "fixture.canonical.product", canonicalLabel },
  ],
}).prompt;
assert.equal((canonicalDeduplication.match(new RegExp(canonicalLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length, 1, "la etiqueta canónica duplicada debe emitirse una vez");

const canonicalAbsent = check({ spec: scene([element({ id: "NO_CANONICAL", name: "Arco", type: "arco", placement: "arco_central", role: "focal" })]) });
assert.doesNotMatch(canonicalAbsent.compilation.prompt, /using exact canonical product/i, "sin etiqueta canónica no debe agregarse restricción inventada");

// Language boundary: free-form Spanish event, venue, and palette values must
// be rendered as English or omitted before either LoRA prompt reaches fal.ai.
const languageScene = scene([element({
  id: "LANGUAGE_PROBE",
  name: "Arco principal",
  type: "arco",
  placement: "arco_central",
  role: "focal",
  colors: [],
})]);
const languageContext = buildVisualContext({
  brief: { tipo_evento: "quinceanos", espacio: "club social", colores: ["azul rey"] },
  userRequest: "quince años",
  eventLabel: "evento corporativo",
});
const languageV2 = compileLoraCaption({ sceneSpec: languageScene, visualContext: languageContext }).prompt;
const languageV1 = buildLoraImagePromptV1({ sceneSpec: languageScene, visualContext: languageContext, revisionInstruction: "más velas" });
assert.match(languageV2, /fifteenth-birthday celebration atmosphere/i);
assert.match(languageV2, /in blue/i);
assert.match(languageV2, /recognizable event venue environment/i);
assert.doesNotMatch(languageV2, /quince|azul|club social|evento|corporativo|años|[áéíóúüñ¿¡]/i);
assert.doesNotMatch(languageV1, /quince|azul|club social|evento|corporativo|años|velas|[áéíóúüñ¿¡]/i);
assert.equal((languageV1.match(/fifteenth-birthday celebration/gi) ?? []).length, 1);
assert.deepEqual(findLoraPromptLanguageLeaks(languageV2), []);
assert.deepEqual(findLoraPromptLanguageLeaks(languageV1), []);

const directQuincePrompt = compileLoraCaption({
  sceneSpec: languageScene,
  visualContext: buildVisualContext({ brief: { tipo_evento: "quinceañera", espacio: "club social" } }),
}).prompt;
assert.match(directQuincePrompt, /fifteenth-birthday celebration atmosphere/i);
assert.doesNotMatch(directQuincePrompt, /quinceañera|club social|[áéíóúüñ¿¡]/i);

const entrance = check({ spec: scene([element({ id: "ARCH_ENTRANCE", name: "Arco Orgánico", type: "arco", placement: "entrada", role: "focal" })]) });
assert.match(entrance.compilation.prompt, /framing the venue entrance/i);
assert.doesNotMatch(entrance.compilation.prompt, /stage photo area/i);

const central = check({ spec: scene([element({ id: "ARCH_CENTER", name: "Arco Orgánico", type: "arco", placement: "arco_central", role: "focal" })]) });
assert.match(central.compilation.prompt, /centered around the stage photo area/i);
assert.doesNotMatch(central.compilation.prompt, /framing the venue entrance/i);

// Regression: the "ubicaciones alternativas o incompatibles" preflight
// check used to flag ANY standalone "or" in the whole prompt, not just a
// genuine entrance/stage-photo-area contradiction — a night-time event
// cue ("dark sky or dark exterior surroundings") tripped it on every
// prompt, blocking valid generations for no reason.
const nightEvent = check({ spec: scene([element({ id: "ARCH_NIGHT", name: "Arco Orgánico", type: "arco", placement: "arco_central", role: "focal" })]), request: "cumpleaños en salón de noche" });
assert.match(nightEvent.compilation.prompt, /\bor\b/i, "el cue nocturno debe contener 'or' para que la regresión sea real");
assert.equal(nightEvent.report.ok, true, nightEvent.report.errors.join("; "));

const bilateral = check({ spec: scene([
  element({ id: "ARCH", name: "Arco principal", type: "arco", placement: "arco_central", role: "focal", colors: ["rosado", "dorado rosa"], dimensions: { height: 3 } }),
  element({ id: "COL_L", name: "Columna izquierda", type: "columna", placement: "lateral_izquierdo", role: "soporte", group: "columns", colors: ["rosado", "dorado rosa"] }),
  element({ id: "COL_R", name: "Columna derecha", type: "columna", placement: "lateral_derecho", role: "soporte", group: "columns", colors: ["rosado", "dorado rosa"] }),
]) });
assert.match(bilateral.compilation.prompt, /two balloon columns/i);
assert.match(bilateral.compilation.prompt, /one standing on the left and one on the right/i);
assert.match(bilateral.compilation.prompt, /flanking the main arch/i);

// Regression: compatibleKey used a single "|" separator for both the outer
// (type/colors/finishes/group) fields and each field's own inner list join,
// so an element with N finishes could produce the same 3-field prefix as an
// element with N-1 finishes plus one extra token shifted in from the group
// — two columns with the SAME color but a DIFFERENT finish count were
// wrongly treated as compatible for bilateral pairing. This bypasses
// preflightLoraPrompt (its bilateral check only compares colors, not
// finishes — a separate, pre-existing gap) to isolate the compiler's own
// pairing decision.
const asymmetricFinishSpec = scene([
  element({ id: "ARCH_AF", name: "Arco", type: "arco", placement: "arco_central", role: "focal", colors: ["rosado"] }),
  element({ id: "COL_AF_L", name: "Columna izquierda", type: "columna", placement: "lateral_izquierdo", role: "soporte", group: "columns-af", colors: ["rojo"], finishes: ["reflex"] }),
  element({ id: "COL_AF_R", name: "Columna derecha", type: "columna", placement: "lateral_derecho", role: "soporte", group: "columns-af", colors: ["rojo"], finishes: ["reflex", "metalizado"] }),
]);
const asymmetricFinishCompilation = compileLoraCaption({ sceneSpec: asymmetricFinishSpec, visualContext: buildVisualContext({ userRequest: "cumpleaños en salón" }) });
assert.doesNotMatch(asymmetricFinishCompilation.prompt, /matching one another/i, "columnas con distinto número de acabados no son un par bilateral real");

const quince = check({
  spec: scene([
    element({ id: "ARCH_XV", name: "Arco Orgánico Principal", type: "arco", placement: "arco_central", role: "focal", colors: ["rosado", "dorado rosa"], finishes: ["reflex", "metalizado"], dimensions: { height: 3 } }),
    element({ id: "COL_L", name: "Columnas Coordinadas", type: "columna", placement: "lateral_izquierdo", role: "soporte", group: "columns", colors: ["rosado", "dorado rosa"] }),
    element({ id: "COL_R", name: "Columnas Coordinadas", type: "columna", placement: "lateral_derecho", role: "soporte", group: "columns", colors: ["rosado", "dorado rosa"] }),
    element({ id: "TABLE", name: "Acento Bajo para Mesa Principal", type: "centro_mesa", placement: "sobre_mesa_principal", role: "acento", colors: ["dorado rosa"] }),
  ]),
  request: "XV años coquette en salón",
});
assert.match(quince.compilation.prompt, /low coordinated balloon centerpiece placed on the main table beneath the main arch/i);
assert.doesNotMatch(quince.compilation.prompt, /balloon installation/i);

const backdrop = check({ spec: scene([
  element({ id: "ARCH", name: "Arco", type: "arco", placement: "arco_central", role: "focal" }),
  element({ id: "BACK", name: "Cortina", type: "backdrop", placement: "fondo_pared", role: "soporte", colors: ["blanco"] }),
]) });
assert.match(backdrop.compilation.prompt, /decorated backdrop installed against the rear wall, behind the main arrangement/i);

const manyCenterpieces = check({
  spec: scene(Array.from({ length: 12 }, (_, index) => element({ id: `TABLE_${index + 1}`, name: "Acento Bajo", type: "centro_mesa", placement: "mesas_invitados", group: "guest-centerpieces", colors: ["dorado"] }))),
});
assert.match(manyCenterpieces.compilation.prompt, /twelve low coordinated balloon centerpieces(?: in gold)? distributed across the guest tables/i);

const ceiling = check({ spec: scene([element({ id: "CEILING", name: "Instalación superior", type: "kit", placement: "techo", role: "soporte", colors: ["plateado"] })]) });
assert.match(ceiling.compilation.prompt, /suspended overhead from the ceiling/i);

const sevenStructures = check({ spec: scene([
  element({ id: "S1", name: "Arco", type: "arco", placement: "arco_central", role: "focal" }),
  element({ id: "S2", name: "Columna", type: "columna", placement: "lateral_izquierdo", role: "soporte" }),
  element({ id: "S3", name: "Columna", type: "columna", placement: "lateral_derecho", role: "soporte" }),
  element({ id: "S4", name: "Guirnalda", type: "guirnalda", placement: "piso_frontal" }),
  element({ id: "S5", name: "Pared", type: "pared", placement: "fondo_pared", role: "soporte" }),
  element({ id: "S6", name: "Centro", type: "centro_mesa", placement: "sobre_mesa_principal" }),
  element({ id: "S7", name: "Techo", type: "kit", placement: "techo", role: "soporte" }),
]) });
assert.equal(sevenStructures.report.structures.represented, 7);
assert.equal(sevenStructures.report.discardedElementIds.length, 0);

console.log("LoRA caption compiler: OK");
