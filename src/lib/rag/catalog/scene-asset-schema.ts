import { z } from "zod";
import type { NonCommercialReferenceClass as LegacyNonCommercialReferenceClass } from "@/lib/generacion/provenance";
import { SceneCategoryV3Schema, SceneFunctionV3Schema } from "../taxonomy/v3";

/**
 * Contratos Zod de "identidad física + verdad comercial" para activos de
 * escena (PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md §6 y §7.3, Tarea 02.2).
 *
 * Principio central del plan: la identidad física de un objeto
 * (`CatalogItemV3`) NUNCA se acopla a su proveedor o precio
 * (`CommercialOfferV1`). Un mismo item puede tener varias ofertas, y una
 * oferta puede caducar sin alterar la identidad visual. `SupplyBinding` es lo
 * que conecta un slot de escena con una fuente concreta y verificable (o con
 * una razón explícita por la que NO es cotizable).
 *
 * Nada aquí inventa precios, proveedores ni disponibilidad: eso sale de datos
 * reales (Postgres/Shopify, adaptadores de proveedor). Este módulo solo
 * valida la FORMA de esos datos.
 */

// ---------------------------------------------------------------------------
// 6.1 — Clases de fuente permitidas
// ---------------------------------------------------------------------------

export const SupplySourceClassSchema = z.enum([
  "catalog_sale",
  "catalog_rental",
  "venue_existing",
  "context_non_quotable",
]);
export type SupplySourceClass = z.infer<typeof SupplySourceClassSchema>;

/**
 * `NonCommercialReferenceClass` — MISMO vocabulario que
 * `src/lib/generacion/provenance.ts` (Tarea 00.3, Ola 0). Ese módulo ya es la
 * fuente de verdad real para clasificar productos sin oferta comercial
 * verificada (seed SQLite / `manualProducts`); este esquema Zod solo valida
 * la forma del mismo par de strings dentro de los contratos V3.
 *
 * Se IMPORTA el tipo TS de `provenance.ts` (en vez de redefinirlo a mano) y
 * se declara el enum Zod con los mismos literales. La comprobación de tipo
 * `_assertNonCommercialReferenceClassAligned` de abajo rompe la compilación
 * si algún día los dos vocabularios divergen.
 */
export const NonCommercialReferenceClassSchema = z.enum(["editorial_reference", "test_only"]);
export type NonCommercialReferenceClass = z.infer<typeof NonCommercialReferenceClassSchema>;

type AssertExactUnion<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// Si esto da un error de tipo, `NonCommercialReferenceClass` de este archivo
// y el de `provenance.ts` dejaron de coincidir exactamente — hay que
// realinearlos antes de seguir.
const _assertNonCommercialReferenceClassAligned: AssertExactUnion<
  NonCommercialReferenceClass,
  LegacyNonCommercialReferenceClass
> = true;
void _assertNonCommercialReferenceClassAligned;

// ---------------------------------------------------------------------------
// 6.2 — Estados comerciales de una oferta
// ---------------------------------------------------------------------------

export const CommercialOfferStatusSchema = z.enum(["PRICED", "QUOTE_REQUIRED", "UNAVAILABLE"]);
export type CommercialOfferStatus = z.infer<typeof CommercialOfferStatusSchema>;

// ---------------------------------------------------------------------------
// 7.3 — CatalogItemV3
// ---------------------------------------------------------------------------

export const MediaRefRoleSchema = z.enum(["identity", "detail"]);
export type MediaRefRole = z.infer<typeof MediaRefRoleSchema>;

export const MediaRefSchema = z
  .object({
    id: z.string().min(1),
    role: MediaRefRoleSchema,
    /** Hash de la URL fuente, no la URL en crudo — evita romper si el CDN rota. */
    source_url_hash: z.string().min(1),
  })
  .strict();
export type MediaRef = z.infer<typeof MediaRefSchema>;

/**
 * Candidata de función de escena para un item, con confianza y evidencia
 * textual — nunca una afirmación categórica. `confidence` en [0, 1];
 * `evidence` debe ser un fragmento de texto real (título/tag/tipo de
 * producto), no una justificación generada libremente por un LLM.
 */
export const SceneFunctionCandidateSchema = z
  .object({
    function: SceneFunctionV3Schema,
    confidence: z.number().min(0).max(1),
    evidence: z.string().min(1),
  })
  .strict();
export type SceneFunctionCandidate = z.infer<typeof SceneFunctionCandidateSchema>;

/**
 * Dimensiones físicas mínimas para chequear compatibilidad de montaje/escala
 * (plan §7.3, `dimensions?: PhysicalDimensions`). Todos los campos son
 * opcionales y en centímetros/kilogramos: la mayoría de productos del
 * catálogo actual no trae medidas estructuradas, así que esto debe poder
 * quedar vacío sin bloquear el resto del item.
 */
export const PhysicalDimensionsSchema = z
  .object({
    width_cm: z.number().positive().optional(),
    height_cm: z.number().positive().optional(),
    depth_cm: z.number().positive().optional(),
    diameter_cm: z.number().positive().optional(),
    weight_kg: z.number().positive().optional(),
  })
  .strict();
export type PhysicalDimensions = z.infer<typeof PhysicalDimensionsSchema>;

export const CompatibilitySchema = z
  .object({
    indoor_outdoor: z.array(z.enum(["indoor", "outdoor"])).optional(),
    requires_support: z.array(z.string().min(1)).optional(),
    supports: z.array(z.string().min(1)).optional(),
    mounting: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type Compatibility = z.infer<typeof CompatibilitySchema>;

export const CatalogItemV3Schema = z
  .object({
    item_id: z.string().min(1),
    category_v3: SceneCategoryV3Schema,
    media_refs: z.array(MediaRefSchema),
    scene_functions: z.array(SceneFunctionCandidateSchema),
    dimensions: PhysicalDimensionsSchema.optional(),
    compatibility: CompatibilitySchema,
  })
  .strict();
export type CatalogItemV3 = z.infer<typeof CatalogItemV3Schema>;

// ---------------------------------------------------------------------------
// 7.3 — CommercialOfferV1
// ---------------------------------------------------------------------------

export const SourceRefSchema = z
  .object({
    source_id: z.string().min(1),
    snapshot_id: z.string().min(1),
    verified_at: z.string().min(1),
  })
  .strict();
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const AvailabilityStatusSchema = z.enum(["available", "limited", "unavailable"]);
export type AvailabilityStatus = z.infer<typeof AvailabilityStatusSchema>;

export const AvailabilitySchema = z
  .object({
    status: AvailabilityStatusSchema,
    checked_at: z.string().min(1),
  })
  .strict();
export type Availability = z.infer<typeof AvailabilitySchema>;

export const ServiceAreaSchema = z
  .object({
    country: z.string().min(1),
    cities: z.array(z.string().min(1)).optional(),
    radius_km: z.number().positive().optional(),
  })
  .strict();
export type ServiceArea = z.infer<typeof ServiceAreaSchema>;

export const RentalPeriodRulesSchema = z
  .object({
    minimum_periods: z.number().int().positive(),
    period_unit: z.enum(["event", "day"]),
  })
  .strict();
export type RentalPeriodRules = z.infer<typeof RentalPeriodRulesSchema>;

/**
 * Componente de precio (plan §6.3): venta unitaria, venta por paquete,
 * período de alquiler o cargo de servicio. Un cargo de servicio SIEMPRE debe
 * declarar su naturaleza (`service_fee_kind`) porque el invariante #3 de la
 * sección 6.3 prohíbe mezclar depósito/transporte/montaje/mano de obra con
 * el subtotal de producto; sin ese sub-tipo no se puede separar en UI ni en
 * cotización.
 */
export const PriceComponentTypeSchema = z.enum(["unit_sale", "package_sale", "rental_period", "service_fee"]);
export type PriceComponentType = z.infer<typeof PriceComponentTypeSchema>;

export const ServiceFeeKindSchema = z.enum(["deposit", "transport", "setup", "labor", "other"]);
export type ServiceFeeKind = z.infer<typeof ServiceFeeKindSchema>;

export const PriceComponentSchema = z
  .object({
    type: PriceComponentTypeSchema,
    /** Entero, COP (plan §6.3 invariante 1). Nunca decimales ni otra moneda. */
    amount_cop: z.number().int().nonnegative(),
    /** Cantidad que multiplica este componente (unidades por paquete, número de períodos, etc.). */
    quantity: z.number().int().positive().optional(),
    /** Obligatorio cuando `type === "service_fee"`; ver comentario arriba. */
    service_fee_kind: ServiceFeeKindSchema.optional(),
    label: z.string().min(1).optional(),
    /** Si es reembolsable (típico de un depósito de alquiler). */
    refundable: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.type === "service_fee" && !value.service_fee_kind) {
      ctx.addIssue({
        code: "custom",
        path: ["service_fee_kind"],
        message:
          "Un price_component de tipo service_fee debe declarar service_fee_kind (deposit/transport/setup/labor/other) " +
          "para no mezclarse con el subtotal de producto (plan §6.3, invariante 3).",
      });
    }
    if (value.type !== "service_fee" && value.service_fee_kind) {
      ctx.addIssue({
        code: "custom",
        path: ["service_fee_kind"],
        message: "service_fee_kind solo aplica a price_components de tipo service_fee.",
      });
    }
  });
export type PriceComponent = z.infer<typeof PriceComponentSchema>;

/** Tipos de `price_components` que "cuentan" como precio del producto/alquiler en sí, no como cargo de servicio. */
const SALE_COVERING_TYPES: readonly PriceComponentType[] = ["unit_sale", "package_sale"];
const RENTAL_COVERING_TYPES: readonly PriceComponentType[] = ["rental_period"];

export const CommercialOfferV1Schema = z
  .object({
    offer_id: z.string().min(1),
    item_id: z.string().min(1),
    variant_id: z.string().min(1).optional(),
    source_ref: SourceRefSchema,
    /**
     * A diferencia de `SupplySourceClass` (que también admite
     * `venue_existing`/`context_non_quotable`), una oferta comercial SOLO
     * puede ser venta o alquiler — plan §7.3.
     */
    source_class: z.enum(["catalog_sale", "catalog_rental"]),
    status: CommercialOfferStatusSchema,
    availability: AvailabilitySchema,
    service_area: ServiceAreaSchema.optional(),
    valid_from: z.string().min(1).optional(),
    valid_until: z.string().min(1).optional(),
    rental_period_rules: RentalPeriodRulesSchema.optional(),
    minimum_quantity: z.number().int().positive().optional(),
    price_components: z.array(PriceComponentSchema),
  })
  .strict()
  .superRefine((value, ctx) => {
    // Invariante de forma: un status PRICED necesita al menos un
    // price_component que efectivamente cubra la modalidad de la oferta
    // (venta -> unit_sale/package_sale; alquiler -> rental_period). Un
    // price_components vacío, o uno que solo trae service_fee, no basta.
    if (value.status === "PRICED") {
      const coveringTypes = value.source_class === "catalog_sale" ? SALE_COVERING_TYPES : RENTAL_COVERING_TYPES;
      const hasCoveringComponent = value.price_components.some((component) => coveringTypes.includes(component.type));
      if (!hasCoveringComponent) {
        ctx.addIssue({
          code: "custom",
          path: ["price_components"],
          message:
            value.source_class === "catalog_sale"
              ? "Una oferta PRICED de venta (catalog_sale) requiere al menos un price_component de tipo unit_sale o package_sale."
              : "Una oferta PRICED de alquiler (catalog_rental) requiere al menos un price_component de tipo rental_period.",
        });
      }
    }
    if (value.valid_from && value.valid_until && value.valid_from > value.valid_until) {
      ctx.addIssue({ code: "custom", path: ["valid_until"], message: "valid_until no puede ser anterior a valid_from." });
    }
  });
export type CommercialOfferV1 = z.infer<typeof CommercialOfferV1Schema>;

// ---------------------------------------------------------------------------
// 7.3 — SupplyBinding (unión discriminada)
// ---------------------------------------------------------------------------

/**
 * Contextos genéricos no cotizables (plan §6.4, invariante anti-alucinación
 * crítica): SOLO arquitectura/naturaleza del lugar o fondo genérico. Flores
 * arregladas, sillas, mesas, lámparas decorativas, carteles y centros de
 * mesa NUNCA pueden entrar por esta vía — deben tener un `SupplyBinding` de
 * venta, alquiler o `venue_existing` con evidencia. Esta lista es
 * deliberadamente cerrada; ampliarla es una decisión de producto, no un
 * detalle de implementación.
 */
export const ContextNonQuotableKindSchema = z.enum(["wall", "floor", "sky", "terrain", "ambient_light", "natural_vegetation"]);
export type ContextNonQuotableKind = z.infer<typeof ContextNonQuotableKindSchema>;

const SaleBindingSchema = z
  .object({
    kind: z.literal("sale"),
    item_id: z.string().min(1),
    offer_id: z.string().min(1),
    snapshot_id: z.string().min(1),
  })
  .strict();

const RentalBindingSchema = z
  .object({
    kind: z.literal("rental"),
    item_id: z.string().min(1),
    offer_id: z.string().min(1),
    snapshot_id: z.string().min(1),
    periods: z.number().int().positive(),
  })
  .strict();

const VenueExistingBindingSchema = z
  .object({
    kind: z.literal("venue_existing"),
    evidence_ref: z.string().min(1),
    region_ref: z.string().min(1).optional(),
  })
  .strict();

/**
 * `context_non_quotable` nunca lleva `offer_id`, `item_id` de catálogo ni
 * ningún otro campo de oferta comercial — esa ausencia estructural (no un
 * `.refine` aparte) es lo que hace imposible construir una línea de
 * cotización a partir de contexto genérico (plan §6.4).
 */
const ContextNonQuotableBindingSchema = z
  .object({
    kind: z.literal("context_non_quotable"),
    context_kind: ContextNonQuotableKindSchema,
  })
  .strict();

export const SupplyBindingSchema = z.discriminatedUnion("kind", [
  SaleBindingSchema,
  RentalBindingSchema,
  VenueExistingBindingSchema,
  ContextNonQuotableBindingSchema,
]);
export type SupplyBinding = z.infer<typeof SupplyBindingSchema>;
