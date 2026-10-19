"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { crearControlador, type ConfigCalificacion, type ControladorCalificacion, type EstadoCalificacion } from "./controlador-calificacion";

export type OpcionesCalificacion = {
  /**
   * El turno se produjo en esta página (no se restauró): se registra al terminar. Un turno restaurado solo consulta su calificación
   * guardada. Cambiar de `false` a `true` registra; nunca se vuelve a consultar.
   */
  producido?: boolean;
  /**
   * Si la persona deshizo o corrigió este turno. `undefined`: no se sabe (el turno es de otra escena que no está a la vista).
   * Solo cuentan los cambios mientras se ve y está montado: lo primero que se ve (al montar o al volver a la escena del turno) solo
   * se toma como punto de partida, sin mandar nada. De `false` a `true` se registra y se abre el «por qué»; de `true` a `false`
   * (lo rehizo) se avisa al servidor.
   */
  deshecho?: boolean | undefined;
};

/** Un turno producido en la página se registra; uno restaurado solo consulta su calificación guardada. */
export function alMontar(controlador: ControladorCalificacion, producido: boolean): Promise<void> {
  return producido ? controlador.registrarTerminado() : controlador.cargarGuardada();
}

export type CambioDeshecho = "deshizo" | "rehizo" | "nada";

/** Qué hacer cuando `deshecho` pasa de `previo` a `ahora` (`undefined`: aún no se sabe, no se hace nada). */
export function cambioDeDeshecho(previo: boolean | undefined, ahora: boolean | undefined): CambioDeshecho {
  if (previo === undefined || ahora === undefined || previo === ahora) return "nada";
  return ahora ? "deshizo" : "rehizo";
}

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
 * gestos de la persona. Un turno producido en esta página se registra al montarse; uno restaurado solo pide su calificación guardada.
 * `config` se lee al enviar (siempre lo último); el turno y el producto no cambian mientras vive el hook.
 */
export function useCalificacionIA(config: ConfigCalificacion, { deshecho, producido = false }: OpcionesCalificacion = {}): CalificacionIA {
  const [controlador] = useState<ControladorCalificacion>(() => crearControlador(config));
  useEffect(() => { controlador.usar(config); });
  useEffect(() => { void alMontar(controlador, producido); }, [controlador, producido]);
  const estado = useSyncExternalStore(controlador.suscribir, controlador.leer, controlador.leer);

  const previo = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const cambio = cambioDeDeshecho(previo.current, deshecho);
    if (cambio === "deshizo") controlador.fijarDeshecho(true);
    else if (cambio === "rehizo") controlador.fijarDeshecho(false);
    previo.current = deshecho;
  }, [deshecho, controlador]);

  const { calificar, alternarPorQue, alternarMotivo, escribirComentario, enviarPorQue, reintentar } = controlador;
  return { estado, calificar, alternarPorQue, alternarMotivo, escribirComentario, enviarPorQue, reintentar };
}
