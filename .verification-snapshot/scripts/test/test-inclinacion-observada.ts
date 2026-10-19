/**
 * «La foto muestra la pieza recta» es un dato, no una ausencia (2026-10-05, CASE-001 de images-judge).
 *
 * - El defecto: el análisis contestaba `top_overhang: none` para una columna orgánica asimétrica, `inclina` valía 0 y
 *   dos filtros (`analizar-referencias-v2.ts`, `pistasInclinacionDelPlan`) descartaban el 0 por considerarlo «el valor de
 *   partida del motor». Pero el motor de la columna asimétrica NO arranca recto: sin pista usa su plantilla inclinada
 *   (`armado_estructura.py`, 25 % del alto). La columna recta salía inclinada.
 * - La regla: solo es «recta observada» cuando el modelo contestó `top_overhang: none`. Un 0 por falta de dirección
 *   (vuelo leve sin lado, pieza que no es vertical) sigue siendo «sin dato».
 * - El 0 solo viaja al motor para columnas; en las demás piezas no hay una plantilla inclinada que contradecir.
 * - Una pareja en espejo que la foto mostró recta en las dos sigue recta.
 *
 * Determinista y sin red. Run: npx tsx --conditions=react-server scripts/test/test-inclinacion-observada.ts
 */
import assert from "node:assert/strict";
import { configurarPersistenciaTelemetria } from "@sempertex/agente-core";
import { pistasInclinacionDelPlan } from "@/lib/ia/herramientas/registro-herramientas";
import { unificarPiezasEspejo } from "@/lib/ia/referencia/piezas-espejo";
import { ReferenceBlueprintV2Schema, type ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import { inclinacionObservada, parseDetectedStructure } from "@/lib/ia/referencia/reference-structure";
import type { PlanDecoracion } from "@/lib/plan/tipos";

configurarPersistenciaTelemetria(undefined);

type Elemento = ReferenceBlueprintV2["elements"][number];

// --- 1. La regla: qué cuenta como «la foto lo dijo» ---------------------------------------------------------

const recta = parseDetectedStructure({ structure_type: "column", top_overhang: "none", curves_toward: "none" });
assert.equal(recta?.type, "column");
assert.equal(inclinacionObservada(recta), 0, "top_overhang none = recta observada, viaja como 0");

const levesinLado = parseDetectedStructure({ structure_type: "column", top_overhang: "slight", curves_toward: "none" });
assert.equal(levesinLado?.inclina, 0, "un vuelo leve sin lado no da inclinación...");
assert.equal(inclinacionObservada(levesinLado), undefined, "...y tampoco es «recta observada»: sigue siendo sin dato");

const leveConLado = parseDetectedStructure({ structure_type: "column", top_overhang: "slight", curves_toward: "right" });
assert.equal(inclinacionObservada(leveConLado), 0.22, "un vuelo leve con lado conserva su valor");

const fuerteIzquierda = parseDetectedStructure({ structure_type: "half_arch", top_overhang: "strong", curves_toward: "left" });
assert.equal(inclinacionObservada(fuerteIzquierda), -0.45);

const arcoSinVuelo = parseDetectedStructure({ structure_type: "arch", curves_toward: "none" });
assert.equal(arcoSinVuelo?.inclina, 0);
assert.equal(inclinacionObservada(arcoSinVuelo), undefined, "una pieza no vertical no responde `top_overhang`: sin dato, no recta");

assert.equal(inclinacionObservada(undefined), undefined);

// --- 2. El 0 viaja al motor solo para columnas --------------------------------------------------------------

function elemento(id: string, tipo: "columna" | "semiarco" | "guirnalda", inclinacion: number | undefined, ubicacion: "lateral_izquierdo" | "lateral_derecho" = "lateral_izquierdo"): Elemento {
  return {
    element_id: id, source_image_id: "REF_01", name: "Organic balloon piece", category: "balloon_structure",
    scene_role: "midground", detection_confidence: 0.9, visible_evidence: "organic balloon piece",
    reference_bbox: { x: ubicacion === "lateral_izquierdo" ? 0.05 : 0.6, y: 0.05, width: 0.3, height: 0.8 }, depth_layer: 2,
    include_policy: "include", approved: true, source_type: "reference_only", quantity: { mode: "exact", min: 1, max: 1 },
    appearance: { observed_colors: ["gold"], resolved_colors: [], color_policy: "adapt_to_event_palette", material: "latex", shape: "tall dense asymmetrical column", composition: "single uniform material", ...(inclinacion === undefined ? {} : { inclinacion }) },
    relationships: [], uncertainties: [],
    visual_semantics: { structure_type: tipo, placement: ubicacion, design_role: "focal", repetition_group: id, density: "lujosa" },
    model_decision: { action: "include", match_type: "none", reason: "relevante", adaptation: "sin catalogo en este modo" },
  } as Elemento;
}

function blueprint(elementos: Elemento[]): ReferenceBlueprintV2 {
  return ReferenceBlueprintV2Schema.parse({
    schema_version: "2.0",
    source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"] }],
    elements: elementos,
    composition: { focal_point: "column", density: "dense", symmetry: "asymmetric", negative_space: [] },
    palette: { observed: ["gold"], priority: [] },
    unresolved_decisions: [],
  });
}

/** Solo lo que `pistasInclinacionDelPlan` lee del plan: el tipo y el elemento de la foto que cada estructura cubre. */
function plan(...estructuras: Array<{ tipo: "columna" | "semiarco" | "guirnalda"; referencia_element_id: string }>): Pick<PlanDecoracion, "estructuras"> {
  return { estructuras } as unknown as Pick<PlanDecoracion, "estructuras">;
}

const rectaEnColumna = pistasInclinacionDelPlan(plan({ tipo: "columna", referencia_element_id: "E1" }), blueprint([elemento("E1", "columna", 0)]));
assert.deepEqual(rectaEnColumna, [{ referencia_element_id: "E1", inclinacion: 0 }], "la columna que la foto muestra recta viaja como 0");

const rectaEnSemiarco = pistasInclinacionDelPlan(plan({ tipo: "semiarco", referencia_element_id: "E1" }), blueprint([elemento("E1", "semiarco", 0)]));
assert.deepEqual(rectaEnSemiarco, [], "un 0 en un semiarco no viaja: su forma no arranca inclinada por plantilla de la columna");

const rectaEnGuirnalda = pistasInclinacionDelPlan(plan({ tipo: "guirnalda", referencia_element_id: "E1" }), blueprint([elemento("E1", "guirnalda", 0)]));
assert.deepEqual(rectaEnGuirnalda, [], "un 0 en una guirnalda no viaja");

const sinDato = pistasInclinacionDelPlan(plan({ tipo: "columna", referencia_element_id: "E1" }), blueprint([elemento("E1", "columna", undefined)]));
assert.deepEqual(sinDato, [], "sin dato no viaja nada: el motor decide con su plantilla");

const inclinada = pistasInclinacionDelPlan(plan({ tipo: "semiarco", referencia_element_id: "E1" }), blueprint([elemento("E1", "semiarco", -0.45)]));
assert.deepEqual(inclinada, [{ referencia_element_id: "E1", inclinacion: -0.45 }], "una inclinación distinta de 0 sigue viajando en cualquier pieza");

// --- 3. Una pareja en espejo recta sigue recta --------------------------------------------------------------

const pareja = unificarPiezasEspejo(blueprint([elemento("E1", "columna", 0, "lateral_izquierdo"), elemento("E2", "columna", 0, "lateral_derecho")]));
const e1 = pareja.elements.find((e) => e.element_id === "E1")!;
const e2 = pareja.elements.find((e) => e.element_id === "E2")!;
assert.equal(e1.visual_semantics?.repetition_group, e2.visual_semantics?.repetition_group, "son una pareja en espejo");
assert.equal(e1.appearance.inclinacion, 0, "la pareja recta conserva el 0 observado (izquierda)");
assert.equal(e2.appearance.inclinacion, 0, "la pareja recta conserva el 0 observado (derecha)");

const parejaSinDato = unificarPiezasEspejo(blueprint([elemento("E1", "columna", undefined, "lateral_izquierdo"), elemento("E2", "columna", undefined, "lateral_derecho")]));
assert.equal(parejaSinDato.elements.find((e) => e.element_id === "E1")!.appearance.inclinacion, undefined, "sin dato en las dos no se inventa un 0");

const parejaInclinada = unificarPiezasEspejo(blueprint([elemento("E1", "columna", 0.22, "lateral_izquierdo"), elemento("E2", "columna", -0.22, "lateral_derecho")]));
assert.equal(parejaInclinada.elements.find((e) => e.element_id === "E1")!.appearance.inclinacion, 0.22, "la pareja inclinada se comporta como antes");

console.log("test-inclinacion-observada: OK");
