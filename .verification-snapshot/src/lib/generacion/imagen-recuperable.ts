import { z } from "zod";
import { CABECERA_SOLICITUD_IMAGEN } from "./pedir-imagen";

export { CABECERA_SOLICITUD_IMAGEN };

/**
 * La imagen de /api/generate guardada unas horas por su id de solicitud, para recuperarla sin volver a pagarla.
 *
 * Producción, 2026-10-07 (guiada-20261007-071126-x7w4dx): el servidor generó la imagen y respondió 200, pero en el
 * móvil la respuesta no llegó («NetworkError») y la guiada dijo que no pudo dibujarla. Ahora, si el navegador manda
 * `x-solicitud-imagen` (un UUID que él mismo crea por intento), el servidor anota la solicitud «en_curso» al empezar y
 * guarda la imagen ya aligerada antes de responder; ante un corte, el navegador pregunta por ese id
 * (/api/generate/recuperar) antes de pedir otra imagen.
 *
 * Dónde: en Postgres (el mismo `DATABASE_URL` de la auditoría de planes). En Vercel `/tmp` es efímero y de cada
 * instancia, así que la consulta podía caer en otra instancia y no encontrar nada. La tabla se crea sola la primera
 * vez (idempotente) y también tiene su migración (scripts/migrations/027_imagen_generada_recuperable.sql).
 *
 * Nada de esto puede tumbar una generación: cada función atrapa sus errores y los devuelve como dato.
 */

/** Lo mínimo de `pg.Pool` que se usa aquí (las pruebas pasan un doble). */
export interface ConsultorPg {
  query(texto: string, valores?: unknown[]): Promise<{ rows: unknown[] }>;
}

export const SolicitudImagenSchema = z.string().uuid();
export const PlanHashImagenSchema = z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/);
/** Cuánto vive una imagen recuperable: basta con cubrir un corte de red y su reintento. */
export const VIDA_IMAGEN_RECUPERABLE_HORAS = 6;
/**
 * Una solicitud «en_curso» más vieja que esto ya no va a terminar: /api/generate tiene `maxDuration = 120` s, así
 * que la función murió (o la cortaron) sin anotar el final.
 */
export const EN_CURSO_CADUCA_MS = 135_000;

const TABLA = "imagen_generada_recuperable";

export const DDL_IMAGEN_RECUPERABLE = `
CREATE TABLE IF NOT EXISTS ${TABLA} (
  solicitud_id UUID PRIMARY KEY,
  plan_hash TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('en_curso', 'lista', 'fallida')),
  mime TEXT,
  datos BYTEA,
  aviso_no_cotizado TEXT,
  creada TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizada TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira TIMESTAMPTZ NOT NULL DEFAULT now() + interval '${VIDA_IMAGEN_RECUPERABLE_HORAS} hours'
);
CREATE INDEX IF NOT EXISTS ${TABLA}_expira_idx ON ${TABLA} (expira);
`;

const tablasListas = new WeakMap<ConsultorPg, Promise<void>>();

/** Crea la tabla una vez por pool; si falla, el siguiente intento lo vuelve a probar. */
function asegurarTabla(db: ConsultorPg): Promise<void> {
  const lista = tablasListas.get(db);
  if (lista) return lista;
  const nueva = db.query(DDL_IMAGEN_RECUPERABLE).then(() => undefined);
  tablasListas.set(db, nueva);
  nueva.catch(() => tablasListas.delete(db));
  return nueva;
}

export function solicitudImagenDe(cabeceras: Headers): string | null {
  const valida = SolicitudImagenSchema.safeParse(cabeceras.get(CABECERA_SOLICITUD_IMAGEN)?.trim());
  return valida.success ? valida.data.toLowerCase() : null;
}

export type ResultadoEscritura = { ok: true } | { ok: false; error: string };

function comoError(error: unknown): ResultadoEscritura {
  return { ok: false, error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) };
}

/** Espera la promesa hasta `ms`; después sigue sin ella (la escritura puede terminar sola más tarde). */
export async function conLimite<T>(promesa: Promise<T>, ms: number, alVencer: T): Promise<T> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const vencida = new Promise<T>((resolver) => { reloj = setTimeout(() => resolver(alVencer), ms); });
  try {
    return await Promise.race([promesa, vencida]);
  } finally {
    if (reloj) clearTimeout(reloj);
  }
}

/** La solicitud empezó: quien pregunte sabrá que la imagen viene en camino. No pisa una fila existente. */
export async function marcarImagenEnCurso(db: ConsultorPg, datos: { solicitudId: string; planHash: string }): Promise<ResultadoEscritura> {
  try {
    await asegurarTabla(db);
    await db.query(
      `INSERT INTO ${TABLA} (solicitud_id, plan_hash, estado) VALUES ($1::uuid, $2, 'en_curso') ON CONFLICT (solicitud_id) DO NOTHING`,
      [datos.solicitudId, datos.planHash],
    );
    return { ok: true };
  } catch (error) {
    return comoError(error);
  }
}

/** La imagen (ya aligerada) queda lista para recuperarse. Solo la misma solicitud del mismo plan la puede escribir. */
export async function guardarImagenLista(
  db: ConsultorPg,
  datos: { solicitudId: string; planHash: string; mime: string; bytes: Buffer; avisoNoCotizado?: string | null },
): Promise<ResultadoEscritura> {
  try {
    await asegurarTabla(db);
    await db.query(
      `INSERT INTO ${TABLA} (solicitud_id, plan_hash, estado, mime, datos, aviso_no_cotizado)
       VALUES ($1::uuid, $2, 'lista', $3, $4, $5)
       ON CONFLICT (solicitud_id) DO UPDATE
         SET estado = 'lista', mime = EXCLUDED.mime, datos = EXCLUDED.datos, aviso_no_cotizado = EXCLUDED.aviso_no_cotizado, actualizada = now()
       WHERE ${TABLA}.plan_hash = EXCLUDED.plan_hash`,
      [datos.solicitudId, datos.planHash, datos.mime, datos.bytes, datos.avisoNoCotizado ?? null],
    );
    // Limpieza de paso: las caducadas no se leen (`expira > now()`), aquí además se borran.
    await db.query(`DELETE FROM ${TABLA} WHERE expira <= now()`).catch(() => undefined);
    return { ok: true };
  } catch (error) {
    return comoError(error);
  }
}

/** La generación falló: quien pregunte ya no espera; la imagen no existe. */
export async function marcarImagenFallida(db: ConsultorPg, datos: { solicitudId: string }): Promise<ResultadoEscritura> {
  try {
    await asegurarTabla(db);
    await db.query(`UPDATE ${TABLA} SET estado = 'fallida', actualizada = now() WHERE solicitud_id = $1::uuid AND estado = 'en_curso'`, [datos.solicitudId]);
    return { ok: true };
  } catch (error) {
    return comoError(error);
  }
}

export type ImagenRecuperable =
  | { estado: "lista"; imagen: string; avisoNoCotizado?: string }
  | { estado: "en_curso" }
  | { estado: "fallida" }
  | { estado: "no_encontrada" };

const FilaSchema = z.object({
  estado: z.enum(["en_curso", "lista", "fallida"]),
  mime: z.string().nullable(),
  datos: z.instanceof(Uint8Array).nullable(),
  aviso_no_cotizado: z.string().nullable(),
  edad_ms: z.union([z.number(), z.string()]).transform((valor) => Number(valor)),
});

const MIMES_IMAGEN = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Lo que hay para esta solicitud de este plan. Un `en_curso` caducado se informa como `fallida`. */
export async function leerImagenRecuperable(db: ConsultorPg, datos: { solicitudId: string; planHash: string }): Promise<ImagenRecuperable> {
  await asegurarTabla(db);
  const { rows } = await db.query(
    `SELECT estado, mime, datos, aviso_no_cotizado, (EXTRACT(EPOCH FROM (now() - actualizada)) * 1000)::float8 AS edad_ms
     FROM ${TABLA}
     WHERE solicitud_id = $1::uuid AND plan_hash = $2 AND expira > now()
     LIMIT 1`,
    [datos.solicitudId, datos.planHash],
  );
  if (!rows.length) return { estado: "no_encontrada" };
  const fila = FilaSchema.parse(rows[0]);
  if (fila.estado === "en_curso") return fila.edad_ms > EN_CURSO_CADUCA_MS ? { estado: "fallida" } : { estado: "en_curso" };
  if (fila.estado === "fallida") return { estado: "fallida" };
  if (!fila.datos?.length || !fila.mime || !MIMES_IMAGEN.has(fila.mime)) return { estado: "fallida" };
  return {
    estado: "lista",
    imagen: `data:${fila.mime};base64,${Buffer.from(fila.datos).toString("base64")}`,
    ...(fila.aviso_no_cotizado ? { avisoNoCotizado: fila.aviso_no_cotizado } : {}),
  };
}
