import { ErrorAlmacen } from "@/lib/almacen/objetos-s3";
import { errorFeedback, exigirEscritura, ipDe } from "./acceso";
import {
  CamposCapturaSchema,
  EntradaFeedbackSchema,
  IdSeguro,
  MAX_TURNOS_CONSULTA,
  PRODUCTOS_FEEDBACK,
  TOPE_CAPTURA_BYTES,
  TOPE_CUERPO_FEEDBACK_BYTES,
  TOPE_ESCENA_BYTES,
  TOPE_TURNOS_CONVERSACION,
  type EntradaFeedback,
  type RespuestaCaptura,
  type RespuestaConsultaFeedback,
} from "./contrato";
import type { DependenciasRutas } from "./dependencias";
import { leerJsonValidado, validar } from "./entrada-http";
import { calificacionesDeTurnos, fijarImagen, usuarioDelTurno, volumenDeConversacion } from "./repositorio";
import { registrarFeedback } from "./servicio";

/**
 * POST /api/feedback-ia y POST /api/feedback-ia/capturas: las dos rutas que escribe la UI (Taller 3D y chat del cliente).
 * Contrato completo en ./contrato.ts. Mismo modelo de acceso para los dos productos (ver ./acceso.ts).
 */

const MARGEN_MULTIPART_BYTES = 16 * 1024;
const FIRMA_JPEG = [0xff, 0xd8, 0xff];
const CHECK_VIOLATION = "23514";

function claveCaptura(producto: string, turnoId: string, momento: string): string {
  return `feedback/${producto}/${turnoId}/${momento}.jpg`;
}

function escenaDemasiadoGrande(entrada: EntradaFeedback): string | null {
  for (const [nombre, escena] of [["escenaAntes", entrada.escenaAntes], ["escenaDespues", entrada.escenaDespues]] as const) {
    if (escena && Buffer.byteLength(JSON.stringify(escena)) > TOPE_ESCENA_BYTES) return nombre;
  }
  return null;
}

function esViolacionDeCheck(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === CHECK_VIOLATION;
}

export async function atenderRegistro(request: Request, deps: DependenciasRutas): Promise<Response> {
  const acceso = exigirEscritura(request);
  if ("respuesta" in acceso) return acceso.respuesta;
  if (!deps.limitadorRegistro(ipDe(request))) return acceso.conCookie(errorFeedback("DEMASIADAS_PETICIONES", "Demasiadas calificaciones seguidas; espera un momento.", 429));

  const leido = await leerJsonValidado(request, EntradaFeedbackSchema, TOPE_CUERPO_FEEDBACK_BYTES);
  if ("respuesta" in leido) return acceso.conCookie(leido.respuesta);
  const entrada = leido.valor;
  const grande = escenaDemasiadoGrande(entrada);
  if (grande) return acceso.conCookie(errorFeedback("CUERPO_DEMASIADO_GRANDE", `${grande} supera ${TOPE_ESCENA_BYTES} bytes.`, 413));

  try {
    const resultado = await registrarFeedback(deps.servicio(), acceso.usuarioId, entrada);
    if (resultado.estado === "turno_ajeno") return acceso.conCookie(errorFeedback("TURNO_AJENO", "Ese turno pertenece a otro navegador.", 403));
    if (resultado.estado === "conversacion_llena") return acceso.conCookie(errorFeedback("CONVERSACION_LLENA", "Esta conversación ya tiene el máximo de turnos calificables.", 429));
    deps.auditar("regla:feedback_ia", "calificación de un turno de la IA registrada", {
      turnoId: entrada.turnoId,
      producto: entrada.producto,
      solicitudId: entrada.solicitudId ?? null,
      calificacion: resultado.respuesta.calificacion,
      motivos: entrada.motivos ?? null,
      deshecho: entrada.deshecho ?? null,
      conComentario: entrada.comentario !== undefined && entrada.comentario !== "",
      pasosDelCliente: entrada.pasos?.length ?? 0,
      escenasGuardadas: resultado.respuesta.escenasGuardadas,
      creado: resultado.respuesta.creado,
    });
    return acceso.conCookie(Response.json(resultado.respuesta, { status: resultado.respuesta.creado ? 201 : 200 }));
  } catch (error) {
    deps.registrarFallo("feedback_ia.registro", error);
    if (esViolacionDeCheck(error)) return acceso.conCookie(errorFeedback("CUERPO_DEMASIADO_GRANDE", "Algún campo supera el tamaño permitido.", 413));
    return acceso.conCookie(errorFeedback("BASE_NO_DISPONIBLE", "No se pudo guardar la calificación; vuelve a intentarlo.", 503));
  }
}

/**
 * GET /api/feedback-ia?producto=…&turnos=id1,id2: la calificación guardada de esos turnos del navegador, para mostrarla seleccionada
 * al recargar. Solo devuelve lo que escribió este navegador (el mismo dueño que la escritura). Nunca se cachea: es de la persona.
 */
export async function atenderConsulta(request: Request, deps: DependenciasRutas): Promise<Response> {
  const respuesta = await resolverConsulta(request, deps);
  respuesta.headers.set("Cache-Control", "private, no-store");
  return respuesta;
}

async function resolverConsulta(request: Request, deps: DependenciasRutas): Promise<Response> {
  const acceso = exigirEscritura(request);
  if ("respuesta" in acceso) return acceso.respuesta;
  if (!deps.limitadorConsulta(ipDe(request))) return acceso.conCookie(errorFeedback("DEMASIADAS_PETICIONES", "Demasiadas consultas seguidas; espera un momento.", 429));
  const url = new URL(request.url);
  const producto = PRODUCTOS_FEEDBACK.find((valor) => valor === url.searchParams.get("producto"));
  const turnos = (url.searchParams.get("turnos") ?? "").split(",").filter((turno) => turno !== "");
  const validos = turnos.length > 0 && turnos.length <= MAX_TURNOS_CONSULTA && turnos.every((turno) => IdSeguro.safeParse(turno).success);
  if (!producto || !validos) return acceso.conCookie(errorFeedback("CUERPO_INVALIDO", "Pide un producto y de 1 a 100 turnos válidos.", 400));
  try {
    const calificaciones = await calificacionesDeTurnos(deps.db(), acceso.usuarioId, producto, turnos);
    return acceso.conCookie(Response.json({ ok: true, calificaciones } satisfies RespuestaConsultaFeedback));
  } catch (error) {
    deps.registrarFallo("feedback_ia.consulta", error);
    return acceso.conCookie(errorFeedback("BASE_NO_DISPONIBLE", "No se pudo leer la calificación guardada.", 503));
  }
}

function esJpeg(bytes: Uint8Array): boolean {
  return FIRMA_JPEG.every((valor, indice) => bytes[indice] === valor);
}

export async function atenderCaptura(request: Request, deps: DependenciasRutas): Promise<Response> {
  const acceso = exigirEscritura(request);
  if ("respuesta" in acceso) return acceso.respuesta;
  if (!deps.limitadorCaptura(ipDe(request)) || !deps.limitadorCapturaDiario(ipDe(request))) return acceso.conCookie(errorFeedback("DEMASIADAS_PETICIONES", "Demasiadas capturas seguidas; espera un momento.", 429));

  const declarado = Number(request.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > TOPE_CAPTURA_BYTES + MARGEN_MULTIPART_BYTES) {
    return acceso.conCookie(errorFeedback("CUERPO_DEMASIADO_GRANDE", `La captura supera ${TOPE_CAPTURA_BYTES} bytes.`, 413));
  }
  let formulario: FormData;
  try {
    formulario = await request.formData();
  } catch {
    return acceso.conCookie(errorFeedback("CUERPO_INVALIDO", "El cuerpo debe ser multipart/form-data.", 400));
  }

  const campos = validar(
    CamposCapturaSchema,
    {
      turnoId: formulario.get("turnoId"),
      producto: formulario.get("producto"),
      momento: formulario.get("momento"),
      conversacionId: formulario.get("conversacionId") ?? undefined,
    },
    "Captura inválida.",
  );
  if ("respuesta" in campos) return acceso.conCookie(campos.respuesta);
  const { turnoId, producto, momento, conversacionId } = campos.valor;

  const archivo = formulario.get("imagen");
  if (!(archivo instanceof Blob)) return acceso.conCookie(errorFeedback("IMAGEN_INVALIDA", "Falta el archivo en el campo `imagen`.", 400));
  if (archivo.size > TOPE_CAPTURA_BYTES) return acceso.conCookie(errorFeedback("CUERPO_DEMASIADO_GRANDE", `La captura supera ${TOPE_CAPTURA_BYTES} bytes.`, 413));
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  if (bytes.length === 0 || !esJpeg(bytes)) return acceso.conCookie(errorFeedback("IMAGEN_INVALIDA", "La captura debe ser un JPEG.", 400));

  const almacen = deps.almacen();
  if (!almacen) return acceso.conCookie(errorFeedback("ALMACEN_NO_CONFIGURADO", "El almacén de imágenes no está configurado.", 503));

  const ajeno = () => acceso.conCookie(errorFeedback("TURNO_AJENO", "Ese turno pertenece a otro navegador.", 403));
  try {
    const dueno = await usuarioDelTurno(deps.db(), producto, turnoId);
    if (dueno !== null && dueno !== acceso.usuarioId) return ajeno();
    if (conversacionId && dueno === null) {
      const volumen = await volumenDeConversacion(deps.db(), conversacionId, producto, turnoId);
      if (volumen.turnos >= TOPE_TURNOS_CONVERSACION) return acceso.conCookie(errorFeedback("CONVERSACION_LLENA", "Esta conversación ya tiene el máximo de turnos calificables.", 429));
    }
    const clave = claveCaptura(producto, turnoId, momento);
    await almacen.poner(clave, bytes, "image/jpeg");
    const fijada = await fijarImagen(deps.db(), { producto, turnoId, usuarioId: acceso.usuarioId, momento, clave, conversacionId: conversacionId ?? null });
    if (!fijada) return ajeno();
    deps.auditar("regla:feedback_ia", "captura del turno de la IA guardada", { turnoId, producto, momento, bytes: bytes.length });
    const cuerpo: RespuestaCaptura = { ok: true, turnoId, producto, momento, bytes: bytes.length };
    return acceso.conCookie(Response.json(cuerpo));
  } catch (error) {
    deps.registrarFallo("feedback_ia.captura", error);
    if (error instanceof ErrorAlmacen) return acceso.conCookie(errorFeedback("ALMACEN_NO_DISPONIBLE", "No se pudo guardar la captura en el almacén.", 502));
    return acceso.conCookie(errorFeedback("BASE_NO_DISPONIBLE", "No se pudo guardar la captura; vuelve a intentarlo.", 503));
  }
}
