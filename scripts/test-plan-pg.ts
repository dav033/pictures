import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { Pool } from "pg";
import { resolverPlan } from "../src/lib/plan/resolver";
import { PlanDecoracionSchema } from "../src/lib/plan/tipos";

for (const archivo of [".env.local", ".env"]) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

async function main(): Promise<void> {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL es obligatoria para la prueba PG del plan");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const fixture = await pool.query<{ product_id: string; variant_ids: string[] }>(
      `SELECT p.product_id, array_agg(v.variant_id ORDER BY v.diam_pulg, v.variant_id) AS variant_ids
         FROM catalog_products p
         JOIN catalog_variants v ON v.product_id = p.product_id
        WHERE p.status = 'ACTIVE' AND p.available = true AND v.available = true
          AND v.forma = 'redondo' AND v.diam_pulg IS NOT NULL AND v.price > 0
          AND v.unidades_paq IS NOT NULL AND v.unidades_paq > 0
        GROUP BY p.product_id
       HAVING COUNT(DISTINCT v.diam_pulg) >= 2
        ORDER BY COUNT(DISTINCT v.diam_pulg) DESC, p.product_id
        LIMIT 1`,
    );
    assert.ok(fixture.rows[0], "no hay producto PG con al menos dos tamaños redondos disponibles");
    const productId = fixture.rows[0]!.product_id;
    const plan = PlanDecoracionSchema.parse({
      plan_version: "1.0",
      plan_id: "66666666-6666-4666-8666-666666666666",
      concepto: { titulo: "Prueba PG", descripcion: "Resolver real contra el catálogo activo.", paleta: [] },
      espacio: { tipo: "salón", fuente: "supuesto" },
      estructuras: [{ estructura_id: "EST_01_ARCO", nombre: "Arco de prueba", tipo: "arco", rol_escena: "focal", ubicacion: "arco_central", medidas: { ancho_m: 3, alto_m: 2.4 }, repeticiones: 1, densidad: "media", mezcla: "organica_fina", materiales: [{ product_id: productId, participacion: 1, rol_material: "principal" }], porque: "Fixture real." }],
      supuestos: [],
    });
    const whitelist = new Map([[productId, new Set(fixture.rows[0]!.variant_ids)]]);
    const resultado = await resolverPlan(pool, plan, whitelist);
    assert.ok(resultado.compras.length > 0);
    assert.ok(resultado.totales.total_cop > 0);
    assert.ok(resultado.compras.every((compra) => compra.sobrante >= 0));
    const varianteUnica = fixture.rows[0]!.variant_ids[0]!;
    const resultadoConUnaVariante = await resolverPlan(pool, plan, new Map([[productId, new Set([varianteUnica])]]));
    assert.ok(resultadoConUnaVariante.sin_cobertura.length > 0, "una sola variante no debe fingir cobertura para toda una mezcla orgánica");
    assert.ok(resultadoConUnaVariante.compras.length > 0);
    assert.ok(resultadoConUnaVariante.estructuras.every((estructura) => estructura.lineas.every((linea) => linea.variant_id === varianteUnica)));

    const gigante = await pool.query<{ product_id: string; variant_id: string }>(
      `SELECT p.product_id, v.variant_id
         FROM catalog_products p
         JOIN catalog_variants v ON v.product_id = p.product_id
        WHERE p.status = 'ACTIVE' AND p.available = true
          AND v.codigo_tamano = 'R-24' AND v.available = true
          AND v.price > 0 AND v.unidades_paq IS NOT NULL AND v.unidades_paq > 0
        ORDER BY p.product_id, v.variant_id
        LIMIT 1`,
    );
    assert.ok(gigante.rows[0], "falta una variante real R-24 activa para probar ausencia de cobertura");
    const planR24 = PlanDecoracionSchema.parse({
      ...plan,
      plan_id: "99999999-9999-4999-8999-999999999999",
      estructuras: [{
        estructura_id: "EST_01_COLUMNAS",
        nombre: "Columnas de prueba",
        tipo: "columna",
        rol_escena: "focal",
        ubicacion: "entrada",
        medidas: { alto_m: 1.8 },
        repeticiones: 2,
        densidad: "media",
        mezcla: "clasica",
        materiales: [{ product_id: gigante.rows[0]!.product_id, participacion: 1, rol_material: "principal" }],
        porque: "Regresión del caso real R-12 convertido en R-24.",
      }],
    });
    const resultadoR24 = await resolverPlan(pool, planR24, new Map([[gigante.rows[0]!.product_id, new Set([gigante.rows[0]!.variant_id])]]));
    assert.deepEqual(resultadoR24.sin_cobertura.map((item) => item.tamano), ["R-12"]);
    assert.equal(resultadoR24.compras.length, 0, "el caso real no debe volver a cotizar 29 paquetes R-24");
    assert.equal(resultadoR24.totales.total_cop, 0);
    console.log(`[PASS] resolver de plan contra PG — producto=${productId}, compras=${resultado.compras.length}, total=${resultado.totales.total_cop} COP`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => { console.error(`[FAIL] resolver de plan contra PG — ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
