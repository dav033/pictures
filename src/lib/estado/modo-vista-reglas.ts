import type { ModoVista } from "./modo-vista";
import { LORA_BASE_MODE, LoraTrainedModeSlugSchema, type LoraModeSlug } from "@/lib/lora/schema";

/**
 * Reglas de comportamiento que dependen del modo de vista (B2,
 * docs/mejoras/PLAN-ESTRUCTURAS-Y-UX.md). Puras, sin React ni navegador.
 *
 * En modo usuario los controles técnicos no se ven, así que su valor efectivo
 * no puede depender de ellos: LoRA no admite fotos ni ajustes sobre la imagen
 * previa.
 */

export type EntradaEstiloImagen = {
  modo: ModoVista;
  selectorLora: boolean;
  /** El cliente pidió "Generar con estilo estándar" desde un aviso. */
  estiloEstandarExplicito: boolean;
  hayFotoEspacio: boolean;
  hayReferencias: boolean;
  /** La petición envía la imagen previa para ajustarla. */
  esAjusteDeImagen: boolean;
};

/**
 * Si este intento usa LoRA. Decisión del usuario (2026-09-15): LoRA por defecto
 * también con foto del espacio, referencias o ajuste de imagen. Antes el modo
 * usuario pasaba a estilo estándar (Gemini) en esos casos. El pedido explícito
 * de estilo estándar y el selector apagado siguen ganando.
 *
 * Qué hace el servidor con eso, que NO es lo que decía este comentario: solo
 * con referencias o imagen previa el adaptador llega a FLUX.2 `/edit`
 * (`sempertex-lora.ts`). Con foto del espacio entra el modo híbrido
 * (`route.ts:913`), que manda al LoRA cero imágenes (`route.ts:1178`) y compone
 * después con Gemini; el `/edit` con las fotos es el objetivo de la fase 4 del
 * plan, no el comportamiento actual.
 */
export function usarLoraEfectivo(entrada: EntradaEstiloImagen): boolean {
  return entrada.selectorLora && !entrada.estiloEstandarExplicito;
}

/** El modal con el prompt técnico solo se abre solo en modo dev. */
export function abrirPromptAutomaticamente(modo: ModoVista, hayPrompts: boolean): boolean {
  return modo === "dev" && hayPrompts;
}

/**
 * Modo con el que el selector "lora" genera. Decisión del usuario
 * (2026-10-04): el modelo base FLUX.2 sin pesos LoRA (`base`) en vez de los
 * LoRA entrenados v004/v007. Solo en desarrollo, `NEXT_PUBLIC_LORA_MODE` puede
 * elegir explícitamente un modo entrenado para compararlo; cualquier otro
 * valor, o producción, deja `base`.
 */
export function modoLoraPorDefecto(entorno: { nodeEnv?: string; modoPedido?: string }): LoraModeSlug {
  if (entorno.nodeEnv !== "development") return LORA_BASE_MODE;
  const pedido = LoraTrainedModeSlugSchema.safeParse(entorno.modoPedido);
  return pedido.success ? pedido.data : LORA_BASE_MODE;
}

/** Nombre visible de la ruta FLUX.2 en fal según el modo: sin LoRA no se presenta como estilo entrenado. */
export function nombreRutaFlux(modo: LoraModeSlug): string {
  return modo === LORA_BASE_MODE ? "FLUX.2 base (fal)" : "LoRA Sempertex";
}
