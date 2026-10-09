import { z } from "zod";
import { errorFeedback, exigirAdministrador } from "./acceso";
import { aCsv } from "./csv";
import {
  FiltrosAdminSchema,
  MOMENTOS_CAPTURA,
  TOPE_FILAS_EXPORTACION,
  type DetalleFeedback,
  type ItemListadoFeedback,
  type PasoAuditado,
  type RespuestaListadoFeedback,
} from "./contrato";
import type { DependenciasRutas } from "./dependencias";
import { validar } from "./entrada-http";
import { exportarCompleto, listar, llamadasIaDeSolicitud, obtenerPorId, type FilaFeedback, type FilaListado } from "./repositorio";

/** Rutas de solo administrador: listado y exportación, detalle de un turno y sus imágenes. */

const RUTA_IMAGEN = "/api/feedback-ia/admin/imagen";

function aItem(fila: FilaListado): ItemListadoFeedback {
  return { ...fila, pedido: fila.pedido === null || fila.pedido.length <= 200 ? fila.pedido : `${fila.pedido.slice(0, 199)}…` };
}

function descarga(cuerpo: string, tipo: string, nombre: string): Response {
  return new Response(cuerpo, {
    headers: { "content-type": `${tipo}; charset=utf-8`, "content-disposition": `attachment; filename="${nombre}"`, "cache-control": "no-store" },
  });
}

export async function atenderListado(request: Request, deps: DependenciasRutas): Promise<Response> {
  const acceso = exigirAdministrador(request);
  if ("respuesta" in acceso) return acceso.respuesta;
  const filtros = validar(FiltrosAdminSchema, Object.fromEntries(new URL(request.url).searchParams), "Filtros inválidos.");
  if ("respuesta" in filtros) return filtros.respuesta;
  const f = filtros.valor;

  try {
    const hoy = new Date().toISOString().slice(0, 10);
    if (f.formato === "csv") {
      const { items } = await listar(deps.db(), f, TOPE_FILAS_EXPORTACION, 0);
      return descarga(aCsv(items), "text/csv", `feedback-ia-${hoy}.csv`);
    }
    if (f.completo) {
      const filas = await exportarCompleto(deps.db(), f, TOPE_FILAS_EXPORTACION);
      return descarga(JSON.stringify(filas, null, 2), "application/json", `feedback-ia-${hoy}.json`);
    }
    const { total, items } = await listar(deps.db(), f, f.limite, f.desplazamiento);
    const cuerpo: RespuestaListadoFeedback = { total, limite: f.limite, desplazamiento: f.desplazamiento, items: items.map(aItem) };
    return Response.json(cuerpo, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    deps.registrarFallo("feedback_ia.listado", error);
    return errorFeedback("BASE_NO_DISPONIBLE", "No se pudo leer el feedback.", 503);
  }
}

function urlImagen(id: number, momento: (typeof MOMENTOS_CAPTURA)[number], clave: string | null): string | null {
  return clave ? `${RUTA_IMAGEN}?id=${id}&momento=${momento}` : null;
}

async function detalleDe(deps: DependenciasRutas, fila: FilaFeedback): Promise<DetalleFeedback> {
  const llamadasIa = fila.solicitudId ? await llamadasIaDeSolicitud(deps.db(), fila.solicitudId) : [];
  const pasos: PasoAuditado[] = fila.pasos ?? [];
  return {
    id: fila.id,
    turnoId: fila.turnoId,
    producto: fila.producto,
    creadoEn: fila.creadoEn,
    calificacion: fila.calificacion,
    motivos: fila.motivos,
    comentario: fila.comentario,
    deshecho: fila.deshecho,
    pedido: fila.pedido,
    modelo: fila.modelo,
    costeUsd: fila.costeUsd,
    latenciaMs: fila.latenciaMs,
    herramientas: fila.herramientas,
    tieneImagenAntes: fila.imagenAntes !== null,
    tieneImagenDespues: fila.imagenDespues !== null,
    usuarioId: fila.usuarioId,
    actualizadoEn: fila.actualizadoEn,
    respuesta: fila.respuesta,
    solicitudId: fila.solicitudId,
    conversacionId: fila.conversacionId,
    versionApp: fila.versionApp,
    pasos,
    llamadasIa,
    diferencia: fila.diferencia,
    escenaAntes: fila.escenaAntes,
    escenaDespues: fila.escenaDespues,
    imagenAntesUrl: urlImagen(fila.id, "antes", fila.imagenAntes),
    imagenDespuesUrl: urlImagen(fila.id, "despues", fila.imagenDespues),
  };
}

const IdSchema = z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

export async function atenderDetalle(request: Request, idTexto: string, deps: DependenciasRutas): Promise<Response> {
  const acceso = exigirAdministrador(request);
  if ("respuesta" in acceso) return acceso.respuesta;
  const id = validar(IdSchema, idTexto, "Identificador inválido.");
  if ("respuesta" in id) return id.respuesta;

  try {
    const fila = await obtenerPorId(deps.db(), id.valor);
    if (!fila) return errorFeedback("NO_ENCONTRADO", "No existe ese feedback.", 404);
    return Response.json(await detalleDe(deps, fila), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    deps.registrarFallo("feedback_ia.detalle", error);
    return errorFeedback("BASE_NO_DISPONIBLE", "No se pudo leer el feedback.", 503);
  }
}

const ConsultaImagenSchema = z.object({ id: IdSchema, momento: z.enum(MOMENTOS_CAPTURA) }).strict();

/** Sirve la captura desde el almacén: el navegador nunca recibe claves ni direcciones de S3. */
export async function atenderImagen(request: Request, deps: DependenciasRutas): Promise<Response> {
  const acceso = exigirAdministrador(request);
  if ("respuesta" in acceso) return acceso.respuesta;
  const consulta = validar(ConsultaImagenSchema, Object.fromEntries(new URL(request.url).searchParams), "Consulta de imagen inválida.");
  if ("respuesta" in consulta) return consulta.respuesta;
  const almacen = deps.almacen();
  if (!almacen) return errorFeedback("ALMACEN_NO_CONFIGURADO", "El almacén de imágenes no está configurado.", 503);

  try {
    const fila = await obtenerPorId(deps.db(), consulta.valor.id);
    const clave = consulta.valor.momento === "antes" ? fila?.imagenAntes : fila?.imagenDespues;
    if (!clave) return errorFeedback("NO_ENCONTRADO", "Ese turno no tiene esa captura.", 404);
    const objeto = await almacen.obtener(clave);
    if (!objeto) return errorFeedback("NO_ENCONTRADO", "La captura ya no está en el almacén.", 404);
    return new Response(Buffer.from(objeto.cuerpo), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
  } catch (error) {
    deps.registrarFallo("feedback_ia.imagen", error);
    return errorFeedback("ALMACEN_NO_DISPONIBLE", "No se pudo leer la captura.", 502);
  }
}
