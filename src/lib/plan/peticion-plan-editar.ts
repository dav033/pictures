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

/**
 * Quitar el único material de una estructura (D7 del E2E real). La UI ya no
 * ofrece "Quitar" en ese caso, pero si el servidor lo rechaza igual el
 * cliente ve por qué, no el genérico de PROPUESTA_INCOMPLETA. Contrato de
 * `fix-backend`: 400 con `causa: "UNICO_MATERIAL"` y ui-error
 * `PIEZA_UNICO_MATERIAL`; un servidor anterior solo mandaba el texto legacy.
 */
export const MENSAJE_UNICO_MATERIAL = CATALOGO_ERRORES_UI_V1.PIEZA_UNICO_MATERIAL.mensaje_usuario;

const PATRON_UNICO_MATERIAL = /unico[_ ]material|ultimo[_ ]material|sin[_ ]materia(l|les)|unique[_ ]material|last[_ ]material/i;

function campoTexto(valor: unknown, ...ruta: string[]): string | undefined {
  let actual: unknown = valor;
  for (const clave of ruta) {
    if (typeof actual !== "object" || actual === null || !(clave in actual)) return undefined;
    actual = (actual as Record<string, unknown>)[clave];
  }
  return typeof actual === "string" ? actual : undefined;
}

function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** El rechazo es "no puedes quitar el único material": por código estable o, sin él, por el texto legacy. */
export function esRechazoUnicoMaterial(datos: unknown): boolean {
  const codigos = [
    campoTexto(datos, "code"),
    campoTexto(datos, "codigo"),
    campoTexto(datos, "causa"),
    campoTexto(datos, "ui_error", "detalles_dev", "codigo_origen"),
    campoTexto(datos, "ui_error", "detalles_dev", "causa"),
  ];
  if (codigos.some((codigo) => codigo !== undefined && PATRON_UNICO_MATERIAL.test(codigo))) return true;
  const error = campoTexto(datos, "error");
  return error !== undefined && /unico material/i.test(sinTildes(error));
}

/**
 * Mensaje de cliente de un cuerpo de respuesta fallido: el del rechazo por
 * único material, el `ui_error` válido o el respaldo. El texto de catálogo de
 * PROPUESTA_INCOMPLETA habla de crear la imagen; al editar la propuesta
 * confunde, así que ahí se usa el respaldo de quien llama.
 */
export function mensajeErrorRespuesta(datos: unknown, respaldo: string): string {
  const ui = leerUiErrorV1(datos);
  const generico = ui?.code === "PROPUESTA_INCOMPLETA" && ui.mensaje_usuario === CATALOGO_ERRORES_UI_V1.PROPUESTA_INCOMPLETA.mensaje_usuario;
  if (ui && !generico) return ui.mensaje_usuario;
  if (esRechazoUnicoMaterial(datos)) return MENSAJE_UNICO_MATERIAL;
  return respaldo;
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
