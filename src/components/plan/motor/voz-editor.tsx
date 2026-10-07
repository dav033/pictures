"use client";

import { createContext, useContext } from "react";

/**
 * Con qué voz hablan los editores de pieza del motor (arco, columna, guirnalda): la del DECORADOR en la vista clásica
 * (receta, firma de la propuesta, globos por metro, papel del color, lo que hay que comprar) o la del CLIENTE en la
 * vista guiada («Modificar esta pieza» de «Tu plan»: hallazgos del probador, latido 88). Con la del cliente:
 *  - nada de jerga ni de mandos de decorador (receta, firma, línea guía, globos por metro, papel del color, hasta
 *    dónde llega la banda, restablecer);
 *  - dos acciones claras: «Guardar» y «Cancelar»;
 *  - una sola cifra de globos (la que lleva la pieza), con la reserva de compra explicada en una línea;
 *  - un solo desplazamiento (la hoja), sin una caja con su propio scroll dentro, y sin saltar al abrir.
 * Por defecto es la clásica: ningún texto ni mando de la clásica cambia si nadie pone la guiada.
 */
export type VozEditor = "clasica" | "cliente";

const ContextoVoz = createContext<VozEditor>("clasica");

export const VozEditorProvider = ContextoVoz.Provider;

/** Si el editor habla con la voz del cliente (vista guiada). */
export function useVozCliente(): boolean {
  return useContext(ContextoVoz) === "cliente";
}

/** La línea que explica la reserva de compra, en la voz del cliente. */
export const RESERVA_CLIENTE = "Al comprar sumo unos globos de reserva por si alguno se revienta; los ves en «Cuánto cuesta».";
