import { ETIQUETA_RECALCULAR, TITULO_AVISO_RECALCULO } from "@/lib/guiada-motor/mensajes-cliente";

type IdeaDelFallo = { titulo: string; sumada: boolean };
type AlternativaDelFallo = "otros-colores" | "otra-pieza";

/** La tarjeta de `TarjetaError` (con la acción que repite su botón) y lo que se anuncia a los lectores de pantalla. */
export type FalloDelPlan<A> = {
  titulo: string; detalle?: string; etiqueta?: string; accion: A; alternativas?: AlternativaDelFallo[]; mensajeId: string; variante?: "actualizar";
};

/**
 * Lo que la vista guiada dice cuando un plan pedido no llegó (`aceptarPropuesta`): «Detener», un fallo, o (P-045) el aviso
 * de que el plan del 3D que el cliente tiene hay que recalcularlo con el método de siempre. El aviso no es un fallo: va en la
 * tarjeta (el texto del mensaje del plan no se ve, la tarjeta del plan lo tapa), con un título que no dice «No pude», el
 * estilo informativo y un único botón, «Recalcular mi plan», que es el consentimiento: sin él no se recalcula ni cambia el
 * precio. Sin otras salidas: «Usar otros colores» también recalcularía.
 */
export function falloDelPlan<A>(entrada: { estado: "fallo" | "detenido"; aviso?: string; idea?: IdeaDelFallo; accion: A; mensajeId: string }): { fallo: FalloDelPlan<A>; anuncio: string } {
  const { estado, aviso, idea, accion, mensajeId } = entrada;
  const anuncio = idea?.sumada ? "No pude agregar la idea; tu plan sigue como estaba" : "No pude terminar tu plan";
  if (estado === "detenido") return { fallo: { titulo: "Detuviste la respuesta", detalle: "Puedes pedir el plan otra vez cuando quieras.", etiqueta: "Preparar el plan", accion, mensajeId }, anuncio };
  if (aviso) return { fallo: { titulo: TITULO_AVISO_RECALCULO, detalle: aviso, etiqueta: ETIQUETA_RECALCULAR, accion, mensajeId, variante: "actualizar" }, anuncio: `${TITULO_AVISO_RECALCULO}. ${aviso}` };
  // Al sumar una idea, el plan de antes sigue intacto (vigente): se dice, y solo se ofrece reintentar.
  if (idea) {
    return {
      fallo: { titulo: idea.sumada ? `No pude agregar «${idea.titulo}» a tu plan` : `No pude armar tu plan con «${idea.titulo}»`, detalle: idea.sumada ? "Tu plan sigue como estaba. Inténtalo otra vez." : "Tu conversación sigue guardada. Inténtalo otra vez.", accion, mensajeId },
      anuncio,
    };
  }
  return { fallo: { titulo: "No pude terminar tu plan", detalle: "Tu conversación sigue guardada.", accion, alternativas: ["otros-colores", "otra-pieza"], mensajeId }, anuncio };
}
