import { ErrorAlmacen } from "@/lib/almacen/objetos-s3";
import { errorFeedback, exigirSesionMismoOrigen, ipDe } from "./acceso";
import {
  CamposCapturaSchema,
  EntradaFeedbackSchema,
  TOPE_CAPTURA_BYTES,
  TOPE_CUERPO_FEEDBACK_BYTES,
  type RespuestaCaptura,
} from "./contrato";
import type { DependenciasRutas } from "./dependencias";
import { leerJsonValidado, validar } from "./entrada-http";
import { fijarImagen, obtenerPorTurno } from "./repositorio";
import { registrarFeedback } from "./servicio";

/**
 * POST /api/feedback-ia y POST /api/feedback-ia/capturas: las dos rutas que escribe la UI (Taller 3D y chat del cliente).
 * Contrato completo en ./contrato.ts. Mismo modelo de acceso para los dos productos: sesión + mismo origen + tope por IP.
 */

const MARGEN_MULTIPART_BYTES = 16 * 1024;
const FIRMA_JPEG = [0xff, 0xd8, 0xff];

function claveCaptura(producto: string, turnoId: string, momento: string): string {
  return `feedback/${producto}/${turnoId}/${momento}.jpg`;
}

export async function atenderRegistro(request: Request, deps: DependenciasRutas): Promise<Response> {
  const acceso = exigirSesionMismoOrigen(request);
  if ("respuesta" in acceso) return acceso.respuesta;
  if (!deps.limitadorRegistro(ipDe(request))) return errorFeedback("DEMASIADAS_PETICIONES", "Demasiadas calificaciones seguidas; espera un momento.", 429);

  const leido = await leerJsonValidado(request, EntradaFeedbackSchema, TOPE_CUERPO_FEEDBACK_BYTES);
  if ("respuesta" in leido) return leido.respuesta;
  const entrada = leido.valor;

  try {
    const resultado = await registrarFeedback(deps.servicio(), acceso.actor.usuarioId, entrada);
    if (resultado.estado === "turno_ajeno") return errorFeedback("TURNO_AJENO", "Ese turno pertenece a otra persona.", 403);
    deps.auditar("regla:feedback_ia", "calificación de un turno de la IA registrada", {
      turnoId: entrada.turnoId,
      producto: entrada.producto,
      solicitudId: entrada.solicitudId ?? null,
      calificacion: resultado.respuesta.calificacion,
      motivos: entrada.motivos ?? null,
      deshecho: entrada.deshecho ?? null,
      conComentario: entrada.comentario !== undefined && entrada.comentario !== "",
      conEscenas: entrada.escenaAntes !== undefined || entrada.escenaDespues !== undefined,
      creado: resultado.respuesta.creado,
    });
    return Response.json(resultado.respuesta, { status: resultado.respuesta.creado ? 201 : 200 });
  } catch (error) {
    deps.registrarFallo("feedback_ia.registro", error);
    return errorFeedback("BASE_NO_DISPONIBLE", "No se pudo guardar la calificación; vuelve a intentarlo.", 503);
  }
}

function esJpeg(bytes: Uint8Array): boolean {
  return FIRMA_JPEG.every((valor, indice) => bytes[indice] === valor);
}

export async function atenderCaptura(request: Request, deps: DependenciasRutas): Promise<Response> {
  const acceso = exigirSesionMismoOrigen(request);
  if ("respuesta" in acceso) return acceso.respuesta;
  if (!deps.limitadorCaptura(ipDe(request))) return errorFeedback("DEMASIADAS_PETICIONES", "Demasiadas capturas seguidas; espera un momento.", 429);

  const declarado = Number(request.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > TOPE_CAPTURA_BYTES + MARGEN_MULTIPART_BYTES) {
    return errorFeedback("CUERPO_DEMASIADO_GRANDE", `La captura supera ${TOPE_CAPTURA_BYTES} bytes.`, 413);
  }
  let formulario: FormData;
  try {
    formulario = await request.formData();
  } catch {
    return errorFeedback("CUERPO_INVALIDO", "El cuerpo debe ser multipart/form-data.", 400);
  }

  const campos = validar(
    CamposCapturaSchema,
    { turnoId: formulario.get("turnoId"), producto: formulario.get("producto"), momento: formulario.get("momento") },
    "Captura inválida.",
  );
  if ("respuesta" in campos) return campos.respuesta;
  const { turnoId, producto, momento } = campos.valor;

  const archivo = formulario.get("imagen");
  if (!(archivo instanceof Blob)) return errorFeedback("IMAGEN_INVALIDA", "Falta el archivo en el campo `imagen`.", 400);
  if (archivo.size > TOPE_CAPTURA_BYTES) return errorFeedback("CUERPO_DEMASIADO_GRANDE", `La captura supera ${TOPE_CAPTURA_BYTES} bytes.`, 413);
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  if (bytes.length === 0 || !esJpeg(bytes)) return errorFeedback("IMAGEN_INVALIDA", "La captura debe ser un JPEG.", 400);

  const almacen = deps.almacen();
  if (!almacen) return errorFeedback("ALMACEN_NO_CONFIGURADO", "El almacén de imágenes no está configurado.", 503);

  try {
    const existente = await obtenerPorTurno(deps.db(), producto, turnoId);
    if (existente && existente.usuarioId !== acceso.actor.usuarioId) return errorFeedback("TURNO_AJENO", "Ese turno pertenece a otra persona.", 403);
    const clave = claveCaptura(producto, turnoId, momento);
    await almacen.poner(clave, bytes, "image/jpeg");
    const fijada = await fijarImagen(deps.db(), { producto, turnoId, usuarioId: acceso.actor.usuarioId, momento, clave });
    if (!fijada) return errorFeedback("TURNO_AJENO", "Ese turno pertenece a otra persona.", 403);
    deps.auditar("regla:feedback_ia", "captura del turno de la IA guardada", { turnoId, producto, momento, bytes: bytes.length });
    const cuerpo: RespuestaCaptura = { ok: true, turnoId, producto, momento, bytes: bytes.length };
    return Response.json(cuerpo);
  } catch (error) {
    deps.registrarFallo("feedback_ia.captura", error);
    if (error instanceof ErrorAlmacen) return errorFeedback("ALMACEN_NO_DISPONIBLE", "No se pudo guardar la captura en el almacén.", 502);
    return errorFeedback("BASE_NO_DISPONIBLE", "No se pudo guardar la captura; vuelve a intentarlo.", 503);
  }
}
