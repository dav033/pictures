import { existsSync } from "node:fs";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

for (const archivo of [".env.local", ".env"]) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada.");

  const pool = new Pool({ connectionString: url });
  const dir = path.join(process.cwd(), "scripts", "migrations");
  const archivos = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename    TEXT PRIMARY KEY,
         applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    const { rows } = await pool.query<{ filename: string }>("SELECT filename FROM schema_migrations");
    const aplicadas = new Set(rows.map((r) => r.filename));

    let nuevas = 0;
    for (const archivo of archivos) {
      if (aplicadas.has(archivo)) continue;
      const sql = readFileSync(path.join(dir, archivo), "utf-8");
      console.log(`Aplicando ${archivo}...`);
      await pool.query("BEGIN");
      try {
        await pool.query(sql);
        await pool.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [archivo]);
        await pool.query("COMMIT");
      } catch (error) {
        await pool.query("ROLLBACK");
        throw error;
      }
      nuevas++;
    }
    console.log(`[PASS] ${nuevas} migración(es) nueva(s) aplicada(s), ${aplicadas.size} ya estaban.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[FAIL] migración falló:", error);
  process.exitCode = 1;
});
