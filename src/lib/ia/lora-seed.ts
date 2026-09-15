import { z } from "zod";

/** Largest seed /api/generate accepts: an unsigned 32-bit integer. */
export const LORA_SEED_MAX = 4_294_967_295;
const LoraSeedSchema = z.number().int().min(0).max(LORA_SEED_MAX);

export type LoraSeedParse = { ok: true; seed: number | undefined } | { ok: false; message: string };

/**
 * Validates the optional `seed` of POST /api/generate. Absent (undefined/null)
 * means "pick one"; anything else must be an integer in 0..2^32-1, never coerced.
 */
export function parseLoraSeed(value: unknown): LoraSeedParse {
  if (value === undefined || value === null) return { ok: true, seed: undefined };
  const parsed = LoraSeedSchema.safeParse(value);
  return parsed.success
    ? { ok: true, seed: parsed.data }
    : { ok: false, message: `LORA_SEED_INVALID: seed debe ser un entero entre 0 y ${LORA_SEED_MAX}.` };
}

/**
 * Random seed fixed before calling the provider, so the effective seed can be
 * reported and the image reproduced. Kept below 2^31-1, the range the "ambos"
 * comparison seed used before explicit seeds existed.
 */
export function randomLoraSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! % 2_147_483_647;
}

/** The requested seed wins; otherwise one random seed is drawn. */
export function resolveLoraSeed(requested: number | undefined, random: () => number = randomLoraSeed): number {
  return requested ?? random();
}
