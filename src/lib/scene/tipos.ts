/**
 * Contratos Zod V2 del dominio de escena (Tarea 01.1 —
 * `PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md`, sección 7).
 *
 * Implementa, con Zod y tipos inferidos (`z.infer<...>`), los contratos
 * descritos en la sección 7 del plan: `EventIntentV2` (7.1), `SceneSlot` /
 * `SceneProgramV1` / `SceneView` (7.2), `SupplySourceClass` /
 * `NonCommercialReferenceClass` / `SupplyBinding` (7.3), y `SlotCandidate` /
 * `SceneCoverageReport` (7.4).
 *
 * `ScenePlanV2`, `ResolvedScenePlanV2` y `SceneSpecV2` (7.5) son contratos
 * ricos que pertenecen a Plan 05/06/07; aquí solo se definen *stubs*
 * mínimos y razonables — suficientes para que `hashes.ts` tenga firmas de
 * tipo coherentes (`computePlanHash`, `computeQuoteHash`,
 * `computeSceneSpecHash`, `computeQaHash`) que otras olas puedan extender
 * sin romper compatibilidad. El cuerpo completo de esos contratos se
 * expandirá cuando existan sus tareas correspondientes.
 *
 * ACTUALIZACIÓN (reconciliación post Tarea 02.2): `CatalogItemV3`,
 * `CommercialOfferV1`, `SupplySourceClass`, `NonCommercialReferenceClass`,
 * `SupplyBinding`, `PhysicalDimensions` y `PriceComponent` YA NO se
 * redefinen aquí — se re-exportan directamente desde
 * `src/lib/rag/catalog/scene-asset-schema.ts` (Tarea 02.2), que es la
 * fuente de verdad real para "identidad física + verdad comercial". Este
 * archivo solo conserva los nombres de export (`ContextKindSchema`/
 * `ContextKind` en vez de `ContextNonQuotableKindSchema`/
 * `ContextNonQuotableKind`) para no romper a `src/lib/scene/invariants.ts`
 * y `src/lib/scene/hashes.ts`, que ya importaban estos símbolos desde
 * `./tipos` antes de que existiera `scene-asset-schema.ts`.
 */

import { z } from "zod";
import {
  CatalogItemV3Schema as SceneAssetCatalogItemV3Schema,
  CommercialOfferV1Schema as SceneAssetCommercialOfferV1Schema,
  ContextNonQuotableKindSchema as SceneAssetContextKindSchema,
  NonCommercialReferenceClassSchema as SceneAssetNonCommercialReferenceClassSchema,
  PhysicalDimensionsSchema as SceneAssetPhysicalDimensionsSchema,
  PriceComponentSchema as SceneAssetPriceComponentSchema,
  SupplyBindingSchema as SceneAssetSupplyBindingSchema,
  SupplySourceClassSchema as SceneAssetSupplySourceClassSchema,
  type CatalogItemV3 as SceneAssetCatalogItemV3,
  type CommercialOfferV1 as SceneAssetCommercialOfferV1,
  type ContextNonQuotableKind as SceneAssetContextKind,
  type NonCommercialReferenceClass as SceneAssetNonCommercialReferenceClass,
  type PhysicalDimensions as SceneAssetPhysicalDimensions,
  type PriceComponent as SceneAssetPriceComponent,
  type SupplyBinding as SceneAssetSupplyBinding,
  type SupplySourceClass as SceneAssetSupplySourceClass,
} from "@/lib/rag/catalog/scene-asset-schema";

// ---------------------------------------------------------------------------
// 7.1 EventIntentV2
// ---------------------------------------------------------------------------

export const EventScopeSchema = z.enum(["ceremony", "reception", "both"]);
export type EventScope = z.infer<typeof EventScopeSchema>;

/**
 * Tipo de vista renderizable (sección 3: "cobertura del evento" vs.
 * "cobertura de la vista"). Se reutiliza tanto para `requested_views` de
 * `EventIntentV2` como para `SceneView.view_type` (ver más abajo).
 */
export const RequestedViewSchema = z.enum([
  "entrance",
  "ceremony",
  "reception",
  "detail",
]);
export type RequestedView = z.infer<typeof RequestedViewSchema>;

export const ComplexityProfileSchema = z.enum([
  "focal_only",
  "balanced_scene",
  "immersive_scene",
  "full_event",
]);
export type ComplexityProfile = z.infer<typeof ComplexityProfileSchema>;

export const EventLocationSchema = z.object({
  country: z.string().min(1),
  city: z.string().min(1),
  venue_id: z.string().min(1).optional(),
});

export const RentalPeriodSchema = z.object({
  starts_at: z.string().min(1),
  ends_at: z.string().min(1),
});

export const EventVenueSchema = z.object({
  environment: z.enum(["indoor", "outdoor"]).optional(),
  existing_asset_refs: z.array(z.string().min(1)),
});

export const HardConstraintSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
  provenance: z.enum(["user", "image"]),
});

export const EventIntentV2Schema = z.object({
  schema_version: z.literal("event-intent-v2"),
  event_type: z.literal("wedding"),
  event_scope: EventScopeSchema,
  requested_views: z.array(RequestedViewSchema).min(1),
  complexity_requested: ComplexityProfileSchema,
  /** COP enteros (sección 6.3, invariante 1: "todo monto usa enteros en COP"). */
  budget_cop: z.number().int().positive().optional(),
  event_date: z.string().min(1).optional(),
  event_location: EventLocationSchema.optional(),
  rental_period: RentalPeriodSchema.optional(),
  venue: EventVenueSchema,
  palette: z.array(z.string().min(1)),
  style_terms: z.array(z.string().min(1)),
  hard_constraints: z.array(HardConstraintSchema),
});

export type EventIntentV2 = z.infer<typeof EventIntentV2Schema>;

// ---------------------------------------------------------------------------
// 7.2 SceneView, SceneSlot y SceneProgramV1
// ---------------------------------------------------------------------------

/**
 * DECISIÓN DE DISEÑO — `SceneView`:
 * El plan referencia `SceneView` en `SceneProgramV1.views` (sección 7.2) sin
 * definirlo explícitamente; la Tarea 01.1 pide definirlo "de forma
 * razonable". Se modela como:
 *   - `view_id`: identificador estable de la vista dentro del programa
 *     (referenciado por `SceneSlot.view_id` y por `SceneCoverageReport`);
 *   - `view_type`: el mismo vocabulario cerrado que `requested_views` de
 *     `EventIntentV2` (`entrance | ceremony | reception | detail`) — una
 *     vista siempre es una instancia concreta de uno de esos tipos
 *     solicitados, así que reutilizar el enum evita divergencia entre
 *     "lo pedido" y "lo programado";
 *   - `zones`: qué zonas (sección 5.2) puede reclamar esta vista — el mismo
 *     concepto de "allowlist de zonas por vista" que ya usa
 *     `assertEventViewCoverageSeparation` en `src/lib/scene/invariants.ts`
 *     (sección 3, "evento y vista son niveles distintos"). Se exige al
 *     menos una zona: una vista sin zonas no podría cubrir ningún slot.
 */
export const SceneViewSchema = z.object({
  view_id: z.string().min(1),
  view_type: RequestedViewSchema,
  zones: z.array(z.string().min(1)).min(1),
});
export type SceneView = z.infer<typeof SceneViewSchema>;

// 7.3 SupplySourceClass se necesita aquí porque SceneSlot.allowed_sources lo
// usa; se declara antes de SceneSlot como re-export de la fuente de verdad
// real (`src/lib/rag/catalog/scene-asset-schema.ts`, Tarea 02.2) y se
// reexporta de nuevo más abajo junto al resto de contratos de la sección 7.3
// para no cambiar la superficie pública de este módulo.
export const SupplySourceClassSchema = SceneAssetSupplySourceClassSchema;
export type SupplySourceClass = SceneAssetSupplySourceClass;

/**
 * DECISIÓN DE DISEÑO — `SpatialConstraint`:
 * Tampoco está definido explícitamente en la sección 7.2, pero
 * `SceneSlot.spatial_constraints` lo requiere. Se modela reutilizando el
 * vocabulario cerrado de relaciones del grafo espacial de la sección 10.1
 * (`attached_to`, `supported_by`, `aligned_with`, `mirrored_with`,
 * `repeated_along`, `in_front_of`, `behind`, `overhead_of`,
 * `clearance_from`) más una referencia a qué se relaciona (otro slot y/o
 * una zona) — un slot puede depender espacialmente de otro slot del mismo
 * programa (p. ej. "decoración focal" `attached_to` "estructura focal") o
 * de una zona genérica (p. ej. "acento de primer plano" `clearance_from`
 * "ceremony_aisle"). Se exige declarar al menos un objetivo
 * (`target_slot_id` o `target_zone`); una restricción sin objetivo no
 * restringe nada.
 */
export const SpatialRelationSchema = z.enum([
  "attached_to",
  "supported_by",
  "aligned_with",
  "mirrored_with",
  "repeated_along",
  "in_front_of",
  "behind",
  "overhead_of",
  "clearance_from",
]);
export type SpatialRelation = z.infer<typeof SpatialRelationSchema>;

export const SpatialConstraintSchema = z
  .object({
    relation: SpatialRelationSchema,
    target_slot_id: z.string().min(1).optional(),
    target_zone: z.string().min(1).optional(),
    note: z.string().min(1).optional(),
  })
  .superRefine((constraint, ctx) => {
    if (!constraint.target_slot_id && !constraint.target_zone) {
      ctx.addIssue({
        code: "custom",
        message:
          "spatial_constraints: cada restricción debe declarar target_slot_id y/o target_zone; una relación sin objetivo no restringe nada",
        path: ["target_slot_id"],
      });
    }
  });
export type SpatialConstraint = z.infer<typeof SpatialConstraintSchema>;

/**
 * DECISIÓN DE DISEÑO — rango de `weight`:
 * `weight` es un multiplicador de importancia relativa dentro del cálculo
 * de `weighted_coverage` (sección 9.4: "maximizar cobertura ponderada").
 * No es una probabilidad ni una fracción — es una entrada de una suma
 * ponderada, así que:
 *   - debe ser >= 0: un peso negativo restaría cobertura por tener un slot
 *     presente, lo cual no tiene sentido semántico (como mucho un slot
 *     puede "no contar", nunca "penalizar por existir");
 *   - se permite 0 explícitamente: representa un slot presente en la
 *     receta (p. ej. para trazabilidad/dependencias) pero excluido del
 *     puntaje de cobertura ponderada, sin necesidad de eliminarlo del
 *     programa;
 *   - se acota en 10 como techo: sin cota, un solo slot opcional con peso
 *     desproporcionado podría dominar `weighted_coverage` y volver el
 *     puntaje incomparable entre recetas. 10 dista lo suficiente de 1
 *     (peso "normal") para expresar prioridad alta sin permitir que un
 *     slot valga, por ejemplo, cien veces más que el resto del programa.
 */
export const SLOT_WEIGHT_MIN = 0;
export const SLOT_WEIGHT_MAX = 10;

export const SlotRequirementSchema = z.enum([
  "required",
  "conditional",
  "optional",
]);
export type SlotRequirement = z.infer<typeof SlotRequirementSchema>;

export const SceneSlotSchema = z
  .object({
    slot_id: z.string().min(1),
    view_id: z.string().min(1),
    zone: z.string().min(1),
    function: z.string().min(1),
    requirement: SlotRequirementSchema,
    weight: z.number().min(SLOT_WEIGHT_MIN).max(SLOT_WEIGHT_MAX),
    min_instances: z.number().int().nonnegative(),
    max_instances: z.number().int().positive(),
    /** Subconjunto NO VACÍO de `SupplySourceClass` (regla obligatoria, sección 01.1). */
    allowed_sources: z.array(SupplySourceClassSchema).min(1),
    dependencies: z.array(z.string().min(1)),
    spatial_constraints: z.array(SpatialConstraintSchema),
  })
  .superRefine((slot, ctx) => {
    if (slot.min_instances > slot.max_instances) {
      ctx.addIssue({
        code: "custom",
        message: `slot ${slot.slot_id}: min_instances (${slot.min_instances}) no puede ser mayor que max_instances (${slot.max_instances})`,
        path: ["min_instances"],
      });
    }
  });
export type SceneSlot = z.infer<typeof SceneSlotSchema>;

export const SceneProgramV1Schema = z
  .object({
    schema_version: z.literal("scene-program-v1"),
    recipe_id: z.string().min(1),
    recipe_version: z.number().int().positive(),
    intent_hash: z.string().min(1),
    views: z.array(SceneViewSchema),
    slots: z.array(SceneSlotSchema),
  })
  .superRefine((program, ctx) => {
    // Regla obligatoria: rechazar IDs de slot duplicados dentro del arreglo.
    const seenSlotIds = new Map<string, number>();
    program.slots.forEach((slot, index) => {
      const firstIndex = seenSlotIds.get(slot.slot_id);
      if (firstIndex !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: `slot_id duplicado "${slot.slot_id}" (primera aparición en el índice ${firstIndex}, repetido en el índice ${index})`,
          path: ["slots", index, "slot_id"],
        });
      } else {
        seenSlotIds.set(slot.slot_id, index);
      }
    });

    // Regla obligatoria: view_id debe existir en program.views.
    const viewIds = new Set(program.views.map((view) => view.view_id));
    program.slots.forEach((slot, index) => {
      if (!viewIds.has(slot.view_id)) {
        ctx.addIssue({
          code: "custom",
          message: `slot ${slot.slot_id}: view_id "${slot.view_id}" no existe en program.views (${[...viewIds].join(", ") || "sin vistas"})`,
          path: ["slots", index, "view_id"],
        });
      }
    });

    // Chequeo adicional razonable: dependencies debe referenciar slot_id existentes.
    const slotIds = new Set(program.slots.map((slot) => slot.slot_id));
    program.slots.forEach((slot, index) => {
      slot.dependencies.forEach((dependencyId, depIndex) => {
        if (!slotIds.has(dependencyId)) {
          ctx.addIssue({
            code: "custom",
            message: `slot ${slot.slot_id}: dependencies[${depIndex}] "${dependencyId}" no corresponde a ningún slot_id del programa`,
            path: ["slots", index, "dependencies", depIndex],
          });
        }
      });
    });
  });
export type SceneProgramV1 = z.infer<typeof SceneProgramV1Schema>;

// ---------------------------------------------------------------------------
// 7.3 SupplySourceClass, NonCommercialReferenceClass, SupplyBinding
// ---------------------------------------------------------------------------

/**
 * Alineado EXACTAMENTE con `NonCommercialReferenceClass` de
 * `src/lib/generacion/provenance.ts` (Tarea 00.3): mismos dos valores
 * literales (`"editorial_reference" | "test_only"`). Re-exportado desde
 * `scene-asset-schema.ts` (Tarea 02.2), que ya lleva su propio chequeo de
 * tipo en compilación contra `provenance.ts` — una sola cadena de
 * alineación en vez de dos copias divergentes.
 */
export const NonCommercialReferenceClassSchema = SceneAssetNonCommercialReferenceClassSchema;
export type NonCommercialReferenceClass = SceneAssetNonCommercialReferenceClass;

/**
 * Subconjunto permitido para `context_non_quotable` (sección 6.4).
 * Re-exportado desde `scene-asset-schema.ts` bajo el nombre `ContextKind`
 * (en vez de `ContextNonQuotableKind`) porque `src/lib/scene/invariants.ts`
 * ya importaba `ContextKind` desde `./tipos` antes de que existiera
 * `scene-asset-schema.ts` — cambiar el nombre ahí rompería esa Ola 0.
 */
export const ContextKindSchema = SceneAssetContextKindSchema;
export type ContextKind = SceneAssetContextKind;

export const SupplyBindingSchema = SceneAssetSupplyBindingSchema;
export type SupplyBinding = SceneAssetSupplyBinding;

// ---------------------------------------------------------------------------
// 7.3 (continuación) — CatalogItemV3 / CommercialOfferV1
//
// Re-exportados desde `src/lib/rag/catalog/scene-asset-schema.ts` (Tarea
// 02.2), que es la fuente de verdad real: `category_v3` valida contra el
// enum cerrado de `taxonomy/v3.ts` (en vez de `z.string()` libre),
// `scene_functions[].function` valida contra el enum de funciones, y
// `CommercialOfferV1`/`PriceComponent` incluyen las reglas de negocio de
// la sección 6.3 (p. ej. PRICED exige un price_component que cubra la
// modalidad; service_fee exige `service_fee_kind`). `SlotCandidate` (7.4)
// usa estos mismos re-exports, así que no hay dos formas divergentes de
// "item de catálogo" en el dominio de escena.
// ---------------------------------------------------------------------------

export const PhysicalDimensionsSchema = SceneAssetPhysicalDimensionsSchema;
export type PhysicalDimensions = SceneAssetPhysicalDimensions;

export const CatalogItemV3Schema = SceneAssetCatalogItemV3Schema;
export type CatalogItemV3 = SceneAssetCatalogItemV3;

export const PriceComponentSchema = SceneAssetPriceComponentSchema;
export type PriceComponent = SceneAssetPriceComponent;

export const CommercialOfferV1Schema = SceneAssetCommercialOfferV1Schema;
export type CommercialOfferV1 = SceneAssetCommercialOfferV1;

// ---------------------------------------------------------------------------
// 7.4 SlotCandidate y SceneCoverageReport
// ---------------------------------------------------------------------------

export const SlotCandidateSchema = z.object({
  slot_id: z.string().min(1),
  item: CatalogItemV3Schema,
  offer: CommercialOfferV1Schema.optional(),
  supply_binding: SupplyBindingSchema,
  retrieval: z.object({
    lexical: z.number(),
    semantic: z.number(),
    rerank: z.number(),
  }),
  eligibility: z.object({
    pass: z.boolean(),
    reasons: z.array(z.string().min(1)),
  }),
  /** COP enteros no negativos (sección 6.3, invariante 1), si se conoce. */
  estimated_cost_cop: z.number().int().nonnegative().optional(),
});
export type SlotCandidate = z.infer<typeof SlotCandidateSchema>;

export const RequiredGapSchema = z.object({
  slot_id: z.string().min(1),
  reason: z.string().min(1),
  suggested_source_type: z.string().min(1).optional(),
});

export const CoverageWaiverSchema = z.object({
  slot_id: z.string().min(1),
  accepted_by: z.literal("user"),
  accepted_at: z.string().min(1),
  reason: z.string().min(1),
});

export const SceneCoverageStatusSchema = z.enum([
  "COMPLETE",
  "PARTIAL",
  "BLOCKED",
]);
export type SceneCoverageStatus = z.infer<typeof SceneCoverageStatusSchema>;

export const SceneCoverageReportSchema = z
  .object({
    // El plan tipa requested_profile/achieved_profile/accepted_profile como
    // `string` genérico, pero ya existe un enum cerrado para el mismo
    // concepto (`ComplexityProfileSchema`, sección 5.1 / 7.1). Reutilizarlo
    // aquí evita que un typo produzca un perfil inexistente que nunca
    // matchee contra la receta real.
    requested_profile: ComplexityProfileSchema,
    achieved_profile: ComplexityProfileSchema,
    accepted_profile: ComplexityProfileSchema.optional(),
    weighted_coverage: z.number().min(0).max(1),
    required_covered: z.array(z.string().min(1)),
    required_gaps: z.array(RequiredGapSchema),
    waivers: z.array(CoverageWaiverSchema),
    optional_covered: z.array(z.string().min(1)),
    distinct_families: z.array(z.string().min(1)),
    status: SceneCoverageStatusSchema,
  })
  .superRefine((report, ctx) => {
    // Regla obligatoria: un estado COMPLETE nunca puede tener brechas
    // obligatorias pendientes.
    if (report.status === "COMPLETE" && report.required_gaps.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `status "COMPLETE" es inconsistente con ${report.required_gaps.length} required_gaps pendiente(s): ${report.required_gaps
          .map((gap) => gap.slot_id)
          .join(", ")}`,
        path: ["required_gaps"],
      });
    }
  });
export type SceneCoverageReport = z.infer<typeof SceneCoverageReportSchema>;

// ---------------------------------------------------------------------------
// 7.5 ScenePlanV2 / ResolvedScenePlanV2 / SceneSpecV2 — STUBS
//
// El cuerpo completo de estos tres contratos corresponde a Plan 05
// (`ScenePlanV2`/`ResolvedScenePlanV2` — Tarea 05.1/05.2) y Plan 07
// (`SceneSpecV2` — Tarea 07.1). Aquí solo se define lo mínimo para que
// `plan_hash`, `quote_hash`, `scene_spec_hash` y `qa_hash` (hashes.ts)
// tengan una firma de tipo coherente que esas olas puedan extender sin
// romper compatibilidad — nunca se debe asumir que estos stubs son la
// forma final.
// ---------------------------------------------------------------------------

/** STUB — se expandirá en Plan 05 (Tarea 05.1/05.2). */
export const ScenePlanV2StubSchema = z.object({
  schema_version: z.literal("scene-plan-v2"),
  program_hash: z.string().min(1),
  selected_candidates: z.array(
    z.object({
      slot_id: z.string().min(1),
      item_id: z.string().min(1),
      offer_id: z.string().min(1).optional(),
      supply_binding: SupplyBindingSchema,
    })
  ),
});
export type ScenePlanV2Stub = z.infer<typeof ScenePlanV2StubSchema>;

/** STUB — se expandirá en Plan 05 (Tarea 05.2, resolver + cotización). */
export const ResolvedScenePlanV2StubSchema = z.object({
  schema_version: z.literal("resolved-scene-plan-v2"),
  plan_hash: z.string().min(1),
  status: z.enum([
    "DRAFT",
    "PARTIAL",
    "COMPLETE",
    "BLOCKED",
    "APPROVED",
    "VERIFICADO",
  ]),
  /** COP enteros (sección 6.3, invariante 1). */
  known_total_cop: z.number().int().nonnegative(),
});
export type ResolvedScenePlanV2Stub = z.infer<
  typeof ResolvedScenePlanV2StubSchema
>;

/** STUB — se expandirá en Plan 07 (Tarea 07.1, spec y layout por grafo). */
export const SceneSpecV2StubSchema = z.object({
  schema_version: z.literal("scene-spec-v2"),
  scene_plan_hash: z.string().min(1),
  view_id: z.string().min(1),
  /** Placeholder deliberado: las instancias completas son objeto de Plan 07. */
  instances: z.array(z.unknown()),
});
export type SceneSpecV2Stub = z.infer<typeof SceneSpecV2StubSchema>;

/** STUB — se expandirá en Plan 07 (Tarea 07.2, QA visual V2). */
export const SceneQaReportStubSchema = z.object({
  schema_version: z.literal("scene-qa-v2"),
  scene_spec_hash: z.string().min(1),
  passed: z.boolean(),
});
export type SceneQaReportStub = z.infer<typeof SceneQaReportStubSchema>;
