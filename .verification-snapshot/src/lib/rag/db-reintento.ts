import type { Pool } from "pg";

/**
 * Bounded retry for read-only queries on a connection the server already
 * closed. E2E 2026-09-14: after ~5 minutes idle, `/api/chat` failed with 502
 * "Connection terminated unexpectedly" (Neon closes idle connections and
 * suspends compute). `pg` discards the broken client on that error, so running
 * the same statement once more takes a fresh connection.
 *
 * Only single read-only statements are retried: a write may have been applied
 * before the connection dropped, and a statement inside a client transaction
 * cannot be replayed alone (those use `pool.connect()` and are not wrapped).
 * Pure except for the wrapped pool; no environment or provider access.
 */

const MENSAJES_CONEXION_TERMINADA = [
  /connection terminated/i,
  /server closed the connection unexpectedly/i,
  /terminating connection due to administrator command/i,
  /client has encountered a connection error and is not queryable/i,
  /connection (?:was )?closed/i,
];
const CODIGOS_CONEXION_TERMINADA = new Set(["ECONNRESET", "EPIPE", "57P01", "57P02", "57P03"]);

export function esErrorConexionTerminada(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const codigo = (error as { code?: unknown }).code;
  if (typeof codigo === "string" && CODIGOS_CONEXION_TERMINADA.has(codigo)) return true;
  return MENSAJES_CONEXION_TERMINADA.some((patron) => patron.test(error.message));
}

const ESCRITURA_O_EFECTO = /\b(?:insert|update|delete|merge|upsert|copy|create|alter|drop|truncate|grant|revoke|lock|call|do|nextval|setval|pg_advisory\w*|set_config|notify|vacuum|refresh)\b|\bfor\s+(?:no\s+key\s+)?(?:update|share)\b/i;

/** A single SELECT/WITH statement without writes, locks or side-effect functions. */
export function esConsultaSoloLectura(sql: string): boolean {
  const limpio = sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").trim();
  if (!/^(?:select|with)\b/i.test(limpio)) return false;
  if (limpio.replace(/;\s*$/, "").includes(";")) return false;
  return !ESCRITURA_O_EFECTO.test(limpio);
}

function textoConsulta(argumento: unknown): string | null {
  if (typeof argumento === "string") return argumento;
  if (argumento && typeof argumento === "object" && typeof (argumento as { text?: unknown }).text === "string") {
    return (argumento as { text: string }).text;
  }
  return null;
}

type QueryFn = (...args: unknown[]) => unknown;

/**
 * Wraps `pool.query` (promise form only; callback and submittable forms pass
 * through) so a read-only statement that fails because its connection was
 * terminated runs again, at most `reintentos` times.
 */
export function instalarReintentoLectura<T extends Pick<Pool, "query">>(
  pool: T,
  opciones: { reintentos?: number; alReintentar?: (error: Error) => void } = {},
): T {
  const reintentos = Math.max(0, Math.min(2, opciones.reintentos ?? 1));
  const original = (pool.query as unknown as QueryFn).bind(pool);
  const conReintento: QueryFn = (...args) => {
    const sql = textoConsulta(args[0]);
    const tieneCallback = args.some((argumento) => typeof argumento === "function");
    const esSubmittable = Boolean(args[0] && typeof (args[0] as { submit?: unknown }).submit === "function");
    if (tieneCallback || esSubmittable || sql === null || !esConsultaSoloLectura(sql)) return original(...args);
    const intentar = async (restantes: number): Promise<unknown> => {
      try {
        return await original(...args);
      } catch (error) {
        if (restantes <= 0 || !esErrorConexionTerminada(error)) throw error;
        opciones.alReintentar?.(error as Error);
        return intentar(restantes - 1);
      }
    };
    return intentar(reintentos);
  };
  (pool as unknown as { query: QueryFn }).query = conReintento;
  return pool;
}
