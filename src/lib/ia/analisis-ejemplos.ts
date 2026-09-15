import { createHash } from "node:crypto";
import analisisEjemplos from "./analisis-ejemplos.json";
import type { AnalisisV2Resultado } from "./analizar-referencias-v2";
import type { ImagenEtiquetada } from "./tipos";

/**
 * Reviewed analyses of the 10 gallery photos (`public/referencias-ejemplo/`).
 * The gallery sends each file untouched, so its bytes are the same in every
 * browser: the same photo always shows the same pieces and boxes, instantly
 * and without a provider call. Regenerate with
 * `npx tsx scripts/generar-analisis-ejemplos.ts` when the parser version changes.
 */
export type AnalisisEjemplo = {
  id: string;
  sha256: string;
  resultado: AnalisisV2Resultado;
};

export type ArchivoAnalisisEjemplos = {
  parser_version: string;
  ejemplos: AnalisisEjemplo[];
};

export const ANALISIS_EJEMPLOS = analisisEjemplos as unknown as ArchivoAnalisisEjemplos;

export function sha256Base64(base64: string): string {
  return createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex");
}

/** The stored analysis when the request is exactly one untouched gallery photo; null otherwise. */
export function analisisFijoDeEjemplo(referencias: ImagenEtiquetada[], parserVersion: string, archivo: ArchivoAnalisisEjemplos = ANALISIS_EJEMPLOS): AnalisisV2Resultado | null {
  if (referencias.length !== 1 || archivo.parser_version !== parserVersion) return null;
  const [referencia] = referencias;
  const hash = sha256Base64(referencia!.base64);
  const ejemplo = archivo.ejemplos.find((item) => item.sha256 === hash);
  if (!ejemplo || ejemplo.resultado.blueprint.source_images[0]?.image_id !== referencia!.id) return null;
  return { ...ejemplo.resultado, metadata: { ...ejemplo.resultado.metadata, cached: true } };
}
