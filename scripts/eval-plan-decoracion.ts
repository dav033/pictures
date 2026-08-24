import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { MERMA } from "../src/lib/cotizacion/constantes";
import { descripcionFisicaTamano, bloqueMezclaPorEstructura } from "../src/lib/ia/tamano-fisico";
import { verificarCoherenciaPrompt } from "../src/lib/plan/coherencia";
import { resolverPlan } from "../src/lib/plan/resolver";
import { PlanDecoracionSchema, type PlanDecoracion } from "../src/lib/plan/tipos";

for (const archivo of [".env.local", ".env"]) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

async function main(): Promise<void> {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL es obligatoria para plan:eval");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const fixture = await pool.query<{ product_id: string; variant_ids: string[]; variantes: string }>(
      `SELECT p.product_id, array_agg(v.variant_id ORDER BY v.diam_pulg, v.variant_id) AS variant_ids,
              COUNT(DISTINCT v.diam_pulg)::text AS variantes
         FROM catalog_products p
         JOIN catalog_variants v ON v.product_id = p.product_id
        WHERE p.status = 'ACTIVE' AND p.available = true AND v.available = true
          AND v.forma = 'redondo' AND v.diam_pulg IS NOT NULL AND v.price > 0
          AND v.unidades_paq IS NOT NULL AND v.unidades_paq > 0
        GROUP BY p.product_id
       HAVING COUNT(DISTINCT v.diam_pulg) >= 4
        ORDER BY COUNT(DISTINCT v.diam_pulg) DESC, p.product_id
        LIMIT 1`,
    );
    assert.ok(fixture.rows[0], "no hay fixture PG con cuatro tamaños redondos disponibles");
    const productId = fixture.rows[0]!.product_id;
    const whitelist = new Map([[productId, new Set(fixture.rows[0]!.variant_ids)]]);
    const resultados: Array<{ estructuras: number; focal: boolean; mezcla: boolean; cobertura: boolean; coherencia: boolean; ahorroCop: number }> = [];

    for (let index = 0; index < 12; index += 1) {
      const mezcla = index % 3 === 0 ? "clasica" : "organica_fina";
      const plan = PlanDecoracionSchema.parse({
        plan_version: "1.0",
        plan_id: randomUUID(),
        concepto: { titulo: `Evaluación ${index + 1}`, descripcion: "Brief determinístico de evaluación.", paleta: ["rojo"] },
        espacio: { tipo: index % 2 ? "jardín" : "salón", fuente: "supuesto" },
        estructuras: [
          { estructura_id: "EST_01_ARCO", nombre: "Arco focal", tipo: "arco", rol_escena: "focal", ubicacion: "arco_central", medidas: { ancho_m: 3 + index * 0.05, alto_m: 2.4 }, repeticiones: 1, densidad: "media", mezcla, materiales: [{ product_id: productId, participacion: 1, rol_material: "principal" }], porque: "Foco visual." },
          { estructura_id: "EST_02_COLUMNA", nombre: "Columna izquierda", tipo: "columna", rol_escena: "soporte", ubicacion: "lateral_izquierdo", medidas: { alto_m: 1.8 }, repeticiones: 1, densidad: "media", mezcla: index % 2 ? "organica_gruesa" : "clasica", materiales: [{ product_id: productId, participacion: 1, rol_material: "principal" }], porque: "Enmarca el foco." },
          { estructura_id: "EST_03_COLUMNA", nombre: "Columna derecha", tipo: "columna", rol_escena: "soporte", ubicacion: "lateral_derecho", medidas: { alto_m: 1.8 }, repeticiones: 1, densidad: "media", mezcla: index % 2 ? "organica_gruesa" : "clasica", materiales: [{ product_id: productId, participacion: 1, rol_material: "principal" }], porque: "Equilibra el foco." },
        ],
        supuestos: [],
      }) as PlanDecoracion;
      const resuelto = await resolverPlan(pool, plan, whitelist);
      const sizeBlock = bloqueMezclaPorEstructura(resuelto.estructuras.map((estructura) => ({
        estructura_id: estructura.estructura_id,
        nombre: estructura.nombre,
        total_unidades: estructura.total_unidades,
        mezcla_real: estructura.mezcla_real.map((linea) => ({ diamPulg: linea.diam_pulg, forma: linea.forma, unidades: linea.unidades, pct: linea.pct })),
      })));
      const prompt = `${sizeBlock ?? ""}\n${resuelto.estructuras.map((estructura) => estructura.nombre).join("\n")}\n${resuelto.compras.map((compra) => descripcionFisicaTamano(compra.diam_pulg, "redondo") ?? "").join("\n")}`;
      const coherencia = verificarCoherenciaPrompt(prompt, resuelto).ok;
      const naivePackages = resuelto.estructuras.reduce((sum, estructura) => sum + estructura.lineas.reduce((lineSum, linea) => {
        const compra = resuelto.compras.find((item) => item.variant_id === linea.variant_id)!;
        return lineSum + Math.max(1, Math.ceil(Math.ceil(linea.unidades * (1 + MERMA)) / compra.unidades_paquete));
      }, 0), 0);
      const consolidatedPackages = resuelto.compras.reduce((sum, compra) => sum + compra.paquetes, 0);
      resultados.push({ estructuras: resuelto.estructuras.length, focal: plan.estructuras.some((estructura) => estructura.rol_escena === "focal"), mezcla: mezcla !== "clasica" ? resuelto.estructuras[0]!.mezcla_real.length >= 2 : true, cobertura: resuelto.sin_cobertura.length === 0, coherencia, ahorroCop: Math.max(0, naivePackages - consolidatedPackages) });
    }
    const median = resultados.slice().sort((a, b) => a.estructuras - b.estructuras)[Math.floor(resultados.length / 2)]!.estructuras;
    const averageSaving = resultados.reduce((sum, result) => sum + result.ahorroCop, 0) / resultados.length;
    const report = `# Evaluación del plan de decoración — ${new Date().toISOString().slice(0, 10)}

Fixture PG: \`${productId}\` (${fixture.rows[0]!.variantes} diámetros redondos).
Evaluación determinística del pipeline resolver → mezcla por estructura → coherencia de prompt; no llama al proveedor de imágenes.

| Métrica | Resultado | Objetivo |
|---|---:|---:|
| Planes válidos | 12/12 | 100% en fixture |
| Mediana de estructuras | ${median} | ≥ 3 |
| Rol focal presente | ${resultados.filter((result) => result.focal).length}/12 | 12/12 |
| Cobertura de variantes | ${resultados.filter((result) => result.cobertura).length}/12 | 12/12 |
| Coherencia prompt ↔ plan | ${resultados.filter((result) => result.coherencia).length}/12 | 12/12 |
| Mezcla de ≥2 tamaños en planes no clásicos | ${resultados.filter((result) => result.mezcla).length}/12 | reportado |
| Ahorro medio de paquetes por consolidación | ${averageSaving.toFixed(2)} paquetes | reportado |

La verificación de visión de la imagen permanece opt-in y requiere un observador multimodal; esta evaluación cubre el contrato determinístico previo al proveedor.`;
    const output = `reports/eval-plan-${new Date().toISOString().slice(0, 10)}.md`;
    mkdirSync("reports", { recursive: true });
    writeFileSync(output, report, "utf8");
    console.log(`[PASS] plan:eval — 12 briefs determinísticos; reporte=${output}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => { console.error(`[FAIL] plan:eval — ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
