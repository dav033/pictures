"use client";

import { acotarPorPartes } from "../feedback-ia/cliente-feedback";
import { CalificacionCliente } from "../feedback-ia/CalificacionCliente";
import { huellaTexto } from "../feedback-ia/huella";
import { corrigeLaRespuesta, estadoPrevio, pedidoDelTurno, type MensajeChat } from "../feedback-ia/turnos-cliente";

/** Lo que esta fila necesita de un mensaje de la vista guiada (el `Mensaje` de `VistaGuiada` lo cumple sin cambios). */
export type MensajeGuiadoCalificable = MensajeChat & {
  widgets?: readonly { tipo: string }[];
  rapidas?: readonly string[];
  pregunta?: string;
  referencia?: unknown;
  miniatura?: string;
  fotoArmada?: boolean;
  envio?: unknown;
};

/** Widgets de respuestas guionadas (sin modelo): preguntas fijas, enlaces de compra, pasos ya calculados, la idea elegida. */
const WIDGETS_GUIONADOS: ReadonlySet<string> = new Set(["pregunta-propuesta", "comprar", "pasos-plan", "seleccion"]);

/** ¿Es una respuesta de la IA que vale la pena calificar? No lo son los saludos, las preguntas fijas con chips ni los fallos sin texto. */
export function esTurnoGuiadoCalificable(m: MensajeGuiadoCalificable): boolean {
  if (m.role !== "assistant" || m.rapidas?.length || m.pregunta) return false;
  if (m.widgets?.some((w) => WIDGETS_GUIONADOS.has(w.tipo))) return false;
  return m.content.trim().length > 0 || (m.widgets?.some((w) => w.tipo === "plan" || w.tipo === "propuesta") ?? false);
}

/** El índice de la última respuesta de la IA que se califica (la única que lleva la fila completa). */
export function ultimoTurnoGuiadoCalificable(mensajes: readonly MensajeGuiadoCalificable[]): number {
  for (let i = mensajes.length - 1; i >= 0; i -= 1) if (esTurnoGuiadoCalificable(mensajes[i]!)) return i;
  return -1;
}

/**
 * Lo que muestra el mensaje como «estado del render» del cliente: cada widget por su tipo (el plan, la propuesta, la cotización, las
 * ideas, los ajustes elegidos...), la lectura de la foto y una huella de su imagen (nunca la imagen). Si pesa más que el tope, se
 * sueltan primero las partes más grandes.
 */
export function estadoGuiadoDelMensaje(m: MensajeGuiadoCalificable): Record<string, unknown> | undefined {
  const partes: Record<string, unknown> = {};
  for (const widget of m.widgets ?? []) {
    const campos = Object.entries(widget).filter(([clave]) => clave !== "tipo");
    // Un widget que solo trae lo suyo (el plan, la propuesta) va directo bajo su tipo.
    const datos: unknown = campos.length === 1 && campos[0]![0] === widget.tipo ? campos[0]![1] : Object.fromEntries(campos);
    const previo = partes[widget.tipo];
    partes[widget.tipo] = previo === undefined ? datos : [...(Array.isArray(previo) ? previo : [previo]), datos];
  }
  if (m.referencia !== undefined) partes.referencia = m.referencia;
  if (m.miniatura) partes.imagenHuella = huellaTexto(m.miniatura);
  if (m.fotoArmada) partes.fotoArmada = true;
  if (m.envio !== undefined) partes.envio = m.envio;
  return Object.keys(partes).length ? acotarPorPartes(partes) : undefined;
}

type Props = {
  mensajes: readonly MensajeGuiadoCalificable[];
  indice: number;
  /** `false` mientras la respuesta llega (se califica ya terminada). */
  listo: boolean;
};

/**
 * La fila «¿Qué tal quedó?» bajo una respuesta de la IA de la vista guiada (REQ-010). Solo la última lleva la escala completa; manda
 * el pedido, la respuesta y el estado de antes y de después (las «escenas» de este producto); si el cliente corrige en su mensaje
 * siguiente, abre el «por qué» en una línea.
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
      escenas={() => ({ antes: estadoPrevio(mensajes, indice, (i) => estadoGuiadoDelMensaje(mensajes[i]!)), despues: estadoGuiadoDelMensaje(mensaje) })}
      corregido={corrigeLaRespuesta(mensajes, indice)}
      ultima={indice === ultimoTurnoGuiadoCalificable(mensajes)}
    />
  );
}
