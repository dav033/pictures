import "server-only";
import { Pool } from "pg";

declare global {
  var __ragPool: Pool | undefined;
}

export function getRagPool(): Pool {
  if (!globalThis.__ragPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL no está configurada (Postgres del pipeline RAG).");
    globalThis.__ragPool = new Pool({ connectionString: url });
  }
  return globalThis.__ragPool;
}
