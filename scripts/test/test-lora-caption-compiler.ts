import assert from "node:assert/strict";
import type { SceneSpec } from "../../src/lib/ia/escena/scene-spec";
import { compileLoraCaption, LORA_PROMPT_MAX_LENGTH, translateLoraColor } from "../../src/lib/ia/kagutsuchi/lora-caption-compiler";
import { findLoraPromptLanguageLeaks, preflightLoraPrompt } from "../../src/lib/ia/kagutsuchi/lora-prompt-preflight";
import { buildVisualContext } from "../../src/lib/ia/escena/visual-context";
import { TERMINOS_COMERCIALES } from "../../src/lib/lora/descriptor-perceptual";

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
  assert.equal((compilation.prompt.match(/eventdecor_style_v[23]/gi) ?? []).length, 0);
  assert.ok(compilation.prompt.length <= LORA_PROMPT_MAX_LENGTH, `prompt demasiado largo: ${compilation.prompt.length}`);
  assert.doesNotMatch(compilation.prompt, /EST_|CATALOG_|SKU|precio|paquete/i);
  return { compilation, report };
}

// `azul rey` decia `blue`, que es la paleta de 26 palabras aplastando un nombre del catalogo que el dataset
// SI sabe decir: `royal blue` sale 20 veces en las 345 captions de `data/staging/lora-v007`, y describiendo
// globos («matte Fashion round latex balloons in royal blue and white»). `azul caribe` se aplastaba al mismo
// `blue` y ahora es `turquoise`. La regla no cambia —solo se usa la palabra donde el corpus la usa—; lo que
// cambia es que se midio, y tres tonos candidatos (`teal`, `dark green`, `light pink`) quedaron fuera porque
// en el corpus describen un mantel, un piso y nada.
assert.equal(translateLoraColor("azul rey"), "royal blue");
assert.equal(translateLoraColor("azul caribe"), "turquoise");
assert.equal(translateLoraColor("blanco nacar"), "pearl white");
assert.equal(translateLoraColor("verde menta"), "mint green");
assert.equal(translateLoraColor("verde esmeralda"), "green");
// `gris` es un color real de producto (colores-producto.ts) fuera de la paleta
// v2: sin alias llegaba en español al caption y el preflight no lo detectaba.
//
// Con `grey` y no `gray`: es la misma palabra y no la misma estadistica. En las 345 captions `grey` sale 15
// veces y son las de globos («12-inch matte Fashion grey round latex balloons»); `gray` sale 7 y son paredes
// y pisos. La ortografia la eligio quien escribio el corpus.
assert.equal(translateLoraColor("gris"), "grey");
assert.equal(translateLoraColor("grafito"), "charcoal gray");
assert.equal(translateLoraColor("plateado"), "silver", "plateado sigue siendo silver, no gris");
assert.ok(findLoraPromptLanguageLeaks("eventdecor_style_v2, an arch of gris balloons").includes("gris"), "el preflight detecta 'gris' sin traducir");
assert.deepEqual(findLoraPromptLanguageLeaks("eventdecor_style_v2, an arch of gray balloons"), []);

const canonicalLabel = "round latex balloon in gold with a Reflex high-shine finish";
const columnaOrganica = scene([element({ id: "ORGANICA", name: "Columna orgánica", type: "columna", placement: "lateral_izquierdo" })]);
const textoColumnaOrganica = compileLoraCaption({
  sceneSpec: columnaOrganica,
  visualContext: buildVisualContext({ userRequest: "cumpleaños en salón" }),
  dialect: "base",
  officialStructures: new Map([["ORGANICA", "columna_asimetrica"]]),
}).prompt;
assert.match(textoColumnaOrganica, /organic balloon column/i);
assert.match(textoColumnaOrganica, /uneven, deep silhouette and large balloons interspersed/i);
assert.doesNotMatch(textoColumnaOrganica, /\btubes?\b|rigid balloon column/i);

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
assert.match(languageV2, /fifteenth-birthday celebration atmosphere/i);
// «azul rey» del brief llega traducido, y ahora con el tono que el dataset sabe decir: `royal blue`, no el
// `blue` de la paleta de 26 palabras. Lo que prueba esta linea sigue siendo lo mismo —que el color del brief
// cruza al ingles— y la de abajo sigue exigiendo que no quede ni una palabra en español.
assert.match(languageV2, /in royal blue/i);
assert.match(languageV2, /recognizable event venue environment/i);
assert.doesNotMatch(languageV2, /quince|azul|club social|evento|corporativo|años|[áéíóúüñ¿¡]/i);
assert.deepEqual(findLoraPromptLanguageLeaks(languageV2), []);

const directQuincePrompt = compileLoraCaption({
  sceneSpec: languageScene,
  visualContext: buildVisualContext({ brief: { tipo_evento: "quinceañera", espacio: "club social" } }),
}).prompt;
assert.match(directQuincePrompt, /fifteenth-birthday celebration atmosphere/i);
assert.doesNotMatch(directQuincePrompt, /quinceañera|club social|[áéíóúüñ¿¡]/i);

const entrance = check({ spec: scene([element({ id: "ARCH_ENTRANCE", name: "Arco Orgánico", type: "arco", placement: "entrada", role: "focal" })]) });
assert.match(entrance.compilation.prompt, /framing the entrance doorway/i);
assert.doesNotMatch(entrance.compilation.prompt, /stage photo area/i);

const central = check({ spec: scene([element({ id: "ARCH_CENTER", name: "Arco Orgánico", type: "arco", placement: "arco_central", role: "focal" })]) });
assert.match(central.compilation.prompt, /centerpiece of the scene/i);
assert.doesNotMatch(central.compilation.prompt, /framing the entrance doorway/i);

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
assert.match(quince.compilation.prompt, /small balloon cluster centerpiece on the main table beneath the main arch/i);
assert.doesNotMatch(quince.compilation.prompt, /balloon installation/i);

const backdrop = check({ spec: scene([
  element({ id: "ARCH", name: "Arco", type: "arco", placement: "arco_central", role: "focal" }),
  element({ id: "BACK", name: "Cortina", type: "backdrop", placement: "fondo_pared", role: "soporte", colors: ["blanco"] }),
]) });
assert.match(backdrop.compilation.prompt, /decorated backdrop in white against the rear wall, behind the main arrangement/i);

const manyCenterpieces = check({
  spec: scene(Array.from({ length: 12 }, (_, index) => element({ id: `TABLE_${index + 1}`, name: "Acento Bajo", type: "centro_mesa", placement: "mesas_invitados", group: "guest-centerpieces", colors: ["dorado"] }))),
});
assert.match(manyCenterpieces.compilation.prompt, /twelve small balloon cluster centerpieces.*on the guest tables/i);

const ceiling = check({ spec: scene([element({ id: "CEILING", name: "Instalación superior", type: "kit", placement: "techo", role: "soporte", colors: ["plateado"] })]) });
assert.match(ceiling.compilation.prompt, /hanging from the ceiling/i);

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

// Regression: the Spanish-leak tokens and the diacritics class were stored as
// mojibake ("quinceaÃ±era", "[Ã¡Ã©...]"), so real accented Spanish text never
// matched and reached fal.ai untranslated.
const accentedLeaks = findLoraPromptLanguageLeaks("eventdecor_style_v2, a quinceañera arch for XV años in the jardín.");
assert.ok(accentedLeaks.includes("quinceañera"), `quinceañera must be detected: ${accentedLeaks.join(", ")}`);
assert.ok(accentedLeaks.includes("años"), `años must be detected: ${accentedLeaks.join(", ")}`);
assert.ok(accentedLeaks.includes("jardín"), `jardín must be detected: ${accentedLeaks.join(", ")}`);
assert.ok(accentedLeaks.includes("caracteres españoles"), "accented characters must be flagged on their own");
assert.deepEqual(findLoraPromptLanguageLeaks("eventdecor_style_v2, celebración"), ["caracteres españoles", "celebración"]);
assert.deepEqual(findLoraPromptLanguageLeaks("eventdecor_style_v2, ¿salón?"), ["caracteres españoles", "salón"]);
const leakScene = scene([element({ id: "LEAK", name: "Arco", type: "arco", placement: "arco_central", role: "focal" })]);
const leakCompilation = compileLoraCaption({ sceneSpec: leakScene, visualContext: buildVisualContext({ userRequest: "cumpleaños en salón" }) });
const leakReport = preflightLoraPrompt({ sceneSpec: leakScene, clauses: leakCompilation.clauses, prompt: `${leakCompilation.prompt} Quinceañera.` });
assert.equal(leakReport.ok, false);
assert.ok(leakReport.errors.some((error) => error.startsWith("texto español sin traducir") && error.includes("quinceañera")), leakReport.errors.join("; "));

// ---------------------------------------------------------------------------
// Una guirnalda es una TIRA, no un portal (decisión 28 de ADR-0032, revisada el 2026-10-03).
// ---------------------------------------------------------------------------
{
  // En el vocabulario de v004 un arco es "organic balloon garland arch". "an organic balloon garland ...
  // against the rear wall" es esa frase a una palabra y sin forma: el LoRA la cerró en un arco de pie con
  // dos patas. La ubicación tiene que decir que corre a lo largo, y la cola no puede prometer apoyos en el
  // suelo cuando la única pieza de la escena va colgada de la pared.
  const contexto = buildVisualContext({ userRequest: "cumpleanos en salon" });
  const muro = scene([element({ id: "GAR", name: "Guirnalda", type: "guirnalda", placement: "fondo_pared", role: "focal" })]);
  const caption = compileLoraCaption({ sceneSpec: muro, visualContext: contexto });
  assert.ok(caption.prompt.includes("running along the rear wall"), caption.prompt);
  assert.doesNotMatch(caption.prompt, /against the rear wall/, caption.prompt);
  assert.doesNotMatch(caption.prompt, /grounded supports|floor contact/, caption.prompt);

  // Con un arco en la escena los apoyos vuelven: los necesita el arco, no la guirnalda.
  const conArco = scene([
    element({ id: "GAR", name: "Guirnalda", type: "guirnalda", placement: "fondo_pared", role: "focal" }),
    element({ id: "ARCH", name: "Arco", type: "arco", placement: "arco_central", role: "focal" }),
  ]);
  assert.match(compileLoraCaption({ sceneSpec: conArco, visualContext: contexto }).prompt, /grounded supports|floor contact/);

  // En el piso la ubicación ya no se puede leer como un portal y no se toca.
  const piso = scene([element({ id: "GAR", name: "Guirnalda", type: "guirnalda", placement: "piso_frontal", role: "focal" })]);
  const enPiso = compileLoraCaption({ sceneSpec: piso, visualContext: contexto });
  assert.ok(enPiso.prompt.includes("resting on the floor in the foreground"), enPiso.prompt);
  assert.match(enPiso.prompt, /grounded supports|floor contact/, enPiso.prompt);

  // Y cuando el motor orgánico armó la pieza, su frase manda sobre la ubicación genérica: dice además la
  // curva, el desnivel y el racimo, que la ubicación no sabe. La escribe Python y entra tal cual.
  const delMotor = "mounted flat high on the wall, curving gently upward along the top, higher on the left and lower at the right end, both ends free, in clusters of four";
  const armada = compileLoraCaption({
    sceneSpec: muro,
    visualContext: contexto,
    colorPatterns: [{ estructura_id: "GAR", aplicado: true, prompt_gemini: "", prompt_lora: delMotor, guirnaldaOrganica: { enAlto: true } }],
  });
  assert.ok(armada.prompt.includes(delMotor), armada.prompt);
  assert.doesNotMatch(armada.prompt, /\barch(es)?\b|\blegs?\b|grounded supports/, armada.prompt);
  // Y la ubicación no repite el soporte: lo dijo la frase del motor, que sabe más.
  assert.doesNotMatch(armada.prompt, /running along the rear wall/, armada.prompt);
}

// ---------------------------------------------------------------------------
// El camino de respaldo del acabado no filtra nombres comerciales.
//
// `descriptor-perceptual.ts` declara `Reflex`, `Fashion`, `Silk`, `Pastel` y `Crystal` en
// `TERMINOS_COMERCIALES` como términos que nunca deben llegar al modelo de imagen, y su gate
// (`assertDescriptorPerceptualSeguro`) protege el camino principal: la etiqueta canónica del producto. Este
// compilador tiene OTRO camino, el de `FINISH_WORDS`, que corre cuando la pieza no trae etiqueta canónica, y
// por ahí no pasa ningún gate: el 2026-10-04 se le metieron `Reflex high-shine`, `matte Fashion` y `Silk
// satin` —las palabras del corpus de entrenamiento— y toda la suite siguió verde, porque nadie miraba.
// Esta es la mirada que faltaba.
{
  const todosLosAcabados = ["reflex", "fashion", "silk", "seda", "cristal", "transparente", "translucido", "neon", "pastel mate", "pastel dusk", "satin", "satinado", "mate", "perlado", "metalizado", "metal", "brillante", "reflectante", "reflectivo"];
  const conAcabados = scene([element({
    id: "ARCO_ACAB",
    name: "Arco de prueba",
    type: "arco",
    placement: "arco_central",
    role: "focal",
    colors: ["dorado"],
    finishes: todosLosAcabados,
  })]);
  const prompt = compileLoraCaption({ sceneSpec: conAcabados, visualContext: buildVisualContext({ userRequest: "cumpleaños" }) }).prompt;
  for (const termino of TERMINOS_COMERCIALES) {
    // `TERMINOS_COMERCIALES` lleva patrones ya escapados por su dueño; aquí solo se buscan como palabra.
    const palabra = new RegExp(`\\b${termino.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    assert.doesNotMatch(prompt, palabra, `el respaldo del acabado filtró el término comercial «${termino}»: ${prompt}`);
  }
  // Y lo que sí dice es lo mismo que dice el camino principal para ese acabado.
  assert.match(prompt, /mirror-like chrome/i, prompt);
}

console.log("LoRA caption compiler: OK");
