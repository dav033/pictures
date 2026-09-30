import { z } from "zod";

/**
 * How the LoRA prompt is sent to fal.ai:
 * - `texto`: natural-language caption, the regime the LoRA was trained on.
 * - `json`: the same approved scene as a FLUX.2 structured JSON prompt.
 * - `ambos`: two provider calls with the same seed, one per format, to compare them.
 */
export const LORA_PROMPT_FORMATS = ["texto", "json", "ambos"] as const;
export const LoraPromptFormatSchema = z.enum(LORA_PROMPT_FORMATS);
export type LoraPromptFormat = z.infer<typeof LoraPromptFormatSchema>;

/**
 * Triggers whose default format is JSON. Product decision (2026-09-14, iteration
 * 3 step 4): with LoRA v004 (`eventdecor_style_v2`) the JSON prompt kept
 * separate side pieces apart in 2 cases where the text caption merged them.
 * Every other trigger keeps text by default.
 */
const JSON_DEFAULT_TRIGGERS: ReadonlySet<string> = new Set(["eventdecor_style_v2"]);

/**
 * Effective prompt format for a request. Absent (undefined/null) resolves by the
 * selected LoRA trigger (JSON for `eventdecor_style_v2`, text otherwise); an
 * explicit value always wins; any other value is a client error, never coerced.
 */
export function resolveLoraPromptFormat(
  value: unknown,
  trigger: string | undefined,
  /**
   * Hay una guía de estructura que mandar (ADR-0033). La guía solo viaja con el
   * caption de TEXTO, así que con el JSON por defecto nunca se enviaba: el único
   * LoRA aprobado (v004, `eventdecor_style_v2`) es precisamente el único trigger
   * cuyo formato por defecto es JSON, y ADR-0033 era código muerto en producción.
   *
   * Por qué se puede preferir texto aquí sin perder lo que el JSON daba: ese
   * JSON por defecto se eligió porque mantenía separadas las piezas laterales
   * (2026-09-14, iteración 3 paso 4), y la guía exige una ÚNICA estructura sin
   * props — justo el caso donde no hay piezas laterales que separar. Ahí el JSON
   * no compra nada y el dibujo sí: es el único canal capaz de decirle al
   * generador dónde va cada color, porque el texto no puede (`corner` no existe
   * en el corpus de v007 y en el de v004 significa una esquina del local).
   *
   * Un formato pedido explícitamente sigue mandando siempre.
   */
  guiaDisponible = false,
): LoraPromptFormat {
  if (value === undefined || value === null) {
    if (guiaDisponible) return "texto";
    return trigger !== undefined && JSON_DEFAULT_TRIGGERS.has(trigger.trim()) ? "json" : "texto";
  }
  return LoraPromptFormatSchema.parse(value);
}

export function includesTextPrompt(format: LoraPromptFormat): boolean {
  return format !== "json";
}

export function includesJsonPrompt(format: LoraPromptFormat): boolean {
  return format !== "texto";
}
