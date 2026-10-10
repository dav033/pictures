"use client";

import { obtenerIdConversacion } from "@/lib/registro/cliente";
import { CalificacionIA } from "./CalificacionIA";
import type { EscenasTurno } from "./cliente-feedback";
import { esProducido } from "./producidos";

type Props = {
  /** La vista de la conversación del cliente: de ella sale el id de conversación. */
  vista: "guiada" | "clasica";
  /** Alinear con el texto del asistente cuando este lleva avatar a la izquierda (la vista guiada). */
  sangria?: boolean;
  turnoId: string;
  pedido: string | undefined;
  respuesta: string;
  /** El estado (plan, cotización, ideas, referencia) antes y después de la respuesta: van como las «escenas» del turno. Se arma al enviar, no al dibujar. */
  escenas: () => EscenasTurno;
  /** La persona corrigió esta respuesta en su mensaje siguiente. */
  corregido: boolean;
  /** Solo la última respuesta de la IA lleva la fila completa; las anteriores, una línea. */
  ultima: boolean;
  /** El chat produjo una imagen (habilita el motivo «la foto realista no coincide»). */
  conImagen?: boolean;
};

/** La fila de calificación de una respuesta de la IA en un chat del cliente (REQ-010). Cada chat la monta con una línea. */
export function CalificacionCliente({ vista, sangria = false, turnoId, pedido, respuesta, escenas, corregido, ultima, conImagen = false }: Props) {
  return (
    <div className={sangria ? "pl-11 pt-2" : "pt-0.5"}>
      <CalificacionIA
        tema="cliente"
        deshecho={corregido}
        producido={esProducido(turnoId)}
        resumida={!ultima}
        conImagen={conImagen}
        config={{
          producto: "cliente",
          turnoId,
          conversacionId: () => obtenerIdConversacion(vista),
          datos: () => ({ ...(pedido ? { pedido } : {}), respuesta }),
          escenas,
        }}
      />
    </div>
  );
}
