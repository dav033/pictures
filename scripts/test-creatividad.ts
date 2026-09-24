/**
 * Creativity calibration 0-5 (src/lib/ia/escena/creatividad.ts): one table read by
 * the chat, the plan validation and the LoRA generation.
 * Run: npx tsx --conditions=react-server scripts/test-creatividad.ts
 */
import assert from "node:assert/strict";
import { CREATIVIDAD_POR_DEFECTO, NIVELES_CREATIVIDAD, nivelCreatividadParaGenerar, parseNivelCreatividad, perfilCreatividad } from "../src/lib/ia/escena/creatividad";
import { abrirContextoPlan, crearTokenPlan, verificarTokenAprobacion } from "../src/lib/plan/aprobacion";
import { bloqueCreatividad, construirSistema } from "../src/lib/ia/omoikane/prompt-sistema";
import { ChatRequestV1Schema, parseChatRequestV1 } from "../src/lib/ia/contracts/chat-v1";
import { guidanceScaleSeguro } from "../src/lib/ia/kagutsuchi/sempertex-lora";
import { ReferenceBlueprintV2Schema } from "../src/lib/ia/referencia/reference-blueprint";
import { validarEstructurasFueraDeReferencia, validarRangoCreatividad } from "../src/lib/plan/restricciones";
import { PlanDecoracionSchema } from "../src/lib/plan/tipos";
import { compileLoraCaption } from "../src/lib/ia/kagutsuchi/lora-caption-compiler";
import { findLoraPromptLanguageLeaks } from "../src/lib/ia/kagutsuchi/lora-prompt-preflight";
import { buildVisualContext } from "../src/lib/ia/escena/visual-context";
import type { SceneSpec } from "../src/lib/ia/escena/scene-spec";

let casos = 0;
function ok(nombre: string): void {
  casos += 1;
  console.log(`ok ${casos} - ${nombre}`);
}

// 1. The default level is the behavior before the calibration existed.
const defecto = perfilCreatividad(undefined);
assert.equal(CREATIVIDAD_POR_DEFECTO, 2);
assert.equal(defecto.nivel, 2);
assert.equal(defecto.instruccionDiseno, "");
assert.equal(defecto.estructurasExtraConReferencia, 0);
assert.deepEqual(defecto.pistasPrompt, []);
assert.equal(defecto.guidanceScale, 3.5);
const base = { ragEnabled: true };
assert.equal(construirSistema({ ...base, creatividad: 2 }), construirSistema(base), "level 2 leaves the system prompt unchanged");
ok("el nivel 2 reproduce el comportamiento anterior");

// 2. The scale is monotonic: more creativity never means fewer freedoms.
for (const nivel of NIVELES_CREATIVIDAD.slice(1)) {
  const anterior = perfilCreatividad((nivel - 1) as typeof nivel);
  const actual = perfilCreatividad(nivel);
  assert.ok(actual.guidanceScale < anterior.guidanceScale, `guidance ${nivel}`);
  assert.ok(actual.estructurasExtraConReferencia >= anterior.estructurasExtraConReferencia, `extras ${nivel}`);
  assert.ok(actual.pistasPrompt.length >= anterior.pistasPrompt.length, `pistas ${nivel}`);
}
for (const nivel of NIVELES_CREATIVIDAD) {
  const perfil = perfilCreatividad(nivel);
  assert.equal(guidanceScaleSeguro(perfil.guidanceScale), perfil.guidanceScale, "every level is inside the accepted guidance range");
  for (const pista of perfil.pistasPrompt) assert.match(pista, /^[a-z][a-z ]+$/, "prompt cues are plain lowercase English");
  if (nivel >= 3) assert.match(perfil.instruccionDiseno, /solo productos que devuelva buscar_catalogo_rag/, "creative levels restate the commercial invariants");
}
ok("la escala es monótona y las pistas del prompt son inglés simple");

// 3. The chat receives the design rule of the chosen level.
assert.equal(bloqueCreatividad(2), "");
assert.match(bloqueCreatividad(0), /nivel 0 de 5 \(Fiel\)/);
assert.match(bloqueCreatividad(4), /nivel 4 de 5 \(Muy creativo\)[\s\S]*hasta 2 acentos/);
assert.match(construirSistema({ ...base, creatividad: 5 }), /CREATIVIDAD DEL DISEÑO: nivel 5 de 5/);
assert.doesNotMatch(construirSistema({ ...base, ragEnabled: false, creatividad: 5 }), /CREATIVIDAD DEL DISEÑO/, "without the catalog there is no plan to shape");
ok("el prompt del chat lleva la regla de diseño del nivel");

// 4. Untrusted input: the contract validates it and the routes fall back to the default.
assert.equal(parseChatRequestV1({ messages: [{ role: "user", content: "hola" }], creatividad: 4 }).creatividad, 4);
assert.equal(parseChatRequestV1({ messages: [{ role: "user", content: "hola" }] }).creatividad, undefined);
for (const invalido of [6, -1, 2.5, "3"]) {
  assert.equal(ChatRequestV1Schema.safeParse({ schema_version: "chat.v1", messages: [{ role: "user", content: "hola" }], brief: {}, creatividad: invalido }).success, false, String(invalido));
  assert.equal(parseNivelCreatividad(invalido), CREATIVIDAD_POR_DEFECTO);
}
assert.equal(guidanceScaleSeguro(undefined), 3.5);
assert.equal(guidanceScaleSeguro(99), 3.5);
ok("nivel inválido: el contrato del chat lo rechaza y generate usa el nivel por defecto");

// 5. Extra pieces beyond a reference photo follow the level.
const pieza = (id: string, name: string, x: number) => ({
  element_id: id, source_image_id: "REF_01", name, category: "balloon_structure",
  scene_role: "midground", detection_confidence: 0.9, visible_evidence: name,
  reference_bbox: { x, y: 0.1, width: 0.3, height: 0.8 }, depth_layer: 1,
  include_policy: "include", approved: true, source_type: "reference_only",
  quantity: { mode: "exact", min: 1, max: 1 },
  appearance: { observed_colors: ["azul"], resolved_colors: [], color_policy: "match_reference", material: "latex", shape: name, composition: "mixed" },
  relationships: [], uncertainties: [],
});
const blueprint = ReferenceBlueprintV2Schema.parse({
  schema_version: "2.0",
  source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"] }],
  elements: [pieza("REF_01_E01", "left balloon column", 0.05), pieza("REF_01_E02", "right balloon half arch", 0.6)],
  composition: { focal_point: "semiarco", density: "moderate", symmetry: "asymmetric", negative_space: [] },
  palette: { observed: ["azul"], priority: ["azul"] },
  unresolved_decisions: [],
});
const material = [{ product_id: "P-GLOBO", participacion: 1, rol_material: "principal" as const, color: "azul" }];
const estructura = (id: string, tipo: "semiarco" | "columna" | "guirnalda" | "centro_mesa", ubicacion: "lateral_derecho" | "lateral_izquierdo" | "piso_frontal" | "sobre_mesa_principal", medidas: Record<string, number>, referencia?: string) => ({
  estructura_id: id, nombre: id, tipo, rol_escena: referencia ? "focal" as const : "acento" as const, ubicacion, medidas, repeticiones: 1,
  densidad: "media" as const, mezcla: "organica_fina" as const, materiales: material, porque: "Prueba.", ...(referencia ? { referencia_element_id: referencia } : {}),
});
const plan = (extras: number) => PlanDecoracionSchema.parse({
  plan_version: "1.0",
  plan_id: "99999999-9999-4999-8999-999999999999",
  concepto: { titulo: "Prueba", descripcion: "Prueba.", paleta: ["azul"] },
  espacio: { tipo: "salón", fuente: "supuesto" },
  estructuras: [
    estructura("EST_01_SEMIARCO", "semiarco", "lateral_derecho", { ancho_m: 1.2, alto_m: 2.2 }, "REF_01_E02"),
    estructura("EST_02_COLUMNA", "columna", "lateral_izquierdo", { alto_m: 1.8 }, "REF_01_E01"),
    ...(extras >= 1 ? [estructura("EST_03_GUIRNALDA", "guirnalda", "piso_frontal", { largo_m: 1.5 })] : []),
    ...(extras >= 2 ? [estructura("EST_04_CENTRO", "centro_mesa", "sobre_mesa_principal", { ancho_m: 0.4, alto_m: 0.5 })] : []),
  ],
  supuestos: [],
});
const pedido = "Quiero esta decoración de la foto en azul.";
const extrasDe = (nivel: 0 | 2 | 3 | 5) => perfilCreatividad(nivel).estructurasExtraConReferencia;
assert.equal(validarEstructurasFueraDeReferencia(plan(1), blueprint, pedido, extrasDe(0)).length, 1, "fiel: no extra piece");
assert.equal(validarEstructurasFueraDeReferencia(plan(1), blueprint, pedido, extrasDe(2)).length, 1, "default: no extra piece");
assert.deepEqual(validarEstructurasFueraDeReferencia(plan(1), blueprint, pedido, extrasDe(3)), [], "creativo: one accent");
const excedido = validarEstructurasFueraDeReferencia(plan(2), blueprint, pedido, extrasDe(3));
assert.equal(excedido.length, 1, "creativo: two accents are too many");
assert.match(excedido[0]!, /hasta 1 pieza extra/);
assert.deepEqual(validarEstructurasFueraDeReferencia(plan(2), blueprint, pedido, extrasDe(5)), [], "libre: two accents");
ok("las piezas extra sobre la foto siguen el nivel de creatividad");

// 6. LoRA prompt: cues in the tail, first to go when compacting.
function elemento(id: string, name: string, type: "semiarco" | "columna", placement: "lateral_izquierdo" | "lateral_derecho", role: "focal" | "soporte"): SceneSpec["elements"][number] {
  return {
    element_id: id, name, category: "balloon_structure", source_type: "reference_only", required: true,
    quantity: { mode: "exact", min: 1, max: 1 }, target_bbox: { x: 0.1, y: 0.1, width: 0.4, height: 0.7 }, depth_layer: 10,
    resolved_colors: ["azul", "blanco"], visual_semantics: { structure_type: type, placement, design_role: role, repetition_group: id, density: "media" },
    identity_constraints: [], relationships: [],
  } as SceneSpec["elements"][number];
}
const escena = {
  schema_version: "1.0", generation_mode: "text_to_image", canvas: { aspect_ratio: "3:2", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
  venue: { preserve: [], protected_regions: [], editable_regions: [] },
  elements: [elemento("EST_01_SEMIARCO", "Semiarco", "semiarco", "lateral_derecho", "focal"), elemento("EST_02_COLUMNA", "Columna", "columna", "lateral_izquierdo", "soporte")],
  positive_prompt: { required_elements: [], composition: [], venue_preservation: [], photorealistic_integration: [] },
  negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
  metadata: { created_by: "server_default", plan_hash: "plan-test" },
} as SceneSpec;
const contexto = buildVisualContext({ userRequest: "cumpleaños en salón" });
const compilar = (nivel: 2 | 5, maxLength?: number) => compileLoraCaption({ sceneSpec: escena, visualContext: contexto, dialect: "scene_v004", creativeCues: perfilCreatividad(nivel).pistasPrompt, ...(maxLength ? { maxLength } : {}) });
const sinPistas = compileLoraCaption({ sceneSpec: escena, visualContext: contexto, dialect: "scene_v004" });
assert.equal(compilar(2).prompt, sinPistas.prompt, "level 2 prompt is unchanged");
const libre = compilar(5);
for (const pista of perfilCreatividad(5).pistasPrompt) assert.ok(libre.prompt.includes(pista), pista);
assert.ok(libre.prompt.length <= 750);
assert.deepEqual(findLoraPromptLanguageLeaks(libre.prompt), []);
assert.match(libre.jsonPrompt, /bold editorial composition/, "the JSON prompt carries the same cues");
const ajustado = compilar(5, sinPistas.prompt.length);
assert.doesNotMatch(ajustado.prompt, /rich layered styling|cinematic|editorial/, "cues are dropped before anything else when the budget is tight");
assert.match(ajustado.prompt, /column/);
assert.match(ajustado.prompt, /one-sided curved/);
ok("el prompt LoRA lleva las pistas del nivel y la compactación las descarta primero");

// 7. The signed plan records the level it was designed with; generation uses it
// instead of whatever the slider says now. Tokens issued before the field existed
// still open and fall back to the request value.
const tokenBase = { planHash: "a".repeat(64), requestId: "req-creatividad", backend: "next" as const, catalogSnapshotId: null, allowlist: [] };
const tokenNivel4 = crearTokenPlan({ ...tokenBase, creatividad: 4 });
assert.equal(abrirContextoPlan(tokenNivel4)?.creatividad, 4, "the token carries the plan level");
assert.ok(verificarTokenAprobacion(tokenNivel4, tokenBase.planHash), "the level does not break approval");
assert.equal(nivelCreatividadParaGenerar(abrirContextoPlan(tokenNivel4)?.creatividad, 0), 4, "the signed plan level wins over the slider");
const tokenAntiguo = crearTokenPlan(tokenBase);
assert.equal(abrirContextoPlan(tokenAntiguo)?.creatividad, null, "an old token has no level");
assert.equal(nivelCreatividadParaGenerar(abrirContextoPlan(tokenAntiguo)?.creatividad, 5), 5, "without a plan level the request value is used");
assert.equal(nivelCreatividadParaGenerar(null, "x"), CREATIVIDAD_POR_DEFECTO, "invalid request value falls back to the default");
assert.equal(nivelCreatividadParaGenerar(undefined, undefined), CREATIVIDAD_POR_DEFECTO);
ok("el plan firmado guarda el nivel y la imagen usa ese nivel");

// 8. Without a reference photo, the confirmed plan respects the structure range of
// the chosen level for any event type (regression: level 4 accepted 3 structures
// for a wedding). Level 2 keeps the historical rule (open events only), and a
// photo with balloons, a single piece, an explicit composition or an explicit
// budget still win over the range.
const boda = "Boda en jardín, blanco y verde";
const rango = (nivel: 0 | 1 | 2 | 3 | 4 | 5, planPrueba: ReturnType<typeof plan>, extra: { solicitud?: string; referencia?: typeof blueprint } = {}) =>
  validarRangoCreatividad(planPrueba, { nivel, solicitudOriginal: extra.solicitud ?? boda, hayCandidatosCatalogo: true, referenceBlueprint: extra.referencia });
const pocas = rango(4, plan(1));
assert.equal(pocas.length, 1, "level 4 rejects 3 structures");
assert.match(pocas[0]!, /entre 4 y 7/);
assert.deepEqual(rango(4, plan(2)), [], "level 4 accepts 4 structures");
assert.match(rango(0, plan(2))[0] ?? "", /entre 1 y 3[\s\S]*más de tres/, "level 0 rejects more than 3 structures");
assert.deepEqual(rango(2, plan(0)), [], "level 2 keeps the historical behavior outside open events");
assert.deepEqual(rango(4, plan(1), { referencia: blueprint }), [], "with a reference photo the photo decides");
assert.deepEqual(rango(0, plan(2), { referencia: blueprint }), [], "with a reference photo the photo decides the maximum too: Fiel keeps every piece of the photo (extras are validarEstructurasFueraDeReferencia's job)");
assert.deepEqual(rango(4, plan(1), { solicitud: "Boda en jardín, solo un arco blanco" }), [], "a single piece is not padded");
const conTecho = PlanDecoracionSchema.parse({ ...plan(0), restricciones: { presupuesto: { techo_cop: 90000, procedencia: "explicito", texto_original: "hasta 90 mil" }, estructuras: [], colores: [], tamanos: [], acabados: [] } });
assert.deepEqual(rango(5, conTecho), [], "an explicit budget decides how many pieces fit");
assert.equal(validarRangoCreatividad(plan(1), { nivel: 4, solicitudOriginal: boda, hayCandidatosCatalogo: false }).length, 0, "without catalog candidates there is nothing to design");
ok("el plan sin foto respeta el rango de estructuras del nivel");

console.log(`\n${casos} casos OK (creatividad 0-5)`);
