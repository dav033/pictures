import { existsSync } from "node:fs";
import { Pool } from "pg";
import { MODELO_EMBEDDING, embeberTexto, validarEmbedding } from "../src/lib/rag/embeddings";

for (const archivo of [".env.local", ".env"]) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

const CONCURRENCIA = Number(process.env.RAG_EMBED_CONCURRENCY ?? 5);

type Pendiente = { product_id: string; search_text: string; embedding_source_hash: string };

/** Pool de concurrencia simple: nada de dependencias nuevas para esto. */
async function procesarEnParalelo<T>(items: T[], concurrencia: number, tarea: (item: T, i: number) => Promise<void>) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      await tarea(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrencia, items.length) }, worker));
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada.");
  const pool = new Pool({ connectionString: url });

  try {
    // Reembedding inteligente (plan §5.7/§3.4): solo lo que no existe o cuyo
    // search_text cambió desde el último embedding. Un cambio de inventario o
    // precio nunca llega hasta aquí porque no toca embedding_source_hash.
    const { rows: pendientes } = await pool.query<Pendiente>(
      `SELECT p.product_id, p.search_text, p.embedding_source_hash
       FROM catalog_products p
       LEFT JOIN catalog_embeddings e ON e.product_id = p.product_id
       WHERE e.product_id IS NULL OR e.embedding_source_hash IS DISTINCT FROM p.embedding_source_hash`,
    );

    console.log(`Productos que necesitan (re)embedding: ${pendientes.length}`);
    if (pendientes.length === 0) {
      console.log("[PASS] catálogo ya embebido y al día.");
      return;
    }

    let ok = 0;
    let fallidos = 0;
    let procesados = 0;

    await procesarEnParalelo(pendientes, CONCURRENCIA, async (p) => {
      try {
        const valores = await embeberTexto(p.search_text, "RETRIEVAL_DOCUMENT");
        validarEmbedding(valores);
        await pool.query(
          `INSERT INTO catalog_embeddings (product_id, embedding, embedding_source_hash, model)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (product_id) DO UPDATE SET
             embedding = excluded.embedding,
             embedding_source_hash = excluded.embedding_source_hash,
             model = excluded.model,
             created_at = now()`,
          [p.product_id, `[${valores.join(",")}]`, p.embedding_source_hash, MODELO_EMBEDDING],
        );
        ok++;
      } catch (error) {
        fallidos++;
        console.error(`[FAIL] ${p.product_id}: ${error instanceof Error ? error.message : error}`);
      } finally {
        procesados++;
        if (procesados % 100 === 0) console.log(`  ...${procesados}/${pendientes.length}`);
      }
    });

    console.log("\n--- Estadísticas Fase 3.1 ---");
    console.log(`embebidos_ok: ${ok}`);
    console.log(`embebidos_fallidos: ${fallidos}`);
    console.log(`[${fallidos === 0 ? "PASS" : "FAIL"}] todos los pendientes se embebieron sin error`);

    const { rows: verif } = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM catalog_embeddings WHERE vector_dims(embedding) <> 768`,
    );
    console.log(`[${verif[0].n === 0 ? "PASS" : "FAIL"}] todos los embeddings tienen 768 dimensiones`);

    process.exitCode = fallidos === 0 && verif[0].n === 0 ? 0 : 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[FAIL] generación de embeddings falló:", error);
  process.exitCode = 1;
});
