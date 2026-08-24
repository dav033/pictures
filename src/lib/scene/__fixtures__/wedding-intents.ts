/**
 * Fixtures de "intención de boda" para la Tarea 00.1 del plan
 * PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md (Ola 0 — línea base).
 *
 * IMPORTANTE — estos son tipos TS simples y explícitos, NO el contrato Zod
 * formal `EventIntentV2` de la sección 7.1 del plan (ese se crea en la
 * Tarea 01.1, que corre en paralelo/después). Cuando ese contrato exista,
 * este archivo debe adaptarse a él sin perder los escenarios aquí
 * registrados. La forma de abajo es una proyección deliberadamente reducida
 * de `EventIntentV2` — solo los campos que necesita el diagnóstico de
 * cobertura de `scripts/eval-scene-baseline.ts`.
 *
 * Los 8 escenarios corresponden exactamente a los escenarios E2E
 * obligatorios de la sección 12 del plan (E2E-1 .. E2E-8), registrados aquí
 * como fixtures deterministas en memoria, no como generación real. Ninguno
 * de estos fixtures llama a un proveedor externo ni toca PostgreSQL.
 */

import type { SceneFunctionId } from "./catalog-capability-snapshots";
import { CATALOG_SNAPSHOT_CURRENT, CATALOG_SNAPSHOT_RICH_VERIFIED } from "./catalog-capability-snapshots";

export type EventScopeLite = "ceremony" | "reception" | "both";
export type RequestedViewLite = "entrance" | "ceremony" | "reception" | "detail";
export type ComplexityProfileLite = "focal_only" | "balanced_scene" | "immersive_scene" | "full_event";

/**
 * Elemento que ya existe en el lugar (foto o confirmación del usuario) y por
 * lo tanto puede cubrir una función de escena vía `venue_existing` sin
 * generar una línea comercial. Proyección reducida de `SupplyBinding`
 * (sección 7.3) + `existing_asset_refs` (sección 7.1).
 */
export type ExistingVenueAssetRefLite = {
  function: SceneFunctionId;
  description: string;
  evidence: "photo_region" | "user_confirmed";
};

export type WeddingIntentFixture = {
  /** Coincide 1:1 con el identificador de escenario de la sección 12 del plan. */
  scenarioId: "E2E-1" | "E2E-2" | "E2E-3" | "E2E-4" | "E2E-5" | "E2E-6" | "E2E-7" | "E2E-8";
  title: string;
  /** Resumen de "Entrada" tal como aparece en la sección 12. */
  userMessage: string;
  eventScope: EventScopeLite;
  requestedViews: RequestedViewLite[];
  complexityRequested: ComplexityProfileLite;
  /** COP enteros; `undefined` cuando el escenario no fija techo explícito. */
  budgetCop?: number;
  hasVenuePhoto: boolean;
  venue: {
    environment: "indoor" | "outdoor";
    existingAssets: ExistingVenueAssetRefLite[];
  };
  /** Proxy determinista de "iluminación ambiental cuando corresponda al horario" (receta 5.4). */
  requiresAmbientLight: boolean;
  /** Referencia a `CatalogCapabilitySnapshot.snapshotId`. */
  catalogSnapshotId: string;
  /** Solo presente en E2E-7; referencia a `OfferLifecycleFixture.offerLifecycleId`. */
  offerLifecycleFixtureId?: string;
  /** Qué debe demostrar este escenario (sección 12) — no es una aserción ejecutable, es documentación del fixture. */
  notes: string;
};

export const WEDDING_INTENT_FIXTURES: WeddingIntentFixture[] = [
  {
    scenarioId: "E2E-1",
    title: "Boda en jardín — catálogo actual (150.000 COP)",
    userMessage: "Quiero ideas para mi boda en un jardín",
    eventScope: "ceremony",
    requestedViews: ["ceremony"],
    complexityRequested: "balanced_scene",
    budgetCop: 150_000,
    hasVenuePhoto: false,
    venue: { environment: "outdoor", existingAssets: [] },
    requiresAmbientLight: false,
    catalogSnapshotId: CATALOG_SNAPSHOT_CURRENT.snapshotId,
    notes:
      "Caso reportado por el usuario. Debe fallar por cobertura semántica insuficiente (asientos/pasillo/floral/iluminación " +
      "sin oferta comercial verificable), no porque el PlanDecoracion V1 resultante sea inválido.",
  },
  {
    scenarioId: "E2E-2",
    title: "Boda en jardín — catálogo rico verificado",
    userMessage: "Quiero ideas para mi boda en un jardín",
    eventScope: "ceremony",
    requestedViews: ["ceremony"],
    complexityRequested: "balanced_scene",
    budgetCop: 150_000,
    hasVenuePhoto: false,
    venue: { environment: "outdoor", existingAssets: [] },
    requiresAmbientLight: true,
    catalogSnapshotId: CATALOG_SNAPSHOT_RICH_VERIFIED.snapshotId,
    notes:
      "Misma intención textual que E2E-1, pero contra el fixture de proveedores ricos. Debe demostrar que el sistema SÍ " +
      "puede cubrir focal + pasillo + asientos/contexto + acentos con cuatro o más familias distintas cuando el catálogo alcanza.",
  },
  {
    scenarioId: "E2E-3",
    title: "Solo arco orgánico blanco y dorado",
    userMessage: "Solo quiero un arco orgánico blanco y dorado, nada más",
    eventScope: "ceremony",
    requestedViews: ["ceremony"],
    complexityRequested: "focal_only",
    budgetCop: 400_000,
    hasVenuePhoto: false,
    venue: { environment: "outdoor", existingAssets: [] },
    requiresAmbientLight: false,
    catalogSnapshotId: CATALOG_SNAPSHOT_CURRENT.snapshotId,
    notes:
      "Petición explícita de una sola instalación. `focal_only` es un perfil válido por sí mismo: el arco aislado no debe " +
      "marcarse como incompleto ni forzarse a agregar pasillo, asientos o floristería no solicitados.",
  },
  {
    scenarioId: "E2E-4",
    title: "Lugar con sillas, vegetación y sendero existentes",
    userMessage:
      "Aquí está la foto de nuestro jardín: ya tenemos sillas blancas dispuestas, un sendero de piedra y vegetación natural alrededor",
    eventScope: "ceremony",
    requestedViews: ["ceremony"],
    complexityRequested: "balanced_scene",
    budgetCop: 200_000,
    hasVenuePhoto: true,
    venue: {
      environment: "outdoor",
      existingAssets: [
        { function: "guest_chair", description: "Sillas blancas plegables ya dispuestas en filas", evidence: "photo_region" },
        { function: "aisle_runner", description: "Sendero de piedra natural entre las filas de sillas", evidence: "photo_region" },
        { function: "floral_foliage_accent", description: "Vegetación natural y arbustos alrededor del área de ceremonia", evidence: "photo_region" },
      ],
    },
    requiresAmbientLight: false,
    catalogSnapshotId: CATALOG_SNAPSHOT_CURRENT.snapshotId,
    notes:
      "guest_chair, aisle_runner y floral_foliage_accent quedan cubiertos vía `venue_existing` aunque el catálogo comercial " +
      "no los tenga; no deben cotizarse ni autorizar mobiliario/floristería adicional inventada.",
  },
  {
    scenarioId: "E2E-5",
    title: "Presupuesto insuficiente para escena inmersiva",
    userMessage: "Quiero una decoración de boda muy completa e inmersiva para la ceremonia, con de todo",
    eventScope: "ceremony",
    requestedViews: ["ceremony"],
    complexityRequested: "immersive_scene",
    budgetCop: 250_000,
    hasVenuePhoto: false,
    venue: { environment: "outdoor", existingAssets: [] },
    requiresAmbientLight: true,
    catalogSnapshotId: CATALOG_SNAPSHOT_RICH_VERIFIED.snapshotId,
    notes:
      "Se usa deliberadamente el catálogo rico para aislar la causa: el catálogo alcanzaría para `immersive_scene`, pero el " +
      "techo de 250.000 COP no. El factor limitante esperado es presupuesto, no cobertura de catálogo; debe degradarse " +
      "explícitamente o bloquearse, nunca ocultar el costo.",
  },
  {
    scenarioId: "E2E-6",
    title: "Ceremonia y recepción (full_event)",
    userMessage: "Necesitamos decoración tanto para la ceremonia como para la recepción de la boda",
    eventScope: "both",
    requestedViews: ["ceremony", "reception"],
    complexityRequested: "full_event",
    budgetCop: 4_500_000,
    hasVenuePhoto: false,
    venue: { environment: "outdoor", existingAssets: [] },
    requiresAmbientLight: true,
    catalogSnapshotId: CATALOG_SNAPSHOT_RICH_VERIFIED.snapshotId,
    notes:
      "`full_event` requiere al menos dos vistas vinculadas al mismo plan, cada una con sus slots núcleo cubiertos " +
      "(ceremony: focal+pasillo+asientos; reception: mesas+mantelería+centros+asientos). No se intenta mostrar todo el " +
      "evento en un único encuadre.",
  },
  {
    scenarioId: "E2E-7",
    title: "Oferta comercial modificada después de aprobar",
    userMessage: "Quiero ideas para mi boda en un jardín",
    eventScope: "ceremony",
    requestedViews: ["ceremony"],
    complexityRequested: "balanced_scene",
    budgetCop: 3_200_000,
    hasVenuePhoto: false,
    venue: { environment: "outdoor", existingAssets: [] },
    requiresAmbientLight: true,
    catalogSnapshotId: CATALOG_SNAPSHOT_RICH_VERIFIED.snapshotId,
    offerLifecycleFixtureId: "altar_frame_offer_lifecycle_v1",
    notes:
      "Construido sobre el mismo catálogo rico de E2E-2/E2E-6, pero con una oferta (`altar_frame`, OFR-ALTAR-0001) que " +
      "cambia de precio/snapshot después de la aprobación. Sirve para probar más adelante que `selection_hash`/`quote_hash` " +
      "se invalidan; aquí solo se registra el fixture y se compara la huella antes/después.",
  },
  {
    scenarioId: "E2E-8",
    title: "Boda en jardín sin foto de lugar",
    userMessage: "Quiero decorar mi boda en un jardín, pero todavía no tengo foto del lugar",
    eventScope: "ceremony",
    requestedViews: ["ceremony"],
    complexityRequested: "balanced_scene",
    budgetCop: 180_000,
    hasVenuePhoto: false,
    venue: { environment: "outdoor", existingAssets: [] },
    requiresAmbientLight: false,
    catalogSnapshotId: CATALOG_SNAPSHOT_CURRENT.snapshotId,
    notes:
      "Sin foto, `context_non_quotable` permite terreno/cielo/vegetación natural genéricos, pero nunca autoriza mobiliario, " +
      "flores arregladas ni iluminación sin `SupplyBinding` verificable. Este fixture NO otorga cobertura vía " +
      "`venue_existing` a ninguna función (existingAssets vacío) para que el diagnóstico distinga contexto de cobertura real.",
  },
];

export function findWeddingIntentFixture(scenarioId: WeddingIntentFixture["scenarioId"]): WeddingIntentFixture {
  const fixture = WEDDING_INTENT_FIXTURES.find((item) => item.scenarioId === scenarioId);
  if (!fixture) {
    throw new Error(`Fixture de intención de boda desconocido: ${scenarioId}`);
  }
  return fixture;
}
