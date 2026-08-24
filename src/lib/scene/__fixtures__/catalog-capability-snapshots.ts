/**
 * Fixtures de "capacidad de catálogo" para la Tarea 00.1 del plan
 * PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md (Ola 0 — línea base).
 *
 * IMPORTANTE — estos son tipos TS simples y explícitos, NO los contratos Zod
 * formales `CatalogItemV3` / `CommercialOfferV1` descritos en la sección 7.3
 * del plan (esos se crean en la Tarea 02.2). Cuando esos contratos existan,
 * este archivo debe adaptarse a ellos sin perder los datos aquí registrados.
 * Por ahora esto es deliberadamente un "snapshot de capacidad agregada":
 * cuántas ofertas verificadas existen por función de escena, no items
 * individuales.
 *
 * Los números del snapshot "catálogo actual" reproducen fielmente la
 * sección 2.2 del plan (consulta de solo lectura al PostgreSQL activo,
 * fecha de auditoría 2026-08-22). No se hace ninguna conexión real a la
 * base de datos aquí: son datos embebidos, deterministas y de solo lectura.
 */

/** Funciones de escena iniciales, sección 5.3 del plan. */
export const SCENE_FUNCTIONS = [
  "altar_frame",
  "focal_backdrop",
  "focal_decor",
  "floral_foliage_accent",
  "balloon_accent",
  "aisle_runner",
  "aisle_marker",
  "guest_chair",
  "table_surface",
  "linen",
  "table_setting",
  "centerpiece",
  "ambient_light",
  "floor_light",
  "welcome_signage",
  "plinth_pedestal",
  "service_support",
] as const;

export type SceneFunctionId = (typeof SCENE_FUNCTIONS)[number];

/** Clases de fuente, versión reducida de `SupplySourceClass` (sección 6.1). */
export type SupplySourceClassLite = "catalog_sale" | "catalog_rental";

/**
 * Capacidad comercial agregada para una función de escena dentro de un
 * snapshot de catálogo. `verifiedOfferCount === 0` significa "sin cobertura
 * comercial verificable", no "sin intentar buscar".
 */
export type CatalogFunctionCapability = {
  function: SceneFunctionId;
  verifiedOfferCount: number;
  sourceClasses: SupplySourceClassLite[];
  minPriceCop?: number;
  sampleOfferIds?: string[];
  notes: string;
};

export type CatalogCapabilitySnapshot = {
  snapshotId: string;
  label: string;
  /** Fecha fija (no `Date.now()`) para mantener el fixture determinista. */
  capturedAt: string;
  source: "postgres_readonly_query" | "fixture_projection";
  /** Conteo de productos activos por categoría (tabla sección 2.2). */
  categoryCounts: Record<string, number>;
  totals: {
    products: number;
    variants: number;
    variantsAvailable: number;
  };
  weddingTaggedProducts: number;
  functionCapabilities: CatalogFunctionCapability[];
};

function capability(
  functionId: SceneFunctionId,
  verifiedOfferCount: number,
  sourceClasses: SupplySourceClassLite[],
  notes: string,
  extra?: { minPriceCop?: number; sampleOfferIds?: string[] },
): CatalogFunctionCapability {
  return { function: functionId, verifiedOfferCount, sourceClasses, notes, ...extra };
}

/**
 * Snapshot 1 — "catálogo actual". Refleja exactamente la sección 2.2:
 * 1.411 productos, 3.592 variantes, 3.369 variantes disponibles; 0 mobiliario,
 * 0 flores/follaje físicos, 0 iluminación física; 4 variantes de
 * `guirnalda_arco` con paquete cotizable, 8 cortinas, 18 textiles de mesa;
 * solo 17 productos con etiqueta de boda.
 */
export const CATALOG_SNAPSHOT_CURRENT: CatalogCapabilitySnapshot = {
  snapshotId: "catalog-snapshot-current-2026-08-22",
  label: "Catálogo actual (PostgreSQL activo, auditoría 2026-08-22)",
  capturedAt: "2026-08-22T00:00:00.000Z",
  source: "postgres_readonly_query",
  categoryCounts: {
    globo_latex: 702,
    desechable: 203,
    banderola_cartel: 137,
    globo_metalizado: 134,
    vela: 80,
    kit: 57,
    complemento: 36,
    empaque: 25,
    sin_categoria: 24,
    guirnalda_arco: 13,
  },
  totals: { products: 1411, variants: 3592, variantsAvailable: 3369 },
  weddingTaggedProducts: 17,
  functionCapabilities: [
    capability(
      "balloon_accent",
      836,
      ["catalog_sale"],
      "globo_latex (702) + globo_metalizado (134); cubre acentos de globo, no reemplaza mobiliario ni floristería física.",
    ),
    capability(
      "altar_frame",
      4,
      ["catalog_sale"],
      "4 variantes disponibles de guirnalda_arco con unidades de paquete cotizables; es un arco de globos genérico, no una estructura de altar dedicada.",
    ),
    capability(
      "focal_backdrop",
      8,
      ["catalog_sale"],
      "8 cortinas disponibles; pueden servir como backdrop plano, sin verificación de uso en boda.",
    ),
    capability("focal_decor", 0, [], "Sin oferta comercial verificada para decoración focal más allá de globos."),
    capability("floral_foliage_accent", 0, [], "0 flores/follaje físicos verificables en el catálogo activo."),
    capability("aisle_runner", 0, [], "Sin cobertura comercial verificada para delimitación de pasillo."),
    capability("aisle_marker", 0, [], "Sin cobertura comercial verificada para marcadores de pasillo."),
    capability("guest_chair", 0, [], "0 mobiliario verificable en el catálogo activo."),
    capability("table_surface", 0, [], "0 mobiliario verificable (mesas) en el catálogo activo."),
    capability(
      "linen",
      18,
      ["catalog_sale"],
      "18 textiles de mesa disponibles; mantelería genérica, sin verificación de uso ceremonial.",
    ),
    capability("table_setting", 0, [], "Sin cobertura comercial verificada para montaje de mesa."),
    capability("centerpiece", 0, [], "Sin cobertura comercial verificada para centros de mesa."),
    capability("ambient_light", 0, [], "0 iluminación física verificable en el catálogo activo."),
    capability("floor_light", 0, [], "0 iluminación física verificable en el catálogo activo."),
    capability(
      "welcome_signage",
      0,
      [],
      "banderola_cartel (137) existe en volumen pero no está verificado como señalización de bienvenida física con oferta comercial de boda.",
    ),
    capability("plinth_pedestal", 0, [], "Sin cobertura comercial verificada para pedestales."),
    capability(
      "service_support",
      0,
      [],
      "complemento (36) y empaque (25) son insumos operativos (inflado, empaques), no soporte escénico verificable.",
    ),
  ],
};

/**
 * Snapshot 2 — "catálogo rico verificado". Fixture de proveedores
 * comerciales completos (mobiliario de boda, floristería, estructura de
 * altar, mantelería e iluminación ambiental) con oferta comercial
 * (`catalog_sale`/`catalog_rental`) para que Ola 2+ pueda probar que el
 * sistema SÍ produce una escena completa cuando el catálogo alcanza.
 * Los `offer_id`/precios son simulados pero con forma realista (COP enteros).
 */
export const CATALOG_SNAPSHOT_RICH_VERIFIED: CatalogCapabilitySnapshot = {
  snapshotId: "catalog-snapshot-rich-verified-fixture-v1",
  label: "Catálogo rico verificado (fixture de proveedores completos, Ola 2+)",
  capturedAt: "2026-08-22T00:00:00.000Z",
  source: "fixture_projection",
  categoryCounts: {
    globo_latex: 702,
    desechable: 203,
    banderola_cartel: 137,
    globo_metalizado: 134,
    vela: 80,
    kit: 57,
    complemento: 36,
    empaque: 25,
    sin_categoria: 24,
    guirnalda_arco: 13,
    mobiliario_boda: 240,
    floristeria_boda: 180,
    estructura_altar: 22,
    manteleria_boda: 96,
    iluminacion_ambiental: 130,
  },
  totals: { products: 2764, variants: 6890, variantsAvailable: 6512 },
  weddingTaggedProducts: 918,
  functionCapabilities: [
    capability("balloon_accent", 836, ["catalog_sale"], "Se mantiene la oferta de globos del catálogo actual."),
    capability(
      "altar_frame",
      22,
      ["catalog_sale", "catalog_rental"],
      "Estructuras de altar dedicadas (arco metálico, marco floral, estructura de madera) con proveedor verificado.",
      { minPriceCop: 380000, sampleOfferIds: ["OFR-ALTAR-0001", "OFR-ALTAR-0002", "OFR-ALTAR-0003"] },
    ),
    capability(
      "focal_backdrop",
      18,
      ["catalog_sale", "catalog_rental"],
      "Cortinas y paneles de backdrop con proveedor verificado, más los 8 existentes en catálogo actual.",
      { minPriceCop: 150000, sampleOfferIds: ["OFR-BACKDROP-0001"] },
    ),
    capability(
      "focal_decor",
      30,
      ["catalog_sale"],
      "Decoración focal ensamblable (guirnaldas florales, cintas, elementos de acabado) con proveedor verificado.",
      { minPriceCop: 60000 },
    ),
    capability(
      "floral_foliage_accent",
      95,
      ["catalog_sale", "catalog_rental"],
      "Floristería y follaje físico con proveedor verificado (ramos, follaje colgante, arreglos de altar).",
      { minPriceCop: 45000, sampleOfferIds: ["OFR-FLORAL-0001", "OFR-FLORAL-0002"] },
    ),
    capability(
      "aisle_runner",
      12,
      ["catalog_rental"],
      "Alfombras/senderos de pasillo con proveedor de alquiler verificado.",
      { minPriceCop: 90000 },
    ),
    capability(
      "aisle_marker",
      40,
      ["catalog_sale", "catalog_rental"],
      "Marcadores de pasillo (faroles, pedestales florales pequeños) con proveedor verificado.",
      { minPriceCop: 35000 },
    ),
    capability(
      "guest_chair",
      240,
      ["catalog_rental"],
      "Sillas de invitado (Chiavari, cross-back, plegable premium) con proveedor de alquiler verificado.",
      { minPriceCop: 12000, sampleOfferIds: ["OFR-CHAIR-0001", "OFR-CHAIR-0002"] },
    ),
    capability(
      "table_surface",
      60,
      ["catalog_rental"],
      "Mesas (redondas, imperiales, cóctel) con proveedor de alquiler verificado.",
      { minPriceCop: 45000 },
    ),
    capability(
      "linen",
      96,
      ["catalog_sale", "catalog_rental"],
      "Mantelería completa (manteles, caminos de mesa, servilletas) con proveedor verificado.",
      { minPriceCop: 18000 },
    ),
    capability(
      "table_setting",
      50,
      ["catalog_sale"],
      "Vajilla y cubertería decorativa con proveedor verificado.",
      { minPriceCop: 8000 },
    ),
    capability(
      "centerpiece",
      65,
      ["catalog_sale", "catalog_rental"],
      "Centros de mesa (florales, de candelabros, mixtos) con proveedor verificado.",
      { minPriceCop: 55000, sampleOfferIds: ["OFR-CENTER-0001"] },
    ),
    capability(
      "ambient_light",
      70,
      ["catalog_rental"],
      "Iluminación ambiental suspendida/colgante (guirnaldas de luz, lámparas) con proveedor de alquiler verificado.",
      { minPriceCop: 40000, sampleOfferIds: ["OFR-LIGHT-AMBIENT-0001"] },
    ),
    capability(
      "floor_light",
      35,
      ["catalog_rental"],
      "Iluminación de piso (faroles, velas LED de exterior) con proveedor de alquiler verificado.",
      { minPriceCop: 15000 },
    ),
    capability(
      "welcome_signage",
      20,
      ["catalog_sale"],
      "Señalización de bienvenida (caballetes, tableros) con proveedor verificado; el texto se compone en fase determinista aparte.",
      { minPriceCop: 70000 },
    ),
    capability(
      "plinth_pedestal",
      28,
      ["catalog_sale", "catalog_rental"],
      "Pedestales y plintos decorativos con proveedor verificado.",
      { minPriceCop: 25000 },
    ),
    capability(
      "service_support",
      15,
      ["catalog_rental"],
      "Estructuras de soporte de servicio (bases ocultas, contrapesos) con proveedor de alquiler verificado.",
      { minPriceCop: 20000 },
    ),
  ],
};

export const CATALOG_CAPABILITY_SNAPSHOTS: CatalogCapabilitySnapshot[] = [
  CATALOG_SNAPSHOT_CURRENT,
  CATALOG_SNAPSHOT_RICH_VERIFIED,
];

export function findCatalogSnapshot(snapshotId: string): CatalogCapabilitySnapshot {
  const snapshot = CATALOG_CAPABILITY_SNAPSHOTS.find((item) => item.snapshotId === snapshotId);
  if (!snapshot) {
    throw new Error(`Snapshot de catálogo desconocido en fixtures: ${snapshotId}`);
  }
  return snapshot;
}

export function capabilityFor(
  snapshot: CatalogCapabilitySnapshot,
  functionId: SceneFunctionId,
): CatalogFunctionCapability | undefined {
  return snapshot.functionCapabilities.find((item) => item.function === functionId);
}

/**
 * Fixture de "ciclo de vida de oferta" para el escenario E2E-7 (oferta
 * comercial modificada/expirada después de aprobar un plan). No implementa
 * todavía la invalidación real de `selection_hash`/`quote_hash` (eso
 * corresponde a Olas posteriores) — solo registra los dos estados
 * (aprobado / revisado) de una misma oferta para que `eval-scene-baseline.ts`
 * pueda demostrar que la huella de la oferta cambia.
 */
export type OfferLifecycleFixture = {
  offerLifecycleId: string;
  function: SceneFunctionId;
  itemId: string;
  offerId: string;
  approvedAt: string;
  initialOffer: {
    snapshotId: string;
    priceCop: number;
    status: "PRICED" | "QUOTE_REQUIRED" | "UNAVAILABLE";
    verifiedAt: string;
  };
  revisedOffer: {
    snapshotId: string;
    priceCop: number;
    status: "PRICED" | "QUOTE_REQUIRED" | "UNAVAILABLE";
    verifiedAt: string;
    changeReason: string;
  };
};

export const OFFER_LIFECYCLE_FIXTURES: OfferLifecycleFixture[] = [
  {
    offerLifecycleId: "altar_frame_offer_lifecycle_v1",
    function: "altar_frame",
    itemId: "ITEM-ALTAR-STRUCTURE-001",
    offerId: "OFR-ALTAR-0001",
    approvedAt: "2026-08-22T15:00:00.000Z",
    initialOffer: {
      snapshotId: "catalog-snapshot-rich-verified-fixture-v1",
      priceCop: 380000,
      status: "PRICED",
      verifiedAt: "2026-08-22T09:00:00.000Z",
    },
    revisedOffer: {
      snapshotId: "catalog-snapshot-rich-verified-fixture-v1-r2",
      priceCop: 460000,
      status: "PRICED",
      verifiedAt: "2026-08-23T11:30:00.000Z",
      changeReason: "El proveedor actualizó la tarifa de alquiler del arco de altar después de la aprobación.",
    },
  },
];

export function findOfferLifecycleFixture(offerLifecycleId: string): OfferLifecycleFixture {
  const fixture = OFFER_LIFECYCLE_FIXTURES.find((item) => item.offerLifecycleId === offerLifecycleId);
  if (!fixture) {
    throw new Error(`Fixture de ciclo de vida de oferta desconocido: ${offerLifecycleId}`);
  }
  return fixture;
}
