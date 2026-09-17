import assert from "node:assert/strict";
import { ReferenceBlueprintV2Schema } from "@/lib/ia/reference-blueprint";
import { applySceneryVisibility, sceneryFromReference } from "@/lib/ia/reference-structure";
import { buildApprovedSceneSpec, sceneSpecHash, type SceneryElement, type SceneSpec } from "@/lib/ia/scene-spec";
import { buildImagePrompt } from "@/lib/ia/build-image-prompt";
import { escenografiaCliente } from "@/lib/plan/presentacion-cliente";

/**
 * FRONTERA PLAN / ESCENOGRAFÍA.
 *
 * El plan es el único dueño de lo que se construye y se cobra. La escenografía
 * es lo que se conserva de la foto del cliente: entra en el prompt, lleva
 * caja, el cliente la enciende o la apaga, y NUNCA toca cotización, materiales,
 * `plan_hash` ni el plan. No se vende, no se cotiza, no se compra.
 *
 * Este test fija los cuatro cerrojos de esa frontera:
 *  1. La escenografía NO aparece en `negative_prompt.forbidden_elements` (antes
 *     un banco detectado se traducía en "no dibujes un banco").
 *  2. La escenografía llega al prompt como contexto a conservar, con su sitio.
 *  3. Apagarla la saca del prompt, y `catalogOnly` sigue cerrado para un
 *     elemento del plan sin producto de catálogo.
 *  4. Encenderla o apagarla no cambia los elementos de la escena, el estimado
 *     de materiales, `plan_hash` ni `sceneSpecHash`.
 *
 * Determinista y sin red: las dos entradas (el análisis de la foto y el
 * blueprint del plan) son fixtures declarados aquí; el sujeto son la selección
 * de escenografía, el `SceneSpec` y el prompt.
 * Run: npx tsx --conditions=react-server scripts/test-escenografia-referencia.ts
 */

let casos = 0;
function ok(nombre: string): void {
  casos += 1;
  console.log(`ok ${casos} - ${nombre}`);
}

function elementoReferencia(
  elementId: string,
  name: string,
  category: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    element_id: elementId,
    source_image_id: "REF_01",
    name,
    category,
    scene_role: "midground",
    detection_confidence: 0.85,
    visible_evidence: "visible en la foto",
    reference_bbox: { x: 0.1, y: 0.5, width: 0.2, height: 0.3 },
    depth_layer: 4,
    include_policy: "include",
    approved: true,
    source_type: "reference_only",
    quantity: { mode: "approximate", min: 1, max: 1 },
    appearance: { observed_colors: ["white"], resolved_colors: [], color_policy: "adapt_to_event_palette", material: "wood", shape: "bench", composition: "single uniform material" },
    relationships: [],
    uncertainties: [],
    ...extra,
  };
}

const referencia = ReferenceBlueprintV2Schema.parse({
  schema_version: "2.0",
  source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"] }],
  elements: [
    elementoReferencia("REF_01_E01", "right balloon half arch", "balloon_structure", {
      visual_semantics: { structure_type: "semiarco", placement: "lateral_derecho", design_role: "focal", repetition_group: "REF_01_E01", density: "media" },
    }),
    elementoReferencia("REF_01_E02", "wooden bench", "furniture"),
    elementoReferencia("REF_01_E03", "white roses", "floral", { reference_bbox: { x: 0.7, y: 0.6, width: 0.2, height: 0.2 } }),
    elementoReferencia("REF_01_E04", "warm string lights", "lighting", { reference_bbox: { x: 0.05, y: 0.05, width: 0.9, height: 0.2 } }),
    // Un letrero nunca entra: el modelo de imagen inventaría tipografía.
    elementoReferencia("REF_01_E05", "welcome sign with printed text", "signage"),
    // Poca confianza: el análisis no lo vio con claridad.
    elementoReferencia("REF_01_E06", "faint candle", "tableware", { detection_confidence: 0.4 }),
  ],
  composition: { focal_point: "half arch", density: "dense", symmetry: "asymmetric", negative_space: [] },
  palette: { observed: ["white"], priority: [] },
  unresolved_decisions: [],
});

// El semiarco de la foto lo materializa el plan: no puede volver a entrar como
// escenografía y dibujarse dos veces.
const MATERIALIZADOS = new Set(["REF_01_E01"]);

// 1. Selección: solo lo que el catálogo no vende, con nombre renderizable.
{
const escenografia = sceneryFromReference(referencia, MATERIALIZADOS);
  // Orden de la selección: por confianza de detección y después por tamaño en
  // la foto, para que el recorte a `SCENERY_LIMIT` deje lo más visible.
  assert.deepEqual(escenografia.map((item) => item.elementId), ["REF_01_E04", "REF_01_E02", "REF_01_E03"]);
  assert.deepEqual(escenografia.map((item) => item.name), ["warm string lights", "wooden bench", "white roses"]);
  assert.ok(escenografia.every((item) => item.visibleByDefault), "lo que el análisis dejó como relevante llega encendido");
  assert.ok(escenografia.every((item) => item.bbox.width > 0 && item.bbox.height > 0), "cada pieza de escenografía lleva su caja");
  // Ni la estructura de globos del plan, ni el letrero, ni la detección floja.
  for (const fuera of ["REF_01_E01", "REF_01_E05", "REF_01_E06"]) {
    assert.ok(!escenografia.some((item) => item.elementId === fuera), `${fuera} no es escenografía`);
  }
  ok("escenografía: mobiliario, flores y luces de la foto; nunca estructuras del plan, letreros ni detecciones flojas");
}

// Con foto del espacio la escenografía se conserva, pero un objeto que el plan ya
// materializa sigue fuera antes de aplicar los chips de visibilidad.
{
  const materializadosConEscenografia = new Set([...MATERIALIZADOS, "REF_01_E02"]);
  const escenografiaConVenue = sceneryFromReference(referencia, materializadosConEscenografia);
  const visibleConVenue = applySceneryVisibility(escenografiaConVenue, undefined);
  assert.deepEqual(visibleConVenue.map((item) => item.elementId), ["REF_01_E04", "REF_01_E03"]);
  assert.ok(visibleConVenue.every((item) => item.visible), "la escenografía superviviente llega visible con venue");
  assert.ok(!visibleConVenue.some((item) => item.elementId === "REF_01_E02"), "un objeto de escenografía materializado por el plan no se duplica");
  ok("venue re-admite escenografía y materializedReferenceIds mantiene fuera lo que construye el plan");
}

// 2. Interruptor del cliente y chips en español.
{
  const chips = escenografiaCliente(referencia, MATERIALIZADOS);
  assert.deepEqual(chips.map((chip) => chip.etiqueta), ["Mobiliario", "Flores", "Luces"]);
  assert.deepEqual(chips.map((chip) => chip.elementIds), [["REF_01_E02"], ["REF_01_E03"], ["REF_01_E04"]]);
  assert.ok(chips.every((chip) => chip.visiblePorDefecto), "el valor por defecto llega encendido");

  const apagado = applySceneryVisibility(sceneryFromReference(referencia, MATERIALIZADOS), new Map([["REF_01_E02", false]]));
  assert.deepEqual(apagado.map((item) => [item.elementId, item.visible]), [["REF_01_E04", true], ["REF_01_E02", false], ["REF_01_E03", true]]);
  // El cliente solo enciende o apaga lo ya seleccionado: un id desconocido no añade nada.
  const inventado = applySceneryVisibility(sceneryFromReference(referencia, MATERIALIZADOS), new Map([["REF_01_E99", true]]));
  assert.equal(inventado.length, 3);
  ok("interruptor: chips por categoría en español; un id desconocido nunca añade un elemento");
}

const escenografiaParaEscena: SceneryElement[] = sceneryFromReference(referencia, MATERIALIZADOS).map((item) => ({
  element_id: item.elementId,
  name: item.name,
  category: item.category,
  target_bbox: item.bbox,
  depth_layer: item.depthLayer,
}));

/** Blueprint del plan aprobado: una estructura declarada con su producto real. */
const PLAN_HASH = "plan-hash-escenografia";
const blueprint = ReferenceBlueprintV2Schema.parse({
  schema_version: "2.0",
  source_images: [{ image_id: "PLAN", approved_roles: ["element_reference"] }],
  elements: [{
    element_id: "EST_01_SEMIARCO",
    source_image_id: "PLAN",
    name: "Semiarco asimétrico",
    category: "balloon_structure",
    scene_role: "midground",
    detection_confidence: 1,
    visible_evidence: "Estructura declarada en el plan aprobado.",
    reference_bbox: { x: 0.55, y: 0.15, width: 0.35, height: 0.7 },
    depth_layer: 10,
    include_policy: "include",
    approved: true,
    source_type: "catalog_backed",
    quantity: { mode: "exact", min: 40, max: 40 },
    appearance: { observed_colors: ["blanco"], resolved_colors: ["blanco"], color_policy: "match_reference", material: "látex", shape: "semiarco asimétrico", composition: "single uniform material" },
    relationships: [],
    uncertainties: [],
    visual_semantics: { structure_type: "semiarco", placement: "lateral_derecho", design_role: "focal", repetition_group: "EST_01_SEMIARCO", density: "media" },
    model_decision: { action: "include", catalog_product_id: "V-BLANCO-R12", match_type: "exact", reason: "Producto del plan.", adaptation: "Usar este producto exacto." },
  }],
  composition: { focal_point: "semiarco derecho", density: "moderate", symmetry: "asymmetric", negative_space: [] },
  palette: { observed: ["blanco"], priority: ["blanco"] },
  unresolved_decisions: [],
});

function escenaCon(scenography: readonly SceneryElement[]): SceneSpec {
  return buildApprovedSceneSpec({
    blueprint,
    aspectRatio: "3:2",
    targetBoxes: { EST_01_SEMIARCO: { x: 0.55, y: 0.15, width: 0.35, height: 0.7 } },
    catalogProducts: {
      EST_01_SEMIARCO: [{ id: "V-BLANCO-R12", name: "Globo Latex Redondo Blanco", description: "Globo látex blanco R-12.", category: "balloon", colors: ["blanco"], installedUnits: 40, share: 1, role: "material principal" }],
    },
    generationMode: "text_to_image",
    createdBy: "server_default",
    planHash: PLAN_HASH,
    catalogOnly: true,
    scenography,
  });
}

const sinEscenografia = escenaCon([]);
const conEscenografia = escenaCon(escenografiaParaEscena);

// 3. La escenografía no toca la cotización, los materiales, el plan ni la escena aprobada.
{
  assert.deepEqual(
    conEscenografia.elements.map((element) => element.element_id),
    sinEscenografia.elements.map((element) => element.element_id),
    "la escenografía nunca se convierte en un elemento del plan",
  );
  assert.deepEqual(
    conEscenografia.elements.map((element) => element.catalog_product_ids ?? [element.catalog_product_id]),
    sinEscenografia.elements.map((element) => element.catalog_product_ids ?? [element.catalog_product_id]),
    "los productos que se cotizan y se compran son exactamente los mismos",
  );
  assert.deepEqual(conEscenografia.material_estimate, sinEscenografia.material_estimate, "el estimado de materiales no cambia");
  assert.equal(conEscenografia.metadata.plan_hash, PLAN_HASH);
  assert.equal(conEscenografia.metadata.plan_hash, sinEscenografia.metadata.plan_hash, "encender escenografía no cambia plan_hash");
  // La escenografía no entra en el registro de escena aprobado: ninguna pieza
  // suya aparece en el SceneSpec, y lo único que cambia entre las dos escenas
  // es el texto del prompt (la excepción a las prohibiciones generales). Los
  // elementos, el estimado, el lugar y los metadatos son idénticos, así que no
  // puede mover la geometría auditada ni el QA de instancias.
  const sinTextos = ({ positive_prompt: _p, negative_prompt: _n, ...resto }: SceneSpec) => resto;
  assert.deepEqual(sinTextos(conEscenografia), sinTextos(sinEscenografia), "la escenografía solo cambia texto del prompt");
  const serializada = JSON.stringify(conEscenografia);
  for (const item of escenografiaParaEscena) {
    assert.ok(!serializada.includes(item.element_id), `${item.element_id} no puede aparecer en el SceneSpec`);
    assert.ok(!serializada.includes(item.name), `"${item.name}" no puede aparecer en el SceneSpec`);
  }
  assert.notEqual(sceneSpecHash(conEscenografia), sceneSpecHash(sinEscenografia), "el prompt sí cambia: el hash de escena lo refleja");
  const ids = new Set(conEscenografia.elements.map((element) => element.element_id));
  for (const item of escenografiaParaEscena) assert.ok(!ids.has(item.element_id), `${item.element_id} no puede ser un elemento cotizable`);
  ok("la escenografía no entra en cotización, materiales, plan_hash ni en el registro de escena aprobado");
}

// 4. Cerrojo 3: nunca en el prompt negativo.
{
  const prohibidos = conEscenografia.negative_prompt.forbidden_elements.join(" | ").toLowerCase();
  for (const item of escenografiaParaEscena) {
    assert.ok(!prohibidos.includes(item.name), `"${item.name}" no puede ir en forbidden_elements: ${prohibidos}`);
  }
  // Y la prohibición general deja de contradecir lo que el cliente conserva.
  assert.ok(
    conEscenografia.negative_prompt.forbidden_elements.some((texto) => /preserved scene context/i.test(texto)),
    "la prohibición general abre la excepción de la escenografía",
  );
  assert.ok(
    !sinEscenografia.negative_prompt.forbidden_elements.some((texto) => /preserved scene context/i.test(texto)),
    "sin escenografía no se abre ninguna excepción",
  );
  ok("cerrojo 3: la escenografía detectada deja de ir al prompt negativo");
}

// 5. Cerrojo 1 y 2: llega al prompt como contexto a conservar, con su sitio; apagarla la saca.
{
  const promptCon = buildImagePrompt({ sceneSpec: conEscenografia, scenography: escenografiaParaEscena });
  const promptSin = buildImagePrompt({ sceneSpec: sinEscenografia, scenography: [] });
  assert.match(promptCon, /PRESERVED SCENE CONTEXT/);
  for (const item of escenografiaParaEscena) assert.ok(promptCon.includes(item.name), `falta "${item.name}" en el prompt`);
  assert.match(promptCon, /wooden bench \(middle left area of the composition\)/, "cada pieza llega con su sitio, derivado de su caja");
  assert.match(promptCon, /white roses \(lower right area of the composition\)/);
  assert.match(promptCon, /warm string lights \(upper center area of the composition\)/);
  assert.doesNotMatch(promptSin, /PRESERVED SCENE CONTEXT/);
  for (const item of escenografiaParaEscena) assert.ok(!promptSin.includes(item.name), `"${item.name}" no debería estar sin escenografía`);

  // Apagar el banco lo saca del prompt y deja el resto.
  const sinBanco = escenografiaParaEscena.filter((item) => item.element_id !== "REF_01_E02");
  const promptSinBanco = buildImagePrompt({ sceneSpec: escenaCon(sinBanco), scenography: sinBanco });
  assert.ok(!promptSinBanco.includes("wooden bench"), "apagar el chip saca su elemento del prompt");
  assert.ok(promptSinBanco.includes("white roses") && promptSinBanco.includes("warm string lights"), "los demás siguen");
  ok("cerrojos 1 y 2: la escenografía entra al prompt con su caja y apagarla la saca");
}

// 6. La puerta que protege de productos inventados sigue cerrada.
{
  const conReferenceOnly = {
    ...blueprint,
    elements: [
      ...blueprint.elements,
      {
        ...blueprint.elements[0]!,
        element_id: "EST_INVENTADA",
        name: "Estructura sin producto de catálogo",
        source_type: "reference_only" as const,
        model_decision: undefined,
        relationships: [],
      },
    ],
  };
  assert.throws(
    () => buildApprovedSceneSpec({
      blueprint: conReferenceOnly,
      aspectRatio: "3:2",
      targetBoxes: Object.fromEntries(conReferenceOnly.elements.map((element) => [element.element_id, { x: 0.1, y: 0.1, width: 0.3, height: 0.3 }])),
      catalogProducts: {
        EST_01_SEMIARCO: [{ id: "V-BLANCO-R12", name: "Globo Latex Redondo Blanco", description: "Globo látex blanco R-12.", category: "balloon", colors: ["blanco"], installedUnits: 40, share: 1, role: "material principal" }],
      },
      catalogOnly: true,
      scenography: escenografiaParaEscena,
    }),
    /Reference-only element cannot enter image generation/,
    "un elemento del plan sin producto de catálogo sigue fallando, con o sin escenografía",
  );
  ok("catalogOnly sigue cerrado: la escenografía no abre la puerta a productos inventados");
}

console.log(`\n${casos} casos OK (frontera plan / escenografía)`);
