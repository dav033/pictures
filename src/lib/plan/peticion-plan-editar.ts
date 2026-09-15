import { CATALOGO_ERRORES_UI_V1, leerUiErrorV1 } from "@/lib/ia/contracts/ui-error-v1";

/**
 * Llamada del navegador a /api/plan-editar con errores aptos para el cliente.
 * Nunca deja pasar el texto técnico del navegador ("Failed to fetch") ni el
 * `error` crudo del servidor: un fallo de red usa el mensaje SIN_CONEXION de
 * ui-error.v1, una respuesta fallida usa su `ui_error` válido y, sin él, el
 * texto de respaldo de quien llama. Sin React.
 */

/** Fallo de /api/plan-editar cuyo `message` ya se puede mostrar al cliente. */
export class FalloPlanEditar extends Error {
  constructor(mensajeCliente: string, options?: { cause?: unknown }) {
    super(mensajeCliente, options);
    this.name = "FalloPlanEditar";
  }
}

export function esCancelacion(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Mensaje de cliente de un cuerpo de respuesta fallido: `ui_error` válido o el respaldo. */
export function mensajeErrorRespuesta(datos: unknown, respaldo: string): string {
  return leerUiErrorV1(datos)?.mensaje_usuario ?? respaldo;
}

/**
 * POST a /api/plan-editar. Devuelve el cuerpo JSON de una respuesta 2xx sin
 * validar (cada llamador comprueba lo que necesita). Una cancelación se
 * relanza tal cual para que el llamador la ignore.
 */
export async function pedirPlanEditar(
  cuerpo: unknown,
  respaldo: string,
  opciones: { signal?: AbortSignal; fetcher?: typeof fetch } = {},
): Promise<unknown> {
  const fetcher = opciones.fetcher ?? fetch;
  let respuesta: Response;
  try {
    respuesta = await fetcher("/api/plan-editar", { method: "POST", headers: { "Content-Type": "application/json" }, signal: opciones.signal, body: JSON.stringify(cuerpo) });
  } catch (error) {
    if (esCancelacion(error)) throw error;
    throw new FalloPlanEditar(CATALOGO_ERRORES_UI_V1.SIN_CONEXION.mensaje_usuario, { cause: error });
  }
  let datos: unknown;
  try {
    datos = await respuesta.json();
  } catch (error) {
    if (esCancelacion(error)) throw error;
    throw new FalloPlanEditar(respaldo, { cause: error });
  }
  if (!respuesta.ok) throw new FalloPlanEditar(mensajeErrorRespuesta(datos, respaldo));
  return datos;
}

/** Texto para el cliente de cualquier fallo capturado: el de `FalloPlanEditar` o el respaldo. */
export function mensajeFalloPlanEditar(error: unknown, respaldo: string): string {
  return error instanceof FalloPlanEditar ? error.message : respaldo;
}
