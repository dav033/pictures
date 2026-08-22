import { z } from "zod";
import {
  CATEGORIAS_CATALOGO_V2,
  DIAMETROS_REDONDOS_CATALOGO_V2,
  FORMAS_CATALOGO_V2,
  OCASIONES_CATALOGO_V2,
  PALETA_COLORES_V2,
  TAXONOMY_VERSION,
} from "@/lib/rag/taxonomy/v2";

const enumSchema = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values);
const diameterSchema = z.union(
  DIAMETROS_REDONDOS_CATALOGO_V2.map((diameter) => z.literal(diameter)) as [z.ZodLiteral<number>, ...z.ZodLiteral<number>[]],
);

/** Zod contract shared by deterministic parsing, Gemini and all retrieval callers. */
export const IntentQuerySchema = z.object({
  intent: z.enum(["product_search", "other"]),
  filtros_duros: z.object({
    categorias: z.array(enumSchema(CATEGORIAS_CATALOGO_V2)).default([]),
    ocasiones: z.array(enumSchema(OCASIONES_CATALOGO_V2)).default([]),
    colores: z.array(enumSchema(PALETA_COLORES_V2)).default([]),
    /** Physical shape only; a finish such as metalizado is never a shape. */
    formas: z.array(enumSchema(FORMAS_CATALOGO_V2)).default([]),
    /** Exact catalog diameters in inches. */
    diametros_pulgadas: z.array(diameterSchema).default([]),
    precio_max: z.number().nullable().default(null),
    solo_disponibles: z.boolean().default(true),
  }),
  semantic_query: z.string().default(""),
});

export type IntentQuery = z.infer<typeof IntentQuerySchema>;
export { TAXONOMY_VERSION };
