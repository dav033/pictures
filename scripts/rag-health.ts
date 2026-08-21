import { existsSync } from "node:fs";
import { Pool } from "pg";
import { DIMENSIONES_EMBEDDING, embeberTexto, validarEmbedding } from "../src/lib/rag/embeddings";

for (const archivo of [".env.local", ".env"]) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

type Resultado = { nombre: string; ok: boolean; detalle: string };

async function checkPostgres(): Promise<Resultado> {
  const url = process.env.DATABASE_URL;
  if (!url) return { nombre: "PostgreSQL", ok: false, detalle: "DATABASE_URL no configurada" };
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query("SELECT 1");
    return { nombre: "PostgreSQL", ok: true, detalle: "conexión OK" };
  } catch (error) {
    return { nombre: "PostgreSQL", ok: false, detalle: String(error) };
  } finally {
    await pool.end();
  }
}

async function checkPgvector(): Promise<Resultado> {
  const url = process.env.DATABASE_URL;
  if (!url) return { nombre: "pgvector", ok: false, detalle: "DATABASE_URL no configurada" };
  const pool = new Pool({ connectionString: url });
  try {
    const res = await pool.query(
      "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
    );
    if (res.rows.length === 0) {
      return { nombre: "pgvector", ok: false, detalle: "extensión 'vector' no está habilitada" };
    }
    return { nombre: "pgvector", ok: true, detalle: `extversion ${res.rows[0].extversion}` };
  } catch (error) {
    return { nombre: "pgvector", ok: false, detalle: String(error) };
  } finally {
    await pool.end();
  }
}

async function checkGeminiEmbeddings(): Promise<Resultado> {
  if (!process.env.GEMINI_API_KEY) {
    return { nombre: "Gemini embeddings", ok: false, detalle: "GEMINI_API_KEY no configurada" };
  }
  try {
    const valores = await embeberTexto("prueba de salud del sistema RAG", "RETRIEVAL_DOCUMENT");
    validarEmbedding(valores);
    return {
      nombre: "Gemini embeddings",
      ok: true,
      detalle: `modelo ${process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-2"}, ${valores.length} dims (esperado ${DIMENSIONES_EMBEDDING})`,
    };
  } catch (error) {
    return { nombre: "Gemini embeddings", ok: false, detalle: String(error) };
  }
}

async function main() {
  const resultados = [
    await checkPostgres(),
    await checkPgvector(),
    await checkGeminiEmbeddings(),
  ];

  for (const r of resultados) {
    console.log(`[${r.ok ? "PASS" : "FAIL"}] ${r.nombre} — ${r.detalle}`);
  }

  const fallo = resultados.some((r) => !r.ok);
  process.exitCode = fallo ? 1 : 0;
}

main();
