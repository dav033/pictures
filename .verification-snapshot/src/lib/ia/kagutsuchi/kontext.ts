import type { Imagen } from "@/lib/ia/nucleo/tipos";
import { idsTelemetria, resultadoTelemetria, type ContextoTelemetriaIA } from "@/lib/ia/nucleo/telemetria-llamadas";
import { bytesDeBase64, registrarLlamadaIA } from "@sempertex/agente-core";
import { auditarGeneracionImagen, type DescripcionImagen } from "@/lib/registro/servidor";
import { falResponseError, fetchFalAllowed, isAllowedFalQueueUrl, parseQueueStatus, parseQueueSubmission, ProveedorImagenNoDisponibleError, sleep, traerImagenDeFal } from "./fal-cola";

// ----------------------------------------------------------------------------------------------------------
// FLUX.1 Kontext (pro / max): edita una imagen con una instrucción y conserva su composición; es un modelo base de FLUX (sin LoRA).
// ----------------------------------------------------------------------------------------------------------

const KONTEXT = {
  pro: { endpoint: "https://queue.fal.run/fal-ai/flux-pro/kontext", modelo: "flux-1/kontext-pro", usd: 0.04 },
  max: { endpoint: "https://queue.fal.run/fal-ai/flux-pro/kontext/max", modelo: "flux-1/kontext-max", usd: 0.08 },
} as const;
/** La cola de fal de los dos Kontext es la de la app `fal-ai/flux-pro`: con el id de una solicitud se pregunta por su estado y su resultado. */
const SOLICITUDES_KONTEXT = "https://queue.fal.run/fal-ai/flux-pro/requests";
const ESPERA_ENTRE_SONDEOS_MS = 1_500;

export type VarianteKontext = keyof typeof KONTEXT;
export const costeKontext = (variante: VarianteKontext): number => KONTEXT[variante].usd;

/**
 * Cuánto espera cada llamada a fal antes de devolver «sigue en curso». Las rutas que la usan tienen `maxDuration = 120` s: 100 s de espera
 * más hasta 15 s para bajar el resultado ya completo (`MARGEN_DESCARGA_MS`) dejan 5 s para aligerar la imagen y responder, y el navegador
 * espera 125 s por petición. Producción, 2026-10-09: una toma de Kontext max tardó 112,9 s de inferencia (las demás, 11 a 17 s) y con el
 * corte de 105 s se perdió una imagen ya pagada.
 */
export const PLAZO_KONTEXT_MS = 100_000;

/**
 * fal sigue trabajando en una solicitud que ya está pagada y el plazo de esta llamada se acabó. Con `requestId` el llamador la
 * retoma (`solicitudPrevia`) en vez de enviar otra: pagar dos veces la misma imagen es lo que se evita.
 */
export class KontextEnCursoError extends Error {
  readonly codigo = "KONTEXT_EN_CURSO";
  readonly requestId: string;
  constructor(requestId: string, esperadoMs: number) {
    super(`fal.ai sigue generando la imagen de Kontext tras ${Math.round(esperadoMs / 1000)} s; la solicitud ${requestId} se retoma con su id.`);
    this.name = "KontextEnCursoError";
    this.requestId = requestId;
  }
}

/**
 * Retomar una solicitud que fal ya no tiene (la dio por FAILED o CANCELLED, o ya no la encuentra: 404, 410 o 422 al preguntar su estado o su
 * resultado): el token con el que el navegador llegó no sirve y repetirlo no la va a traer. El llamador responde 409 y el navegador suelta
 * el token y pide una imagen nueva. Solo se lanza al retomar (`solicitudPrevia`); un FAILED al enviar es un error de verdad.
 */
export class SolicitudKontextInvalidaError extends Error {
  readonly codigo = "SOLICITUD_KONTEXT_INVALIDA";
  readonly requestId: string;
  constructor(requestId: string, motivo: string) {
    super(`La solicitud ${requestId} de Kontext ya no se puede retomar: ${motivo}`);
    this.name = "SolicitudKontextInvalidaError";
    this.requestId = requestId;
  }
}

export type OpcionesKontext = {
  /** La captura del visor (tal cual: la salida sale de su proporción). */
  imagen: { base64: string; mime: string; ancho: number; alto: number };
  variante: VarianteKontext;
  seed?: number;
  guidanceScale?: number;
  /** Proporción pedida (`3:2`, `16:9`…); sin ella, la de la imagen. */
  aspecto?: string;
  signal?: AbortSignal;
  telemetria?: ContextoTelemetriaIA;
  /** Cuánto espera esta llamada a fal; por defecto `PLAZO_KONTEXT_MS`. Si se acaba, lanza `KontextEnCursoError` con el id. */
  plazoMs?: number;
  /** El id de una solicitud ya enviada: no se envía otra, solo se espera la que ya existe. */
  solicitudPrevia?: string;
  /** Recibe el id apenas fal acepta la solicitud (desde ahí está pagada), por si el llamador debe guardarlo. */
  alEnviar?: (requestId: string) => void;
};

/** fal terminó mal la solicitud (FAILED/CANCELLED) o contestó algo ilegible: no hay nada que retomar. */
class ErrorDeFal extends Error {}
/** fal dio la solicitud por FAILED o CANCELLED. */
class SolicitudFallida extends ErrorDeFal {}
/** La espera llegó a su plazo con la solicitud todavía en cola o en curso. */
class EsperaVencida extends Error {}

/** Un corte de red o el plazo de una petición (no un error HTTP ni un fallo del código): la solicitud sigue viva en fal. */
const esFalloDeRed = (error: unknown): boolean =>
  error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError" || (error instanceof TypeError && /fetch failed|terminated|network|socket/i.test(error.message)));

/** Un error HTTP de fal que dice que la solicitud ya no existe o no se pudo resolver: 404, 410 o 422. */
const esSolicitudPerdida = (error: unknown): boolean => error instanceof Error && /\((?:404|410|422)\)/.test(error.message);

/** Un error HTTP pasajero de fal (408, 425, 429, 5xx) al PREGUNTAR por el estado. */
const esHttpPasajero = (error: unknown): boolean => error instanceof Error && /\((?:408|425|429|5\d\d)\)/.test(error.message);

/**
 * Cuánto después del plazo de la espera se puede seguir bajando el resultado ya completo: el tiempo total de una llamada no pasa de
 * `plazoMs` + esto (100 + 15 = 115 s, bajo el `maxDuration` de 120 s de las rutas).
 */
const MARGEN_DESCARGA_MS = 15_000;

/**
 * Los ids de solicitud cuya imagen ya se entregó (de esta instancia, acotado): una retoma de un id ya entregado (el navegador no recibió
 * la respuesta y vuelve a pedirla) trae la misma imagen otra vez pero no cuenta otro cobro en la telemetría.
 */
const MAX_ENTREGADAS = 500;
const entregadas = new Set<string>();
function marcarEntregada(requestId: string): boolean {
  const primera = !entregadas.has(requestId);
  entregadas.add(requestId);
  if (entregadas.size > MAX_ENTREGADAS) entregadas.delete(entregadas.values().next().value as string);
  return primera;
}

const urlsDeLaSolicitud = (requestId: string) => ({ request_id: requestId, status_url: `${SOLICITUDES_KONTEXT}/${requestId}/status`, response_url: `${SOLICITUDES_KONTEXT}/${requestId}` });

/** FLUX.1 Kontext en fal con el mismo registro que los demás caminos de imagen (evento `imagen`, coste, telemetría). */
export async function generarConFluxKontext(prompt: string, opciones: OpcionesKontext): Promise<Imagen> {
  const k = KONTEXT[opciones.variante];
  const plazoMs = opciones.plazoMs ?? PLAZO_KONTEXT_MS;
  const cuerpo = {
    prompt,
    image_url: `data:${opciones.imagen.mime};base64,${opciones.imagen.base64}`,
    guidance_scale: opciones.guidanceScale ?? 3.5,
    num_images: 1,
    output_format: "png",
    safety_tolerance: "2",
    ...(Number.isInteger(opciones.seed) ? { seed: opciones.seed } : {}),
    ...(opciones.aspecto ? { aspect_ratio: opciones.aspecto } : {}),
  };
  const descripcion: DescripcionImagen = {
    proveedor: "fal", endpoint: k.endpoint, modelo: k.modelo, prompt,
    referencias: [{ base64: opciones.imagen.base64, mime: opciones.imagen.mime, rol: "captura_3d" }],
    parametros: {
      guidanceScale: cuerpo.guidance_scale, ancho: opciones.imagen.ancho, alto: opciones.imagen.alto, plazoMs,
      ...(Number.isInteger(opciones.seed) ? { seed: opciones.seed } : {}), ...(opciones.aspecto ? { aspecto: opciones.aspecto } : {}),
      ...(opciones.solicitudPrevia ? { retomaSolicitud: opciones.solicitudPrevia } : {}),
    },
    // Retomar una solicitud no paga otra imagen: la que se cobra es la del envío.
    costeEstimadoUsd: opciones.solicitudPrevia ? 0 : k.usd,
  };
  let proveedorRequestId = opciones.solicitudPrevia;
  const alEnviar = (requestId: string) => { proveedorRequestId = requestId; opciones.alEnviar?.(requestId); };
  return auditarGeneracionImagen(
    descripcion,
    () => cicloKontext(cuerpo, k, { ...opciones, plazoMs, alEnviar }),
    (imagen) => ({ base64: imagen.base64, mime: imagen.mime, ...(proveedorRequestId ? { proveedorRequestId } : {}) }),
  );
}

async function cicloKontext(
  cuerpo: Record<string, unknown>,
  k: (typeof KONTEXT)[VarianteKontext],
  opciones: OpcionesKontext & { plazoMs: number; alEnviar: (requestId: string) => void },
): Promise<Imagen> {
  const clave = process.env.FAL_KEY;
  if (!clave) throw new Error("FLUX no está conectado todavía: falta FAL_KEY en .env.local.");
  const inicio = Date.now();
  const venceEn = inicio + opciones.plazoMs;
  const signalFor = (presupuestoMs: number): AbortSignal => {
    const limite = AbortSignal.timeout(Math.max(1, Math.min(presupuestoMs, venceEn - Date.now())));
    return opciones.signal ? AbortSignal.any([opciones.signal, limite]) : limite;
  };
  let proveedorRequestId = opciones.solicitudPrevia;
  let fase: "envio" | "espera" | "resultado" = "envio";
  const ids = idsTelemetria(opciones.telemetria);
  const registrar = (resultado: "ok" | "error" | "timeout" | "cancelado", cobra = true) => registrarLlamadaIA({
    proveedor: "fal",
    flujo: "generador_imagen",
    capacidad: "imagen_generacion",
    modelo: k.modelo,
    superficie: opciones.telemetria?.superficie ?? "taller-3d",
    requestId: ids.requestId,
    correlationId: ids.correlationId,
    intento: opciones.telemetria?.intento ?? 1,
    proveedorRequestId,
    ms: Math.max(0, Date.now() - inicio),
    resultado,
    bytesImagenEntrada: bytesDeBase64(opciones.imagen.base64),
    unidadesFacturadas: resultado === "ok" && cobra ? 1 : undefined,
    ...(resultado === "ok" && cobra ? { costeEstimado: k.usd, moneda: "USD" } : {}),
  });
  // El resultado ya completo se baja con lo que quede del margen después del plazo: toda la llamada cabe en `plazoMs` + `MARGEN_DESCARGA_MS`.
  const signalDescarga = (presupuestoMs: number): AbortSignal => {
    const limite = AbortSignal.timeout(Math.max(1, Math.min(presupuestoMs, venceEn + MARGEN_DESCARGA_MS - Date.now())));
    return opciones.signal ? AbortSignal.any([opciones.signal, limite]) : limite;
  };
  const autorizacion = { Authorization: `Key ${clave}` };
  try {
    const solicitud = opciones.solicitudPrevia ? urlsDeLaSolicitud(opciones.solicitudPrevia) : await enviar(cuerpo, k.endpoint, autorizacion, signalFor(30_000));
    if (!opciones.solicitudPrevia) { proveedorRequestId = solicitud.request_id; opciones.alEnviar(solicitud.request_id); }
    fase = "espera";
    await esperarFinal(solicitud.status_url, autorizacion, signalFor, venceEn);
    fase = "resultado";
    const imagen = await traerImagenDeFal(solicitud.response_url, clave, signalDescarga, "Kontext");
    registrar("ok", marcarEntregada(solicitud.request_id));
    return imagen;
  } catch (error) {
    // Al retomar, una solicitud que fal ya no tiene no se puede traer: el llamador responde 409 y el navegador pide una imagen nueva.
    if (opciones.solicitudPrevia && !opciones.signal?.aborted && (error instanceof SolicitudFallida || esSolicitudPerdida(error))) {
      const perdida = new SolicitudKontextInvalidaError(opciones.solicitudPrevia, error instanceof Error ? error.message.slice(0, 200) : "fal ya no la tiene");
      registrar("error");
      throw perdida;
    }
    // Con la solicitud ya pagada y viva en fal, el plazo vencido o un corte de red NO pierde la imagen: se retoma con su id. También un
    // 5xx pasajero al PREGUNTAR el estado. No se retoma lo demás: lo que fal rechazó (FAILED, cuenta sin saldo), un error HTTP al bajar el
    // resultado, una respuesta ilegible, un fallo del código ni lo que canceló quien llama.
    const retomable = proveedorRequestId !== undefined && !opciones.signal?.aborted && !(error instanceof ErrorDeFal) && !(error instanceof ProveedorImagenNoDisponibleError)
      && (error instanceof EsperaVencida || esFalloDeRed(error) || (fase === "espera" && esHttpPasajero(error)));
    const final = retomable ? new KontextEnCursoError(proveedorRequestId!, opciones.plazoMs) : error;
    registrar(final instanceof KontextEnCursoError ? "timeout" : resultadoTelemetria(final));
    throw final;
  }
}

async function enviar(cuerpo: Record<string, unknown>, endpoint: string, autorizacion: Record<string, string>, signal: AbortSignal) {
  const respuesta = await fetchFalAllowed(endpoint, { method: "POST", headers: { ...autorizacion, "Content-Type": "application/json" }, body: JSON.stringify(cuerpo), signal }, isAllowedFalQueueUrl);
  if (!respuesta.ok) throw await falResponseError(respuesta, "fal.ai rechazó la solicitud Kontext");
  const enviada = parseQueueSubmission(await respuesta.json());
  if (!enviada || !isAllowedFalQueueUrl(enviada.status_url) || !isAllowedFalQueueUrl(enviada.response_url)) throw new Error("fal.ai no devolvió una solicitud Kontext en cola válida.");
  return enviada;
}

async function esperarFinal(statusUrl: string, autorizacion: Record<string, string>, signalFor: (presupuestoMs: number) => AbortSignal, venceEn: number): Promise<void> {
  while (Date.now() < venceEn) {
    const respuesta = await fetchFalAllowed(statusUrl, { headers: autorizacion, signal: signalFor(15_000) }, isAllowedFalQueueUrl);
    if (!respuesta.ok) throw await falResponseError(respuesta, "fal.ai no pudo consultar el estado de Kontext");
    const estado = parseQueueStatus(await respuesta.json());
    if (!estado) throw new ErrorDeFal("fal.ai devolvió un estado de Kontext inválido.");
    if (estado.status === "COMPLETED") return;
    if (estado.status === "FAILED" || estado.status === "CANCELLED") throw new SolicitudFallida(`fal.ai no pudo completar Kontext${estado.error ? `: ${estado.error.slice(0, 300)}` : ""}`);
    await sleep(Math.min(ESPERA_ENTRE_SONDEOS_MS, Math.max(0, venceEn - Date.now())));
  }
  throw new EsperaVencida("El plazo de Kontext se acabó.");
}
