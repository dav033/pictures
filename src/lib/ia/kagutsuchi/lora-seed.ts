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

/**
 * Semilla de evaluación del entorno (fase 0.1). Cuando está puesta, una petición
 * que no pide semilla usa ESTA en vez de sortear una.
 *
 * Existe porque sin ella no se puede atribuir un cambio de prompt a nada: la
 * semilla se movía por debajo, así que dos generaciones del mismo plan aprobado
 * daban imágenes distintas y no había forma de saber si la diferencia la causó
 * el cambio o el sorteo. El arnés de evaluación ya podía fijarla pasándola por
 * la petición; lo que faltaba era poder fijarla para una CORRIDA entera sin
 * tocar cada llamador.
 *
 * Deliberadamente NO se toca el camino del cliente: la variación le beneficia, y
 * poner esta variable en producción congelaría todas las vistas previas en la
 * misma imagen. Es una variable de entorno de evaluación, no una bandera de
 * producto, y por eso no vive en `feature-flags.ts`.
 */
export function semillaDeEvaluacion(entorno: string | undefined = process.env.LORA_EVAL_SEED): number | undefined {
  if (entorno === undefined || entorno.trim() === "") return undefined;
  const parsed = LoraSeedSchema.safeParse(Number(entorno));
  if (!parsed.success) {
    // Fallar en abierto y decirlo: una semilla mal escrita que se ignora en
    // silencio produce una corrida que PARECE determinista y no lo es, que es
    // peor que no tener la variable.
    console.warn(`[lora-seed] LORA_EVAL_SEED="${entorno}" no es un entero entre 0 y ${LORA_SEED_MAX}; se ignora y se sortea la semilla.`);
    return undefined;
  }
  return parsed.data;
}

/**
 * La semilla pedida gana; si no, la de evaluación; si tampoco, se sortea una.
 * Ese orden importa: una petición que pide semilla explícita la quiere aunque
 * la corrida tenga una fijada.
 */
export function resolveLoraSeed(requested: number | undefined, random: () => number = randomLoraSeed, evaluacion: number | undefined = semillaDeEvaluacion()): number {
  return requested ?? evaluacion ?? random();
}
