import { getRagPool } from "@/lib/rag/db";
import { coloresRealesProducto, patronTituloDeColorSql } from "@/lib/plan/colores-producto";
async function main() {
  const patron = patronTituloDeColorSql("burdeos")!;
  console.log("patron", patron, "| rojo ->", patronTituloDeColorSql("rojo"));
  const pool = getRagPool();
  const filas = await pool.query<{ title: string; colores: string[] }>("SELECT title, derived->'colors' AS colores FROM catalog_products WHERE title ~* $1 ORDER BY title", [patron]);
  for (const f of filas.rows) console.log(f.title, JSON.stringify(f.colores), "->", JSON.stringify(coloresRealesProducto(f.title, f.colores)));
  await pool.end();
}
void main();
