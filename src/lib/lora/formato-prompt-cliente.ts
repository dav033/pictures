import { LORA_PROMPT_FORMATS, type LoraPromptFormat } from "@/lib/ia/lora-prompt-format";

/**
 * Selector del formato del prompt LoRA en el navegador (modo dev).
 *
 * "Automático" no es un formato: significa no enviar `promptFormat` y dejar
 * que /api/generate lo resuelva por el trigger del LoRA elegido. Esa regla
 * vive solo en el servidor; aquí no se replica. Texto, JSON y Ambos se envían
 * explícitos y siempre ganan. Puro: sin React.
 */
export const FORMATO_PROMPT_AUTOMATICO = "automatico" as const;
export type SeleccionFormatoPrompt = typeof FORMATO_PROMPT_AUTOMATICO | LoraPromptFormat;

export const OPCIONES_FORMATO_PROMPT: readonly SeleccionFormatoPrompt[] = [FORMATO_PROMPT_AUTOMATICO, ...LORA_PROMPT_FORMATS];

export const ETIQUETA_FORMATO_PROMPT: Readonly<Record<SeleccionFormatoPrompt, string>> = {
  automatico: "Prompt: automático",
  texto: "Prompt: texto",
  json: "Prompt: JSON",
  ambos: "Prompt: ambos (2 imágenes)",
};

export function esSeleccionFormatoPrompt(valor: string): valor is SeleccionFormatoPrompt {
  return (OPCIONES_FORMATO_PROMPT as readonly string[]).includes(valor);
}

/** Valor de `promptFormat` para /api/generate: ausente sin LoRA o en automático. */
export function promptFormatParaGenerar(seleccion: SeleccionFormatoPrompt, usarLora: boolean): LoraPromptFormat | undefined {
  if (!usarLora || seleccion === FORMATO_PROMPT_AUTOMATICO) return undefined;
  return seleccion;
}
