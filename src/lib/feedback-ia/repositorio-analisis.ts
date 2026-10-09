import type { AnalisisFeedback, MetricasAnalisis, ProductoFeedback } from "./contrato";
import type { FilaParaAnalisis } from "./analisis";
import type { BaseDatos } from "./repositorio";

export const TOPE_FILAS_ANALISIS = 20_000;

type FilaTurnoSql = {
  id: string;
  turno_id: string;
  producto: ProductoFeedback;
  calificacion: number | null;
  motivos: string[];
  comentario: string | null;
  pedido: string | null;
  herramientas: string[];
  deshecho: boolean;
};

export type DatosDelPeriodo = {
  /** Turnos valorados (calificados o deshechos) cuya última actualización cae en el periodo. */
  filas: FilaParaAnalisis[];
  /** Turnos registrados en el periodo, con o sin valorar. */
  totalTurnos: number;
  /** `true` si había más filas que `TOPE_FILAS_ANALISIS`: el análisis usa las más recientes. */
  truncado: boolean;
};

/** Se filtra por cuándo se valoró (`actualizado_en`), y lo no valorado se excluye ANTES del límite para que no lo ocupe. */
export async function filasParaAnalisis(db: BaseDatos, desde: Date, hasta: Date): Promise<DatosDelPeriodo> {
  const [valoradas, registrados] = await Promise.all([
    db.query<FilaTurnoSql>(
      `SELECT id, turno_id, producto, calificacion, motivos, comentario, pedido, herramientas, deshecho
       FROM ai_feedback WHERE (calificacion IS NOT NULL OR deshecho) AND actualizado_en >= $1 AND actualizado_en < $2
       ORDER BY id DESC LIMIT $3`,
      [desde, hasta, TOPE_FILAS_ANALISIS + 1],
    ),
    db.query<{ total: string }>("SELECT count(*) AS total FROM ai_feedback WHERE creado_en >= $1 AND creado_en < $2", [desde, hasta]),
  ]);
  return {
    filas: valoradas.rows.slice(0, TOPE_FILAS_ANALISIS).map((fila) => ({
      id: Number(fila.id),
      turnoId: fila.turno_id,
      producto: fila.producto,
      calificacion: fila.calificacion,
      motivos: fila.motivos,
      comentario: fila.comentario,
      pedido: fila.pedido,
      herramientas: fila.herramientas,
      deshecho: fila.deshecho,
    })),
    totalTurnos: Number(registrados.rows[0]?.total ?? 0),
    truncado: valoradas.rows.length > TOPE_FILAS_ANALISIS,
  };
}

type FilaAnalisisSql = {
  id: string;
  creado_en: Date;
  origen: AnalisisFeedback["origen"];
  desde: Date;
  hasta: Date;
  dias: number;
  total_turnos: number;
  total_calificados: number;
  promedio: string | null;
  metricas: MetricasAnalisis;
  resumen: string | null;
  resumen_modelo: string | null;
  resumen_coste_usd: string | null;
};

const COLUMNAS = "id, creado_en, origen, desde, hasta, dias, total_turnos, total_calificados, promedio, metricas, resumen, resumen_modelo, resumen_coste_usd";

function aAnalisis(fila: FilaAnalisisSql): AnalisisFeedback {
  return {
    id: Number(fila.id),
    creadoEn: fila.creado_en.toISOString(),
    origen: fila.origen,
    desde: fila.desde.toISOString(),
    hasta: fila.hasta.toISOString(),
    dias: fila.dias,
    totalTurnos: fila.total_turnos,
    totalCalificados: fila.total_calificados,
    promedio: fila.promedio === null ? null : Number(fila.promedio),
    metricas: fila.metricas,
    resumen: fila.resumen,
    resumenModelo: fila.resumen_modelo,
    resumenCosteUsd: fila.resumen_coste_usd === null ? null : Number(fila.resumen_coste_usd),
  };
}

export type AnalisisNuevo = Omit<AnalisisFeedback, "id" | "creadoEn" | "desde" | "hasta"> & { desde: Date; hasta: Date };

export async function guardarAnalisis(db: BaseDatos, a: AnalisisNuevo): Promise<AnalisisFeedback> {
  const { rows } = await db.query<FilaAnalisisSql>(
    `INSERT INTO ai_feedback_analisis (origen, desde, hasta, dias, total_turnos, total_calificados, promedio, metricas, resumen, resumen_modelo, resumen_coste_usd)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${COLUMNAS}`,
    [a.origen, a.desde, a.hasta, a.dias, a.totalTurnos, a.totalCalificados, a.promedio, JSON.stringify(a.metricas), a.resumen, a.resumenModelo, a.resumenCosteUsd],
  );
  return aAnalisis(rows[0]);
}

export async function ultimosAnalisis(db: BaseDatos, limite: number): Promise<AnalisisFeedback[]> {
  const { rows } = await db.query<FilaAnalisisSql>(`SELECT ${COLUMNAS} FROM ai_feedback_analisis ORDER BY creado_en DESC, id DESC LIMIT $1`, [limite]);
  return rows.map(aAnalisis);
}
