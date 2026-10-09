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
  pasosFuente: "cliente" | "servidor" | null;
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

/**
 * Lo que trae UNA petición sobre un turno. `null` significa «no enviado»: se conserva lo que ya había en la fila. La mezcla
 * se hace en SQL (COALESCE por columna, en un solo upsert), así que dos peticiones concurrentes sobre el mismo turno no se
 * pisan con nulos. Excepciones: `comentario` vacío lo borra y `versionApp` solo se fija la primera vez.
 */
export type ParcheFeedback = {
  turnoId: string;
  producto: ProductoFeedback;
  usuarioId: string;
  calificacion: number | null;
  motivos: string[] | null;
  comentario: string | null;
  deshecho: boolean | null;
  pedido: string | null;
  respuesta: string | null;
  solicitudId: string | null;
  conversacionId: string | null;
  herramientas: string[] | null;
  pasos: PasoAuditado[] | null;
  pasosFuente: "cliente" | "servidor" | null;
  modelo: string | null;
  costeUsd: number | null;
  latenciaMs: number | null;
  versionApp: string;
  escenaAntes: Record<string, unknown> | null;
  escenaDespues: Record<string, unknown> | null;
  diferencia: DiferenciaEscena | null;
};

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
  pasos_fuente: "cliente" | "servidor" | null;
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
  pedido, respuesta, solicitud_id, conversacion_id, herramientas, pasos, pasos_fuente, modelo, coste_usd, latencia_ms, version_app,
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
    pasosFuente: fila.pasos_fuente,
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

/** Quién creó el turno (`null` si el turno no existe todavía). */
export async function usuarioDelTurno(db: BaseDatos, producto: ProductoFeedback, turnoId: string): Promise<string | null> {
  const { rows } = await db.query<{ usuario_id: string }>("SELECT usuario_id FROM ai_feedback WHERE producto = $1 AND turno_id = $2", [producto, turnoId]);
  return rows[0]?.usuario_id ?? null;
}

/** Lo que ya ocupan los demás turnos de la conversación (turnos y bytes de escenas) y si este turno ya existe: para los topes. */
export async function volumenDeConversacion(
  db: BaseDatos,
  conversacionId: string,
  producto: ProductoFeedback,
  turnoId: string,
): Promise<{ turnos: number; bytesEscenas: number; existe: boolean }> {
  const { rows } = await db.query<{ turnos: string; bytes: string; existe: boolean }>(
    `WITH filas AS (SELECT (producto = $2 AND turno_id = $3) AS este,
        coalesce(octet_length(escena_antes::text), 0) + coalesce(octet_length(escena_despues::text), 0) AS bytes
      FROM ai_feedback WHERE conversacion_id = $1)
     SELECT count(*) FILTER (WHERE NOT este) AS turnos, coalesce(sum(bytes) FILTER (WHERE NOT este), 0) AS bytes, coalesce(bool_or(este), FALSE) AS existe FROM filas`,
    [conversacionId, producto, turnoId],
  );
  return { turnos: Number(rows[0]?.turnos ?? 0), bytesEscenas: Number(rows[0]?.bytes ?? 0), existe: rows[0]?.existe ?? false };
}

export async function obtenerPorId(db: BaseDatos, id: number): Promise<FilaFeedback | null> {
  const { rows } = await db.query<FilaSql>(`SELECT ${COLUMNAS} FROM ai_feedback WHERE id = $1`, [id]);
  return rows[0] ? aFila(rows[0]) : null;
}

export type ResultadoGuardado = { id: number; creado: boolean; calificacion: number | null; actualizadoEn: string };

function jsonONulo(valor: unknown): string | null {
  return valor === null ? null : JSON.stringify(valor);
}

/** Los pasos nuevos mandan salvo que sean del servidor y la fila ya tenga los del navegador (esos son más fieles). */
const PASOS_NUEVOS = "($13::jsonb IS NOT NULL AND NOT ($14::text = 'servidor' AND ai_feedback.pasos_fuente = 'cliente'))";

/**
 * Inserta o mezcla el turno por (producto, turnoId) en una sola sentencia. Solo lo mezcla quien lo creó: con otro
 * `usuario_id` el ON CONFLICT no toca la fila y devuelve `null` (la ruta responde TURNO_AJENO). No toca las imágenes.
 */
export async function guardar(db: BaseDatos, p: ParcheFeedback): Promise<ResultadoGuardado | null> {
  const { rows } = await db.query<{ id: string; creado: boolean; calificacion: number | null; actualizado_en: Date }>(
    `INSERT INTO ai_feedback (turno_id, producto, usuario_id, calificacion, motivos, comentario, deshecho, pedido, respuesta,
        solicitud_id, conversacion_id, herramientas, pasos, pasos_fuente, modelo, coste_usd, latencia_ms, version_app,
        escena_antes, escena_despues, diferencia)
     VALUES ($1::text, $2::text, $3::text, $4::smallint, COALESCE($5::text[], '{}'), NULLIF($6::text, ''), COALESCE($7::boolean, FALSE),
        $8::text, $9::text, $10::text, $11::text, COALESCE($12::text[], '{}'), $13::jsonb,
        CASE WHEN $13::jsonb IS NULL THEN NULL ELSE $14::text END, $15::text, $16::numeric, $17::integer, $18::text,
        $19::jsonb, $20::jsonb, $21::jsonb)
     ON CONFLICT (producto, turno_id) DO UPDATE SET
        calificacion = COALESCE($4::smallint, ai_feedback.calificacion),
        motivos = COALESCE($5::text[], ai_feedback.motivos),
        comentario = CASE WHEN $6::text IS NULL THEN ai_feedback.comentario ELSE NULLIF($6::text, '') END,
        deshecho = COALESCE($7::boolean, ai_feedback.deshecho),
        pedido = COALESCE($8::text, ai_feedback.pedido),
        respuesta = COALESCE($9::text, ai_feedback.respuesta),
        solicitud_id = COALESCE($10::text, ai_feedback.solicitud_id),
        conversacion_id = COALESCE($11::text, ai_feedback.conversacion_id),
        herramientas = CASE WHEN ${PASOS_NUEVOS} THEN COALESCE($12::text[], '{}') ELSE ai_feedback.herramientas END,
        pasos = CASE WHEN ${PASOS_NUEVOS} THEN $13::jsonb ELSE ai_feedback.pasos END,
        pasos_fuente = CASE WHEN ${PASOS_NUEVOS} THEN $14::text ELSE ai_feedback.pasos_fuente END,
        modelo = COALESCE($15::text, ai_feedback.modelo),
        coste_usd = COALESCE($16::numeric, ai_feedback.coste_usd),
        latencia_ms = COALESCE($17::integer, ai_feedback.latencia_ms),
        version_app = COALESCE(ai_feedback.version_app, $18::text),
        escena_antes = COALESCE($19::jsonb, ai_feedback.escena_antes),
        escena_despues = COALESCE($20::jsonb, ai_feedback.escena_despues),
        diferencia = COALESCE($21::jsonb, ai_feedback.diferencia),
        actualizado_en = now()
     WHERE ai_feedback.usuario_id = $3::text
     RETURNING id, (xmax = 0) AS creado, calificacion, actualizado_en`,
    [
      p.turnoId, p.producto, p.usuarioId, p.calificacion, p.motivos, p.comentario, p.deshecho, p.pedido, p.respuesta,
      p.solicitudId, p.conversacionId, p.herramientas, jsonONulo(p.pasos), p.pasosFuente, p.modelo, p.costeUsd, p.latenciaMs, p.versionApp,
      jsonONulo(p.escenaAntes), jsonONulo(p.escenaDespues), jsonONulo(p.diferencia),
    ],
  );
  const fila = rows[0];
  return fila ? { id: Number(fila.id), creado: fila.creado, calificacion: fila.calificacion, actualizadoEn: fila.actualizado_en.toISOString() } : null;
}

/** Guarda la clave de la captura; crea el turno vacío si la captura llega antes que el registro. `false` si el turno es de otro navegador. */
export async function fijarImagen(
  db: BaseDatos,
  datos: { producto: ProductoFeedback; turnoId: string; usuarioId: string; momento: MomentoCaptura; clave: string; conversacionId: string | null },
): Promise<boolean> {
  const columna = datos.momento === "antes" ? "imagen_antes" : "imagen_despues";
  const { rowCount } = await db.query(
    `INSERT INTO ai_feedback (turno_id, producto, usuario_id, ${columna}, conversacion_id) VALUES ($1, $2, $3, $4, $5::text)
     ON CONFLICT (producto, turno_id) DO UPDATE SET ${columna} = EXCLUDED.${columna},
        conversacion_id = COALESCE(ai_feedback.conversacion_id, $5::text), actualizado_en = now()
     WHERE ai_feedback.usuario_id = EXCLUDED.usuario_id`,
    [datos.turnoId, datos.producto, datos.usuarioId, datos.clave, datos.conversacionId],
  );
  return (rowCount ?? 0) > 0;
}

/* ---------- Panel de administración ---------- */

export type ConsultaFiltrada = { donde: string; valores: unknown[] };

function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, "\\$&");
}

/** WHERE parametrizado de los filtros del panel (puro: se prueba sin base). Por defecto solo las calificadas. */
export function construirFiltros(filtros: Pick<FiltrosAdmin, "producto" | "minimo" | "maximo" | "motivo" | "desde" | "hasta" | "texto" | "deshecho" | "sinCalificar" | "cursor">): ConsultaFiltrada {
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
  if (filtros.cursor !== undefined) agregar((m) => `id > ${m}`, filtros.cursor);
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
    items: pagina.rows.map(aItemListado),
  };
}

function aItemListado(fila: FilaListadoSql): FilaListado {
  return {
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
  };
}

/** Una página de la exportación CSV por id ascendente (`cursor` = último id ya exportado): memoria acotada, sin OFFSET. */
export async function paginaParaExportar(db: BaseDatos, filtros: FiltrosAdmin, cursor: number, limite: number): Promise<FilaListado[]> {
  const { donde, valores } = construirFiltros({ ...filtros, cursor });
  const { rows } = await db.query<FilaListadoSql>(`SELECT ${COLUMNAS_LISTADO} FROM ai_feedback ${donde} ORDER BY id ASC LIMIT $${valores.length + 1}`, [...valores, limite]);
  return rows.map(aItemListado);
}

/** Ids de la exportación completa (NDJSON): después se pide cada fila sola, así nunca hay varias escenas en memoria a la vez. */
export async function idsParaExportar(db: BaseDatos, filtros: FiltrosAdmin, cursor: number, limite: number): Promise<number[]> {
  const { donde, valores } = construirFiltros({ ...filtros, cursor });
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM ai_feedback ${donde} ORDER BY id ASC LIMIT $${valores.length + 1}`, [...valores, limite]);
  return rows.map((fila) => Number(fila.id));
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  // request_id y correlation_id son UUID: comparar con un id que no lo es haría fallar la consulta entera.
  if (!RE_UUID.test(solicitudId)) return [];
  const { rows } = await db.query<FilaLlamadaSql>(
    `SELECT capacidad, modelo, herramienta, vuelta, ms, resultado, coste_estimado FROM ai_call_log
     WHERE request_id = $1::uuid OR correlation_id = $1::uuid ORDER BY created_at, id LIMIT 100`,
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
