import { RESPALDO_VISTA_ARMADO_ARCO_ORGANICO } from "@/lib/plan/peticion-armado-arco-organico";
import type { EstadoVistaBorradorArcoOrganico } from "./vista-borrador-arco-organico";

/**
 * Cuándo se puede guardar el borrador del arco orgánico (ADR-0035). Puro: sin React.
 *
 * Guardar escribe el armado en el plan, lo vuelve a resolver y lo vuelve a firmar: cambia el `plan_hash` y con él
 * el total, así que es lo que mueve dinero y solo se ofrece con un borrador que **el motor ya dibujó**: nunca con
 * un dibujo pendiente, rechazado o que no llegó, y nunca sin cambios que guardar.
 */

export type PuedeGuardarArcoOrganico =
  | { puede: true }
  | {
    puede: false;
    /** Por qué no, en español, para decirlo junto al botón. */
    motivo: string;
    /**
     * `error`: el motor rechazó el borrador o no respondió; `espera`: algo está en camino; `nada`: no hay cambios;
     * `colores`: los colores de la pieza cambiaron y el decorador aún no revisó la paleta.
     */
    tipo: "error" | "espera" | "nada" | "colores";
  };

export function puedeGuardarArcoOrganico({ estado, hayCambios, guardando, ocupado, coloresCambiaron = false }: {
  estado: Pick<EstadoVistaBorradorArcoOrganico, "borrador" | "error">;
  hayCambios: boolean;
  guardando: boolean;
  /** Otro ajuste de la propuesta se está guardando: el plan que se firma es el que ese deje. */
  ocupado: boolean;
  /** Los colores de la pieza cambiaron desde que se revisó la paleta: sus índices pueden apuntar a otro color. */
  coloresCambiaron?: boolean;
}): PuedeGuardarArcoOrganico {
  if (guardando) return { puede: false, motivo: "Guardando el arco…", tipo: "espera" };
  if (ocupado) return { puede: false, motivo: "Hay otro ajuste guardándose. Espera un momento.", tipo: "espera" };
  if (coloresCambiaron) return { puede: false, motivo: "Los colores de la pieza cambiaron: revisa la paleta antes de guardar.", tipo: "colores" };
  if (!hayCambios) return { puede: false, motivo: "Todavía no cambiaste nada.", tipo: "nada" };
  switch (estado.borrador) {
    case "listo":
      return { puede: true };
    case "pendiente":
      return { puede: false, motivo: "Dibujando tus cambios…", tipo: "espera" };
    case "rechazado":
    case "fallido":
      return { puede: false, motivo: estado.error?.mensaje ?? RESPALDO_VISTA_ARMADO_ARCO_ORGANICO, tipo: "error" };
  }
}
