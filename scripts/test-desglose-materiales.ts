import assert from "node:assert/strict";
import type { Pool } from "pg";
import { cotizarPlan } from "../src/lib/cotizacion/motor";
import { ReferenceBlueprintV2Schema } from "../src/lib/ia/reference-blueprint";
import { construirDesglose } from "../src/lib/plan/desglose";
import { resolverPlan } from "../src/lib/plan/resolver";
import { PlanDecoracionSchema } from "../src/lib/plan/tipos";

const row = { product_id: "P-1", variant_id: "V-12", sku: "SKU-12", producto_titulo: "Globo", variante_titulo: "R-12", precio: 100, unidades_paq: 50, disponible: true, producto_disponible: true, codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, colores_producto: ["rojo"], colores_variante: ["rojo"], descripcion: "Globo rojo." };
const pool = { query: async () => ({ rows: [row] }) } as unknown as Pool;
const plan = PlanDecoracionSchema.parse({
  plan_version: "1.0",
  plan_id: "55555555-5555-4555-8555-555555555555",
  concepto: { titulo: "Plan", descripcion: "Prueba.", paleta: ["rojo"] },
  espacio: { tipo: "interior", fuente: "supuesto" },
  estructuras: [
    { estructura_id: "EST_01_COLUMNA", nombre: "Columna izquierda", tipo: "columna", rol_escena: "focal", ubicacion: "arco_central", medidas: { alto_m: 1.4 }, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales: [{ product_id: "P-1", color: "rojo", participacion: 1, rol_material: "principal" }], porque: "Prueba.", referencia_element_id: "REF_01_E01" },
    { estructura_id: "EST_02_COLUMNA", nombre: "Columna derecha", tipo: "columna", rol_escena: "relleno", ubicacion: "lateral_izquierdo", medidas: { alto_m: 1.4 }, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales: [{ product_id: "P-1", color: "rojo", participacion: 1, rol_material: "principal" }], porque: "Prueba.", referencia_element_id: "REF_01_E02" },
  ],
  supuestos: [],
  referencia_omitida: [{ element_id: "REF_01_E03", motivo: "sin equivalente comercial" }],
});

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
async function main(): Promise<void> {
  const resuelto = await resolverPlan(pool, plan, new Map([["P-1", new Set(["V-12"])]]));
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
    motivo: "sin equivalente comercial",
  }]);

  const cotizacion = cotizarPlan(resuelto);
  assert.equal(cotizacion.lineas.length, 1, "una variante compartida conserva una sola línea de compra");
  assert.deepEqual(cotizacion.lineas[0]?.referenciaElementIds, ["REF_01_E01", "REF_01_E02"]);
  assert.equal(cotizacion.lineas.reduce((total, linea) => total + (linea.subtotal ?? 0), 0), cotizacion.total);
  assert.equal(cotizacion.total, resuelto.totales.total_cop, "la trazabilidad no altera el total consolidado");
  console.log("[PASS] desglose y cotización — referencias por estructura, omisiones y compra compartida sin duplicar");
}

main().catch((error) => { console.error("[FAIL] desglose de materiales", error); process.exitCode = 1; });
