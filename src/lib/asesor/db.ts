import "server-only";
import { Pool, type PoolConfig } from "pg";

/** Minimal surface the advisor repository needs; satisfied by `pg.Pool` and by test doubles. */
export type AsesorQueryResult<Row> = { rows: Row[]; rowCount: number | null };
export type AsesorClient = {
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<AsesorQueryResult<Row>>;
};
export type AsesorDb = AsesorClient & {
  /** Checks out one connection for a transaction; the caller must call `release`. */
  connect(): Promise<AsesorClient & { release(): void }>;
};

/**
 * Builds the pool config from the advisor DSN. Remote Supabase connections always use TLS;
 * loopback-only test databases may use plaintext because they never leave the local machine.
 * Supabase poolers present a certificate from a private CA that Node does not trust by default,
 * so the remote chain is encrypted but not verified.
 */
export function poolConfigFromDsn(dsn: string): PoolConfig {
  const url = new URL(dsn);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("ssl") || key === "uselibpqcompat") url.searchParams.delete(key);
  }
  return {
    connectionString: url.toString(),
    ssl: isLoopback ? false : { rejectUnauthorized: false },
    // Set the default schema during startup, before a client can run a query. A `connect` event
    // handler issuing SET asynchronously can race with the first query and is unreliable through
    // transaction poolers, which may assign a backend per transaction.
    options: "-c search_path=asesor",
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
  };
}

let pool: Pool | null = null;

/** Lazily created advisor pool. Reads only SUPABASE_DB_URL (never DATABASE_URL, which is Neon). */
export function getAsesorPool(): Pool {
  if (pool) return pool;
  const dsn = process.env.SUPABASE_DB_URL;
  if (!dsn) throw new Error("SUPABASE_DB_URL no está configurada.");
  pool = new Pool(poolConfigFromDsn(dsn));
  pool.on("error", (error) => console.error("[asesor-db] idle client error:", error.message));
  return pool;
}

export async function closeAsesorPool(): Promise<void> {
  const current = pool;
  pool = null;
  if (current) await current.end();
}
