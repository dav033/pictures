import { existsSync } from "node:fs";
import { Pool } from "pg";

/**
 * Local-only readiness check for the RAG runtime. It deliberately does not
 * import application modules: those may be marked `server-only` and this
 * command must remain usable outside Next's React Server Components runtime.
 */

type Estado = "READY" | "BLOCKED" | "SKIPPED_OPTIONAL";

type Resultado = {
  nombre: string;
  estado: Estado;
  detalle: string;
};

function cargarEntornoLocal(): void {
  if (process.env.DATABASE_URL) return;

  for (const archivo of [".env.local", ".env"]) {
    if (!existsSync(archivo)) continue;
    try {
      process.loadEnvFile(archivo);
    } catch {
      // The individual checks below produce the actionable failure. Do not
      // print values from a malformed env file, which could contain secrets.
    }
    if (process.env.DATABASE_URL) return;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function expectedDimensions(): number {
  return 768;
}

async function checkPostgres(): Promise<Resultado[]> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return [
      {
        nombre: "PostgreSQL",
        estado: "BLOCKED",
        detalle: "DATABASE_URL no configurada (copia .env.example a .env.local)",
      },
      {
        nombre: "Extensiones RAG",
        estado: "BLOCKED",
        detalle: "no se pueden comprobar sin conexión PostgreSQL",
      },
    ];
  }

  const dimension = expectedDimensions();
  const pool = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 2500,
    idleTimeoutMillis: 2500,
  });

  try {
    const database = await pool.query<{ database: string }>("SELECT current_database() AS database");
    const extensions = await pool.query<{ extname: string; extversion: string }>(
      "SELECT extname, extversion FROM pg_extension WHERE extname = ANY($1::text[])",
      [["vector", "unaccent", "pg_trgm"]],
    );
    const installed = new Map(extensions.rows.map((row) => [row.extname, row.extversion]));
    // pg_trgm is an optional retrieval accelerator. It is installed by a
    // later RAG migration, so its absence must not block the base runtime.
    const missing = ["vector", "unaccent"].filter((name) => !installed.has(name));
    const results: Resultado[] = [
      {
        nombre: "PostgreSQL",
        estado: "READY",
        detalle: `conexión OK (${database.rows[0]?.database ?? "desconocida"})`,
      },
      {
        nombre: "Extensiones RAG",
        estado: missing.length === 0 ? "READY" : "BLOCKED",
        detalle:
          missing.length === 0
            ? `vector ${installed.get("vector")}, unaccent ${installed.get("unaccent")}`
            : `faltan: ${missing.join(", ")}`,
      },
    ];

    results.push({
      nombre: "pg_trgm",
      estado: installed.has("pg_trgm") ? "READY" : "SKIPPED_OPTIONAL",
      detalle: installed.has("pg_trgm") ? `extversion ${installed.get("pg_trgm")}` : "acelerador opcional aún no instalado",
    });

    const provenanceColumns = await pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'catalog_embeddings'
         AND column_name = ANY($1::text[])`,
      [["embedding_dimensions", "embedding_task_type"]],
    );
    const provenanceNames = new Set(provenanceColumns.rows.map((row) => row.column_name));
    const lock = await pool.query<{ lock_name: string | null }>(
      "SELECT to_regclass('public.catalog_embedding_job_lock')::text AS lock_name",
    );
    const missingProvenance = [
      "embedding_dimensions",
      "embedding_task_type",
      "catalog_embedding_job_lock",
    ].filter((name) => (
      name === "catalog_embedding_job_lock"
        ? !lock.rows[0]?.lock_name
        : !provenanceNames.has(name)
    ));
    results.push({
      nombre: "Provenance de embeddings",
      estado: missingProvenance.length === 0 ? "READY" : "BLOCKED",
      detalle: missingProvenance.length === 0
        ? "columnas y lock de Fase 8.3 presentes"
        : `faltan: ${missingProvenance.join(", ")}`,
    });

    if (installed.has("vector")) {
      const vector = await pool.query<{ dimensions: number }>(
        "SELECT vector_dims(array_fill(0::real, ARRAY[$1::int])::vector) AS dimensions",
        [dimension],
      );
      const actual = Number(vector.rows[0]?.dimensions);
      results.push({
        nombre: "pgvector",
        estado: actual === dimension ? "READY" : "BLOCKED",
        detalle: `dimensión ${actual || "desconocida"} (esperada ${dimension})`,
      });
    } else {
      results.push({
        nombre: "pgvector",
        estado: "BLOCKED",
        detalle: "extensión vector no instalada",
      });
    }

    if (installed.has("unaccent")) {
      const unaccent = await pool.query<{ normalized: string }>("SELECT unaccent('Árbol') AS normalized");
      results.push({
        nombre: "unaccent",
        estado: unaccent.rows[0]?.normalized === "Arbol" ? "READY" : "BLOCKED",
        detalle: `normalización ${JSON.stringify(unaccent.rows[0]?.normalized ?? null)}`,
      });
    } else {
      results.push({ nombre: "unaccent", estado: "BLOCKED", detalle: "extensión no instalada" });
    }

    return results;
  } catch (error) {
    return [
      {
        nombre: "PostgreSQL",
        estado: "BLOCKED",
        detalle: errorMessage(error),
      },
    ];
  } finally {
    await pool.end();
  }
}

function checkGemini(): Resultado {
  if (process.env.GEMINI_API_KEY?.trim()) {
    return {
      nombre: "Gemini",
      estado: "READY",
      detalle: "GEMINI_API_KEY configurada; las capacidades generativas son opcionales",
    };
  }
  return {
    nombre: "Gemini",
    estado: "SKIPPED_OPTIONAL",
    detalle: "sin GEMINI_API_KEY; parser determinista y retrieval SQL siguen disponibles",
  };
}

async function main(): Promise<void> {
  cargarEntornoLocal();
  const resultados = [...(await checkPostgres()), checkGemini()];

  for (const resultado of resultados) {
    console.log(`[${resultado.estado}] ${resultado.nombre} — ${resultado.detalle}`);
  }

  process.exitCode = resultados.some((resultado) => resultado.estado === "BLOCKED") ? 1 : 0;
}

void main().catch((error: unknown) => {
  console.error(`[BLOCKED] stack-check — ${errorMessage(error)}`);
  process.exitCode = 1;
});
