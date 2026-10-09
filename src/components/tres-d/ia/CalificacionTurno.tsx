"use client";

import { useMemo } from "react";
import { obtenerIdConversacion } from "@/lib/registro/cliente";
import type { EstadoTurnoEnEscena } from "@/lib/globos3d/deshacer-turno";
import type { TurnoPanel } from "@/lib/globos3d/turnos-ia";
import { CalificacionIA } from "../../feedback-ia/CalificacionIA";
import type { ConfigCalificacion } from "../../feedback-ia/controlador-calificacion";
import { capturarTurnoFeedback } from "./captura-feedback";
import type { RegistroTurnoIA } from "./registro-feedback";

type Props = {
  turno: TurnoPanel;
  /** Lo que hay hoy con el turno en la escena (de `useAsistenteIA`); `undefined` si es de otra escena. */
  estado: EstadoTurnoEnEscena | undefined;
  /** Escenas, solicitud y pasos del turno (`ia.datosFeedback`). */
  datos: (id: string) => RegistroTurnoIA | undefined;
  compacta: boolean;
};

/** Los turnos con respuesta de la IA se califican; los que fallaron o se detuvieron se reintentan, no se califican. */
export const turnoCalificable = (turno: TurnoPanel): boolean => turno.estado === "aplicado" || turno.estado === "sin_cambios";

/** Deshecho: la persona lo revirtió (con «Deshacer turno» o con Ctrl+Z); no se cuenta el que nunca se pudo deshacer. */
export const turnoDeshecho = (estado: EstadoTurnoEnEscena | undefined): boolean => estado !== undefined && !estado.deshacible && estado.rehacible;

/**
 * La fila «¿Qué tal quedó?» bajo la tarjeta de un turno del panel B (REQ-010). Manda el pedido, la respuesta, los pasos del flujo,
 * el coste, el tiempo, la solicitud y las escenas de antes y después; las capturas se hacen solo al calificar, deshacer o comentar.
 */
export function CalificacionTurno({ turno, estado, datos, compacta }: Props) {
  const config = useMemo<ConfigCalificacion>(() => ({
    producto: "taller",
    turnoId: turno.id,
    conversacionId: () => obtenerIdConversacion("3d"),
    datos: () => {
      const registro = datos(turno.id);
      return {
        pedido: turno.pedido,
        respuesta: turno.respuesta,
        costeUsd: turno.costeUsd,
        latenciaMs: turno.ms,
        pasos: registro?.pasos ?? turno.pasos.map((p) => ({ nombre: p.herramienta, ok: true, resumen: p.resumen })),
        ...(registro?.solicitudId ? { solicitudId: registro.solicitudId } : {}),
      };
    },
    escenas: () => {
      const registro = datos(turno.id);
      return registro ? { antes: registro.escenaAntes, despues: registro.escenaDespues } : {};
    },
    capturas: () => capturarTurnoFeedback(datos(turno.id)),
  }), [turno, datos]);
  return <CalificacionIA tema="taller" config={config} deshecho={turnoDeshecho(estado)} compacta={compacta} />;
}
