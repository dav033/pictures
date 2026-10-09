import type { ClienteAlmacen } from "@/lib/almacen/objetos-s3";
import type { BaseDatos } from "./repositorio";

/**
 * Retención del feedback (REQ-010): lo que NUNCA se calificó, deshizo ni comentó se borra a los 30 días (fila e imágenes), y
 * las imágenes del almacén que ninguna fila referencia (una subida que no llegó a registrarse) también. Lo valorado se
 * conserva: es el material del análisis. Se invoca desde el cron del análisis y desde `npm run feedback:analizar`.
 */

export const DIAS_RETENCION = 30;
const DIA_MS = 24 * 60 * 60 * 1000;
const TAMANO_LOTE = 200;
const MAX_LOTES = 20;
const MAX_PAGINAS_LISTADO = 5;
const MAX_HUERFANAS_POR_CORRIDA = 500;
const PREFIJO_CAPTURAS = "feedback/";

export type ResultadoRetencion = {
  filasBorradas: number;
  imagenesBorradas: number;
  huerfanasBorradas: number;
  /** Filas que se dejaron para la próxima corrida (sin almacén configurado o con una imagen que no se pudo borrar). */
  filasPendientes: number;
};

type FilaVencida = { id: string; imagen_antes: string | null; imagen_despues: string | null };

async function filasVencidas(db: BaseDatos, antesDe: Date, despuesDeId: number): Promise<FilaVencida[]> {
  const { rows } = await db.query<FilaVencida>(
    `SELECT id, imagen_antes, imagen_despues FROM ai_feedback
     WHERE calificacion IS NULL AND deshecho = FALSE AND comentario IS NULL AND actualizado_en < $1 AND id > $2
     ORDER BY id LIMIT $3`,
    [antesDe, despuesDeId, TAMANO_LOTE],
  );
  return rows;
}

async function borrarFilas(db: BaseDatos, ids: number[]): Promise<void> {
  if (ids.length > 0) await db.query("DELETE FROM ai_feedback WHERE id = ANY($1::bigint[])", [ids]);
}

async function clavesReferenciadas(db: BaseDatos, claves: string[]): Promise<Set<string>> {
  const { rows } = await db.query<{ imagen_antes: string | null; imagen_despues: string | null }>(
    "SELECT imagen_antes, imagen_despues FROM ai_feedback WHERE imagen_antes = ANY($1::text[]) OR imagen_despues = ANY($1::text[])",
    [claves],
  );
  return new Set(rows.flatMap((fila) => [fila.imagen_antes, fila.imagen_despues]).filter((clave): clave is string => clave !== null));
}

async function borrarSinCalificar(db: BaseDatos, almacen: ClienteAlmacen | null, antesDe: Date, resultado: ResultadoRetencion): Promise<void> {
  let ultimoId = 0;
  for (let lote = 0; lote < MAX_LOTES; lote++) {
    const filas = await filasVencidas(db, antesDe, ultimoId);
    if (filas.length === 0) return;
    const borrables: number[] = [];
    for (const fila of filas) {
      ultimoId = Number(fila.id);
      const claves = [fila.imagen_antes, fila.imagen_despues].filter((clave): clave is string => clave !== null);
      if (claves.length > 0 && !almacen) {
        resultado.filasPendientes += 1;
        continue;
      }
      try {
        for (const clave of claves) await almacen?.borrar(clave);
        resultado.imagenesBorradas += claves.length;
        borrables.push(ultimoId);
      } catch {
        resultado.filasPendientes += 1;
      }
    }
    await borrarFilas(db, borrables);
    resultado.filasBorradas += borrables.length;
    if (filas.length < TAMANO_LOTE) return;
  }
}

async function borrarHuerfanas(db: BaseDatos, almacen: ClienteAlmacen, antesDe: Date, resultado: ResultadoRetencion): Promise<void> {
  let token: string | undefined;
  for (let pagina = 0; pagina < MAX_PAGINAS_LISTADO; pagina++) {
    const { objetos, siguiente } = await almacen.listar(PREFIJO_CAPTURAS, token);
    const viejas = objetos.filter((objeto) => objeto.modificado < antesDe).map((objeto) => objeto.clave);
    const referenciadas = viejas.length > 0 ? await clavesReferenciadas(db, viejas) : new Set<string>();
    for (const clave of viejas) {
      if (referenciadas.has(clave) || resultado.huerfanasBorradas >= MAX_HUERFANAS_POR_CORRIDA) continue;
      await almacen.borrar(clave);
      resultado.huerfanasBorradas += 1;
    }
    if (!siguiente) return;
    token = siguiente;
  }
}

export async function aplicarRetencion(deps: { db: BaseDatos; almacen: ClienteAlmacen | null; ahora?: () => Date }): Promise<ResultadoRetencion> {
  const antesDe = new Date((deps.ahora?.() ?? new Date()).getTime() - DIAS_RETENCION * DIA_MS);
  const resultado: ResultadoRetencion = { filasBorradas: 0, imagenesBorradas: 0, huerfanasBorradas: 0, filasPendientes: 0 };
  await borrarSinCalificar(deps.db, deps.almacen, antesDe, resultado);
  if (deps.almacen) await borrarHuerfanas(deps.db, deps.almacen, antesDe, resultado);
  return resultado;
}
