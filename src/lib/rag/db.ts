import "server-only";
import { Pool } from "pg";
import { instalarReintentoLectura } from "./db-reintento";

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
      // Neon closes idle connections and suspends compute after ~5 minutes
      // (E2E 2026-09-14: 502 "Connection terminated unexpectedly"). Idle
      // clients are released well before that, every client is recycled before
      // it could reach it, and TCP keepalive detects a dropped link early.
      idleTimeoutMillis: 20_000,
      maxLifetimeSeconds: 240,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 30_000,
    });
    // An idle client whose connection drops emits on the pool; without a
    // listener that error would crash the process. `pg` already removed it.
    globalThis.__ragPool.on("error", (error) => {
      console.warn("[rag-db] conexión inactiva cerrada por el servidor", { mensaje: error.message });
    });
    instalarReintentoLectura(globalThis.__ragPool, {
      alReintentar: (error) => console.warn("[rag-db] reintento de lectura tras conexión terminada", { mensaje: error.message }),
    });
  }
  return globalThis.__ragPool;
}
