import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { CABECERA_CONVERSACION, CABECERA_SOLICITUD, CABECERA_VISTA, type ContextoRegistro } from "./tipos";

/**
 * Contexto de correlación por petición (AsyncLocalStorage): todo lo que se registre dentro de
 * `conContexto(...)` lleva la misma solicitud, conversación, vista y ruta sin pasarlas a mano.
 * La instancia vive en globalThis para que la compartan todos los bundles de rutas y sobreviva al HMR.
 */

declare global {
  var __registroAlmacenContexto: AsyncLocalStorage<ContextoRegistro> | undefined;
}

function almacen(): AsyncLocalStorage<ContextoRegistro> {
  if (!globalThis.__registroAlmacenContexto) globalThis.__registroAlmacenContexto = new AsyncLocalStorage<ContextoRegistro>();
  return globalThis.__registroAlmacenContexto;
}

const RE_NO_PERMITIDO = /[^a-zA-Z0-9_-]+/g;

/** [a-zA-Z0-9_-], máximo 64; `undefined` si no queda nada. Es también el nombre de archivo de la conversación. */
export function sanearIdConversacion(valor: unknown): string | undefined {
  if (typeof valor !== "string" && typeof valor !== "number") return undefined;
  const limpio = String(valor).trim().replace(RE_NO_PERMITIDO, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return limpio || undefined;
}

/** Id de solicitud aceptable: el mismo alfabeto, máximo 64. */
export function sanearIdSolicitud(valor: unknown): string | undefined {
  return sanearIdConversacion(valor);
}

export function contextoActual(): ContextoRegistro | undefined {
  try {
    return almacen().getStore();
  } catch {
    return undefined;
  }
}

/**
 * Ejecuta `fn` con un contexto nuevo que hereda lo que no se indique del contexto vigente (una sub-tarea
 * conserva la conversación de su petición). Si el registro fallara, `fn` corre igual.
 */
export function conContexto<T>(parcial: Partial<ContextoRegistro>, fn: () => T): T {
  let contexto: ContextoRegistro;
  try {
    const actual = contextoActual();
    contexto = {
      solicitud: sanearIdSolicitud(parcial.solicitud) ?? actual?.solicitud ?? randomUUID(),
      conversacion: sanearIdConversacion(parcial.conversacion) ?? actual?.conversacion,
      vista: parcial.vista ?? actual?.vista,
      ruta: parcial.ruta ?? actual?.ruta,
      inicio: parcial.inicio ?? Date.now(),
    };
  } catch {
    return fn();
  }
  return almacen().run(contexto, fn);
}

/** Completa el contexto vigente (p. ej. cuando el id de conversación aparece al leer el cuerpo). */
export function actualizarContexto(cambios: Partial<Pick<ContextoRegistro, "conversacion" | "vista" | "ruta">>): void {
  const actual = contextoActual();
  if (!actual) return;
  if (cambios.conversacion !== undefined) actual.conversacion = sanearIdConversacion(cambios.conversacion) ?? actual.conversacion;
  if (cambios.vista !== undefined) actual.vista = cambios.vista;
  if (cambios.ruta !== undefined) actual.ruta = cambios.ruta;
}

function campoTexto(objeto: unknown, ...ruta: string[]): string | undefined {
  let actual: unknown = objeto;
  for (const paso of ruta) {
    if (typeof actual !== "object" || actual === null || Array.isArray(actual)) return undefined;
    actual = (actual as Record<string, unknown>)[paso];
  }
  return typeof actual === "string" && actual.trim() ? actual : undefined;
}

/** Dónde puede venir el id de conversación en un cuerpo JSON (además de la cabecera x-conversacion-id). */
export function idConversacionDelCuerpo(cuerpo: unknown): string | undefined {
  return campoTexto(cuerpo, "idConversacion")
    ?? campoTexto(cuerpo, "conversacionId")
    ?? campoTexto(cuerpo, "conversacion_id")
    ?? campoTexto(cuerpo, "conversationId")
    ?? campoTexto(cuerpo, "estadoGuiado", "idConversacion")
    ?? campoTexto(cuerpo, "contexto", "idConversacion");
}

/**
 * Contexto de una petición entrante: x-request-id (o uno nuevo), id de conversación de la cabecera
 * x-conversacion-id o del cuerpo, vista de x-vista / cuerpo.vista, y la ruta.
 */
export function contextoDesdeRequest(
  request: Request,
  cuerpo?: unknown,
  extra: { ruta?: string; vista?: string } = {},
): ContextoRegistro {
  let ruta = extra.ruta;
  try {
    ruta ??= new URL(request.url).pathname;
  } catch {
    // URL relativa en pruebas: sin ruta.
  }
  return {
    solicitud: sanearIdSolicitud(request.headers.get(CABECERA_SOLICITUD)) ?? randomUUID(),
    conversacion: sanearIdConversacion(request.headers.get(CABECERA_CONVERSACION)) ?? sanearIdConversacion(idConversacionDelCuerpo(cuerpo)),
    vista: request.headers.get(CABECERA_VISTA)?.trim().slice(0, 32) || campoTexto(cuerpo, "vista")?.slice(0, 32) || extra.vista,
    ruta,
    inicio: Date.now(),
  };
}

/**
 * Cabeceras para propagar la correlación a otro servicio (el Python): x-request-id y x-conversacion-id.
 * El adaptador de Python ya manda su propio x-request-id (UUID validado): allí basta x-conversacion-id.
 */
export function cabecerasCorrelacion(opciones: { incluirSolicitud?: boolean } = {}): Record<string, string> {
  const actual = contextoActual();
  const cabeceras: Record<string, string> = {};
  if (!actual) return cabeceras;
  if (opciones.incluirSolicitud !== false) cabeceras[CABECERA_SOLICITUD] = actual.solicitud;
  if (actual.conversacion) cabeceras[CABECERA_CONVERSACION] = actual.conversacion;
  if (actual.vista) cabeceras[CABECERA_VISTA] = actual.vista;
  return cabeceras;
}

/** Nombre del archivo de auditoría para el contexto dado. */
export function idConversacionEfectivo(contexto: ContextoRegistro | undefined, explicito?: string): string {
  return sanearIdConversacion(explicito)
    ?? contexto?.conversacion
    ?? `sin-conversacion-${(sanearIdSolicitud(contexto?.solicitud) ?? "fuera-de-peticion").slice(0, 45)}`;
}
