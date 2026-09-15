import type { ModoVista } from "./modo-vista";

/**
 * Reglas de comportamiento que dependen del modo de vista (B2,
 * docs/mejoras/PLAN-ESTRUCTURAS-Y-UX.md). Puras, sin React ni navegador.
 *
 * En modo usuario los controles técnicos no se ven, así que su valor efectivo
 * no puede depender de ellos: la revisión visual es obligatoria para aprobar
 * un plan (el servidor exige IMAGE_QA_REQUIRED) y LoRA no admite fotos ni
 * ajustes sobre la imagen previa.
 */

/** Modo usuario: revisión visual siempre activa. Modo dev: lo que marque la casilla. */
export function qaVisualEfectivo(modo: ModoVista, casillaDev: boolean): boolean {
  return modo === "dev" ? casillaDev : true;
}

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
 * también con foto del espacio, referencias o ajuste de imagen, que el servidor
 * envía a FLUX.2 `/edit` (sempertex-lora.ts). Antes el modo usuario pasaba a
 * estilo estándar (Gemini) en esos casos. El pedido explícito de estilo estándar
 * y el selector apagado siguen ganando.
 */
export function usarLoraEfectivo(entrada: EntradaEstiloImagen): boolean {
  return entrada.selectorLora && !entrada.estiloEstandarExplicito;
}

/** El modal con el prompt técnico solo se abre solo en modo dev. */
export function abrirPromptAutomaticamente(modo: ModoVista, hayPrompts: boolean): boolean {
  return modo === "dev" && hayPrompts;
}
