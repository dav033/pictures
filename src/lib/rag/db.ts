import "server-only";
import { Pool } from "pg";

declare global {
  var __ragPool: Pool | undefined;
}

export function getRagPool(): Pool {
  if (!globalThis.__ragPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL no está configurada (Postgres del pipeline RAG).");
    globalThis.__ragPool = new Pool({
      connectionString: url,
      // Fase 3.7: robustez, no velocidad — el plan ya midió que subir `max`
      // a 50 no mejoró latencia (contención de pool descartada como causa),
      // así que este valor no busca throughput. `connectionTimeoutMillis`
      // es el que importa de verdad: sin él, "Postgres no disponible" no
      // fallaba rápido — el pool se quedaba esperando conectar con el
      // timeout por defecto de `pg`, indistinguible de una query lenta.
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 30_000,
    });
  }
  return globalThis.__ragPool;
}
