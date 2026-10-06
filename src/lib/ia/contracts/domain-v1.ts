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
import { ReferenceBlueprintV2Schema } from "@/lib/ia/referencia/reference-blueprint";
import { SceneSpecSchema } from "@/lib/ia/escena/scene-spec";
import { MaterialEstimateSchema } from "@/lib/materiales/estimacion";
import {
  DENSIDADES,
  MEZCLAS,
  PlanDecoracion1_1Schema,
  PlanDecoracionSchema,
  PropCatalogoSchema,
} from "@/lib/plan/tipos";
import { TIPOS_ESTRUCTURA_GEOMETRICOS } from "@/lib/plan/composicion";
import { ESTRUCTURAS_OFICIALES_IDS, incoherenciasEstructuraOficial } from "@/lib/plan/estructuras-oficiales";
import { ArcoResueltoSchema, ArmadoArcoV1Schema } from "@/lib/plan/armado-arco";
import { ArmadoBouquetResueltoSchema, PistaArmadoSchema } from "@/lib/plan/armado-bouquet";
import { ArmadoColumnaV1Schema, ColumnaResueltaSchema } from "@/lib/plan/armado-columna";
import { ColumnaOrganicaResueltaSchema } from "@/lib/plan/armado-columna-organica";
import { ArcoOrganicoResueltoSchema } from "@/lib/plan/armado-arco-organico";
import { ArmadoGuirnaldaOrganicaV1Schema, GuirnaldaOrganicaResueltaSchema } from "@/lib/plan/armado-guirnalda-organica";
import { ArmadoGuirnaldaResueltoSchema, ArmadoGuirnaldaV1Schema, PistaGuirnaldaSchema } from "@/lib/plan/armado-guirnalda";
import { ConteoAplicadoSchema, MAX_GLOBOS_CONTEO, PistaConteoSchema } from "@/lib/plan/conteo-referencia";
import { PatronColorResueltoSchema, PistaPatronSchema, PistaTamanosSchema } from "@/lib/plan/patron-color";
import { PlanGuiaEscenaRequestV1Schema, PlanGuiaEscenaResultV1Schema } from "@/lib/plan/guia-escena";
import { CatalogProductSchema, CatalogVariantSchema } from "@/lib/rag/catalog/schemas";
import { LoraSelectionSchema } from "@/lib/lora/schema";
import { productVocabularySchema } from "@/lib/lora/product-vocabulary";

export const CATALOG_SELECTION_CONTRACT_VERSION = "catalog-selection.v1" as const;
export const CATALOG_SEARCH_CONTRACT_VERSION = "catalog-search.v1" as const;
export const CATALOG_SEARCH_RESULT_CONTRACT_VERSION = "catalog-search-result.v1" as const;
export const CATALOG_COLORS_CONTRACT_VERSION = "catalog-colors.v1" as const;
export const CATALOG_COLORS_RESULT_CONTRACT_VERSION = "catalog-colors-result.v1" as const;
export const PLAN_RESUELTO_CONTRACT_VERSION = "plan-resuelto.v1" as const;
export const QUOTE_CONTRACT_VERSION = "quote.v1" as const;
export const PLAN_RESOLUTION_CONTRACT_VERSION = "plan-resolution.v1" as const;
export const PLAN_RESOLUTION_RESULT_CONTRACT_VERSION = "plan-resolution-result.v1" as const;
export const CATALOG_RECOMMENDATIONS_CONTRACT_VERSION = "catalog-recommendations.v1" as const;
export const CATALOG_RECOMMENDATIONS_RESULT_CONTRACT_VERSION = "catalog-recommendations-result.v1" as const;
export const CATALOG_RECOMMENDATIONS_MAX_LIMIT = 100;

const idSchema = z.string().trim().min(1).max(160);
/** COP is transported as whole pesos; rounding happens before this boundary. */
const copSchema = z.number().int().nonnegative();
const positiveIntSchema = z.number().int().positive();
const safePositiveIntSchema = positiveIntSchema.max(Number.MAX_SAFE_INTEGER);
const nonNegativeIntSchema = z.number().int().nonnegative();

export const CatalogSelectionRequestItemV1Schema = z.object({
  product_id: idSchema,
  variant_id: idSchema,
  quantity: safePositiveIntSchema,
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
  operation_schema_version: z.literal("catalog-selection-result.v1"),
  status: z.enum(["ok", "partial", "empty"]),
  catalog_snapshot_id: idSchema.nullable(),
  validados: z.array(CatalogValidatedItemV1Schema),
  rechazados: z.array(CatalogRejectedItemV1Schema),
  total_cop: copSchema,
}).strict();

const CatalogSearchFiltersV1Schema = z.object({
  available: z.boolean().optional(),
  price_max: z.number().nonnegative().optional(),
  categories: z.array(z.string().trim().min(1).max(120)).max(32).optional(),
  occasions: z.array(z.string().trim().min(1).max(120)).max(32).optional(),
  colors: z.array(z.string().trim().min(1).max(80)).max(16).optional(),
  finishes: z.array(z.string().trim().min(1).max(80)).max(16).optional(),
  shapes: z.array(z.string().trim().min(1).max(80)).max(16).optional(),
  diameters_inches: z.array(z.number().nonnegative()).max(16).optional(),
}).strict();

const CatalogSearchAllowlistV1Schema = z.object({
  product_id: idSchema,
  variant_ids: z.array(idSchema).max(256),
}).strict();

export const CatalogSearchRequestV1Schema = z.object({
  schema_version: z.literal(CATALOG_SEARCH_CONTRACT_VERSION),
  message: z.string().trim().min(1).max(2000),
  filters: CatalogSearchFiltersV1Schema,
  allowlist: z.array(CatalogSearchAllowlistV1Schema).max(256),
  limit: z.number().int().min(1).max(50),
  catalog_snapshot_id: idSchema.nullable().optional(),
  /**
   * Browsing: recall comes from `filters` alone and `message` is only a label
   * (the editor's catalog explorer without text). Absent means a text search.
   */
  browse: z.boolean().optional(),
}).strict();

const CatalogSearchVariantV1Schema = z.object({
  variant_id: idSchema,
  sku: z.string().nullable(),
  title: z.string().nullable(),
  price: z.number().nonnegative(),
  available: z.boolean(),
  size_code: z.string().nullable(),
  diameter_inches: z.number().nonnegative().nullable(),
  shape: z.string().nullable(),
  colors: z.array(z.string()),
}).strict();

const CatalogSearchCandidateV1Schema = z.object({
  product_id: idSchema,
  title: z.string().min(1),
  category: z.string().nullable(),
  colors: z.array(z.string()),
  finishes: z.array(z.string()),
  occasions: z.array(z.string()),
  available: z.boolean(),
  image: z.string().nullable(),
  score: z.number(),
  variants: z.array(CatalogSearchVariantV1Schema),
}).strict();

/**
 * A requested `filters.colors` entry the active snapshot does not stock,
 * resolved by Python (`catalog.py`, `x-tonos-colores-catalogo`) to the
 * nearest color it actually has. Optional: older responses and every hand-built
 * test payload predate this field and still validate without it.
 */
const CatalogSearchColorSubstitutionV1Schema = z.object({
  pedido: z.string().min(1),
  entregado: z.string().min(1),
}).strict();

export const CatalogSearchResultV1Schema = z.object({
  operation_schema_version: z.literal(CATALOG_SEARCH_RESULT_CONTRACT_VERSION),
  status: z.enum(["OK", "NO_MATCH", "AMBIGUOUS_SKU"]),
  sku_status: z.enum(["not_sku", "unique", "ambiguous", "not_found", "filtered_out"]).nullable(),
  candidates: z.array(CatalogSearchCandidateV1Schema).max(50),
  whitelist: z.array(CatalogSearchAllowlistV1Schema),
  catalog_snapshot_id: idSchema.nullable(),
  latency_parse_ms: z.number().int().nonnegative(),
  latency_retrieval_ms: z.number().int().nonnegative(),
  color_substitutions: z.array(CatalogSearchColorSubstitutionV1Schema).optional(),
}).strict();

/**
 * Colors the editor's explorer can offer, with how many available products
 * carry each (read-only). Same snapshot pin and allowlist semantics as
 * `catalog-search.v1`: an empty allowlist is unrestricted.
 */
export const CatalogColorsRequestV1Schema = z.object({
  schema_version: z.literal(CATALOG_COLORS_CONTRACT_VERSION),
  allowlist: z.array(CatalogSearchAllowlistV1Schema).max(256),
  catalog_snapshot_id: idSchema.nullable().optional(),
}).strict();

export const CatalogColorsResultV1Schema = z.object({
  operation_schema_version: z.literal(CATALOG_COLORS_RESULT_CONTRACT_VERSION),
  /** `null` when the requested snapshot is not published (and `colors` is empty). */
  catalog_snapshot_id: idSchema.nullable(),
  /** Most stocked first; `value` is the lowercase catalog color, `total` the distinct available products. */
  colors: z.array(z.object({
    value: z.string().min(1),
    total: z.number().int().min(1),
  }).strict()).max(256),
}).strict();

/** Recommendations for one reference variant inside a pinned snapshot. */
export const CatalogRecommendationsRequestV1Schema = z.object({
  schema_version: z.literal(CATALOG_RECOMMENDATIONS_CONTRACT_VERSION),
  catalog_snapshot_id: idSchema,
  reference_variant_id: idSchema,
  limit: z.number().int().min(1).max(CATALOG_RECOMMENDATIONS_MAX_LIMIT),
}).strict();

const CatalogRecommendationVariantV1Schema = z.object({
  variant_id: idSchema,
  sku: z.string().nullable(),
  title: z.string().nullable(),
  price: copSchema.positive(),
  available: z.literal(true),
  size_code: z.string().nullable(),
  diameter_inches: z.number().nonnegative().nullable(),
  shape: z.string().nullable(),
  colors: z.array(z.string()),
}).strict();

const CatalogRecommendationCandidateV1Schema = z.object({
  product_id: idSchema,
  title: z.string().min(1),
  category: z.string().nullable(),
  colors: z.array(z.string()),
  finishes: z.array(z.string()),
  occasions: z.array(z.string()),
  available: z.literal(true),
  image: z.string().nullable(),
  variants: z.array(CatalogRecommendationVariantV1Schema).min(1).max(CATALOG_RECOMMENDATIONS_MAX_LIMIT),
}).strict();

export const CatalogRecommendationsResultV1Schema = z.object({
  operation_schema_version: z.literal(CATALOG_RECOMMENDATIONS_RESULT_CONTRACT_VERSION),
  catalog_snapshot_id: idSchema,
  reference: z.object({
    product_id: idSchema,
    variant_id: idSchema,
    size_code: z.string().nullable(),
    diameter_inches: z.number().nonnegative().nullable(),
    shape: z.string().nullable(),
    category: z.string().nullable(),
    colors: z.array(z.string()),
  }).strict(),
  candidates: z.array(CatalogRecommendationCandidateV1Schema).max(CATALOG_RECOMMENDATIONS_MAX_LIMIT),
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
    // Percentages are transported as 0..100; the plan resolver and the
    // physical-prompt consumer both use this unit.
    pct: z.number().min(0).max(100),
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
  /**
   * Consumo imputado a cada estructura, para que la tarjeta muestre el peso
   * relativo de cada pieza. NO es un precio: los paquetes se compran una sola
   * vez para todo el plan, así que la suma de estos valores no es el total, que
   * es `totales.total_cop`. `consumo_cop` va nulo cuando alguna línea de la
   * estructura no tiene compra con paquete utilizable, para no enseñar una
   * cifra incompleta.
   *
   * Va FUERA del snapshot que firma `plan_hash` a propósito: es información
   * derivada para la UI, y meterla dentro cambiaría el hash de cada plan ya
   * aprobado. Lo calculaba la propia tarjeta en TypeScript hasta ADR-0023.
   */
  costes_por_estructura: z.array(z.object({
    estructura_id: idSchema,
    consumo_cop: copSchema.nullable(),
  }).strict()),
  /**
   * Patrón de color expandido por estructura (ADR-0028): rejilla, conteo, paso
   * a paso y textos, escritos por Python. Fuera del snapshot que firma
   * `plan_hash`, como `costes_por_estructura`; se omite cuando no hay ninguno.
   */
  patrones_color: z.array(PatronColorResueltoSchema).optional(),
  /**
   * Armado de cada bouquet (ADR-0030): leyenda por globo comprado, niveles,
   * insumos no cotizados y pasos, escritos por Python. Fuera del snapshot que
   * firma `plan_hash`; se omite cuando no hay ninguno.
   */
  armados_bouquet: z.array(ArmadoBouquetResueltoSchema).optional(),
  /**
   * Armado de cada guirnalda (ADR-0032): leyenda por globo comprado, racimos
   * de izquierda a derecha, relleno, remates, insumos no cotizados y pasos,
   * escritos por Python. Fuera del snapshot que firma `plan_hash`; se omite
   * cuando no hay ninguno.
   */
  armados_guirnalda: z.array(ArmadoGuirnaldaResueltoSchema).optional(),
  /**
   * Cada arco y cada columna resueltos por el motor migrado del diseñador
   * (ADR-0034): cada globo colocado, el conteo, lo que se compra y los avisos,
   * escritos por Python. Fuera del snapshot que firma `plan_hash`, como los
   * demás resueltos; se omiten cuando el plan no lleva ninguno.
   *
   * El **dibujo no viaja aquí**: son decenas de kilobytes por pieza y se pide
   * cuando hace falta a `/api/plan-armado-arco`, que devuelve el mismo SVG que
   * emite el motor. Meterlo en cada resolución engordaría todas las respuestas
   * para una imagen que la mayoría de las llamadas no mira.
   */
  armados_arco: z.array(ArcoResueltoSchema).optional(),
  armados_columna: z.array(ColumnaResueltaSchema).optional(),
  armados_arco_organico: z.array(ArcoOrganicoResueltoSchema).optional(),
  armados_columna_organica: z.array(ColumnaOrganicaResueltaSchema).optional(),
  armados_guirnalda_organica: z.array(GuirnaldaOrganicaResueltaSchema).optional(),
  /**
   * Qué hizo Python con el conteo de la foto de cada estructura y por qué
   * (ADR-0031). Fuera del snapshot que firma `plan_hash`; se omite sin conteos.
   */
  conteos_referencia: z.array(ConteoAplicadoSchema).max(32).optional(),
  /**
   * Las lecturas de la foto de las guirnaldas del plan (`pistas_guirnalda` de
   * la petición, ADR-0032), devueltas para que la re-resolución de una
   * edición las vuelva a mandar: sin ellas, un armado que la edición quita se
   * re-sugería con la receta y perdía el soporte y la forma de la foto
   * (hallazgo 32). Fuera del snapshot que firma `plan_hash`; se omite sin
   * lecturas.
   */
  lecturas_guirnalda: z.array(PistaGuirnaldaSchema).max(16).optional(),
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

export const PlanResolutionRequestV1Schema = z.object({
  schema_version: z.literal(PLAN_RESOLUTION_CONTRACT_VERSION),
  // Plan 1.1 remains deferred until its active consumers and rollback path
  // are ready; this endpoint currently resolves the active Plan 1.0 contract.
  plan: PlanDecoracionSchema,
  allowlist: z.array(CatalogAllowlistEntryV1Schema).max(256),
  catalog_snapshot_id: idSchema,
  /** Solo al confirmar un plan: Python asigna patrón de color a las estructuras que no lo tienen (ADR-0028 §7). */
  completar_patrones: z.boolean().optional(),
  pistas_patron: z.array(PistaPatronSchema).max(16).optional(),
  /** Los tamaños leídos en la foto, aparte de la pista de patrón: un tamaño no es una disposición de color. */
  pistas_tamanos: z.array(PistaTamanosSchema).max(16).optional(),
  /** Solo al confirmar un plan: Python arma por niveles los bouquets que no tienen armado (ADR-0030). */
  completar_armados: z.boolean().optional(),
  pistas_armado: z.array(PistaArmadoSchema).max(16).optional(),
  /** Con `completar_armados`: solo estas estructuras (tras una edición, la pieza editada). */
  completar_armados_de: z.array(idSchema).max(8).optional(),
  /**
   * Solo al confirmar un plan: Python arma por partes las guirnaldas que no
   * tienen armado (ADR-0032), sin cambiar lo que se compra. Independiente de
   * `completar_armados`; `completar_armados_de` limita las dos.
   */
  completar_armados_guirnalda: z.boolean().optional(),
  /** Con `completar_armados_guirnalda`: la lectura de cada guirnalda de la foto, por elemento (E4). */
  pistas_guirnalda: z.array(PistaGuirnaldaSchema).max(16).optional(),
  /** Al confirmar un plan: Python ajusta cantidad, medidas, densidad o mezcla al conteo de la foto (ADR-0031). */
  completar_conteos: z.boolean().optional(),
  pistas_conteo: z.array(PistaConteoSchema).max(16).optional(),
  /**
   * Tras una edición: solo estas estructuras se ajustan (la de la mezcla
   * editada, o ninguna); las demás con pista conservan su lectura sin cambios.
   */
  completar_conteos_de: z.array(idSchema).max(8).optional(),
  /**
   * Con `completar_conteos`: el cliente dio medidas en su pedido
   * (`clienteDioMedidasEspacio`). Las medidas que el plan declara para una
   * estructura son entonces las suyas y el conteo no las mueve, aunque el
   * espacio no tenga medidas (ADR-0031, revisión 33).
   */
  medidas_del_cliente: z.boolean().optional(),
}).strict();

export const PlanResolutionResultV1Schema = z.object({
  operation_schema_version: z.literal(PLAN_RESOLUTION_RESULT_CONTRACT_VERSION),
  catalog_snapshot_id: idSchema,
  plan_resuelto: PlanResueltoV1Schema,
  material_estimate: MaterialEstimateSchema,
  quote: QuoteV1Schema,
}).strict();

// --- Estimar el conteo de globos (`estimar-conteo.v1`) -----------------------------------------
//
// Una consulta de SOLO LECTURA: la IA pregunta cuántos globos cobraría el plan para unos candidatos
// (medidas, densidad, mezcla y, si la pieza lo trae, el armado del motor) y qué variación de mandos los
// acerca a un conteo objetivo (el de la foto). Python es el único dueño de cada cifra: este contrato es la
// forma de la pregunta y de la respuesta, y no escribe nada en el plan, el token ni `plan_hash`.

export const ESTIMAR_CONTEO_CONTRACT_VERSION = "estimar-conteo.v1" as const;
export const ESTIMAR_CONTEO_RESULT_CONTRACT_VERSION = "estimar-conteo-result.v1" as const;
/** Candidatos que una estimación compara a la vez. */
export const ESTIMAR_CONTEO_MAX_CANDIDATOS = 6;
/** Un tamaño obligatorio del cliente en pulgadas (`restricciones.tamanos`), como lo lee `mezclas.ts`. */
const ESTIMAR_CONTEO_MAX_TAMANOS = 6;

/**
 * Los mandos que una sugerencia puede mover. Los de la fórmula son la densidad y las medidas del plan; los
 * del motor son los de `armar_estructura` (`geometria`): el tamaño del globo y cuántos van a lo ancho en un
 * arco, los de la capa y los tamaños de la columna. `via` dice cuál de los dos juegos es.
 */
export const CAMPOS_CAMBIO_ESTIMACION = [
  "densidad",
  "ancho_m",
  "alto_m",
  "largo_m",
  "tamano_globo",
  "globos_ancho",
  "globos_capa",
  "abajo",
  "arriba",
] as const;
/**
 * `cortada_por_tope`: la búsqueda se cortó por el tiempo o las evaluaciones que una petición puede gastar y no halló
 * nada; no es un error ni un «sin ajuste posible», porque no se sabe si existía una variación.
 */
export const ESTADOS_SUGERENCIA_CONTEO = ["no_necesaria", "propuesta", "sin_ajuste_posible", "no_evaluada", "cortada_por_tope"] as const;
export const FUENTES_CONTEO_ESTIMADO = ["formula", "motor"] as const;

const estimarConteoMedidasSchema = z.object({
  ancho_m: z.number().positive().max(100).optional(),
  alto_m: z.number().positive().max(100).optional(),
  largo_m: z.number().positive().max(100).optional(),
}).strict();

const estimarConteoTextoSchema = z.string().trim().min(1).max(400);

/**
 * Una pieza a contar, con los campos de una estructura del plan que mueven su conteo y nada más: no
 * lleva materiales (el motor no mira tonos), precios ni catálogo. `colores` es cuántos materiales
 * tendría; solo importa si trae armado, porque el armado nombra materiales por índice.
 */
export const EstimarConteoCandidatoV1Schema = z.object({
  /** Cómo lo nombra quien consulta; es lo que vuelve en la respuesta, sin repetirse. */
  etiqueta: z.string().trim().min(1).max(80),
  tipo: z.enum(TIPOS_ESTRUCTURA_GEOMETRICOS),
  estructura_oficial: z.enum(ESTRUCTURAS_OFICIALES_IDS).optional(),
  medidas: estimarConteoMedidasSchema,
  densidad: z.enum(DENSIDADES),
  mezcla: z.enum(MEZCLAS),
  colores: z.number().int().min(1).max(12).optional(),
  repeticiones: z.number().int().min(1).max(24).optional(),
  /** Armado por partes (ADR-0032): decide el eje real de la guirnalda en la fórmula. */
  armado_guirnalda: ArmadoGuirnaldaV1Schema.optional(),
  /** Armado del motor (ADR-0034): con uno, cuenta el motor y no la fórmula. Solo el de su `tipo`. */
  armado_arco: ArmadoArcoV1Schema.optional(),
  armado_columna: ArmadoColumnaV1Schema.optional(),
  armado_guirnalda_organica: ArmadoGuirnaldaOrganicaV1Schema.optional(),
}).strict().superRefine((value, ctx) => {
  // La coherencia de `estructura_oficial` con tipo y densidad: la misma tabla que el JSON Schema exportado
  // (`reglasJsonSchemaEstructuraOficial`), para que Zod y el esquema que valida Python no discrepen.
  for (const problema of incoherenciasEstructuraOficial(value)) {
    ctx.addIssue({ code: "custom", path: [problema.campo], message: problema.mensaje });
  }
});

export const EstimarConteoObjetivoV1Schema = z.object({
  /** Globos por pieza que se quiere alcanzar (por ejemplo, el conteo leído en la foto). */
  conteo: z.number().int().min(1).max(MAX_GLOBOS_CONTEO),
  /** Se devuelve tal cual en la respuesta: en las piezas geométricas no cambia la tolerancia ni la búsqueda. */
  exacto: z.boolean().optional(),
}).strict();

export const EstimarConteoRequestV1Schema = z.object({
  schema_version: z.literal(ESTIMAR_CONTEO_CONTRACT_VERSION),
  candidatos: z.array(EstimarConteoCandidatoV1Schema).min(1).max(ESTIMAR_CONTEO_MAX_CANDIDATOS),
  objetivo: EstimarConteoObjetivoV1Schema.optional(),
  /** Tamaños que el cliente hizo obligatorios (`restricciones.tamanos`): la mezcla efectiva los respeta. */
  tamanos_obligatorios: z.array(z.number().int().min(1).max(100)).max(ESTIMAR_CONTEO_MAX_TAMANOS).optional(),
  /** Las medidas son del cliente: la sugerencia no las mueve, igual que el conteo de la foto al confirmar. */
  medidas_del_cliente: z.boolean().optional(),
}).strict();

const valorDeMandoSchema = z.union([z.string().min(1).max(40), z.number()]);

const estimarConteoCambioSchema = z.object({
  campo: z.enum(CAMPOS_CAMBIO_ESTIMACION),
  antes: valorDeMandoSchema,
  despues: valorDeMandoSchema,
}).strict();

/** Qué tan lejos queda el total vigente del objetivo, con la tolerancia de `conteo_foto.py`. */
const estimarConteoBrechaSchema = z.object({
  objetivo: z.number().int().min(1),
  /** Total vigente menos el objetivo: negativo es quedarse corto. */
  diferencia: z.number().int(),
  absoluta: z.number().int().nonnegative(),
  /** `absoluta` entre el objetivo. */
  relativa: z.number().nonnegative(),
  /** La tolerancia, en globos, que `conteo_foto.tolerancia` da a ese objetivo. */
  tolerancia: z.number().nonnegative(),
  dentro_de_tolerancia: z.boolean(),
}).strict();

/**
 * La menor variación de mandos que acerca el total al objetivo. Honesta: si no hay ninguna, o si esa
 * pieza no se puede barrer, lo dice en `estado` y `motivo` en vez de proponer algo.
 */
const estimarConteoSugerenciaSchema = z.object({
  estado: z.enum(ESTADOS_SUGERENCIA_CONTEO),
  /** Qué juego de mandos se exploró o se movió: los de la fórmula o los del armado del motor. `null` si no hizo falta. */
  via: z.enum(FUENTES_CONTEO_ESTIMADO).nullable(),
  cambios: z.array(estimarConteoCambioSchema).max(CAMPOS_CAMBIO_ESTIMACION.length),
  /** El total vigente con los cambios puestos; `null` sin propuesta. */
  total_resultante: z.number().int().nonnegative().nullable(),
  brecha: estimarConteoBrechaSchema.nullable(),
  motivo: estimarConteoTextoSchema,
}).strict();

const estimarConteoRepartoSchema = z.object({
  pulgadas: z.number().int().positive(),
  cantidad: z.number().int().nonnegative(),
  proporcion: z.number().nonnegative(),
}).strict();

export const EstimarConteoCandidatoResultadoV1Schema = z.object({
  etiqueta: z.string().trim().min(1).max(80),
  tipo: z.enum(TIPOS_ESTRUCTURA_GEOMETRICOS),
  repeticiones: z.number().int().min(1).max(24),
  /** Lo que daría la fórmula, haya o no armado del motor. */
  total_formula: z.number().int().nonnegative(),
  /** Lo que cuenta el motor; `null` sin armado del motor. */
  total_motor: z.number().int().nonnegative().nullable(),
  /** El que de verdad se cobraría por pieza: el del motor si hay armado, si no el de la fórmula. */
  total_vigente: z.number().int().nonnegative(),
  fuente: z.enum(FUENTES_CONTEO_ESTIMADO),
  /** `total_vigente` por las repeticiones. */
  total_instalado: z.number().int().nonnegative(),
  eje_m: z.number().nonnegative(),
  /** Globos por metro de eje por pieza, lo que mira la puerta física; `null` sin eje. */
  globos_por_metro: z.number().nonnegative().nullable(),
  /** La fórmula clásica `4,8 · L / d` que publica el motor del arco: un ancla independiente de la fórmula del plan. `null` fuera del arco con armado. */
  formula_clasica: z.number().nonnegative().nullable(),
  reparto_por_tamano: z.array(estimarConteoRepartoSchema).max(12),
  puerta_fisica: z.object({
    dentro: z.boolean(),
    avisos: z.array(estimarConteoTextoSchema).max(12),
  }).strict(),
  avisos: z.array(estimarConteoTextoSchema).max(24),
  /** Lo que el que consulta no debe pasar por alto de esta pieza (el motor ignora medidas, densidad y mezcla). */
  nota: z.string().trim().min(1).max(900).nullable(),
  brecha: estimarConteoBrechaSchema.nullable(),
  /** `null` sin objetivo. */
  sugerencia: estimarConteoSugerenciaSchema.nullable(),
}).strict();

export const EstimarConteoResultV1Schema = z.object({
  operation_schema_version: z.literal(ESTIMAR_CONTEO_RESULT_CONTRACT_VERSION),
  objetivo: z.object({
    conteo: z.number().int().min(1),
    exacto: z.boolean(),
    tolerancia: z.number().nonnegative(),
  }).strict().nullable(),
  candidatos: z.array(EstimarConteoCandidatoResultadoV1Schema).min(1).max(ESTIMAR_CONTEO_MAX_CANDIDATOS),
  /** Etiqueta del candidato dentro de tolerancia y de la puerta física más cerca del objetivo; `null` si ninguno. */
  mejor: z.string().trim().min(1).max(80).nullable(),
}).strict();

export const DomainContractSchemas = {
  "catalog-product.v1": CatalogProductSchema,
  "catalog-variant.v1": CatalogVariantSchema,
  "catalog-selection-request.v1": CatalogSelectionRequestV1Schema,
  "catalog-selection-result.v1": CatalogSelectionResultV1Schema,
  "catalog-search.v1": CatalogSearchRequestV1Schema,
  "catalog-search-result.v1": CatalogSearchResultV1Schema,
  "catalog-colors.v1": CatalogColorsRequestV1Schema,
  "catalog-colors-result.v1": CatalogColorsResultV1Schema,
  "catalog-recommendations.v1": CatalogRecommendationsRequestV1Schema,
  "catalog-recommendations-result.v1": CatalogRecommendationsResultV1Schema,
  "plan-decoracion.v1": PlanDecoracionSchema,
  "plan-resuelto.v1": PlanResueltoV1Schema,
  "design-material-estimate.v1": MaterialEstimateSchema,
  "quote.v1": QuoteV1Schema,
  "plan-resolution.v1": PlanResolutionRequestV1Schema,
  "plan-resolution-result.v1": PlanResolutionResultV1Schema,
  "estimar-conteo.v1": EstimarConteoRequestV1Schema,
  "estimar-conteo-result.v1": EstimarConteoResultV1Schema,
  "plan-guia-escena.v1": PlanGuiaEscenaRequestV1Schema,
  "plan-guia-escena-result.v1": PlanGuiaEscenaResultV1Schema,
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
export type CatalogSearchRequestV1 = z.infer<typeof CatalogSearchRequestV1Schema>;
export type CatalogSearchResultV1 = z.infer<typeof CatalogSearchResultV1Schema>;
export type CatalogColorsRequestV1 = z.infer<typeof CatalogColorsRequestV1Schema>;
export type CatalogColorsResultV1 = z.infer<typeof CatalogColorsResultV1Schema>;
export type CatalogRecommendationsRequestV1 = z.infer<typeof CatalogRecommendationsRequestV1Schema>;
export type CatalogRecommendationsResultV1 = z.infer<typeof CatalogRecommendationsResultV1Schema>;
export type PlanResueltoV1 = z.infer<typeof PlanResueltoV1Schema>;
export type QuoteV1 = z.infer<typeof QuoteV1Schema>;
export type PlanResolutionRequestV1 = z.infer<typeof PlanResolutionRequestV1Schema>;
export type PlanResolutionResultV1 = z.infer<typeof PlanResolutionResultV1Schema>;
export type EstimarConteoRequestV1 = z.infer<typeof EstimarConteoRequestV1Schema>;
export type EstimarConteoResultV1 = z.infer<typeof EstimarConteoResultV1Schema>;
