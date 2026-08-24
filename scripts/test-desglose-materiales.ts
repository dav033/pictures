import assert from "node:assert/strict";
import type { Pool } from "pg";
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
  estructuras: [{ estructura_id: "EST_01_COLUMNA", nombre: "Columna", tipo: "columna", rol_escena: "focal", ubicacion: "arco_central", medidas: { alto_m: 1.4 }, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales: [{ product_id: "P-1", color: "rojo", participacion: 1, rol_material: "principal" }], porque: "Prueba." }],
  supuestos: [],
});
async function main(): Promise<void> {
  const resuelto = await resolverPlan(pool, plan, new Map([["P-1", new Set(["V-12"])]]));
  assert.equal(resuelto.sin_cobertura.length, 0);
  const desglose = construirDesglose(resuelto);
  assert.equal(desglose.por_estructura.reduce((sum, estructura) => sum + estructura.total_unidades, 0), desglose.compras.reduce((sum, compra) => sum + compra.unidades_necesarias, 0));
  assert.equal(desglose.resumen_tamanos.reduce((sum, linea) => sum + linea.unidades, 0), resuelto.totales.total_unidades);
  assert.ok(desglose.compras.every((compra) => compra.sobrante === compra.paquetes * compra.unidades_paquete - compra.unidades_necesarias && compra.sobrante >= 0));
  console.log("[PASS] desglose de materiales — unidades, tamaños, compra consolidada y sobrantes cuadran");
}

main().catch((error) => { console.error("[FAIL] desglose de materiales", error); process.exitCode = 1; });
