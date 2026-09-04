import { z } from "zod";

/** Shared honesty vocabulary for reference elements and event products. */
export const NIVELES_COINCIDENCIA = ["exacto", "adaptable", "fuera_de_catalogo"] as const;

export const NivelCoincidenciaSchema = z.enum(NIVELES_COINCIDENCIA);
export type NivelCoincidencia = z.infer<typeof NivelCoincidenciaSchema>;
