import type { Pool } from "pg";
import type { ConfigSmoke } from "./entorno";
import type { ClienteNext, RespuestaHttp } from "./http";
import { resumen, type Reporte } from "./reporte";

export type Contexto = {
  config: ConfigSmoke;
  reporte: Reporte;
  next: ClienteNext;
  pool: Pool;
  snapshotId: string;
};

/** Logs the (redacted) request body actually sent, for the final report. */
export function registrarPeticion(ctx: Contexto, etiqueta: string, ruta: string, body: unknown): void {
  ctx.reporte.info(`REQ ${etiqueta} POST ${ruta} ${resumen(body, 500)}`);
}

export function detalleRespuesta(respuesta: RespuestaHttp, largo = 400): string {
  return `status=${respuesta.status} body=${resumen(respuesta.json ?? respuesta.texto, largo)}`;
}
