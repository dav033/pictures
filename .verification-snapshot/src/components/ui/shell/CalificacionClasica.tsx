"use client";

import { acotarPorPartes } from "../../feedback-ia/cliente-feedback";
import { CalificacionCliente } from "../../feedback-ia/CalificacionCliente";
import { huellaTexto } from "../../feedback-ia/huella";
import { corrigeLaRespuesta, estadoPrevio, pedidoDelTurno, type MensajeChat } from "../../feedback-ia/turnos-cliente";

type ImagenAdjunta = { id?: string; mime: string; base64: string };

/** Lo que esta fila necesita de un mensaje del chat clásico (el `Mensaje` de `page.tsx` lo cumple sin cambios). */
export type MensajeClasicoCalificable = MensajeChat & {
  plan?: unknown;
  cotizacion?: unknown;
  brief?: unknown;
  referenceBlueprint?: unknown;
  decoraciones?: unknown;
  ragValidados?: unknown;
  ragRechazados?: unknown;
  analisisReferencias?: unknown;
  adjuntos?: { referencias: readonly ImagenAdjunta[]; fotoEspacio?: ImagenAdjunta };
};

const SALUDO_ID = "saludo";

const huellaImagen = (i: ImagenAdjunta) => ({ ...(i.id ? { id: i.id } : {}), mime: i.mime, huella: huellaTexto(i.base64) });

/**
 * El estado de la propuesta en este mensaje: el plan, la cotización, el brief, la referencia, las piezas validadas y descartadas, las
 * decoraciones ofrecidas y una huella de cada foto (nunca la foto). Si pesa más que el tope, se sueltan primero las partes más grandes.
 */
export function estadoClasicoDelMensaje(m: MensajeClasicoCalificable): Record<string, unknown> | undefined {
  const partes: Record<string, unknown> = {
    ...(m.plan ? { plan: m.plan } : {}),
    ...(m.cotizacion ? { cotizacion: m.cotizacion } : {}),
    ...(m.brief ? { brief: m.brief } : {}),
    ...(m.referenceBlueprint ? { referenceBlueprint: m.referenceBlueprint } : {}),
    ...(m.ragValidados ? { ragValidados: m.ragValidados } : {}),
    ...(m.ragRechazados ? { ragRechazados: m.ragRechazados } : {}),
    ...(m.decoraciones ? { decoraciones: m.decoraciones } : {}),
    ...(m.adjuntos ? { fotos: { referencias: m.adjuntos.referencias.map(huellaImagen), ...(m.adjuntos.fotoEspacio ? { fotoEspacio: huellaImagen(m.adjuntos.fotoEspacio) } : {}) } } : {}),
  };
  return Object.keys(partes).length ? acotarPorPartes(partes) : undefined;
}

const esTurnoClasicoCalificable = (m: MensajeClasicoCalificable): boolean =>
  m.role === "assistant" && m.id !== SALUDO_ID && m.analisisReferencias == null && (m.content.trim().length > 0 || Boolean(m.plan));

/** El índice de la última respuesta de la IA que se califica (la única que lleva la fila completa). */
export function ultimoTurnoClasicoCalificable(mensajes: readonly MensajeClasicoCalificable[]): number {
  for (let i = mensajes.length - 1; i >= 0; i -= 1) if (esTurnoClasicoCalificable(mensajes[i]!)) return i;
  return -1;
}

type Props = {
  mensajes: readonly MensajeClasicoCalificable[];
  indice: number;
  /** `false` mientras la respuesta llega (se califica ya terminada). */
  listo: boolean;
  /** El chat ya produjo una imagen de la propuesta. */
  conImagen: boolean;
};

/**
 * La fila «¿Qué tal quedó?» bajo una respuesta de la IA del chat clásico (REQ-010): solo la última lleva la escala completa; manda el
 * pedido, la respuesta y el estado de la propuesta de antes y de después; si el cliente corrige en su mensaje siguiente, abre el
 * «por qué» en una línea.
 */
export function CalificacionClasica({ mensajes, indice, listo, conImagen }: Props) {
  const mensaje = mensajes[indice];
  if (!listo || !mensaje || !esTurnoClasicoCalificable(mensaje)) return null;
  return (
    <CalificacionCliente
      vista="clasica"
      turnoId={mensaje.id}
      pedido={pedidoDelTurno(mensajes, indice)}
      respuesta={mensaje.content}
      escenas={() => ({ antes: estadoPrevio(mensajes, indice, (i) => estadoClasicoDelMensaje(mensajes[i]!)), despues: estadoClasicoDelMensaje(mensaje) })}
      corregido={corrigeLaRespuesta(mensajes, indice)}
      ultima={indice === ultimoTurnoClasicoCalificable(mensajes)}
      conImagen={conImagen}
    />
  );
}
