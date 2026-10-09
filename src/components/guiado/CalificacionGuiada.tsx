"use client";

import { CalificacionCliente } from "../feedback-ia/CalificacionCliente";
import { corrigeLaRespuesta, estadoPrevio, pedidoDelTurno, type MensajeChat } from "../feedback-ia/turnos-cliente";

/** Lo que esta fila necesita de un mensaje de la vista guiada (el `Mensaje` de `VistaGuiada` lo cumple sin cambios). */
export type MensajeGuiadoCalificable = MensajeChat & {
  widgets?: readonly { tipo: string }[];
  rapidas?: readonly string[];
  pregunta?: string;
};

/** Widgets de respuestas guionadas (sin modelo): preguntas fijas, enlaces de compra, pasos ya calculados, la idea elegida. */
const WIDGETS_GUIONADOS: ReadonlySet<string> = new Set(["pregunta-propuesta", "comprar", "pasos-plan", "seleccion"]);

/** ¿Es una respuesta de la IA que vale la pena calificar? No lo son los saludos, las preguntas fijas con chips ni los fallos sin texto. */
export function esTurnoGuiadoCalificable(m: MensajeGuiadoCalificable): boolean {
  if (m.role !== "assistant" || m.rapidas?.length || m.pregunta) return false;
  if (m.widgets?.some((w) => WIDGETS_GUIONADOS.has(w.tipo))) return false;
  return m.content.trim().length > 0 || (m.widgets?.some((w) => w.tipo === "plan" || w.tipo === "propuesta") ?? false);
}

/** Lo que muestra el mensaje como «estado del render» del cliente: su plan, o su propuesta si aún no hay plan. */
export function estadoGuiadoDelMensaje(m: MensajeGuiadoCalificable): Record<string, unknown> | undefined {
  for (const clave of ["plan", "propuesta"] as const) {
    const widget = m.widgets?.find((w) => w.tipo === clave);
    const dato: unknown = widget ? Reflect.get(widget, clave) : undefined;
    if (dato !== undefined) return { [clave]: dato };
  }
  return undefined;
}

type Props = {
  mensajes: readonly MensajeGuiadoCalificable[];
  indice: number;
  /** `false` mientras la respuesta llega (se califica ya terminada). */
  listo: boolean;
};

/**
 * La fila «¿Qué tal quedó?» bajo una respuesta de la IA de la vista guiada (REQ-010). Manda el pedido, la respuesta y el plan de
 * antes y de después (las «escenas» de este producto); si el cliente corrige en su mensaje siguiente, abre el «por qué».
 */
export function CalificacionGuiada({ mensajes, indice, listo }: Props) {
  const mensaje = mensajes[indice];
  if (!listo || !mensaje || !esTurnoGuiadoCalificable(mensaje)) return null;
  return (
    <CalificacionCliente
      vista="guiada"
      sangria
      turnoId={mensaje.id}
      pedido={pedidoDelTurno(mensajes, indice)}
      respuesta={mensaje.content}
      antes={estadoPrevio(mensajes, indice, (i) => estadoGuiadoDelMensaje(mensajes[i]!))}
      despues={estadoGuiadoDelMensaje(mensaje)}
      corregido={corrigeLaRespuesta(mensajes, indice)}
    />
  );
}
