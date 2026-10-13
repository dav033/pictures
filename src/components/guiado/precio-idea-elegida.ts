import { CotizacionPlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { textoMaterialesDesde } from "./precio-chat";

/**
 * El precio de la tarjeta «Tu elección» (REQ-015, D3): una sola cifra, la del plan exacto guardado de la idea, que es la
 * misma que dirá la cotización. Se pide una vez por idea elegida y se guarda atado a la idea y a la conversación; si el plan
 * no llega, la tarjeta dice «Precio al elegir» y nunca un número que pueda cambiar. Puro: sin React ni red.
 */

export const TEXTO_PRECIO_AL_ELEGIR = "Precio al elegir";

type Cifra = { total: number; incluyeIva: boolean };
type Atado = { ideaId: string; sesion: number };

export type EstadoPrecioIdea =
  | (Atado & { fase: "cargando" })
  | (Atado & { fase: "listo"; cotizacion: Cifra })
  | (Atado & { fase: "al-elegir" });

export type RespuestaPlanIdea = { ok: true; cotizacion: unknown } | { ok: false };

export type VistaPrecioIdea = { tipo: "ninguno" } | { tipo: "cargando" } | { tipo: "al-elegir" } | { tipo: "precio"; texto: string };

export function empezarPrecioIdea(ideaId: string, sesion: number): EstadoPrecioIdea {
  return { ideaId, sesion, fase: "cargando" };
}

/**
 * Cierra el pedido de `ideaId` en `sesion`. Una respuesta tardía de otra idea, de otra conversación o ya resuelta no pisa
 * el estado de ahora. Sin cotización válida y con total, queda «al elegir».
 */
export function resolverPrecioIdea(estado: EstadoPrecioIdea | null, entrada: Atado & { sesionVigente: number; respuesta: RespuestaPlanIdea }): EstadoPrecioIdea | null {
  if (!estado || estado.fase !== "cargando" || estado.ideaId !== entrada.ideaId || estado.sesion !== entrada.sesion || entrada.sesion !== entrada.sesionVigente) return estado;
  const atado = { ideaId: estado.ideaId, sesion: estado.sesion };
  if (!entrada.respuesta.ok) return { ...atado, fase: "al-elegir" };
  const leida = CotizacionPlanGuiadoSchema.safeParse(entrada.respuesta.cotizacion);
  if (!leida.success || !(leida.data.total > 0)) return { ...atado, fase: "al-elegir" };
  return { ...atado, fase: "listo", cotizacion: { total: leida.data.total, incluyeIva: leida.data.incluyeIva } };
}

/** El pedido de `ideaId` se canceló sin respuesta (la idea dejó de ser la elegida sin reiniciar): su tarjeta no se queda calculando. */
export function cancelarPrecioIdea(estado: EstadoPrecioIdea | null, ideaId: string): EstadoPrecioIdea | null {
  return estado && estado.ideaId === ideaId && estado.fase === "cargando" ? { ideaId: estado.ideaId, sesion: estado.sesion, fase: "al-elegir" } : estado;
}

/** Lo que dice la tarjeta de `ideaId`: nada si el estado es de otra idea o el uso es negocio (su precio lleva mano de obra). */
export function vistaPrecioIdea(estado: EstadoPrecioIdea | null, ideaId: string, uso: "personal" | "negocio" | null): VistaPrecioIdea {
  if (!estado || estado.ideaId !== ideaId || uso === "negocio") return { tipo: "ninguno" };
  if (estado.fase === "cargando") return { tipo: "cargando" };
  if (estado.fase === "al-elegir") return { tipo: "al-elegir" };
  const texto = textoMaterialesDesde(estado.cotizacion, uso);
  return texto ? { tipo: "precio", texto } : { tipo: "al-elegir" };
}
