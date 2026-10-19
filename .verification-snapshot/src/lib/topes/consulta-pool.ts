import { PlazoDeTopeVencido, PLAZO_TOPE_MS, type Consulta } from "./tipos";

type ClienteDePool = {
  query: (config: { text: string; values: unknown[]; query_timeout: number }) => Promise<{ rows: Array<Record<string, unknown>> }>;
  release: (destruir?: boolean) => void;
};
export type PoolDeTopes = { connect: () => Promise<ClienteDePool> };

/** Un error que Postgres mismo devolvió (lleva `code`): la conexión sigue sana. Cualquier otro (plazo, corte) la deja en duda. */
const esErrorDePostgres = (causa: unknown): boolean => typeof (causa as { code?: unknown } | null)?.code === "string";

/**
 * La consulta del tope sobre un pool de `pg`, con el plazo de verdad:
 * - la conexión se pide aparte de la consulta. Si el pool tarda más que el plazo (Neon dormido que se despierta, red lenta), la
 *   toma ya siguió en memoria; al llegar la conexión no se manda nada, así una toma tardía no cuenta de más ni deja el INSERT huérfano;
 * - la consulta lleva `query_timeout` con lo que queda del plazo, y si falla por algo que no es Postgres (plazo, corte) la conexión se
 *   destruye en vez de volver al pool: el servidor cancela lo que estuviera ejecutando.
 * La primera toma tras un arranque en frío de Neon puede no caber en el plazo y seguir en memoria; la conexión ya queda abierta
 * y la siguiente sonda (`PAUSA_TRAS_FALLO_MS`) responde a tiempo.
 */
export function crearConsultaDePool(pool: PoolDeTopes, reloj: () => number = Date.now): Consulta {
  return async (sql, valores, plazoMs = PLAZO_TOPE_MS) => {
    const limite = reloj() + plazoMs;
    const cliente = await pool.connect();
    let destruir = false;
    try {
      const restante = limite - reloj();
      if (restante <= 0) throw new PlazoDeTopeVencido(plazoMs);
      return await cliente.query({ text: sql, values: valores, query_timeout: restante });
    } catch (causa) {
      destruir = !esErrorDePostgres(causa) && !(causa instanceof PlazoDeTopeVencido);
      throw causa;
    } finally {
      cliente.release(destruir);
    }
  };
}

/**
 * Si los topes cuentan en Neon. Solo en el servidor de Next ya compilado para producción (Vercel, `next start`): los scripts de
 * prueba, la CI con su propia base y `next dev` (cuyo `.env.local` puede apuntar a la base de producción) cuentan en memoria y no
 * gastan ni ensucian los topes reales. `TOPES_DURABLES=1` lo fuerza (si hay `DATABASE_URL`) y `TOPES_DURABLES=0` lo apaga.
 */
export function topesDurablesActivos(env: Record<string, string | undefined> = process.env): boolean {
  const forzado = env.TOPES_DURABLES?.trim();
  if (forzado === "0" || !env.DATABASE_URL) return false;
  if (forzado === "1") return true;
  // Literales `process.env.…`: Next los sustituye al compilar el servidor; `env` cubre el proceso real (como `registroActivo`).
  const enNext = process.env.NEXT_RUNTIME === "nodejs" || env.NEXT_RUNTIME === "nodejs";
  const enProduccion = process.env.NODE_ENV === "production" || env.NODE_ENV === "production";
  return enNext && enProduccion;
}

/**
 * El pool de Neon (el del RAG). Se importa al usarlo: `server-only` impide cargar `rag/db` en los scripts de prueba sin la condición
 * `react-server`, y fuera de producción ni siquiera se intenta.
 */
export async function consultaDeNeon(): Promise<Consulta | null> {
  if (!topesDurablesActivos()) return null;
  const { getRagPool } = await import("@/lib/rag/db");
  const pool = getRagPool();
  return crearConsultaDePool({
    connect: async () => {
      const cliente = await pool.connect();
      return { query: (config) => cliente.query(config), release: (destruir) => cliente.release(destruir) };
    },
  });
}
