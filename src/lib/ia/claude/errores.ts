import { ZodError } from "zod";
import { ErrorIA } from "@sempertex/agente-core";
import { PREFIJO_IMAGEN_RECHAZADA } from "@sempertex/agente-core/gemini";

const MAX_TEXTO_ERROR = 500;

/** Error HTTP (o evento `error` dentro del flujo, con `status` 0) de la API. El mensaje nunca lleva cabeceras ni la llave. */
export class ErrorApiAnthropic extends Error {
  constructor(
    readonly status: number,
    readonly tipo: string,
    detalle: string,
  ) {
    super(`Anthropic ${status || "flujo"} ${tipo}: ${detalle.slice(0, MAX_TEXTO_ERROR)}`);
    this.name = "ErrorApiAnthropic";
  }
}

/**
 * Fallo del transporte por Claude Code (`claude -p`, ver cli/): se categoriza igual que uno de la API (`status` es el
 * de la API cuando Claude Code lo informa; 0 si no). El detalle nunca lleva el entorno ni credenciales.
 */
export class ErrorCliClaude extends ErrorApiAnthropic {
  constructor(status: number, tipo: string, detalle: string) {
    super(status, tipo, detalle);
    this.message = `Claude CLI ${status ? `${status} ` : ""}${tipo}: ${detalle.slice(0, MAX_TEXTO_ERROR)}`;
    this.name = "ErrorCliClaude";
  }
}

/** Un 400 que no habla de la imagen es de la petición (herramientas, historial, parámetros): reintentar no cambia nada. */
const HABLA_DE_IMAGEN = /\bimage\b|media_type|base64/i;

/**
 * Traduce cualquier fallo del transporte a `ErrorIA` (el mismo contrato que el adaptador de Gemini): 401/403 sin llave,
 * 429 cuota, 5xx y 529 (sobrecarga) reintentables, 400 nunca reintentable, red caída reintentable.
 * `conImagenes`: la petición llevaba imágenes; un 400 sobre la imagen lleva `PREFIJO_IMAGEN_RECHAZADA` como en Gemini.
 * Un fallo del transporte `cli` (Claude Code) nunca es reintentable: Claude Code ya reintenta por dentro, cada intento es
 * un proceso de minutos, y un límite de uso de la suscripción no se libera en segundos.
 */
export function categorizarErrorClaude(error: unknown, conImagenes = false): ErrorIA {
  const categoria = categorizar(error, conImagenes);
  return error instanceof ErrorCliClaude && categoria.reintentable ? new ErrorIA(categoria.causa, "claude", categoria.message, false) : categoria;
}

function categorizar(error: unknown, conImagenes: boolean): ErrorIA {
  if (error instanceof ErrorIA) return error;
  const mensaje = error instanceof Error ? error.message : "Error desconocido";
  if (error instanceof ErrorApiAnthropic) {
    const { status, tipo } = error;
    if (status === 401 || status === 403 || tipo === "authentication_error" || tipo === "permission_error") return new ErrorIA("sin_llave", "claude", mensaje, false);
    if (status === 429 || tipo === "rate_limit_error") return new ErrorIA("cuota", "claude", mensaje, true);
    if (status === 408 || status === 504 || tipo === "timeout_error") return new ErrorIA("timeout", "claude", mensaje, true);
    if (status >= 500 || tipo === "overloaded_error" || tipo === "api_error") return new ErrorIA("desconocido", "claude", mensaje, true);
    if (conImagenes && status === 400 && HABLA_DE_IMAGEN.test(mensaje)) return new ErrorIA("desconocido", "claude", `${PREFIJO_IMAGEN_RECHAZADA}: ${mensaje}`, false);
    return new ErrorIA("desconocido", "claude", mensaje, false);
  }
  // La API ya respondió 200 (y cobró): una respuesta que no cumple la forma esperada no mejora repitiéndola.
  if (error instanceof ZodError || error instanceof SyntaxError) return new ErrorIA("desconocido", "claude", `Respuesta de Anthropic inesperada: ${mensaje}`, false);
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return new ErrorIA("timeout", "claude", mensaje, true);
  // `fetch` lanza TypeError cuando no llega a conectarse.
  if (error instanceof TypeError) return new ErrorIA("red", "claude", mensaje, true);
  return new ErrorIA("desconocido", "claude", mensaje, true);
}
