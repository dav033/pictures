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
 * Si este intento usa LoRA. Opción (a) del bloqueo de producto de B2 (conserva
 * el comportamiento actual): LoRA por defecto, y en modo usuario el estilo
 * estándar cuando la petición trae fotos, referencias o un ajuste, que LoRA no
 * puede procesar. No es un fallback tras un fallo: se decide antes de pedir la
 * imagen, por capacidad. En modo dev manda el selector.
 */
export function usarLoraEfectivo(entrada: EntradaEstiloImagen): boolean {
  if (!entrada.selectorLora || entrada.estiloEstandarExplicito) return false;
  if (entrada.modo === "dev") return true;
  return !(entrada.hayFotoEspacio || entrada.hayReferencias || entrada.esAjusteDeImagen);
}

/** El modal con el prompt técnico solo se abre solo en modo dev. */
export function abrirPromptAutomaticamente(modo: ModoVista, hayPrompts: boolean): boolean {
  return modo === "dev" && hayPrompts;
}
