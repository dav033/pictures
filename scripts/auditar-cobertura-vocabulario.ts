import { Pool } from "pg";
import { PRODUCT_VOCABULARY } from "../src/lib/lora/product-vocabulary-data";

/**
 * ¿Cuántos productos vendibles del catálogo puede nombrar el vocabulario LoRA?
 *
 * Esta es la pregunta que importa, y no la de los colores: `compileProductPrompt`
 * resuelve por PRODUCT ID contra `catalog_product_ids`. Un plan que compra un
 * producto ausente del vocabulario sale como `unresolved_products` y
 * `route.ts:1086` lo convierte en LORA_PRODUCT_VOCABULARY_FAILED — la petición
 * no produce imagen. Un color puede estar "cubierto" por un concepto y aun así
 * fallar si el plan eligió otra referencia de ese color.
 *
 * Solo lectura.
 *   npx tsx --env-file=.env.local scripts/auditar-cobertura-vocabulario.ts
 */

type Fila = { product_id: string; title: string; colores: string[] | null; skus: string[] | null };

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL");
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

  const enVocabulario = new Set(
    PRODUCT_VOCABULARY.filter((c) => c.status === "active").flatMap((c) => c.catalog_product_ids ?? []),
  );

  // El vocabulario identifica productos por SKU sin prefijo (`20014242`) y a
  // veces por id de Shopify. En producción el puente son los alias
  // `variant_id -> [sku, product_id]` que arma `route.ts:1047-1054`, así que la
  // cobertura hay que medirla contra los tres espacios de id, no contra uno.
  const { rows } = await pool.query<Fila>(
    `SELECT DISTINCT p.product_id, p.title,
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(p.derived->'colors', '[]'::jsonb))) AS colores,
            ARRAY(SELECT DISTINCT regexp_replace(COALESCE(v2.sku_canonical, v2.sku, ''), '^B2B-', '')
                    FROM catalog_variants v2 WHERE v2.product_id = p.product_id AND v2.available = true) AS skus
       FROM catalog_products p
       JOIN catalog_variants v ON v.product_id = p.product_id
      WHERE p.status = 'ACTIVE' AND p.available = true AND v.available = true
        AND v.forma = 'redondo' AND p.derived->>'category' = 'globo_latex'`,
  );

  const fuera = rows.filter((r) => !enVocabulario.has(r.product_id) && !(r.skus ?? []).some((s) => s && enVocabulario.has(s)));
  const porColor = new Map<string, number>();
  for (const r of fuera) for (const c of r.colores ?? ["(sin color)"]) porColor.set(c, (porColor.get(c) ?? 0) + 1);

  console.log(`globos redondos de latex vendibles: ${rows.length}`);
  console.log(`  en el vocabulario: ${rows.length - fuera.length}`);
  console.log(`  FUERA (harian fallar la generacion): ${fuera.length}  (${Math.round((fuera.length / rows.length) * 100)}%)`);
  console.log(`\nproductos fuera del vocabulario, por color declarado:`);
  for (const [color, n] of [...porColor].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${color.padEnd(16)} ${n}`);
  }
  console.log(`\nejemplos:`);
  for (const r of fuera.slice(0, 8)) console.log(`  ${r.product_id.padEnd(16)} ${String(r.title).slice(0, 62)}`);
  await pool.end();
}

void main();
