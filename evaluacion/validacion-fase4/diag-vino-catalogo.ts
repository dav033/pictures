// Solo lectura: cuántos productos con un tono vino en el título y con qué colores los guarda el catálogo.
import { getRagPool } from "@/lib/rag/db";
async function main() {
const pool = getRagPool();
const filas = await pool.query<{ title: string; colores: unknown; var_colores: unknown }>(`
  SELECT p.title, p.derived->'colors' AS colores, array_agg(DISTINCT c) FILTER (WHERE c IS NOT NULL) AS var_colores
    FROM catalog_products p LEFT JOIN catalog_variants v ON v.product_id = p.product_id
    LEFT JOIN LATERAL unnest(v.derived_colors) AS c ON true
   WHERE p.title ~* '(vinotinto|vino tinto|burdeos|borgo|merlot|granate|marsala|wine|burgundy)'
   GROUP BY p.product_id, p.title, p.derived ORDER BY p.title`);
for (const f of filas.rows) console.log(f.title.slice(0, 70), "| producto", JSON.stringify(f.colores), "| variantes", JSON.stringify(f.var_colores));
console.log("total", filas.rowCount);
await pool.end();
}
void main();
