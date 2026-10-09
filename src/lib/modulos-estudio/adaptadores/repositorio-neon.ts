import { randomUUID } from "node:crypto";
import type { EstadoFila, FilaRender, NuevaFila, RepositorioRendersModulo } from "../puertos";

/**
 * Adaptador del puerto sobre Postgres (Neon), tabla `modulos_renders` (scripts/migrations/031_modulos_renders.sql).
 * La unicidad de `clave` (clave primaria) es lo que hace atómico `reservar`: de dos INSERT simultáneos solo uno inserta.
 * Cada reserva lleva una ficha (`dueno`): completar, liberar y reclamar filtran por ella, así quien tardó más que la
 * caducidad no pisa a quien tomó su reserva. La edad de una fila la mide la base (`now() - actualizado_en`).
 */
export interface ConsultorPg {
  query(texto: string, valores?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null }>;
}

type FilaSql = {
  clave: string; tipo: string; formato_id: string; colores: string[]; version_pipeline: string; estado: EstadoFila;
  objeto_key: string | null; mime: string | null; coste_usd: string | null; captura_sha256: string | null; sesion: string | null; edad_ms: string | number;
};

const COLUMNAS = `clave, tipo, formato_id, colores, version_pipeline, estado, objeto_key, mime, coste_usd, captura_sha256, sesion,
  (extract(epoch FROM (now() - actualizado_en)) * 1000) AS edad_ms`;

function aFila(r: FilaSql): FilaRender {
  return {
    clave: r.clave, tipo: r.tipo, formatoId: r.formato_id, colores: r.colores, version: r.version_pipeline, estado: r.estado,
    objeto: r.objeto_key, mime: r.mime, costeUsd: r.coste_usd === null ? null : Number(r.coste_usd), capturaSha256: r.captura_sha256, sesion: r.sesion, edadMs: Number(r.edad_ms),
  };
}

export function crearRepositorioNeon(db: ConsultorPg): RepositorioRendersModulo {
  async function reservar(nueva: NuevaFila, reintentos: number): Promise<Awaited<ReturnType<RepositorioRendersModulo["reservar"]>>> {
    const dueno = randomUUID();
    const insertada = await db.query(
      `INSERT INTO modulos_renders (clave, tipo, formato_id, colores, version_pipeline, estado, dueno)
       VALUES ($1, $2, $3, $4::jsonb, $5, 'pendiente', $6) ON CONFLICT (clave) DO NOTHING RETURNING clave`,
      [nueva.clave, nueva.tipo, nueva.formatoId, JSON.stringify(nueva.colores), nueva.version, dueno],
    );
    if (insertada.rows.length > 0) return { reservada: true, dueno };
    const { rows } = await db.query(`SELECT ${COLUMNAS} FROM modulos_renders WHERE clave = $1`, [nueva.clave]);
    const existente = rows[0] as FilaSql | undefined;
    // La fila desapareció entre el INSERT y el SELECT (quien la tenía falló y la liberó): se intenta de nuevo.
    if (!existente) {
      if (reintentos <= 0) throw new Error(`No se pudo reservar ${nueva.clave}.`);
      return reservar(nueva, reintentos - 1);
    }
    return { reservada: false, existente: aFila(existente) };
  }

  return {
    async buscar(clave) {
      const { rows } = await db.query(`SELECT ${COLUMNAS} FROM modulos_renders WHERE clave = $1`, [clave]);
      const fila = rows[0] as FilaSql | undefined;
      return fila ? aFila(fila) : null;
    },
    reservar: (nueva) => reservar(nueva, 2),
    async reclamarCaducada(clave, edadMinimaMs) {
      const dueno = randomUUID();
      const { rows } = await db.query(
        `UPDATE modulos_renders SET actualizado_en = now(), dueno = $3
         WHERE clave = $1 AND estado = 'pendiente' AND actualizado_en < now() - ($2::int * interval '1 millisecond') RETURNING clave`,
        [clave, Math.round(edadMinimaMs), dueno],
      );
      return rows.length > 0 ? dueno : null;
    },
    async reabrir(clave) {
      const dueno = randomUUID();
      const { rows } = await db.query(
        `UPDATE modulos_renders SET estado = 'pendiente', objeto_key = NULL, mime = NULL, coste_usd = NULL, captura_sha256 = NULL, sesion = NULL, completado_en = NULL, actualizado_en = now(), dueno = $2
         WHERE clave = $1 AND estado = 'lista' RETURNING clave`,
        [clave, dueno],
      );
      return rows.length > 0 ? dueno : null;
    },
    async completar(clave, dueno, datos) {
      const { rows } = await db.query(
        `UPDATE modulos_renders SET estado = 'lista', objeto_key = $2, mime = $3, coste_usd = $4, captura_sha256 = $6, sesion = $7, completado_en = now(), actualizado_en = now(), dueno = NULL
         WHERE clave = $1 AND estado = 'pendiente' AND dueno = $5 RETURNING clave`,
        [clave, datos.objeto, datos.mime, datos.costeUsd, dueno, datos.capturaSha256, datos.sesion],
      );
      if (rows.length === 0) throw new Error(`La reserva de ${clave} ya no es de quien la completa.`);
    },
    async eliminar(clave) {
      const { rows } = await db.query(
        `DELETE FROM modulos_renders WHERE clave = $1 AND estado = 'lista'
         RETURNING clave, tipo, formato_id, colores, version_pipeline, estado, objeto_key, mime, coste_usd, captura_sha256, sesion, 0 AS edad_ms`,
        [clave],
      );
      const fila = rows[0] as FilaSql | undefined;
      return fila ? aFila(fila) : null;
    },
    async liberar(clave, dueno) {
      await db.query(`DELETE FROM modulos_renders WHERE clave = $1 AND estado = 'pendiente' AND dueno = $2`, [clave, dueno]);
    },
  };
}
