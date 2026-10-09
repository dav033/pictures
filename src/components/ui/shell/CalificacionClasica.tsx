"use client";

import { CalificacionCliente } from "../../feedback-ia/CalificacionCliente";
import { corrigeLaRespuesta, estadoPrevio, pedidoDelTurno, type MensajeChat } from "../../feedback-ia/turnos-cliente";

/** Lo que esta fila necesita de un mensaje del chat clásico (el `Mensaje` de `page.tsx` lo cumple sin cambios). */
export type MensajeClasicoCalificable = MensajeChat & { plan?: unknown; analisisReferencias?: unknown };

const SALUDO_ID = "saludo";

const estadoDelMensaje = (m: MensajeClasicoCalificable): Record<string, unknown> | undefined => (m.plan ? { plan: m.plan } : undefined);

type Props = {
  mensajes: readonly MensajeClasicoCalificable[];
  indice: number;
  /** `false` mientras la respuesta llega (se califica ya terminada). */
  listo: boolean;
};

/**
 * La fila «¿Qué tal quedó?» bajo una respuesta de la IA del chat clásico (REQ-010): el pedido, la respuesta y la propuesta de
 * antes y de después; si el cliente corrige en su mensaje siguiente, abre el «por qué».
 */
export function CalificacionClasica({ mensajes, indice, listo }: Props) {
  const mensaje = mensajes[indice];
  if (!listo || !mensaje || mensaje.role !== "assistant" || mensaje.id === SALUDO_ID || mensaje.analisisReferencias != null) return null;
  if (!mensaje.content.trim() && !mensaje.plan) return null;
  return (
    <CalificacionCliente
      vista="clasica"
      turnoId={mensaje.id}
      pedido={pedidoDelTurno(mensajes, indice)}
      respuesta={mensaje.content}
      antes={estadoPrevio(mensajes, indice, (i) => estadoDelMensaje(mensajes[i]!))}
      despues={estadoDelMensaje(mensaje)}
      corregido={corrigeLaRespuesta(mensajes, indice)}
    />
  );
}
