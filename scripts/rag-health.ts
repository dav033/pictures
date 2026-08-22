import { existsSync } from "node:fs";
import { Pool } from "pg";
import { DIMENSIONES_EMBEDDING, embeberTexto, validarEmbedding } from "../src/lib/rag/embeddings";

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
  const value = Number(process.env.GEMINI_EMBEDDING_DIMENSIONS ?? DIMENSIONES_EMBEDDING);
  return Number.isInteger(value) && value > 0 && value <= 4096 ? value : 0;
}

async function checkPgvector(): Promise<Resultado> {
  if (!process.env.GEMINI_API_KEY?.trim() || process.env.RAG_USE_VECTOR !== "true") {
    return { nombre: "pgvector", estado: "SKIPPED_OPTIONAL", detalle: "sin GEMINI_API_KEY o RAG_USE_VECTOR=false; ruta determinista activa" };
  }
  const client = pool();
  if (!client) return { nombre: "pgvector", estado: "FAIL", detalle: "DATABASE_URL no configurada" };
  const dimension = expectedDimensions();
  if (dimension === 0) {
    await client.end();
    return { nombre: "pgvector", estado: "FAIL", detalle: "GEMINI_EMBEDDING_DIMENSIONS inválida" };
  }
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
    const valores = await embeberTexto("prueba de salud del sistema RAG", "RETRIEVAL_DOCUMENT");
    validarEmbedding(valores);
    return {
      nombre: "Gemini embeddings",
      estado: "PASS",
      detalle: `modelo ${process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-2"}, ${valores.length} dims (esperado ${DIMENSIONES_EMBEDDING})`,
    };
  } catch (error) {
    return { nombre: "Gemini embeddings", estado: "FAIL", detalle: errorMessage(error) };
  }
}

async function main(): Promise<void> {
  cargarEntornoLocal();
  const resultados = [
    await checkPostgres(),
    await checkRequiredExtensions(),
    await checkPgvector(),
    await checkGeminiEmbeddings(),
  ];

  for (const resultado of resultados) console.log(`[${resultado.estado}] ${resultado.nombre} — ${resultado.detalle}`);
  process.exitCode = resultados.some((resultado) => resultado.estado === "FAIL") ? 1 : 0;
}

void main().catch((error: unknown) => {
  console.error(`[FAIL] rag-health — ${errorMessage(error)}`);
  process.exitCode = 1;
});
