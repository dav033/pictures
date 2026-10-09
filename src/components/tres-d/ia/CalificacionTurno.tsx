"use client";

import { obtenerIdConversacion } from "@/lib/registro/cliente";
import type { EstadoTurnoEnEscena } from "@/lib/globos3d/deshacer-turno";
import type { TurnoPanel } from "@/lib/globos3d/turnos-ia";
import { CalificacionIA } from "../../feedback-ia/CalificacionIA";
import type { ConfigCalificacion } from "../../feedback-ia/controlador-calificacion";
import { useSostenido } from "../../feedback-ia/useSostenido";
import { capturarTurnoFeedback } from "./captura-feedback";
import type { RegistroTurnoIA } from "./registro-feedback";

/** Cuánto tiene que seguir deshecho un turno (con Ctrl+Z) para que cuente: un Ctrl+Z que se rehace enseguida es otra cosa. */
export const ESPERA_CTRL_Z_MS = 5000;

type Props = {
  turno: TurnoPanel;
  /** Lo que hay hoy con el turno en la escena (de `useAsistenteIA`); `undefined` si es de otra escena. */
  estado: EstadoTurnoEnEscena | undefined;
  /** ¿Lo deshizo la persona con el botón «Deshacer turno»? */
  deshechoConBoton: boolean;
  /** Escenas, solicitud y pasos del turno (`ia.datosFeedback`). */
  datos: (id: string) => RegistroTurnoIA | undefined;
  compacta: boolean;
};

/** Los turnos con respuesta de la IA se califican; los que fallaron o se detuvieron se reintentan, no se califican. */
export const turnoCalificable = (turno: TurnoPanel): boolean => turno.estado === "aplicado" || turno.estado === "sin_cambios";

/** Hoy está revertido en la escena: ya no se puede deshacer y se puede rehacer. */
export const turnoRevertido = (estado: EstadoTurnoEnEscena): boolean => !estado.deshacible && estado.rehacible;

/**
 * ¿Cuenta como «deshecho» para la calificación? Solo si hoy está revertido Y la persona usó el botón «Deshacer turno», o lo dejó
 * revertido (Ctrl+Z) `ESPERA_CTRL_Z_MS` seguidos. `undefined` si el turno es de otra escena (no se sabe: el hook no hace nada).
 */
export function turnoDeshechoParaCalificar(estado: EstadoTurnoEnEscena | undefined, conBoton: boolean, sostenido: boolean): boolean | undefined {
  if (estado === undefined) return undefined;
  return turnoRevertido(estado) && (conBoton || sostenido);
}

/**
 * La fila «¿Qué tal quedó?» bajo la tarjeta de un turno del panel B (REQ-010). Manda el pedido, la respuesta, los pasos del flujo,
 * el coste, el tiempo, la solicitud y las escenas de antes y después; las capturas se hacen solo al calificar, deshacer o comentar.
 * Lo que no se sabe (turnos de una sesión anterior, rondas de la comparación con la foto) no se manda: nunca se inventa.
 */
export function CalificacionTurno({ turno, estado, deshechoConBoton, datos, compacta }: Props) {
  const revertido = estado !== undefined && turnoRevertido(estado);
  const sostenido = useSostenido(revertido, ESPERA_CTRL_Z_MS);
  const config: ConfigCalificacion = {
    producto: "taller",
    turnoId: turno.id,
    conversacionId: () => obtenerIdConversacion("3d"),
    datos: () => {
      const registro = datos(turno.id);
      return {
        pedido: turno.pedido,
        respuesta: turno.respuesta,
        costeUsd: turno.costeUsd,
        ...(turno.ms > 0 ? { latenciaMs: turno.ms } : {}),
        ...(registro && registro.pasos.length > 0 ? { pasos: registro.pasos } : {}),
        ...(registro?.solicitudId ? { solicitudId: registro.solicitudId } : {}),
      };
    },
    escenas: () => {
      const registro = datos(turno.id);
      return registro ? { antes: registro.escenaAntes, despues: registro.escenaDespues } : {};
    },
    capturas: () => capturarTurnoFeedback(datos(turno.id)),
  };
  return <CalificacionIA tema="taller" config={config} deshecho={turnoDeshechoParaCalificar(estado, deshechoConBoton, sostenido)} compacta={compacta} />;
}
