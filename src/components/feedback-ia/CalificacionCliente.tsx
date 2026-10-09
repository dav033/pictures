"use client";

import { obtenerIdConversacion } from "@/lib/registro/cliente";
import { CalificacionIA } from "./CalificacionIA";

type Props = {
  /** La vista de la conversación del cliente: de ella sale el id de conversación. */
  vista: "guiada" | "clasica";
  /** Alinear con el texto del asistente cuando este lleva avatar a la izquierda (la vista guiada). */
  sangria?: boolean;
  turnoId: string;
  pedido: string | undefined;
  respuesta: string;
  /** El plan (o lo que se muestre) antes y después de la respuesta, si lo hay: van como las «escenas» del turno. */
  antes?: unknown;
  despues?: unknown;
  /** La persona corrigió esta respuesta en su mensaje siguiente. */
  corregido: boolean;
};

/** La fila de calificación de una respuesta de la IA en un chat del cliente (REQ-010). Cada chat la monta con una línea. */
export function CalificacionCliente({ vista, sangria = false, turnoId, pedido, respuesta, antes, despues, corregido }: Props) {
  return (
    <div className={sangria ? "pl-11 pt-2" : "pt-0.5"}>
      <CalificacionIA
        tema="cliente"
        deshecho={corregido}
        config={{
          producto: "cliente",
          turnoId,
          conversacionId: () => obtenerIdConversacion(vista),
          datos: () => ({ ...(pedido ? { pedido } : {}), respuesta }),
          escenas: () => ({ antes, despues }),
        }}
      />
    </div>
  );
}
