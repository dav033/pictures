import { z } from "zod";
import { CATEGORIAS_CATALOGO, DIAMETROS_REDONDOS_CATALOGO, FORMAS_CATALOGO, OCASIONES_CATALOGO, PALETA_COLORES } from "@/lib/shopify/derivar";

/**
 * Salida estructurada del intérprete de consultas (plan §3.10/§3.11). Usa la
 * MISMA taxonomía controlada que la normalización (derivar.ts) — así lo que
 * el LLM puede decir sobre filtros duros siempre es representable en la DB,
 * nunca un valor inventado que el retrieval no sabría filtrar.
 *
 * La distinción central: `filtros_duros` son requerimientos estrictos
 * ("tiene que ser dorado") que se aplican en SQL antes del ranking.
 * Preferencias sueltas ("preferiría algo dorado") NO van aquí — se dejan en
 * `semantic_query` para que el ranking las use sin arriesgar cero resultados.
 */
export const IntentQuerySchema = z.object({
  intent: z.enum(["product_search", "other"]),
  filtros_duros: z.object({
    categorias: z.array(z.enum(CATEGORIAS_CATALOGO as [string, ...string[]])),
    ocasiones: z.array(z.enum(OCASIONES_CATALOGO as [string, ...string[]])),
    colores: z.array(z.enum(PALETA_COLORES as [string, ...string[]])),
    /** Forma física del globo — no el tamaño. Ver comentario del mismo campo en herramientas.ts. */
    formas: z.array(z.enum(FORMAS_CATALOGO as [string, ...string[]])),
    /**
     * Diámetro EXACTO en pulgadas — solo cuando el cliente da un número o un
     * término inequívoco ("5 pulgadas", "los chiquitos" → 5; "gigante" →
     * 24/36). Una preferencia suelta de tamaño ("medianos", sin más) no es
     * un filtro duro: va en semantic_query, igual que con color/categoría.
     */
    diametros_pulgadas: z.array(z.union(DIAMETROS_REDONDOS_CATALOGO.map((d) => z.literal(d)) as [z.ZodLiteral<number>, ...z.ZodLiteral<number>[]])),
    precio_max: z.number().nullable(),
    solo_disponibles: z.boolean(),
  }),
  semantic_query: z.string(),
});

export type IntentQuery = z.infer<typeof IntentQuerySchema>;
