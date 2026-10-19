/**
 * La lectura de la foto de referencia (pedido 3 del dueño, 2026-10-06: «el agente que lee la imagen está
 * horriblemente configurado»). Determinista, sin red ni proveedor.
 *
 * - La ruta lee con v20 (v18 + reglas de color) y la herramienta pide TODOS los colores con su acabado; v16-v19 no
 *   cambian.
 * - El lector no hereda la configuración del chat: modelo fijo, el mismo que manda a Python.
 * - Un «light grey» que la disposición de la misma pieza lee blanco es blanco (`colores-lectura.ts`).
 * - Del cuarto tono en adelante entra el que la disposición pone en la pieza aunque los píxeles no lo separen.
 * - Una parte medida nunca pasa de 1 (rompía el esquema del blueprint y las dos vistas tiraban la lectura).
 * - La normalización resume lo que descarta para la auditoría.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-lectura-foto-config.ts
 */
import assert from "node:assert/strict";
import { configurarPersistenciaTelemetria } from "@sempertex/agente-core";
import { analysisConfigHash, resumenNormalizacion, sistemaAnalisis } from "@/lib/ia/amaterasu/analizar-referencias-v2";
import { MODELO_LECTURA_FOTO } from "@/lib/ia/amaterasu/config-lectura-foto";
import { reconciliarColoresLectura } from "@/lib/ia/referencia/colores-lectura";
import { parseCandidates } from "@/lib/ia/referencia/candidatos-referencia";
import { STRUCTURE_RULES_V20_COLORES, VARIANTE_RUTA_ANALISIS, VARIANTE_V18_CANDIDATA, VARIANTE_V20_COLORES } from "@/lib/ia/referencia/reference-structure";
import type { ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import { coloresDominantesReferencia, coloresNombradosReferencia } from "@/lib/plan/colores-referencia";
import { referenciasDePieza } from "@/lib/plan/referencias-medidas";
import type { AnalisisColorSempertex } from "@/lib/plan/analisis-color";

configurarPersistenciaTelemetria(undefined);

// 1. La ruta lee con v20 y su prompt lleva las reglas de color; la configuración del lector entra en el hash.
assert.equal(VARIANTE_RUTA_ANALISIS, VARIANTE_V20_COLORES);
const v20 = sistemaAnalisis([], "perceptual", VARIANTE_V20_COLORES);
assert.ok(v20.inventorySystem.endsWith(STRUCTURE_RULES_V20_COLORES));
for (const regla of ["EVERY balloon color", "always with its finish", "clear with gold confetti", "not of the light on it", "ceiling_installation"]) {
  assert.ok(STRUCTURE_RULES_V20_COLORES.includes(regla), `falta la regla «${regla}»`);
}
const hash = (variante: typeof VARIANTE_V20_COLORES) => analysisConfigHash({ model: MODELO_LECTURA_FOTO, thinkingLevel: "default", mode: "perceptual", systemPromptHash: sistemaAnalisis([], "perceptual", variante).systemPromptHash, variante });
assert.notEqual(hash(VARIANTE_V20_COLORES), hash(VARIANTE_V18_CANDIDATA), "v20 cambia prompt y herramienta: otro hash de configuración");
assert.equal(MODELO_LECTURA_FOTO, "gemini-3.6-flash", "el mismo modelo que DEFAULT_MODEL de services/ai-api/app/amaterasu/turno.py");
console.log("[PASS] la ruta lee con v20: todos los colores, acabado siempre, transparentes con su relleno");

// 2. Gris claro de las etiquetas que la disposición lee blanco.
type Elemento = ReferenceBlueprintV2["elements"][number];
const pieza = (id: string, etiquetas: string[], disposicion?: { colores: string[]; motas?: string[] }): Elemento => ({
  element_id: id, source_image_id: "REF_01", name: id, category: "balloon_structure", scene_role: "midground", detection_confidence: 0.9,
  visible_evidence: "pieza", reference_bbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.8 }, depth_layer: 1, include_policy: "include", approved: true,
  source_type: "reference_only", quantity: { mode: "exact", min: 1, max: 1 }, quantity_semantics: "physical_instances",
  appearance: { observed_colors: etiquetas, resolved_colors: [], color_policy: "adapt_to_event_palette", material: "latex", shape: "columna", composition: "mixta", ...(disposicion ? { patron_color: { modo: "aleatorio", confianza: 0.9, ...disposicion } } : {}) },
  relationships: [], uncertainties: [],
} as unknown as Elemento);
const blueprint = (elementos: Elemento[]) => ({
  schema_version: "2.0", source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"] }], elements: elementos,
  composition: { focal_point: "globos", density: "moderate", symmetry: "unknown", negative_space: [] }, palette: { observed: [], priority: [] }, unresolved_decisions: [],
} as unknown as ReferenceBlueprintV2);

const ej01 = reconciliarColoresLectura(blueprint([pieza("E1", ["matte pastel pink", "chrome silver", "matte light grey", "clear"], { colores: ["rosado", "plateado", "blanco"], motas: ["transparente"] })]));
assert.deepEqual(ej01.blueprint.elements[0]!.appearance.observed_colors, ["matte pastel pink", "chrome silver", "matte white", "clear"]);
assert.deepEqual(ej01.cambios, [{ element_id: "E1", antes: "matte light grey", despues: "matte white" }]);
assert.deepEqual(coloresDominantesReferencia(ej01.blueprint.elements[0]!.appearance), ["rosado", "plateado", "blanco", "transparente"]);
const conBlanco = blueprint([pieza("E1", ["pearl white", "pearl light grey"], { colores: ["blanco"] })]);
assert.equal(reconciliarColoresLectura(conBlanco).blueprint, conBlanco, "con una etiqueta blanca, el gris claro es otro globo");
const sinBlanco = blueprint([pieza("E1", ["matte light grey"], { colores: ["plateado"] })]);
assert.equal(reconciliarColoresLectura(sinBlanco).blueprint, sinBlanco, "sin blanco en la disposición no se toca");
const oscuro = blueprint([pieza("E1", ["matte dark grey", "matte grey"], { colores: ["blanco"] })]);
assert.equal(reconciliarColoresLectura(oscuro).blueprint, oscuro, "solo grises claros");
console.log("[PASS] un gris claro que la disposición lee blanco es blanco; un gris real se queda");

// 3. Del cuarto tono en adelante: medido (>= 3 %) o puesto en la pieza por la disposición.
const coral = { observed_colors: ["matte coral red", "chrome silver", "matte pastel pink", "matte white"], measured_colors: [{ color: "coral", share: 0.09 }, { color: "plateado", share: 0.08 }] };
assert.deepEqual(coloresDominantesReferencia(coral), ["coral", "plateado", "rosado"], "sin disposición, el blanco que los píxeles no separan queda fuera");
assert.deepEqual(coloresDominantesReferencia({ ...coral, patron_color: { colores: ["rosado", "blanco", "coral"], motas: ["plateado"] } }), ["coral", "plateado", "rosado", "blanco"], "la disposición lo pone en un tramo: se compra");
assert.deepEqual(coloresNombradosReferencia(["clear with silver confetti"]).map((color) => color.color), ["transparente"], "el confeti es el relleno, no otro látex");
console.log("[PASS] la disposición confirma el cuarto tono; el confeti no compra otro color");

// 4. Una parte medida nunca pasa de 1.
const candidata = { codigo: "981", nombre: "Plata", nombreCompleto: "Reflex Plata", nombreEn: "Silver", pms: null, acabado: "reflex", hexGlobo: "#c0c0c0", deltaE: 3, distancia: 3, tono: 2, razonCroma: 1 };
const piezaMedida = {
  elementId: "E1", tipo: "bouquet", croquis: { forma: "caja", parteDeLaCaja: 1 }, pixeles: { medidos: 100, deLaCaja: 100 }, avisos: [],
  colores: [{ hex: "#c0c0c0", parte: 1.00005, pixeles: 100, cruce: { hex: "#c0c0c0", candidatas: [candidata], porNombre: false, neutro: true, ambigua: false, sinReferencia: false, familias: ["reflex"] } }],
} as AnalisisColorSempertex["piezas"][number];
const [referencia] = referenciasDePieza(piezaMedida);
assert.ok(referencia && referencia.parte <= 1, `parte ${referencia?.parte}`);
console.log("[PASS] la parte de una referencia medida queda acotada a 1");

// 5. La normalización resume lo que descarta: tope de colores, relevancia menor, globo sin tipo.
const crudo = {
  image_id: "REF_01",
  elements: [
    { name: "Organic column", category: "balloon_structure", scene_role: "midground", detection_confidence: 0.9, visible_evidence: "column", box_2d: [100, 100, 900, 400], composition_relevance: "essential",
      observed_colors: ["chrome silver", "matte pink", "matte white", "clear", "chrome gold", "matte blue", "matte green", "matte red", "matte yellow", "matte black"],
      structure: { structure_type: "column", top_overhang: "none" }, model_decision: { action: "include", match_type: "none", reason: "r", adaptation: "a" } },
    { name: "Wall outlet", category: "other", scene_role: "midground", detection_confidence: 0.6, visible_evidence: "outlet", box_2d: [500, 800, 550, 850], composition_relevance: "minor",
      observed_colors: ["white"], model_decision: { action: "include", match_type: "none", reason: "r", adaptation: "a" } },
    { name: "Balloons", category: "balloon_structure", scene_role: "midground", detection_confidence: 0.7, visible_evidence: "balloons", box_2d: [600, 500, 700, 600], composition_relevance: "supporting",
      observed_colors: ["matte pink"], model_decision: { action: "include", match_type: "none", reason: "r", adaptation: "a" } },
  ],
};
const candidatos = parseCandidates("REF_01", crudo);
const elementos = candidatos.map((candidato, indice) => ({ element_id: `REF_01_E0${indice + 1}`, name: candidato.name, category: candidato.category, approved: candidato.model_decision.action === "include" && !(candidato.category === "balloon_structure" && !candidato.structure), appearance: { observed_colors: candidato.observed_colors } }));
const resumen = resumenNormalizacion([crudo], candidatos, elementos, new Map());
assert.equal(resumen.elementos_modelo, 3);
const columna = resumen.elementos.find((entrada) => entrada.nombre === "Organic column");
assert.equal(columna?.colores_modelo?.length, 10, "los 10 colores que escribió el modelo");
assert.equal(columna?.colores_lectura?.length, 8, "los 8 que caben en el blueprint");
assert.equal(resumen.elementos.find((entrada) => entrada.nombre === "Wall outlet")?.motivo, "relevancia_menor");
assert.ok(resumen.elementos.find((entrada) => entrada.nombre === "Balloons")?.motivo, "un globo sin tipo de estructura no se aprueba y se dice por qué");
console.log("[PASS] la normalización registra el tope de colores y cada elemento que no se aprueba, con su motivo");

console.log("test-lectura-foto-config: OK");
