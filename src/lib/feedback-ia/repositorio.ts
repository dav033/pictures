import type { QueryResult, QueryResultRow } from "pg";
import type {
  DiferenciaEscena,
  FiltrosAdmin,
  LlamadaIaFeedback,
  MomentoCaptura,
  PasoAuditado,
  ProductoFeedback,
} from "./contrato";

/** Lo mínimo que se usa de `pg.Pool`: en las pruebas se sustituye por un doble que anota las consultas. */
export type BaseDatos = {
  query<R extends QueryResultRow = QueryResultRow>(sql: string, valores?: unknown[]): Promise<QueryResult<R>>;
};

export type FilaFeedback = {
  id: number;
  turnoId: string;
  producto: ProductoFeedback;
  usuarioId: string;
  creadoEn: string;
  actualizadoEn: string;
  calificacion: number | null;
  motivos: string[];
  comentario: string | null;
  deshecho: boolean;
  pedido: string | null;
  respuesta: string | null;
  solicitudId: string | null;
  conversacionId: string | null;
  herramientas: string[];
  pasos: PasoAuditado[] | null;
  modelo: string | null;
  costeUsd: number | null;
  latenciaMs: number | null;
  versionApp: string | null;
  escenaAntes: Record<string, unknown> | null;
  escenaDespues: Record<string, unknown> | null;
  diferencia: DiferenciaEscena | null;
  imagenAntes: string | null;
  imagenDespues: string | null;
};

/** Lo que escribe el registro del turno; las claves de imagen se fijan aparte (`fijarImagen`). */
export type DatosFeedback = Omit<FilaFeedback, "id" | "creadoEn" | "actualizadoEn" | "imagenAntes" | "imagenDespues">;

type FilaSql = {
  id: string;
  turno_id: string;
  producto: ProductoFeedback;
  usuario_id: string;
  creado_en: Date;
  actualizado_en: Date;
  calificacion: number | null;
  motivos: string[];
  comentario: string | null;
  deshecho: boolean;
  pedido: string | null;
  respuesta: string | null;
  solicitud_id: string | null;
  conversacion_id: string | null;
  herramientas: string[];
  pasos: PasoAuditado[] | null;
  modelo: string | null;
  coste_usd: string | null;
  latencia_ms: number | null;
  version_app: string | null;
  escena_antes: Record<string, unknown> | null;
  escena_despues: Record<string, unknown> | null;
  diferencia: DiferenciaEscena | null;
  imagen_antes: string | null;
  imagen_despues: string | null;
};

const COLUMNAS = `id, turno_id, producto, usuario_id, creado_en, actualizado_en, calificacion, motivos, comentario, deshecho,
  pedido, respuesta, solicitud_id, conversacion_id, herramientas, pasos, modelo, coste_usd, latencia_ms, version_app,
  escena_antes, escena_despues, diferencia, imagen_antes, imagen_despues`;

/** Columnas del listado y de la exportación CSV: sin escenas ni pasos (pesan cientos de kB por fila). */
const COLUMNAS_LISTADO = `id, turno_id, producto, creado_en, calificacion, motivos, comentario, deshecho, pedido, modelo,
  coste_usd, latencia_ms, herramientas, imagen_antes IS NOT NULL AS tiene_antes, imagen_despues IS NOT NULL AS tiene_despues`;

const ORDEN_PEOR_PRIMERO = "ORDER BY calificacion ASC NULLS LAST, creado_en DESC, id DESC";

function aFila(fila: FilaSql): FilaFeedback {
  return {
    id: Number(fila.id),
    turnoId: fila.turno_id,
    producto: fila.producto,
    usuarioId: fila.usuario_id,
    creadoEn: fila.creado_en.toISOString(),
    actualizadoEn: fila.actualizado_en.toISOString(),
    calificacion: fila.calificacion,
    motivos: fila.motivos,
    comentario: fila.comentario,
    deshecho: fila.deshecho,
    pedido: fila.pedido,
    respuesta: fila.respuesta,
    solicitudId: fila.solicitud_id,
    conversacionId: fila.conversacion_id,
    herramientas: fila.herramientas,
    pasos: fila.pasos,
    modelo: fila.modelo,
    costeUsd: fila.coste_usd === null ? null : Number(fila.coste_usd),
    latenciaMs: fila.latencia_ms,
    versionApp: fila.version_app,
    escenaAntes: fila.escena_antes,
    escenaDespues: fila.escena_despues,
    diferencia: fila.diferencia,
    imagenAntes: fila.imagen_antes,
    imagenDespues: fila.imagen_despues,
  };
}

export async function obtenerPorTurno(db: BaseDatos, producto: ProductoFeedback, turnoId: string): Promise<FilaFeedback | null> {
  const { rows } = await db.query<FilaSql>(`SELECT ${COLUMNAS} FROM ai_feedback WHERE producto = $1 AND turno_id = $2`, [producto, turnoId]);
  return rows[0] ? aFila(rows[0]) : null;
}

export async function obtenerPorId(db: BaseDatos, id: number): Promise<FilaFeedback | null> {
  const { rows } = await db.query<FilaSql>(`SELECT ${COLUMNAS} FROM ai_feedback WHERE id = $1`, [id]);
  return rows[0] ? aFila(rows[0]) : null;
}

export type ResultadoGuardado = { id: number; creado: boolean; actualizadoEn: string };

function jsonONulo(valor: unknown): string | null {
  return valor === null ? null : JSON.stringify(valor);
}

/**
 * Inserta o actualiza el turno por (producto, turnoId). Solo lo actualiza quien lo creó: con otro `usuario_id` el
 * ON CONFLICT no toca la fila y devuelve `null` (la ruta responde TURNO_AJENO). No toca las claves de imagen.
 */
export async function guardar(db: BaseDatos, d: DatosFeedback): Promise<ResultadoGuardado | null> {
  const { rows } = await db.query<{ id: string; creado: boolean; actualizado_en: Date }>(
    `INSERT INTO ai_feedback (turno_id, producto, usuario_id, calificacion, motivos, comentario, deshecho, pedido, respuesta,
        solicitud_id, conversacion_id, herramientas, pasos, modelo, coste_usd, latencia_ms, version_app,
        escena_antes, escena_despues, diferencia)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
     ON CONFLICT (producto, turno_id) DO UPDATE SET
        calificacion = EXCLUDED.calificacion, motivos = EXCLUDED.motivos, comentario = EXCLUDED.comentario,
        deshecho = EXCLUDED.deshecho, pedido = EXCLUDED.pedido, respuesta = EXCLUDED.respuesta,
        solicitud_id = EXCLUDED.solicitud_id, conversacion_id = EXCLUDED.conversacion_id,
        herramientas = EXCLUDED.herramientas, pasos = EXCLUDED.pasos, modelo = EXCLUDED.modelo,
        coste_usd = EXCLUDED.coste_usd, latencia_ms = EXCLUDED.latencia_ms, version_app = EXCLUDED.version_app,
        escena_antes = EXCLUDED.escena_antes, escena_despues = EXCLUDED.escena_despues,
        diferencia = EXCLUDED.diferencia, actualizado_en = now()
     WHERE ai_feedback.usuario_id = EXCLUDED.usuario_id
     RETURNING id, (xmax = 0) AS creado, actualizado_en`,
    [
      d.turnoId, d.producto, d.usuarioId, d.calificacion, d.motivos, d.comentario, d.deshecho, d.pedido, d.respuesta,
      d.solicitudId, d.conversacionId, d.herramientas, jsonONulo(d.pasos), d.modelo, d.costeUsd, d.latenciaMs, d.versionApp,
      jsonONulo(d.escenaAntes), jsonONulo(d.escenaDespues), jsonONulo(d.diferencia),
    ],
  );
  const fila = rows[0];
  return fila ? { id: Number(fila.id), creado: fila.creado, actualizadoEn: fila.actualizado_en.toISOString() } : null;
}

/** Guarda la clave de la captura; crea el turno vacío si la captura llega antes que el registro. `false` si el turno es de otra persona. */
export async function fijarImagen(
  db: BaseDatos,
  datos: { producto: ProductoFeedback; turnoId: string; usuarioId: string; momento: MomentoCaptura; clave: string },
): Promise<boolean> {
  const columna = datos.momento === "antes" ? "imagen_antes" : "imagen_despues";
  const { rowCount } = await db.query(
    `INSERT INTO ai_feedback (turno_id, producto, usuario_id, ${columna}) VALUES ($1, $2, $3, $4)
     ON CONFLICT (producto, turno_id) DO UPDATE SET ${columna} = EXCLUDED.${columna}, actualizado_en = now()
     WHERE ai_feedback.usuario_id = EXCLUDED.usuario_id`,
    [datos.turnoId, datos.producto, datos.usuarioId, datos.clave],
  );
  return (rowCount ?? 0) > 0;
}

/* ---------- Panel de administración ---------- */

export type ConsultaFiltrada = { donde: string; valores: unknown[] };

function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, "\\$&");
}

/** WHERE parametrizado de los filtros del panel (puro: se prueba sin base). Por defecto solo las calificadas. */
export function construirFiltros(filtros: Pick<FiltrosAdmin, "producto" | "minimo" | "maximo" | "motivo" | "desde" | "hasta" | "texto" | "deshecho" | "sinCalificar">): ConsultaFiltrada {
  const condiciones: string[] = [];
  const valores: unknown[] = [];
  const agregar = (condicion: (marcador: string) => string, valor: unknown) => {
    valores.push(valor);
    condiciones.push(condicion(`$${valores.length}`));
  };
  if (!filtros.sinCalificar) condiciones.push("calificacion IS NOT NULL");
  if (filtros.producto) agregar((m) => `producto = ${m}`, filtros.producto);
  if (filtros.minimo !== undefined) agregar((m) => `calificacion >= ${m}`, filtros.minimo);
  if (filtros.maximo !== undefined) agregar((m) => `calificacion <= ${m}`, filtros.maximo);
  if (filtros.motivo) agregar((m) => `${m} = ANY(motivos)`, filtros.motivo);
  if (filtros.desde) agregar((m) => `creado_en >= ${m}::date`, filtros.desde);
  if (filtros.hasta) agregar((m) => `creado_en < (${m}::date + 1)`, filtros.hasta);
  if (filtros.deshecho) condiciones.push("deshecho = TRUE");
  if (filtros.texto) agregar((m) => `(pedido ILIKE ${m} OR comentario ILIKE ${m} OR respuesta ILIKE ${m})`, `%${escaparLike(filtros.texto)}%`);
  return { donde: condiciones.length > 0 ? `WHERE ${condiciones.join(" AND ")}` : "", valores };
}

type FilaListadoSql = Pick<FilaSql, "id" | "turno_id" | "producto" | "creado_en" | "calificacion" | "motivos" | "comentario" | "deshecho" | "pedido" | "modelo" | "coste_usd" | "latencia_ms" | "herramientas"> & {
  tiene_antes: boolean;
  tiene_despues: boolean;
};

export type FilaListado = Pick<FilaFeedback, "id" | "turnoId" | "producto" | "creadoEn" | "calificacion" | "motivos" | "comentario" | "deshecho" | "pedido" | "modelo" | "costeUsd" | "latenciaMs" | "herramientas"> & {
  tieneImagenAntes: boolean;
  tieneImagenDespues: boolean;
};

/** Peor calificación primero; a igual nota, lo más reciente. */
export async function listar(db: BaseDatos, filtros: FiltrosAdmin, limite: number, desplazamiento: number): Promise<{ total: number; items: FilaListado[] }> {
  const { donde, valores } = construirFiltros(filtros);
  const [conteo, pagina] = await Promise.all([
    db.query<{ total: string }>(`SELECT count(*) AS total FROM ai_feedback ${donde}`, valores),
    db.query<FilaListadoSql>(
      `SELECT ${COLUMNAS_LISTADO} FROM ai_feedback ${donde} ${ORDEN_PEOR_PRIMERO} LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
      [...valores, limite, desplazamiento],
    ),
  ]);
  return {
    total: Number(conteo.rows[0]?.total ?? 0),
    items: pagina.rows.map((fila) => ({
      id: Number(fila.id),
      turnoId: fila.turno_id,
      producto: fila.producto,
      creadoEn: fila.creado_en.toISOString(),
      calificacion: fila.calificacion,
      motivos: fila.motivos,
      comentario: fila.comentario,
      deshecho: fila.deshecho,
      pedido: fila.pedido,
      modelo: fila.modelo,
      costeUsd: fila.coste_usd === null ? null : Number(fila.coste_usd),
      latenciaMs: fila.latencia_ms,
      herramientas: fila.herramientas,
      tieneImagenAntes: fila.tiene_antes,
      tieneImagenDespues: fila.tiene_despues,
    })),
  };
}

/** Exportación JSON completa del filtro (escenas, pasos y diferencia incluidos), hasta `tope` filas. */
export async function exportarCompleto(db: BaseDatos, filtros: FiltrosAdmin, tope: number): Promise<FilaFeedback[]> {
  const { donde, valores } = construirFiltros(filtros);
  const { rows } = await db.query<FilaSql>(`SELECT ${COLUMNAS} FROM ai_feedback ${donde} ${ORDEN_PEOR_PRIMERO} LIMIT $${valores.length + 1}`, [...valores, tope]);
  return rows.map(aFila);
}

type FilaLlamadaSql = {
  capacidad: string;
  modelo: string;
  herramienta: string | null;
  vuelta: number | null;
  ms: number;
  resultado: string;
  coste_estimado: string | null;
};

/** Llamadas a modelos del turno en `ai_call_log`, unidas por el id de solicitud (`request_id` o `correlation_id`). */
export async function llamadasIaDeSolicitud(db: BaseDatos, solicitudId: string): Promise<LlamadaIaFeedback[]> {
  const { rows } = await db.query<FilaLlamadaSql>(
    `SELECT capacidad, modelo, herramienta, vuelta, ms, resultado, coste_estimado FROM ai_call_log
     WHERE request_id::text = $1 OR correlation_id::text = $1 ORDER BY created_at, id LIMIT 100`,
    [solicitudId],
  );
  return rows.map((fila) => ({
    capacidad: fila.capacidad,
    modelo: fila.modelo,
    herramienta: fila.herramienta,
    vuelta: fila.vuelta,
    ms: fila.ms,
    resultado: fila.resultado,
    costeEstimadoUsd: fila.coste_estimado === null ? null : Number(fila.coste_estimado),
  }));
}
