import { z } from "zod";
import {
  HappieConversationRequestV1Schema,
  HappieConversationResponseV1Schema,
  HappieDescriptionRequestV1Schema,
  HappieErrorV1Schema,
  HappiePackageRecommendationResponseV1Schema,
  HappieRecommendationRequestV1Schema,
  HappieRecommendationResponseV1Schema,
  HappieStructuredRecommendationRequestV1Schema,
} from "./happie-v1";
import {
  BackendSelectionV1Schema,
  InternalRequestSignatureV1Schema,
  OperationalContextV1Schema,
} from "./operational-v1";
import { ReferenceBlueprintV2Schema } from "@/lib/ia/reference-blueprint";
import { SceneSpecSchema } from "@/lib/ia/scene-spec";
import { MaterialEstimateSchema } from "@/lib/materiales/estimacion";
import {
  PlanDecoracion1_1Schema,
  PlanDecoracionSchema,
  PropCatalogoSchema,
} from "@/lib/plan/tipos";
import { CatalogProductSchema, CatalogVariantSchema } from "@/lib/rag/catalog/schemas";
import { LoraSelectionSchema } from "@/lib/lora/schema";
import { productVocabularySchema } from "@/lib/lora/product-vocabulary";

export const CATALOG_SELECTION_CONTRACT_VERSION = "catalog-selection.v1" as const;
export const PLAN_RESUELTO_CONTRACT_VERSION = "plan-resuelto.v1" as const;
export const QUOTE_CONTRACT_VERSION = "quote.v1" as const;

const idSchema = z.string().trim().min(1).max(160);
/** COP is transported as whole pesos; rounding happens before this boundary. */
const copSchema = z.number().int().nonnegative();
const positiveIntSchema = z.number().int().positive();
const nonNegativeIntSchema = z.number().int().nonnegative();

export const CatalogSelectionRequestItemV1Schema = z.object({
  product_id: idSchema,
  variant_id: idSchema,
  quantity: positiveIntSchema,
  reason: z.string().trim().min(1).max(500).optional(),
}).strict();

export const CatalogAllowlistEntryV1Schema = z.object({
  product_id: idSchema,
  variant_ids: z.array(idSchema).min(1).max(256),
}).strict();

export const CatalogSelectionRequestV1Schema = z.object({
  schema_version: z.literal(CATALOG_SELECTION_CONTRACT_VERSION),
  request_id: z.string().uuid(),
  catalog_snapshot_id: idSchema.nullable().optional(),
  items: z.array(CatalogSelectionRequestItemV1Schema).min(1).max(64),
  allowlist: z.array(CatalogAllowlistEntryV1Schema).max(256),
}).strict();

export const CatalogValidatedItemV1Schema = z.object({
  product_id: idSchema,
  variant_id: idSchema,
  sku: z.string().nullable(),
  product_title: z.string().min(1),
  title: z.string().min(1),
  unit_price_cop: copSchema,
  quantity: positiveIntSchema,
  subtotal_cop: copSchema,
  image_url: z.string().url().nullable(),
  handle: z.string().min(1).nullable(),
  product_type: z.string().min(1).nullable(),
  category: z.string().min(1).nullable(),
  colors: z.array(z.string().min(1)),
  description: z.string().nullable(),
  units_per_package: positiveIntSchema.nullable(),
  size_code: z.string().min(1).nullable(),
  shape: z.string().min(1).nullable(),
  diameter_inches: z.number().nonnegative().nullable(),
}).strict();

export const CatalogRejectedItemV1Schema = z.object({
  product_id: idSchema,
  variant_id: idSchema,
  reason: z.string().min(1).max(500),
}).strict();

export const CatalogSelectionResultV1Schema = z.object({
  schema_version: z.literal(CATALOG_SELECTION_CONTRACT_VERSION),
  request_id: z.string().uuid(),
  status: z.enum(["ok", "partial", "empty"]),
  catalog_snapshot_id: idSchema.nullable(),
  validados: z.array(CatalogValidatedItemV1Schema),
  rechazados: z.array(CatalogRejectedItemV1Schema),
  total_cop: copSchema,
}).strict();

const originLineSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("estructura"), id: idSchema }).strict(),
  z.object({ kind: z.literal("prop"), id: idSchema }).strict(),
]);

const resolvedMaterialLineSchema = z.object({
  estructura_id: idSchema,
  origen: originLineSchema,
  product_id: idSchema,
  variant_id: idSchema,
  sku: z.string().nullable(),
  sku_original: z.string().nullable().optional(),
  source_snapshot_id: z.string().nullable().optional(),
  source_variant_id: z.string().nullable().optional(),
  inventory_quantity: z.number().int().nullable().optional(),
  unidades_inferidas: z.boolean().nullable().optional(),
  titulo: z.string().min(1),
  color: z.string().nullable(),
  tamano_codigo: z.string().nullable(),
  diam_pulg: z.number().nonnegative().nullable(),
  diam_cm: z.number().nonnegative().nullable(),
  forma: z.string().nullable(),
  acabado: z.string().nullable(),
  unidades: positiveIntSchema,
  imagen: z.string().url().nullable().optional(),
  sustitucion: z.object({ pedido: z.string(), entregado: z.string(), motivo: z.string() }).strict().nullable(),
}).strict();

const resolvedStructureSchema = z.object({
  estructura_id: idSchema,
  nombre: z.string().min(1),
  tipo: z.string().min(1),
  ubicacion: z.string().min(1),
  repeticiones: positiveIntSchema,
  eje_m: z.number().nonnegative().nullable(),
  total_unidades: nonNegativeIntSchema,
  lineas: z.array(resolvedMaterialLineSchema),
  mezcla_real: z.array(z.object({
    diam_pulg: z.number().nonnegative(),
    forma: z.string().nullable(),
    unidades: nonNegativeIntSchema,
    pct: z.number().min(0).max(1),
  }).strict()),
  supuestos: z.array(z.string()),
}).strict();

const resolvedPropSchema = z.object({
  prop_id: idSchema,
  product_id: idSchema,
  variant_id: idSchema,
  rol_escena: z.string().min(1),
  ubicacion: z.string().min(1),
  unidades: positiveIntSchema,
  linea: resolvedMaterialLineSchema,
  porque: z.string().min(1),
}).strict();

const consolidatedPurchaseSchema = z.object({
  variant_id: idSchema,
  product_id: idSchema,
  sku: z.string().nullable(),
  sku_original: z.string().nullable().optional(),
  source_snapshot_id: z.string().nullable().optional(),
  source_variant_id: z.string().nullable().optional(),
  inventory_quantity: z.number().int().nullable().optional(),
  unidades_inferidas: z.boolean().nullable().optional(),
  titulo: z.string().min(1),
  tamano_codigo: z.string().nullable(),
  diam_pulg: z.number().nonnegative().nullable(),
  color: z.string().nullable(),
  unidades_necesarias: nonNegativeIntSchema,
  design_quantity: nonNegativeIntSchema,
  waste_reserve: nonNegativeIntSchema,
  required_quantity: nonNegativeIntSchema,
  unidades_con_merma: nonNegativeIntSchema,
  unidades_paquete: positiveIntSchema,
  paquetes: positiveIntSchema,
  purchase_quantity: positiveIntSchema,
  used: nonNegativeIntSchema,
  leftover_inventory: nonNegativeIntSchema,
  consumption_cost: copSchema,
  purchase_cost: copSchema,
  additional_package_for_waste: z.boolean(),
  sobrante: nonNegativeIntSchema,
  precio_paquete: copSchema,
  subtotal: copSchema,
  estructuras: z.array(idSchema),
  elementos_origen: z.array(originLineSchema),
  imagen: z.string().url().nullable().optional(),
}).strict();

export const PlanResueltoV1Schema = z.object({
  schema_version: z.literal(PLAN_RESUELTO_CONTRACT_VERSION),
  plan: z.union([PlanDecoracionSchema, PlanDecoracion1_1Schema]),
  props: z.array(resolvedPropSchema).optional(),
  plan_hash: z.string().min(1),
  event_label: z.string().nullable().optional(),
  original_request: z.string().optional(),
  event_match_levels: z.array(z.enum(["exact_event", "thematic", "adaptable"])).optional(),
  event_relaxations: z.array(z.string()).optional(),
  request_id: z.string().uuid().optional(),
  estructuras: z.array(resolvedStructureSchema),
  compras: z.array(consolidatedPurchaseSchema),
  totales: z.object({
    globos_por_tamano: z.record(z.string(), nonNegativeIntSchema),
    total_unidades: nonNegativeIntSchema,
    total_cop: copSchema,
    design_quantity: nonNegativeIntSchema,
    target_waste_reserve: nonNegativeIntSchema,
    covered_waste_reserve: nonNegativeIntSchema,
    uncovered_waste_reserve: nonNegativeIntSchema,
    natural_package_surplus: nonNegativeIntSchema,
    purchase_cost: copSchema,
    consumption_cost: copSchema,
    waste_only_savings_cop: copSchema,
    additional_waste_packages: nonNegativeIntSchema,
    ahorro_paquetes_cop: copSchema,
    incluye_iva: z.boolean(),
    merma_porcentaje: z.number().min(0).max(100),
  }).strict(),
  comercial: z.object({
    estado: z.enum(["VERIFICADO", "APROBACION_REQUERIDA", "PRESUPUESTO_EXCEDIDO"]),
    techo_cop: copSchema.optional(),
    delta_cop: z.number().int(),
    procedencia: z.enum(["explicito", "inferido", "supuesto"]).optional(),
  }).strict(),
  alternativas: z.array(z.object({
    familia_id: idSchema,
    titulo: z.string().min(1),
    total_cop: copSchema,
    ahorro_cop: copSchema,
    etiqueta: z.enum(["economica", "equilibrada", "premium"]),
  }).strict()),
  merma_log: z.string(),
  sustituciones: z.array(z.object({ estructura_id: idSchema, pedido: z.string(), entregado: z.string(), motivo: z.string() }).strict()),
  sin_cobertura: z.array(z.object({ estructura_id: idSchema, product_id: idSchema, tamano: z.string() }).strict()),
  advertencias: z.array(z.string()),
}).strict();

const quoteLineSchema = z.object({
  id: idSchema,
  product_id: idSchema.optional(),
  variant_id: idSchema.optional(),
  size: z.string().min(1),
  size_code: z.string().optional(),
  diameter_inches: z.number().nonnegative().optional(),
  structures: z.array(idSchema).optional(),
  origins: z.array(originLineSchema).optional(),
  color: z.string().optional(),
  required_quantity: nonNegativeIntSchema,
  design_quantity: nonNegativeIntSchema.optional(),
  waste_reserve: nonNegativeIntSchema.optional(),
  purchase_quantity: nonNegativeIntSchema.optional(),
  used: nonNegativeIntSchema.optional(),
  leftover_inventory: nonNegativeIntSchema.optional(),
  consumption_cost_cop: copSchema.optional(),
  purchase_cost_cop: copSchema.optional(),
  available: z.boolean(),
  title: z.string().optional(),
  package_price_cop: copSchema.optional(),
  units_per_package: positiveIntSchema.optional(),
  packages: positiveIntSchema.optional(),
  subtotal_cop: copSchema.optional(),
  surplus: nonNegativeIntSchema.optional(),
  without_reference: z.boolean().optional(),
}).strict();

export const QuoteV1Schema = z.object({
  schema_version: z.literal(QUOTE_CONTRACT_VERSION),
  currency: z.literal("COP"),
  lines: z.array(quoteLineSchema),
  total_cop: copSchema,
  waste_percentage: z.number().min(0).max(100),
  includes_vat: z.boolean(),
  supported_complements: z.literal(false),
  purchase_cost_cop: copSchema.optional(),
  consumption_cost_cop: copSchema.optional(),
  target_waste_reserve: nonNegativeIntSchema.optional(),
  covered_waste_reserve: nonNegativeIntSchema.optional(),
  leftover_inventory: nonNegativeIntSchema.optional(),
  plan_hash: z.string().min(1).optional(),
}).strict();

export const DomainContractSchemas = {
  "catalog-product.v1": CatalogProductSchema,
  "catalog-variant.v1": CatalogVariantSchema,
  "catalog-selection-request.v1": CatalogSelectionRequestV1Schema,
  "catalog-selection-result.v1": CatalogSelectionResultV1Schema,
  "plan-decoracion.v1": PlanDecoracionSchema,
  "plan-resuelto.v1": PlanResueltoV1Schema,
  "design-material-estimate.v1": MaterialEstimateSchema,
  "quote.v1": QuoteV1Schema,
  "reference-blueprint.v2": ReferenceBlueprintV2Schema,
  "scene-spec.v1": SceneSpecSchema,
  "lora-selection.v1": LoraSelectionSchema,
  "product-vocabulary.v1": productVocabularySchema,
  "prop-catalogo.v1": PropCatalogoSchema,
  "happie-recommendation-request.v1": HappieRecommendationRequestV1Schema,
  "happie-recommendation-response.v1": HappieRecommendationResponseV1Schema,
  "happie-package-response.v1": HappiePackageRecommendationResponseV1Schema,
  "happie-description-request.v1": HappieDescriptionRequestV1Schema,
  "happie-structured-recommendation-request.v1": HappieStructuredRecommendationRequestV1Schema,
  "happie-conversation-request.v1": HappieConversationRequestV1Schema,
  "happie-conversation-response.v1": HappieConversationResponseV1Schema,
  "happie-error.v1": HappieErrorV1Schema,
  "operational-context.v1": OperationalContextV1Schema,
  "internal-request-signature.v1": InternalRequestSignatureV1Schema,
  "backend-selection.v1": BackendSelectionV1Schema,
} as const;

export type CatalogSelectionRequestV1 = z.infer<typeof CatalogSelectionRequestV1Schema>;
export type CatalogSelectionResultV1 = z.infer<typeof CatalogSelectionResultV1Schema>;
export type PlanResueltoV1 = z.infer<typeof PlanResueltoV1Schema>;
export type QuoteV1 = z.infer<typeof QuoteV1Schema>;
