import { Pool } from "pg";
import { PRODUCT_VOCABULARY } from "../../src/lib/lora/product-vocabulary-data";

/**
 * Compara los `allowed_codes` de cada concepto del vocabulario LoRA con los
 * diámetros que el catálogo publicado VENDE de verdad para sus product ids.
 *
 * Motivación (F5 del plan): una talla que el plan aprueba pero que no está en
 * `allowed_codes` se cae del caption con un simple diagnóstico
 * (`lora-product-runtime.ts`), así que el remate de 36" se cotiza, se cobra y
 * no llega al modelo. La línea base del benchmark lo vio en los 4 casos.
 *
 * Solo lectura. No modifica el vocabulario: imprime el desfase para decidirlo.
 *   npx tsx --env-file=.env.local scripts/dataset/auditar-tamanos-vocabulario.ts
 */

type Fila = { product_id: string; diametros: number[] | null };

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL");
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

  const ids = [...new Set(PRODUCT_VOCABULARY.flatMap((c) => c.catalog_product_ids ?? []))];
  const { rows } = await pool.query<Fila>(
    `SELECT p.product_id,
            array_agg(DISTINCT v.diam_pulg::int ORDER BY v.diam_pulg::int) FILTER (WHERE v.diam_pulg IS NOT NULL) AS diametros
       FROM catalog_products p
       JOIN catalog_variants v ON v.product_id = p.product_id
      WHERE p.product_id = ANY($1::text[])
        AND p.status = 'ACTIVE' AND p.available = true AND v.available = true AND v.forma = 'redondo'
      GROUP BY p.product_id`,
    [ids],
  );
  const porProducto = new Map(rows.map((r) => [r.product_id, (r.diametros ?? []).map((d) => `R-${d}`)]));

  let conDesfase = 0;
  let tallasPerdidas = 0;
  console.log("concepto".padEnd(48) + "declarado".padEnd(34) + "el catalogo ademas vende");
  for (const concepto of PRODUCT_VOCABULARY) {
    const declarados = concepto.sizes?.allowed_codes ?? [];
    const idsConcepto = concepto.catalog_product_ids ?? [];
    if (!idsConcepto.length) continue;
    const reales = [...new Set(idsConcepto.flatMap((id) => porProducto.get(id) ?? []))];
    const faltan = reales.filter((r) => !declarados.includes(r)).sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
    if (!faltan.length) continue;
    conDesfase += 1;
    tallasPerdidas += faltan.length;
    console.log(concepto.concept_id.padEnd(48) + declarados.join(",").padEnd(34) + faltan.join(","));
  }
  console.log(`\nconceptos con product ids: ${PRODUCT_VOCABULARY.filter((c) => (c.catalog_product_ids ?? []).length).length}`);
  console.log(`conceptos cuyo allowed_codes se queda corto: ${conDesfase}`);
  console.log(`tallas vendidas que el caption no puede nombrar: ${tallasPerdidas}`);
  await pool.end();
}

void main();
