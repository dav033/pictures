import { SupuestoTokensSchema, type SupuestoTokens } from "./costo";

/**
 * Measured token usage per reference-analysis pass (Plan A §A0.3 cost
 * assumptions). Aggregates only: no request ids, texts or images leave the
 * database. The query runs inside a READ ONLY transaction.
 */

export const CONSULTA_TOKENS_ANALISIS = `
SELECT capacidad,
       COUNT(*)::int AS n,
       COUNT(*) FILTER (WHERE intento > 1)::int AS n_reintentos,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY COALESCE(tokens_entrada, 0)) AS entrada_p50,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY COALESCE(tokens_entrada, 0)) AS entrada_p95,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY COALESCE(tokens_salida, 0)) AS salida_p50,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY COALESCE(tokens_salida, 0)) AS salida_p95,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY COALESCE(tokens_pensamiento, 0)) AS pensamiento_p50,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY COALESCE(tokens_pensamiento, 0)) AS pensamiento_p95,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY COALESCE(tokens_cacheados, 0)) AS cacheados_p50,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY COALESCE(tokens_cacheados, 0)) AS cacheados_p95,
       MIN(created_at) AS desde,
       MAX(created_at) AS hasta
  FROM ai_call_log
 WHERE flujo = 'analisis_referencia'
   AND capacidad IN ('analisis_referencia_inventario', 'analisis_referencia_auditoria')
   AND resultado = 'ok'
   AND modelo = $1
   AND created_at >= now() - ($2::int * interval '1 day')
 GROUP BY capacidad`;

export type FilaTokens = {
  capacidad: string;
  n: number;
  n_reintentos: number;
  entrada_p50: number | string; entrada_p95: number | string;
  salida_p50: number | string; salida_p95: number | string;
  pensamiento_p50: number | string; pensamiento_p95: number | string;
  cacheados_p50: number | string; cacheados_p95: number | string;
  desde: Date | string; hasta: Date | string;
};

export type EjecutarLectura = (sql: string, parametros: readonly unknown[]) => Promise<FilaTokens[]>;

const redondear = (valor: number | string) => Math.ceil(Number(valor));

/** Builds the assumption file from the aggregated rows; throws when a pass has too few calls. */
export function supuestoDesdeFilas(filas: readonly FilaTokens[], opciones: { modelo: string; dias: number; minimoLlamadas: number; fecha: string }): SupuestoTokens & { reintentos: Record<string, number>; ventana: { desde: string; hasta: string } } {
  const porCapacidad = new Map(filas.map((fila) => [fila.capacidad, fila]));
  const pase = (capacidad: string) => {
    const fila = porCapacidad.get(capacidad);
    if (!fila || fila.n < opciones.minimoLlamadas) {
      throw new Error(`${capacidad}: ${fila?.n ?? 0} llamadas ok de ${opciones.modelo} en ${opciones.dias} días; se exigen ${opciones.minimoLlamadas}`);
    }
    return {
      fila,
      tokens: {
        p50: { entrada: redondear(fila.entrada_p50), salida: redondear(fila.salida_p50), pensamiento: redondear(fila.pensamiento_p50), cacheados: redondear(fila.cacheados_p50) },
        p95: { entrada: redondear(fila.entrada_p95), salida: redondear(fila.salida_p95), pensamiento: redondear(fila.pensamiento_p95), cacheados: redondear(fila.cacheados_p95) },
      },
    };
  };
  const inventario = pase("analisis_referencia_inventario");
  const auditoria = pase("analisis_referencia_auditoria");
  const fechas = [inventario.fila, auditoria.fila].flatMap((fila) => [new Date(fila.desde).getTime(), new Date(fila.hasta).getTime()]);
  const supuesto = SupuestoTokensSchema.parse({
    version: `tokens-analisis-${opciones.fecha}`,
    modelo: opciones.modelo,
    origen: `ai_call_log (solo lectura, READ ONLY), flujo analisis_referencia, resultado ok, modelo ${opciones.modelo}, últimos ${opciones.dias} días; percentiles 50 y 95 por pase redondeados hacia arriba. Tráfico mezclado (producción, local y E2E sin marca: ver REVISION-HUMANA.md)`,
    n_llamadas: inventario.fila.n + auditoria.fila.n,
    inventario: inventario.tokens,
    auditoria: auditoria.tokens,
  });
  return {
    ...supuesto,
    reintentos: { analisis_referencia_inventario: inventario.fila.n_reintentos, analisis_referencia_auditoria: auditoria.fila.n_reintentos },
    ventana: { desde: new Date(Math.min(...fechas)).toISOString().slice(0, 10), hasta: new Date(Math.max(...fechas)).toISOString().slice(0, 10) },
  };
}

export async function medirTokensAnalisis(ejecutar: EjecutarLectura, opciones: { modelo: string; dias: number; minimoLlamadas: number; fecha: string }) {
  const filas = await ejecutar(CONSULTA_TOKENS_ANALISIS, [opciones.modelo, opciones.dias]);
  return supuestoDesdeFilas(filas, opciones);
}
