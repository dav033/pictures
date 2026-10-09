import { z } from "zod";
import { adminConfigurado, claveAdminValida, cookieDeAdministrador, errorFeedback, exigirAdministrador, exigirSesionMismoOrigen, ipDe } from "./acceso";
import { ENCABEZADO_CSV, filasACsv } from "./csv";
import {
  ClaveAdminSchema,
  FiltrosAdminSchema,
  LIMITE_EXPORTACION_COMPLETA,
  MOMENTOS_CAPTURA,
  TOPE_FILAS_EXPORTACION,
  type DetalleFeedback,
  type FiltrosAdmin,
  type ItemListadoFeedback,
  type PasoAuditado,
  type RespuestaListadoFeedback,
} from "./contrato";
import type { DependenciasRutas } from "./dependencias";
import { leerJsonValidado, validar } from "./entrada-http";
import { idsParaExportar, listar, llamadasIaDeSolicitud, obtenerPorId, paginaParaExportar, type FilaFeedback, type FilaListado } from "./repositorio";

/** Rutas de solo administrador: listado y exportación, detalle de un turno y sus imágenes. */

const RUTA_IMAGEN = "/api/feedback-ia/admin/imagen";

function aItem(fila: FilaListado): ItemListadoFeedback {
  return { ...fila, pedido: fila.pedido === null || fila.pedido.length <= 200 ? fila.pedido : `${fila.pedido.slice(0, 199)}…` };
}

const PAGINA_CSV = 200;
const CODIFICADOR = new TextEncoder();

/** CSV de todo el filtro, por id ascendente y en páginas: la memoria no crece con el número de filas. */
function respuestaCsv(deps: DependenciasRutas, filtros: FiltrosAdmin, nombre: string): Response {
  let cursor = 0;
  let enviadas = 0;
  let encabezadoEnviado = false;
  const flujo = new ReadableStream<Uint8Array>({
    async pull(controlador) {
      try {
        if (!encabezadoEnviado) {
          encabezadoEnviado = true;
          controlador.enqueue(CODIFICADOR.encode(ENCABEZADO_CSV));
          return;
        }
        const filas = await paginaParaExportar(deps.db(), filtros, cursor, Math.min(PAGINA_CSV, TOPE_FILAS_EXPORTACION - enviadas));
        if (filas.length === 0) return controlador.close();
        cursor = filas[filas.length - 1].id;
        enviadas += filas.length;
        controlador.enqueue(CODIFICADOR.encode(filasACsv(filas)));
        if (enviadas >= TOPE_FILAS_EXPORTACION) controlador.close();
      } catch (error) {
        deps.registrarFallo("feedback_ia.exportar_csv", error);
        controlador.error(error);
      }
    },
  });
  return new Response(flujo, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${nombre}"`, "cache-control": "no-store" } });
}

/**
 * NDJSON con la fila completa (escenas y pasos), como mucho 50 por petición. Cada fila se pide sola dentro del flujo, así
 * nunca hay más de una escena en memoria. El siguiente `cursor` viene en la cabecera `x-siguiente-cursor`.
 */
async function respuestaNdjson(deps: DependenciasRutas, filtros: FiltrosAdmin, nombre: string): Promise<Response> {
  const limite = Math.min(filtros.limite, LIMITE_EXPORTACION_COMPLETA);
  const ids = await idsParaExportar(deps.db(), filtros, filtros.cursor ?? 0, limite);
  let indice = 0;
  const flujo = new ReadableStream<Uint8Array>({
    async pull(controlador) {
      try {
        if (indice >= ids.length) return controlador.close();
        const fila = await obtenerPorId(deps.db(), ids[indice++]);
        if (fila) controlador.enqueue(CODIFICADOR.encode(`${JSON.stringify(fila)}
`));
      } catch (error) {
        deps.registrarFallo("feedback_ia.exportar_ndjson", error);
        controlador.error(error);
      }
    },
  });
  const cabeceras: Record<string, string> = { "content-type": "application/x-ndjson; charset=utf-8", "content-disposition": `attachment; filename="${nombre}"`, "cache-control": "no-store" };
  if (ids.length === limite) cabeceras["x-siguiente-cursor"] = String(ids[ids.length - 1]);
  return new Response(flujo, { headers: cabeceras });
}

export async function atenderListado(request: Request, deps: DependenciasRutas): Promise<Response> {
  const acceso = exigirAdministrador(request);
  if ("respuesta" in acceso) return acceso.respuesta;
  const filtros = validar(FiltrosAdminSchema, Object.fromEntries(new URL(request.url).searchParams), "Filtros inválidos.");
  if ("respuesta" in filtros) return filtros.respuesta;
  const f = filtros.valor;

  try {
    const hoy = new Date().toISOString().slice(0, 10);
    if (f.formato === "csv") return respuestaCsv(deps, f, `feedback-ia-${hoy}.csv`);
    if (f.completo) return await respuestaNdjson(deps, f, `feedback-ia-${hoy}.ndjson`);
    const { total, items } = await listar(deps.db(), f, f.limite, f.desplazamiento);
    const cuerpo: RespuestaListadoFeedback = { total, limite: f.limite, desplazamiento: f.desplazamiento, items: items.map(aItem) };
    return Response.json(cuerpo, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    deps.registrarFallo("feedback_ia.listado", error);
    return errorFeedback("BASE_NO_DISPONIBLE", "No se pudo leer el feedback.", 503);
  }
}

const LIMITE_INTENTOS_CLAVE_POR_MINUTO = 10;
const intentosPorIp = new Map<string, number[]>();

function demasiadosIntentos(ip: string): boolean {
  const ahora = Date.now();
  const recientes = (intentosPorIp.get(ip) ?? []).filter((marca) => ahora - marca < 60_000);
  recientes.push(ahora);
  intentosPorIp.set(ip, recientes);
  if (intentosPorIp.size > 1_000) intentosPorIp.clear();
  return recientes.length > LIMITE_INTENTOS_CLAVE_POR_MINUTO;
}

/** Entrega la cookie de administrador a quien manda `ADMIN_PASSWORD` (sin ella configurada, nunca). Sin auditar el cuerpo: lleva la clave. */
export async function atenderSesionAdmin(request: Request): Promise<Response> {
  const acceso = exigirSesionMismoOrigen(request);
  if ("respuesta" in acceso) return acceso.respuesta;
  if (!adminConfigurado()) return errorFeedback("ADMIN_NO_CONFIGURADO", "El acceso de administrador no está configurado.", 403);
  if (demasiadosIntentos(ipDe(request))) return errorFeedback("DEMASIADAS_PETICIONES", "Demasiados intentos; espera un minuto.", 429);
  const leido = await leerJsonValidado(request, ClaveAdminSchema, 1_000);
  if ("respuesta" in leido) return leido.respuesta;
  if (!claveAdminValida(leido.valor.clave)) return errorFeedback("CLAVE_INCORRECTA", "Clave incorrecta.", 401);
  const respuesta = Response.json({ ok: true });
  respuesta.headers.append("set-cookie", cookieDeAdministrador());
  return respuesta;
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
    pasosFuente: fila.pasosFuente,
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
