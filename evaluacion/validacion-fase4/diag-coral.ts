import { getRagPool } from "@/lib/rag/db";
import { resolveProductConcept } from "@/lib/lora/product-vocabulary";
import { PRODUCT_VOCABULARY } from "@/lib/lora/product-vocabulary-data";
async function main() {
  const pool = getRagPool();
  const { rows } = await pool.query("SELECT v.variant_id, v.sku, v.sku_canonical, v.title AS vt, p.title FROM catalog_variants v JOIN catalog_products p ON p.product_id=v.product_id WHERE v.product_id = ANY($1::text[]) ORDER BY 1", [["8634310426919", "8634243219751"]]);
  for (const r of rows) {
    const porSku = resolveProductConcept({ productId: r.sku_canonical }, PRODUCT_VOCABULARY);
    const porTitulo = resolveProductConcept({ text: r.title }, PRODUCT_VOCABULARY);
    console.log(r.variant_id, r.sku, r.sku_canonical, r.vt, "| sku->", porSku.status, porSku.status === "resolved" ? porSku.concept.concept_id : "", "| titulo->", porTitulo.status);
  }
  await pool.end();
}
void main();
