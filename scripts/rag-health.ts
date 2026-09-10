import { existsSync } from "node:fs";
import { Pool } from "pg";

const MODELO_EMBEDDING = "gemini-embedding-2";
const DIMENSIONES_EMBEDDING = 768;

function cargarEntornoLocal(): void {
  if (process.env.DATABASE_URL) return;
  for (const archivo of [".env.local", ".env"]) {
    if (!existsSync(archivo)) continue;
    try {
      process.loadEnvFile(archivo);
    } catch {
      // The checks below report the actionable failure without printing env data.
    }
    if (process.env.DATABASE_URL) return;
  }
}

type Estado = "PASS" | "SKIPPED_OPTIONAL" | "FAIL";
type Resultado = { nombre: string; estado: Estado; detalle: string };

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/postgres(?:ql)?:\/\/[^\s)]+/gi, "postgresql://<redacted>");
}

function pool(): Pool | null {
  const url = process.env.DATABASE_URL;
  return url ? new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 2500 }) : null;
}

async function checkPostgres(): Promise<Resultado> {
  const client = pool();
  if (!client) return { nombre: "PostgreSQL", estado: "FAIL", detalle: "DATABASE_URL no configurada" };
  try {
    const result = await client.query<{ database: string }>("SELECT current_database() AS database");
    return { nombre: "PostgreSQL", estado: "PASS", detalle: `conexión OK (${result.rows[0]?.database ?? "desconocida"})` };
  } catch (error) {
    return { nombre: "PostgreSQL", estado: "FAIL", detalle: errorMessage(error) };
  } finally {
    await client.end();
  }
}

async function checkRequiredExtensions(): Promise<Resultado> {
  const required = [
    { name: "unaccent", enabled: process.env.RAG_USE_FULLTEXT !== "false" },
    { name: "pg_trgm", enabled: process.env.RAG_USE_TRIGRAM !== "false" },
  ];
  const client = pool();
  if (!client) {
    return required.some((extension) => extension.enabled)
      ? { nombre: "Extensiones RAG", estado: "FAIL", detalle: "DATABASE_URL no configurada" }
      : { nombre: "Extensiones RAG", estado: "SKIPPED_OPTIONAL", detalle: "FTS/trigram deshabilitados" };
  }
  try {
    const result = await client.query<{ extname: string; extversion: string }>(
      "SELECT extname, extversion FROM pg_extension WHERE extname = ANY($1::text[])",
      [["unaccent", "pg_trgm"]],
    );
    const installed = new Map(result.rows.map((row) => [row.extname, row.extversion]));
    const missing = required.filter((extension) => extension.enabled && !installed.has(extension.name)).map((extension) => extension.name);
    if (missing.length) return { nombre: "Extensiones RAG", estado: "FAIL", detalle: `faltan: ${missing.join(", ")}` };
    const skipped = required.filter((extension) => !extension.enabled).map((extension) => extension.name);
    return {
      nombre: "Extensiones RAG",
      estado: "PASS",
      detalle: `${required.filter((extension) => extension.enabled).map((extension) => `${extension.name} ${installed.get(extension.name)}`).join(", ")}${skipped.length ? `; omitidas: ${skipped.join(", ")}` : ""}`,
    };
  } catch (error) {
    return { nombre: "Extensiones RAG", estado: "FAIL", detalle: errorMessage(error) };
  } finally {
    await client.end();
  }
}

function expectedDimensions(): number {
  return DIMENSIONES_EMBEDDING;
}

async function checkPgvector(): Promise<Resultado> {
  const truthy = (value: string | undefined): boolean =>
    value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "on";
  const pythonCanaryConfigured = process.env.RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED === "true"
    && truthy(process.env.PYTHON_BACKEND_ENABLED)
    && !truthy(process.env.PYTHON_BACKEND_KILL_SWITCH);
  if (
    (!process.env.GEMINI_API_KEY?.trim() && !pythonCanaryConfigured)
    || process.env.RAG_USE_VECTOR !== "true"
  ) {
    return { nombre: "pgvector", estado: "SKIPPED_OPTIONAL", detalle: "sin GEMINI_API_KEY o RAG_USE_VECTOR=false; ruta determinista activa" };
  }
  const client = pool();
  if (!client) return { nombre: "pgvector", estado: "FAIL", detalle: "DATABASE_URL no configurada" };
  const dimension = expectedDimensions();
  try {
    const extension = await client.query<{ extversion: string }>("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
    if (extension.rows.length === 0) return { nombre: "pgvector", estado: "FAIL", detalle: "extensión 'vector' no está habilitada" };
    const vector = await client.query<{ dimensions: number }>(
      "SELECT vector_dims(array_fill(0::real, ARRAY[$1::int])::vector) AS dimensions",
      [dimension],
    );
    const actual = Number(vector.rows[0]?.dimensions);
    return actual === dimension
      ? { nombre: "pgvector", estado: "PASS", detalle: `extversion ${extension.rows[0].extversion}, ${actual} dims` }
      : { nombre: "pgvector", estado: "FAIL", detalle: `dimensión ${actual || "desconocida"} (esperada ${dimension})` };
  } catch (error) {
    return { nombre: "pgvector", estado: "FAIL", detalle: errorMessage(error) };
  } finally {
    await client.end();
  }
}

async function checkGeminiEmbeddings(): Promise<Resultado> {
  if (!process.env.GEMINI_API_KEY?.trim() || process.env.RAG_USE_VECTOR !== "true") {
    return { nombre: "Gemini embeddings", estado: "SKIPPED_OPTIONAL", detalle: "sin GEMINI_API_KEY o vector deshabilitado" };
  }
  try {
    const { embeberTexto, validarEmbedding } = await import("../src/lib/rag/embeddings");
    const valores = await embeberTexto("prueba de salud del sistema RAG", "RETRIEVAL_DOCUMENT");
    validarEmbedding(valores);
    return {
      nombre: "Gemini embeddings",
      estado: "PASS",
      detalle: `modelo ${MODELO_EMBEDDING}, ${valores.length} dims (esperado ${DIMENSIONES_EMBEDDING})`,
    };
  } catch (error) {
    return { nombre: "Gemini embeddings", estado: "FAIL", detalle: errorMessage(error) };
  }
}

async function checkEmbeddingProvenance(): Promise<Resultado> {
  const truthy = (value: string | undefined): boolean =>
    value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "on";
  const pythonCanaryConfigured = process.env.RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED === "true"
    && truthy(process.env.PYTHON_BACKEND_ENABLED)
    && !truthy(process.env.PYTHON_BACKEND_KILL_SWITCH);
  if (process.env.RAG_USE_VECTOR !== "true" || (!process.env.GEMINI_API_KEY?.trim() && !pythonCanaryConfigured)) {
    return {
      nombre: "Provenance de embeddings",
      estado: "SKIPPED_OPTIONAL",
      detalle: "vector deshabilitado; no se requiere provenance en runtime",
    };
  }
  const client = pool();
  if (!client) return { nombre: "Provenance de embeddings", estado: "FAIL", detalle: "DATABASE_URL no configurada" };
  try {
    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'catalog_embeddings'
         AND column_name = ANY($1::text[])`,
      [["embedding_dimensions", "embedding_task_type"]],
    );
    const names = new Set(columns.rows.map((row) => row.column_name));
    const lock = await client.query<{ lock_name: string | null }>(
      "SELECT to_regclass('public.catalog_embedding_job_lock')::text AS lock_name",
    );
    const missing = [
      ...["embedding_dimensions", "embedding_task_type"].filter((name) => !names.has(name)),
      ...(!lock.rows[0]?.lock_name ? ["catalog_embedding_job_lock"] : []),
    ];
    return missing.length
      ? { nombre: "Provenance de embeddings", estado: "FAIL", detalle: `faltan: ${missing.join(", ")}` }
      : { nombre: "Provenance de embeddings", estado: "PASS", detalle: "migración 023 presente" };
  } catch (error) {
    return { nombre: "Provenance de embeddings", estado: "FAIL", detalle: errorMessage(error) };
  } finally {
    await client.end();
  }
}

async function checkPythonQueryEmbeddings(): Promise<Resultado> {
  const [{ RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED, RAG_USE_VECTOR }, { seleccionarBackendPython }] = await Promise.all([
    import("../src/lib/ia/feature-flags"),
    import("../src/lib/ia/python-adapter"),
  ]);
  if (
    !RAG_USE_VECTOR
    || !RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED
    || seleccionarBackendPython().backend !== "python"
  ) {
    return {
      nombre: "Python query embeddings",
      estado: "SKIPPED_OPTIONAL",
      detalle: "canario Python deshabilitado",
    };
  }
  try {
    const { embeberTexto, validarEmbedding } = await import("../src/lib/rag/embeddings");
    const valores = await embeberTexto("prueba de salud del canario Python", "RETRIEVAL_QUERY");
    validarEmbedding(valores);
    return {
      nombre: "Python query embeddings",
      estado: "PASS",
      detalle: `modelo ${MODELO_EMBEDDING}, ${valores.length} dims (esperado ${DIMENSIONES_EMBEDDING})`,
    };
  } catch (error) {
    return { nombre: "Python query embeddings", estado: "FAIL", detalle: errorMessage(error) };
  }
}

async function main(): Promise<void> {
  cargarEntornoLocal();
  const resultados = [
    await checkPostgres(),
    await checkRequiredExtensions(),
    await checkPgvector(),
    await checkEmbeddingProvenance(),
    await checkGeminiEmbeddings(),
    await checkPythonQueryEmbeddings(),
  ];

  for (const resultado of resultados) console.log(`[${resultado.estado}] ${resultado.nombre} — ${resultado.detalle}`);
  process.exitCode = resultados.some((resultado) => resultado.estado === "FAIL") ? 1 : 0;
}

void main().catch((error: unknown) => {
  console.error(`[FAIL] rag-health — ${errorMessage(error)}`);
  process.exitCode = 1;
});
