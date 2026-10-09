"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { crearControlador, type ConfigCalificacion, type ControladorCalificacion, type EstadoCalificacion } from "./controlador-calificacion";

export type OpcionesCalificacion = {
  /**
   * `true` cuando la persona deshizo o corrigió este turno. Solo el paso de `false` a `true` mientras está montado cuenta (un turno que
   * ya llega deshecho, p. ej. al recargar, no manda nada ni abre nada).
   */
  deshecho?: boolean;
};

/** Solo el paso de «no deshecho» a «deshecho» mientras está montado cuenta. */
export const pasaADeshecho = (previo: boolean, ahora: boolean): boolean => ahora && !previo;

export type CalificacionIA = {
  estado: EstadoCalificacion;
  calificar: ControladorCalificacion["calificar"];
  alternarPorQue: ControladorCalificacion["alternarPorQue"];
  alternarMotivo: ControladorCalificacion["alternarMotivo"];
  escribirComentario: ControladorCalificacion["escribirComentario"];
  enviarPorQue: ControladorCalificacion["enviarPorQue"];
  reintentar: ControladorCalificacion["reintentar"];
};

/**
 * La calificación de un turno de la IA para cualquier superficie (Taller, chat guiado, chat clásico): el estado de la fila y los
 * gestos de la persona. `config` se lee al enviar (siempre lo último); el turno y el producto no cambian mientras vive el hook.
 */
export function useCalificacionIA(config: ConfigCalificacion, { deshecho = false }: OpcionesCalificacion = {}): CalificacionIA {
  const [controlador] = useState<ControladorCalificacion>(() => crearControlador(config));
  useEffect(() => { controlador.usar(config); });
  const estado = useSyncExternalStore(controlador.suscribir, controlador.leer, controlador.leer);

  const previo = useRef(deshecho);
  useEffect(() => {
    if (pasaADeshecho(previo.current, deshecho)) controlador.marcarDeshecho();
    previo.current = deshecho;
  }, [deshecho, controlador]);

  const { calificar, alternarPorQue, alternarMotivo, escribirComentario, enviarPorQue, reintentar } = controlador;
  return { estado, calificar, alternarPorQue, alternarMotivo, escribirComentario, enviarPorQue, reintentar };
}
