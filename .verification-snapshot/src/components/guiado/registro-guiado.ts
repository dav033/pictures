/**
 * Registro de la vista guiada en el navegador (src/lib/registro/cliente): cada acción del cliente (chips, botones de
 * los widgets, elegir idea, costear, aprender, contratar, reintentar) y cada fallo (SSE cortado, plan defectuoso o
 * fallido, imagen) va a /api/registro-cliente con el id de la conversación y una INSTANTÁNEA del estado: en qué paso
 * del flujo está, qué idea o plan tiene elegido y qué widgets mostraba el último mensaje. Nunca fotos ni base64.
 * Nada aquí lanza ni cambia lo que ve el cliente.
 */
import { nuevaConversacion, obtenerIdConversacion, registrarEventoCliente } from "@/lib/registro/cliente";

export const VISTA_GUIADA = "guiada";

/** Id de la conversación guiada de esta pestaña (lo crea si no hay) y la deja como activa para el interceptor de fetch. */
export function conversacionGuiada(): string {
  return obtenerIdConversacion(VISTA_GUIADA);
}

/** Al abrir la vista: fija la conversación activa (la de la sesión restaurada, o una nueva) y lo deja anotado. */
export function abrirConversacionGuiada(restaurada: boolean, mensajes: number): string {
  const id = conversacionGuiada();
  try {
    registrarEventoCliente("vista.abierta", { restaurada, mensajes }, id, { vista: VISTA_GUIADA });
  } catch {
    // Nunca lanza.
  }
  return id;
}

/** Al vaciar: se cierra la conversación anterior y empieza una nueva, en su propio archivo del servidor. */
export function vaciarConversacionGuiada(): string {
  try {
    const anterior = conversacionGuiada();
    const nueva = nuevaConversacion(VISTA_GUIADA);
    registrarEventoCliente("conversacion.vaciar", { nueva }, anterior, { vista: VISTA_GUIADA });
    registrarEventoCliente("conversacion.nueva", { anterior }, nueva, { vista: VISTA_GUIADA });
    return nueva;
  } catch {
    return nuevaConversacion(VISTA_GUIADA);
  }
}

const MAX_TEXTO = 300;
const MAX_IDS = 12;

function texto(valor: string): string {
  if (valor.startsWith("data:")) return "[imagen]";
  return valor.length > MAX_TEXTO ? `${valor.slice(0, MAX_TEXTO)}…` : valor;
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/** Resumen de un widget: tipo, escalares, ids de sus listas y la huella del plan. Sin fotos ni objetos grandes. */
export function resumenWidget(widget: unknown): Record<string, unknown> {
  if (!esObjeto(widget)) return { tipo: "desconocido" };
  const resumen: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(widget)) {
    if (typeof valor === "string") resumen[clave] = texto(valor);
    else if (typeof valor === "number" || typeof valor === "boolean") resumen[clave] = valor;
    else if (Array.isArray(valor)) {
      const ids = valor.map((item) => (esObjeto(item) && typeof item.id === "string" ? item.id : typeof item === "string" ? texto(item) : null)).filter((id): id is string => id !== null);
      resumen[clave] = ids.length ? ids.slice(0, MAX_IDS) : { elementos: valor.length };
    } else if (esObjeto(valor)) {
      if (typeof valor.id === "string") resumen[clave] = { id: valor.id, ...(typeof valor.titulo === "string" ? { titulo: texto(valor.titulo) } : {}) };
      else if (typeof valor.plan_hash === "string") resumen[clave] = { plan_hash: valor.plan_hash };
      else if (typeof valor.total === "number") resumen[clave] = { total: valor.total };
      else resumen[clave] = `{${Object.keys(valor).length} campos}`;
    }
  }
  return resumen;
}

export interface EstadoParaInstantanea {
  mensajes: ReadonlyArray<{ id: string; role: string; content: string; widgets?: readonly unknown[]; referencia?: unknown }>;
  brief: Record<string, unknown>;
  seleccionada: { id: string; titulo: string } | null;
  uso: string | null;
  planVigente: { mensajeId: string; widget: { plan: { plan_hash?: string } } } | null;
  cargando: boolean;
  fallo: { titulo: string; accion: { tipo: string } } | null;
}

/** En qué paso del flujo guiado está el cliente (para leer la instantánea sin reconstruir la conversación). */
export function pasoDelFlujo(estado: EstadoParaInstantanea): string {
  if (estado.fallo) return "fallo";
  if (estado.planVigente) return "plan";
  if (estado.seleccionada) return estado.uso ? "idea_elegida_con_uso" : "idea_elegida";
  const ultimo = [...estado.mensajes].reverse().find((mensaje) => mensaje.role === "assistant");
  if (ultimo?.widgets?.some((widget) => esObjeto(widget) && widget.tipo === "propuesta")) return "propuesta";
  if (ultimo?.widgets?.some((widget) => esObjeto(widget) && widget.tipo === "decoraciones")) return "ideas";
  if (ultimo?.referencia) return "lectura_foto";
  return estado.mensajes.length ? "conversando" : "inicio";
}

export function instantaneaGuiada(estado: EstadoParaInstantanea): Record<string, unknown> {
  try {
    const ultimo = [...estado.mensajes].reverse().find((mensaje) => mensaje.role === "assistant");
    return {
      paso: pasoDelFlujo(estado),
      mensajes: estado.mensajes.length,
      brief: estado.brief,
      ideaElegida: estado.seleccionada ? { id: estado.seleccionada.id, titulo: estado.seleccionada.titulo } : null,
      uso: estado.uso,
      plan: estado.planVigente ? { mensajeId: estado.planVigente.mensajeId, plan_hash: estado.planVigente.widget.plan.plan_hash ?? null } : null,
      ultimoAsistente: ultimo ? { id: ultimo.id, texto: texto(ultimo.content), widgets: (ultimo.widgets ?? []).map(resumenWidget) } : null,
      cargando: estado.cargando,
      fallo: estado.fallo ? { titulo: estado.fallo.titulo, accion: estado.fallo.accion.tipo } : null,
    };
  } catch {
    return { paso: "desconocido" };
  }
}

/** Acción del cliente en la vista guiada, con la instantánea del estado en que la hizo. */
export function registrarAccionGuiada(evento: string, datos: Record<string, unknown>, estado: EstadoParaInstantanea): void {
  try {
    registrarEventoCliente(evento, { ...datos, instantanea: instantaneaGuiada(estado) }, conversacionGuiada(), { vista: VISTA_GUIADA });
  } catch {
    // El registro nunca cambia la vista.
  }
}

/** Fallo visto por el cliente (SSE cortado, plan sin confirmar, imagen…), con la instantánea y el error. */
export function registrarFalloGuiado(evento: string, causa: unknown, datos: Record<string, unknown>, estado: EstadoParaInstantanea, nivel: "warn" | "error" = "error"): void {
  try {
    const error = causa instanceof Error
      ? { nombre: causa.name, mensaje: causa.message, pila: causa.stack }
      : { mensaje: typeof causa === "string" ? causa : String(causa) };
    // Solo los fallos que el cliente ve como error cuentan como `error` en la auditoría; los avisos (un plan con
    // defecto que se pide otra vez, una foto sin lectura) quedan como evento de nivel warn en su momento.
    registrarEventoCliente(evento, { ...datos, error, instantanea: instantaneaGuiada(estado) }, conversacionGuiada(), { vista: VISTA_GUIADA, nivel, tipo: nivel === "error" ? "error" : "evento" });
  } catch {
    // El registro nunca cambia la vista.
  }
}
