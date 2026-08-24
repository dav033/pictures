import { z } from "zod";

/**
 * Modelo canónico del catálogo RAG (plan §2.3). Todo campo aquí, salvo
 * `derived` y `source_payload`, es HARD DATA que viene tal cual de Shopify —
 * nunca lo produce un LLM. `derived` es DERIVED DATA (taxonomía controlada,
 * ver derivar.ts) y se guarda separado para no mezclar niveles de autoridad.
 */
export const CatalogVariantSchema = z.object({
  variant_id: z.string().min(1),
  product_id: z.string().min(1),
  sku: z.string().nullable(),
  title: z.string().nullable(),
  price: z.number().nonnegative(),
  currency: z.literal("COP"),
  inventory_quantity: z.number().int().nullable(),
  inventory_source: z.enum(["cdn"]).nullable(),
  available: z.boolean(),
  options: z.record(z.string(), z.string().nullable()),
  image_url: z.string().nullable(),
  source_payload: z.unknown(),
  /**
   * Tamaño/forma decodificados (plan tamaños F1) vía `decodificarTamano()` —
   * mismo derivado determinístico que ya usa el catálogo SQLite, ahora
   * también en Postgres para que el retrieval pueda filtrar/ordenar por
   * diámetro. `null` cuando el código no es decodificable o el producto no
   * tiene tamaño (ver comentario de `TamanoDecodificado.forma`).
   */
  codigo_tamano: z.string().nullable(),
  forma: z.string().nullable(),
  diam_pulg: z.number().nullable(),
  largo_pulg: z.number().nullable(),
  ancho_cm: z.number().nullable(),
  alto_cm: z.number().nullable(),
  /** Variant-level color evidence; empty means unknown, never a union guess. */
  derived_colors: z.array(z.string()),
  /** Parsed package count; null means the source did not expose a safe count. */
  unidades_paq: z.number().int().positive().nullable(),
  /** True when package count is unknown rather than source-confirmed. */
  unidades_inferidas: z.boolean(),
});

export type CatalogVariant = z.infer<typeof CatalogVariantSchema>;

export const CatalogProductDerivedSchema = z.object({
  category: z.string().nullable(),
  colors: z.array(z.string()),
  finishes: z.array(z.string()).optional(),
  occasions: z.array(z.string()),
});

export type CatalogProductDerived = z.infer<typeof CatalogProductDerivedSchema>;

export const CatalogProductSchema = z.object({
  product_id: z.string().min(1),
  handle: z.string().min(1),
  title: z.string().min(1),
  description_text: z.string().nullable(),
  vendor: z.string().nullable(),
  product_type: z.string().nullable(),
  tags: z.array(z.string()),
  image_urls: z.array(z.string()),
  status: z.literal("ACTIVE"),
  available: z.boolean(),
  price_min: z.number().nullable(),
  price_max: z.number().nullable(),
  derived: CatalogProductDerivedSchema,
  source_payload: z.unknown(),
  search_text: z.string(),
  embedding_source_hash: z.string(),
  /** `updated_at` de Shopify tal cual — null si la fuente no lo trajo. Sirve
   * para no dejar que un webhook viejo pise datos más recientes (plan §5.5). */
  source_updated_at: z.string().nullable(),
});

export type CatalogProduct = z.infer<typeof CatalogProductSchema>;

export type CatalogRejection = {
  source_id: string | null;
  reason: string;
  raw_payload: unknown;
};

/**
 * Re-export de conveniencia (Tarea 02.2, PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md
 * §7.3): los contratos V3 (identidad física + verdad comercial) viven en
 * `./scene-asset-schema` y `../taxonomy/v3`, pero el resto del código puede
 * importarlos desde este módulo conocido (`@/lib/rag/catalog/schemas`) sin
 * tener que descubrir la ruta exacta. Ningún esquema/tipo V2 de arriba se
 * modifica ni se renombra.
 */
export {
  SupplySourceClassSchema,
  NonCommercialReferenceClassSchema,
  CommercialOfferStatusSchema,
  MediaRefRoleSchema,
  MediaRefSchema,
  SceneFunctionCandidateSchema,
  PhysicalDimensionsSchema,
  CompatibilitySchema,
  CatalogItemV3Schema,
  SourceRefSchema,
  AvailabilityStatusSchema,
  AvailabilitySchema,
  ServiceAreaSchema,
  RentalPeriodRulesSchema,
  PriceComponentTypeSchema,
  ServiceFeeKindSchema,
  PriceComponentSchema,
  CommercialOfferV1Schema,
  ContextNonQuotableKindSchema,
  SupplyBindingSchema,
} from "./scene-asset-schema";
export type {
  SupplySourceClass,
  NonCommercialReferenceClass,
  CommercialOfferStatus,
  MediaRefRole,
  MediaRef,
  SceneFunctionCandidate,
  PhysicalDimensions,
  Compatibility,
  CatalogItemV3,
  SourceRef,
  AvailabilityStatus,
  Availability,
  ServiceArea,
  RentalPeriodRules,
  PriceComponentType,
  ServiceFeeKind,
  PriceComponent,
  CommercialOfferV1,
  ContextNonQuotableKind,
  SupplyBinding,
} from "./scene-asset-schema";
export { SceneCategoryV3Schema, SceneFunctionV3Schema, SCENE_CATEGORIES_V3, SCENE_FUNCTIONS_V3 } from "../taxonomy/v3";
export type { SceneCategoryV3, SceneFunctionV3 } from "../taxonomy/v3";
