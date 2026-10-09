import type { UsoAnthropic } from "./tipos";

/**
 * Precio estimado de una llamada a Claude (USD). Fuente: https://platform.claude.com/docs/en/models/haiku-5-5/overview
 * (tabla de precios, consultada 2026-10-09; NOTES.md §1). USD por millón de tokens; el razonamiento se cobra como
 * salida. Una petición cuyo prompt pasa de 100 000 tokens se cobra entera con la segunda tarifa.
 */

type Tarifa = { entrada: number; salida: number; cacheEscritura: number; cacheLectura: number };

export const UMBRAL_PROMPT_LARGO = 100_000;

const PRECIOS: Readonly<Record<string, { normal: Tarifa; largo: Tarifa }>> = {
  "claude-haiku-5-5": {
    // Escritura de caché de 5 minutos (la única que se usa: `cache_control` sin `ttl`).
    normal: { entrada: 0.10, salida: 0.50, cacheEscritura: 0.125, cacheLectura: 0.01 },
    largo: { entrada: 0.50, salida: 2.50, cacheEscritura: 0.625, cacheLectura: 0.05 },
  },
};

/** `undefined` si el modelo no tiene precio cargado (no se inventa). */
export function costeClaudeUsd(modelo: string, uso: UsoAnthropic): number | undefined {
  const precios = PRECIOS[modelo];
  if (!precios) return undefined;
  const leidos = uso.cache_read_input_tokens ?? 0;
  const escritos = uso.cache_creation_input_tokens ?? 0;
  const prompt = uso.input_tokens + leidos + escritos;
  const tarifa = prompt > UMBRAL_PROMPT_LARGO ? precios.largo : precios.normal;
  return (uso.input_tokens * tarifa.entrada + escritos * tarifa.cacheEscritura + leidos * tarifa.cacheLectura + uso.output_tokens * tarifa.salida) / 1e6;
}
