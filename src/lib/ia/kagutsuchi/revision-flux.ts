import { limpiarTextoBase } from "./texto-base";

export class FluxRevisionTranslationError extends Error {
  readonly code = "FLUX_REVISION_TRANSLATION_FAILED";

  constructor(causa?: unknown) {
    super(`FLUX_REVISION_TRANSLATION_FAILED: no se pudo traducir la instrucción de revisión.${causa instanceof Error ? ` ${causa.message}` : ""}`);
    this.name = "FluxRevisionTranslationError";
  }
}

/** Traduce la revisión a una instrucción breve en inglés antes de formar el prompt de imagen. */
export async function traducirRevisionParaFlux(
  instruccion: string,
  traducir: (texto: string) => Promise<string | undefined>,
): Promise<string> {
  const entrada = limpiarTextoBase(instruccion.trim().slice(0, 500)).texto.trim();
  if (!entrada) throw new FluxRevisionTranslationError();
  try {
    const traducida = await traducir(entrada);
    const limpia = limpiarTextoBase(traducida?.trim() ?? "").texto.trim();
    if (!limpia) throw new Error("La traducción llegó vacía.");
    return limpia;
  } catch (error) {
    if (error instanceof FluxRevisionTranslationError) throw error;
    throw new FluxRevisionTranslationError(error);
  }
}
