import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "pg";
import { poolConfigFromDsn } from "../src/lib/asesor/db";

export const ASESOR_MIGRATIONS_DIR = path.join(process.cwd(), "scripts", "migrations-asesor");
/** Own ledger: the Neon `schema_migrations` table is never read or written here. */
export const ASESOR_LEDGER = "asesor_schema_migrations";
export const ASESOR_DEFAULT_SCHEMA = "asesor";
const LOCK_KEY = 1836345459;

const checksumOf = (sql: string) => createHash("sha256").update(sql, "utf-8").digest("hex");

export type ApplyOptions = { dir?: string; schema?: string };

/** Applies pending advisor migrations on one connected client. Re-running is a no-op. */
export async function applyAsesorMigrations(client: Client, options: ApplyOptions = {}): Promise<{ applied: string[]; skipped: string[] }> {
  const dir = options.dir ?? ASESOR_MIGRATIONS_DIR;
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const schema = options.schema ?? ASESOR_DEFAULT_SCHEMA;
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`Invalid schema name: ${schema}`);
  // Keep the advisory lock and all DDL in one transaction: transaction poolers pin a backend only
  // for a transaction, so a session lock could be acquired and released on different backends.
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK_KEY]);
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await client.query(`SET LOCAL search_path TO ${schema}`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${ASESOR_LEDGER} (filename TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    );
    const rows = (await client.query<{ filename: string; checksum: string }>(
      `SELECT filename, checksum FROM ${ASESOR_LEDGER}`,
    )).rows;
    const done = new Map(rows.map((r) => [r.filename, r.checksum]));
    const applied: string[] = [];
    const skipped: string[] = [];
    for (const file of files) {
      const sql = readFileSync(path.join(dir, file), "utf-8").replace(/\r\n/g, "\n");
      const checksum = checksumOf(sql);
      const previous = done.get(file);
      if (previous !== undefined) {
        if (previous !== checksum) throw new Error(`Advisor migration ${file} changed after being applied.`);
        skipped.push(file);
        continue;
      }
      await client.query(sql);
      await client.query(`INSERT INTO ${ASESOR_LEDGER} (filename, checksum) VALUES ($1, $2)`, [file, checksum]);
      applied.push(file);
    }
    await client.query("COMMIT");
    return { applied, skipped };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function main() {
  // Explicit test target: --test-target reads ASESOR_TEST_DATABASE_URL instead of SUPABASE_DB_URL.
  const useTest = process.argv.includes("--test-target");
  const dsn = useTest ? process.env.ASESOR_TEST_DATABASE_URL : process.env.SUPABASE_DB_URL;
  if (!dsn) throw new Error(`${useTest ? "ASESOR_TEST_DATABASE_URL" : "SUPABASE_DB_URL"} no está configurada.`);
  const schemaArg = process.argv.find((a) => a.startsWith("--schema="))?.slice("--schema=".length);
  const host = new URL(dsn).hostname;
  console.log(`Destino: ${host} (${useTest ? "test" : "supabase"})${schemaArg ? ` schema=${schemaArg}` : ""}`);
  const client = new Client(poolConfigFromDsn(dsn));
  await client.connect();
  try {
    const { applied, skipped } = await applyAsesorMigrations(client, { schema: schemaArg });
    console.log(`[PASS] ${applied.length} aplicada(s), ${skipped.length} ya estaban.`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("[FAIL] migración asesor falló:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
