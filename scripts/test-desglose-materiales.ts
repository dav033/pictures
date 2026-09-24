import assert from "node:assert/strict";
import { ReferenceBlueprintV2Schema } from "../src/lib/ia/referencia/reference-blueprint";
import { construirDesglose } from "../src/lib/plan/desglose";
import { planFijado } from "./lib/planes-fijados";

/**
 * Sujeto: `construirDesglose`. El plan resuelto que consume es una entrada
 * congelada (`scripts/lib/planes-fijados.ts`, ADR-0023 paso 5): dos columnas
 * que comparten la misma variante, cada una atada a un elemento de la
 * referencia, y un tercer elemento en `referencia_omitida`.
 *
 * Lo que este test ya no cubre: la cotización de la UI. Sus tres aserciones
 * —una sola línea de compra para la variante compartida, sus
 * `referenciaElementIds`, y el total consolidado— probaban `cotizarPlan`, que
 * el paso 5 del ADR-0023 retira junto al resolutor TypeScript. Con Python como
 * único dueño, la cotización llega ya calculada en la respuesta del servicio y
 * no hay función local que ejercitar; la consolidación de compras que sostenía
 * la primera de las tres se sigue viendo aquí en `desglose.compras`.
 */

const blueprint = ReferenceBlueprintV2Schema.parse({
  schema_version: "2.0",
  source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"] }],
  elements: [
    {
      element_id: "REF_01_E01", source_image_id: "REF_01", name: "Arreglo izquierdo", category: "balloon_structure",
      scene_role: "midground", detection_confidence: 0.9, visible_evidence: "estructura izquierda",
      reference_bbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.7 }, depth_layer: 1,
      include_policy: "include", approved: true, source_type: "reference_only",
      quantity: { mode: "exact", min: 1, max: 1 },
      appearance: { observed_colors: ["rojo"], resolved_colors: [], color_policy: "match_reference", material: "latex", shape: "columna", composition: "single uniform material" },
      relationships: [], uncertainties: [],
    },
    {
      element_id: "REF_01_E02", source_image_id: "REF_01", name: "Arreglo derecho", category: "balloon_structure",
      scene_role: "midground", detection_confidence: 0.9, visible_evidence: "estructura derecha",
      reference_bbox: { x: 0.6, y: 0.1, width: 0.3, height: 0.7 }, depth_layer: 1,
      include_policy: "include", approved: true, source_type: "reference_only",
      quantity: { mode: "exact", min: 1, max: 1 },
      appearance: { observed_colors: ["rojo"], resolved_colors: [], color_policy: "match_reference", material: "latex", shape: "columna", composition: "single uniform material" },
      relationships: [], uncertainties: [],
    },
    {
      element_id: "REF_01_E03", source_image_id: "REF_01", name: "Cortina", category: "curtain",
      scene_role: "backdrop", detection_confidence: 0.9, visible_evidence: "cortina",
      reference_bbox: { x: 0.2, y: 0.1, width: 0.6, height: 0.7 }, depth_layer: 0,
      include_policy: "include", approved: true, source_type: "reference_only",
      quantity: { mode: "exact", min: 1, max: 1 },
      appearance: { observed_colors: ["blanco"], resolved_colors: [], color_policy: "match_reference", material: "tela", shape: "cortina", composition: "single uniform material" },
      relationships: [], uncertainties: [],
    },
  ],
  composition: { focal_point: "columnas", density: "moderate", symmetry: "symmetric", negative_space: [] },
  palette: { observed: ["rojo"], priority: ["rojo"] },
  unresolved_decisions: [],
});
function main(): void {
  const { plan: resuelto } = planFijado("desglose-dos-columnas");
  assert.equal(resuelto.sin_cobertura.length, 0);
  const desglose = construirDesglose(resuelto);
  assert.equal(desglose.por_estructura.reduce((sum, estructura) => sum + estructura.total_unidades, 0), desglose.compras.reduce((sum, compra) => sum + compra.unidades_necesarias, 0));
  assert.equal(desglose.resumen_tamanos.reduce((sum, linea) => sum + linea.unidades, 0), resuelto.totales.total_unidades);
  assert.ok(desglose.compras.every((compra) => compra.sobrante === compra.paquetes * compra.unidades_paquete - compra.unidades_necesarias && compra.sobrante >= 0));
  const desgloseConReferencias = construirDesglose(resuelto, blueprint);
  assert.deepEqual(
    desgloseConReferencias.por_estructura.map((estructura) => [estructura.referencia_element_id, estructura.referencia_nombre]),
    [["REF_01_E01", "Arreglo izquierdo"], ["REF_01_E02", "Arreglo derecho"]],
  );
  assert.deepEqual(desgloseConReferencias.referencias_omitidas, [{
    element_id: "REF_01_E03",
    nombre: "Cortina",
    categoria: "curtain",
    alcance: "emulable",
    motivo: "sin equivalente comercial",
    motivo_tipo: "emulacion_propuesta",
    propuesta: "plano vertical de globos",
  }]);

  // Las dos columnas comparten la misma variante y el desglose las consolida en
  // una sola compra, con las dos estructuras trazadas dentro.
  assert.equal(desglose.compras.length, 1, "una variante compartida conserva una sola línea de compra");
  assert.deepEqual(desglose.compras[0]?.estructuras, ["EST_01_COLUMNA", "EST_02_COLUMNA"]);
  console.log("[PASS] desglose — referencias por estructura, omisiones y compra compartida sin duplicar");
}

try {
  main();
} catch (error: unknown) {
  console.error("[FAIL] desglose de materiales", error);
  process.exitCode = 1;
}
