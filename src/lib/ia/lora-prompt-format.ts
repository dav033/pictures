import { z } from "zod";

/**
 * How the LoRA prompt is sent to fal.ai:
 * - `texto`: natural-language caption (default, the regime the LoRA was trained on).
 * - `json`: the same approved scene as a FLUX.2 structured JSON prompt (experimental).
 * - `ambos`: two provider calls with the same seed, one per format, to compare them.
 */
export const LORA_PROMPT_FORMATS = ["texto", "json", "ambos"] as const;
export const LoraPromptFormatSchema = z.enum(LORA_PROMPT_FORMATS);
export type LoraPromptFormat = z.infer<typeof LoraPromptFormatSchema>;

/** Absent means `texto`; any other value is a client error, never silently coerced. */
export function parseLoraPromptFormat(value: unknown): LoraPromptFormat {
  return value === undefined || value === null ? "texto" : LoraPromptFormatSchema.parse(value);
}

export function includesTextPrompt(format: LoraPromptFormat): boolean {
  return format !== "json";
}

export function includesJsonPrompt(format: LoraPromptFormat): boolean {
  return format !== "texto";
}
