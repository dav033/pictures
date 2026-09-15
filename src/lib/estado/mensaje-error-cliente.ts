import { CATALOGO_ERRORES_UI_V1 } from "@/lib/ia/contracts/ui-error-v1";

/**
 * Texto de error apto para el cliente a partir de cualquier fallo capturado
 * en el navegador (iteración 4, D4 del E2E real).
 *
 * `fetch` sin red rechaza con un `TypeError` cuyo mensaje depende del
 * navegador ("Failed to fetch", "NetworkError when attempting to fetch
 * resource.", "Load failed"): nunca debe llegar a la pantalla. Tampoco los
 * errores técnicos de parseo o de HTTP. Los `Error` que la propia app lanza con
 * un texto ya redactado en español (p. ej. el `mensaje_usuario` de ui-error.v1)
 * pasan tal cual. Sin React.
 */

export const MENSAJE_SIN_CONEXION = CATALOGO_ERRORES_UI_V1.SIN_CONEXION.mensaje_usuario;

/** Mensajes técnicos conocidos del navegador, de `fetch` y de `JSON.parse`. */
const PATRONES_TECNICOS: readonly RegExp[] = [
  /failed to fetch/i,
  /networkerror/i,
  /network ?request failed/i,
  /load failed/i,
  /fetch failed/i,
  /err_[a-z_]+/i,
  /unexpected (token|end of json)/i,
  /is not valid json/i,
  /json\.parse/i,
  /\bhttp \d{3}\b/i,
  /^[a-z_]+ is not defined$/i,
  /cannot read propert/i,
  /undefined is not/i,
];

const PATRONES_RED: readonly RegExp[] = [/failed to fetch/i, /networkerror/i, /network ?request failed/i, /load failed/i, /fetch failed/i, /err_(internet|network|connection)/i];

/** true si el fallo es de conexión (sin red, DNS, conexión cortada). */
export function esFalloDeRed(error: unknown): boolean {
  // Offline, a TypeError from fetch is a connection failure whatever the browser calls it.
  if (typeof navigator !== "undefined" && navigator.onLine === false && error instanceof TypeError) return true;
  const mensaje = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return PATRONES_RED.some((patron) => patron.test(mensaje));
}

/** true si el texto parece un mensaje técnico que el cliente no debe ver. */
export function esMensajeTecnico(mensaje: string): boolean {
  return PATRONES_TECNICOS.some((patron) => patron.test(mensaje));
}

/**
 * Mensaje para el cliente: sin conexión → mensaje SIN_CONEXION de ui-error.v1;
 * mensaje técnico, vacío o fallo que no es `Error` → `respaldo`; si no, el
 * mensaje ya redactado del `Error`.
 */
export function mensajeErrorCliente(error: unknown, respaldo: string): string {
  if (esFalloDeRed(error)) return MENSAJE_SIN_CONEXION;
  if (!(error instanceof Error)) return respaldo;
  const mensaje = error.message.trim();
  if (!mensaje || esMensajeTecnico(mensaje)) return respaldo;
  return mensaje;
}
