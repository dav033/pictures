import { getRagPool } from "@/lib/rag/db";
import { buscarGlobosPorColor } from "@/lib/rag/catalog/globos-por-color";
async function main() {
  const pool = getRagPool();
  const r = await buscarGlobosPorColor(pool, ["burdeos", "gris"], { catalogSnapshotId: process.argv[2] ?? null });
  for (const [color, productos] of r) console.log(color, "->", productos.map((p) => `${p.titulo.slice(4, 50)} ${JSON.stringify(p.diametros)}`));
  await pool.end();
}
void main();
