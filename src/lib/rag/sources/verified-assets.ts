/**
 * Capa de consulta "solo fuentes verificadas" (Tarea 03.2 —
 * `PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md`, secciones 6, 7.4, 8.2 y 9).
 *
 * Esto es lo que el RAG por slot (Plan 04, todavía no implementado) usará
 * para nunca traer un candidato sin fuente real: dado un conjunto de
 * `SceneFunctionV3`, devuelve exclusivamente `CatalogItemV3` +
 * `CommercialOfferV1` con:
 *   - una fila en `catalog_product_capabilities` que declare esa función
 *     (con evidencia y confianza — nunca inferencia libre de un LLM aquí);
 *   - una oferta en `catalog_commercial_offers` con
 *     `status IN ('PRICED', 'QUOTE_REQUIRED')`;
 *   - una fila en `catalog_sources` con `status = 'active'` y
 *     `verified_at IS NOT NULL` para esa oferta (sección 6.4: "Venta y
 *     alquiler requieren offer_id, snapshot, medio de identidad y precio
 *     verificable").
 *
 * DISTINCIÓN EXIGIDA por la Tarea 03.2: "no hay fila" vs. "hay fila pero sin
 * oferta verificada" — ver `SceneFunctionCoverageResult`. Esto es lo que le
 * permite a `scripts/audit-scene-catalog.ts` reportar brechas con razón
 * precisa (¿nadie etiquetó ningún producto con esta función? ¿o sí, pero
 * ninguno tiene oferta comercial verificada?) en vez de un mensaje genérico.
 *
 * Este módulo NUNCA escribe en Postgres — solo lee. Y nunca "completa" un
 * campo faltante con un valor supuesto: si un dato no está en las tablas de
 * la Tarea 02.1 (`012_scene_catalog.sql`), el asset correspondiente
 * simplemente no puede reconstruirse como `CatalogItemV3` válido y se omite
 * (ver `buildCatalogItem` más abajo).
 */

import { createHash } from "node:crypto";
import type { Pool } from "pg";
import {
  CatalogItemV3Schema,
  CommercialOfferV1Schema,
  type CatalogItemV3,
  type CommercialOfferV1,
} from "@/lib/rag/catalog/scene-asset-schema";

/** Acepta tanto `Pool` como `PoolClient` (mismo patrón que `src/lib/plan/resolver.ts`) — solo se necesita `.query`. */
export type Queryable = Pick<Pool, "query">;

/**
 * Umbral mínimo de confianza (`catalog_product_capabilities.confidence`,
 * sección 5.3/8.1) para que una capacidad candidata cuente como cobertura
 * real de un slot. Por debajo de este umbral, la capacidad existe como dato
 * (fue derivada por `scripts/enrich-scene-capabilities.ts`, Tarea 03.1) pero
 * es demasiado incierta para ofrecerse como candidato elegible — se trata
 * como si la fila de capacidad no existiera para efectos de esta consulta,
 * nunca se "redondea hacia arriba".
 */
export const DEFAULT_MIN_CAPABILITY_CONFIDENCE = 0.5;

export type VerifiedAssetsQuery = {
  /** Una o más `SceneFunctionV3` (sección 5.3) a buscar. Muchos-a-muchos: un item puede matchear más de una. */
  sceneFunctions: readonly string[];
  /** ISO 8601. Instante contra el que se evalúa `valid_from`/`valid_until` de la oferta. Default: ahora. */
  asOf?: string;
  /** Filtro de área de servicio (sección 9.2: "ciudad/área de servicio... cuando aplique"). Si se omite, no filtra por ciudad. */
  city?: string;
  minConfidence?: number;
};

export type VerifiedCatalogAsset = {
  item: CatalogItemV3;
  offer: CommercialOfferV1;
  /** A cuál de las `sceneFunctions` pedidas corresponde este match (una fila de `catalog_product_capabilities`). */
  matchedFunction: string;
  confidence: number;
  evidence: string;
};

/**
 * Resultado por función — la distinción de tres estados que exige la Tarea
 * 03.2. `NO_CAPABILITY_ROW` y `CAPABILITY_ROWS_NO_VERIFIED_OFFER` son las dos
 * formas de "brecha" que un auditor debe reportar con razones DISTINTAS
 * (nadie etiquetó nada vs. hay candidatos pero ninguno tiene fuente
 * verificada) — nunca colapsarlas en un solo "sin cobertura" genérico.
 */
export type SceneFunctionCoverageResult =
  | { sceneFunction: string; status: "NO_CAPABILITY_ROW" }
  | {
      sceneFunction: string;
      status: "CAPABILITY_ROWS_NO_VERIFIED_OFFER";
      candidateItemCount: number;
      candidateItemIds: string[];
    }
  | { sceneFunction: string; status: "VERIFIED"; assets: VerifiedCatalogAsset[] };

// ---------------------------------------------------------------------------
// Filas crudas de Postgres
// ---------------------------------------------------------------------------

type CapabilityRow = {
  item_id: string;
  scene_function: string;
  confidence: string; // NUMERIC llega como string desde `pg`
  evidence: string;
};

type OfferRow = {
  offer_id: string;
  item_id: string;
  variant_id: string | null;
  source_id: string;
  snapshot_id: string;
  verified_at: string;
  source_class: "catalog_sale" | "catalog_rental";
  status: "PRICED" | "QUOTE_REQUIRED" | "UNAVAILABLE";
  availability_status: "available" | "limited" | "unavailable";
  availability_checked_at: string;
  service_area_country: string | null;
  service_area_cities: string[];
  service_area_radius_km: string | null;
  valid_from: string | null;
  valid_until: string | null;
  rental_minimum_periods: number | null;
  rental_period_unit: "event" | "day" | null;
  minimum_quantity: number | null;
};

type PriceComponentRow = {
  offer_id: string;
  price_type: "unit_sale" | "package_sale" | "rental_period" | "service_fee";
  component_kind: "product" | "deposit" | "transport" | "installation" | "labor";
  amount_cop: number;
  refundable: boolean;
  period_unit: "event" | "day" | null;
  valid_from: string | null;
  valid_until: string | null;
};

type ItemShapeRow = {
  item_id: string;
  category_v3: string | null;
  product_id: string;
  variant_id: string | null;
  product_image_urls: string[] | null;
  variant_image_url: string | null;
  width_cm: string | null;
  height_cm: string | null;
  depth_cm: string | null;
  weight_kg: string | null;
  indoor_outdoor: string[] | null;
  requires_support: string[] | null;
  supports: string[] | null;
  mounting: string[] | null;
};

// ---------------------------------------------------------------------------
// Reconstrucción de CatalogItemV3 / CommercialOfferV1 desde filas SQL
// ---------------------------------------------------------------------------

/** Hash estable de una URL de imagen (nunca la URL cruda) — mismo criterio que `MediaRef.source_url_hash` (scene-asset-schema.ts). */
function hashImageUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

function buildMediaRefs(row: ItemShapeRow): CatalogItemV3["media_refs"] {
  const urls: string[] = [];
  if (row.variant_image_url) {
    urls.push(row.variant_image_url);
  }
  for (const url of row.product_image_urls ?? []) {
    if (!urls.includes(url)) urls.push(url);
  }
  return urls.map((url, index) => ({
    id: `img-${hashImageUrl(url).slice(0, 16)}`,
    role: index === 0 ? "identity" : "detail",
    source_url_hash: hashImageUrl(url),
  }));
}

function toNumberOrUndefined(value: string | null): number | undefined {
  if (value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Reconstruye un `CatalogItemV3` a partir de las filas de
 * `catalog_items`/`catalog_products`/`catalog_variants`/`catalog_product_spatial`
 * y las capacidades de función YA FILTRADAS a las que fueron pedidas en esta
 * consulta (`scene_functions` del resultado NO es necesariamente la lista
 * completa de funciones del item en la base — es una vista con alcance a
 * esta consulta, suficiente para elegibilidad de slot; ver nota de diseño
 * arriba del archivo). Devuelve `undefined` si los datos no alcanzan a
 * formar un `CatalogItemV3` válido (p. ej. `category_v3` ausente o fuera de
 * la taxonomía V3) — NUNCA rellena con un valor inventado.
 */
function buildCatalogItem(row: ItemShapeRow, capabilities: CapabilityRow[]): CatalogItemV3 | undefined {
  const candidate = {
    item_id: row.item_id,
    category_v3: row.category_v3 ?? undefined,
    media_refs: buildMediaRefs(row),
    scene_functions: capabilities
      .filter((c) => c.item_id === row.item_id)
      .map((c) => ({
        function: c.scene_function,
        confidence: Number(c.confidence),
        evidence: c.evidence,
      })),
    dimensions: {
      width_cm: toNumberOrUndefined(row.width_cm),
      height_cm: toNumberOrUndefined(row.height_cm),
      depth_cm: toNumberOrUndefined(row.depth_cm),
      weight_kg: toNumberOrUndefined(row.weight_kg),
    },
    compatibility: {
      indoor_outdoor: row.indoor_outdoor && row.indoor_outdoor.length > 0 ? row.indoor_outdoor : undefined,
      requires_support: row.requires_support && row.requires_support.length > 0 ? row.requires_support : undefined,
      supports: row.supports && row.supports.length > 0 ? row.supports : undefined,
      mounting: row.mounting && row.mounting.length > 0 ? row.mounting : undefined,
    },
  };
  // dimensions completamente vacío (sin ninguna medida) se omite en vez de
  // enviar un objeto `{}` — CatalogItemV3.dimensions es opcional (sección
  // 7.3: "una fila faltante significa 'dimensiones desconocidas', nunca
  // 'cero'", comentario de la migración 012).
  const dims = candidate.dimensions;
  const hasAnyDimension = dims.width_cm !== undefined || dims.height_cm !== undefined || dims.depth_cm !== undefined || dims.weight_kg !== undefined;
  const shaped = { ...candidate, dimensions: hasAnyDimension ? dims : undefined };

  const parsed = CatalogItemV3Schema.safeParse(shaped);
  return parsed.success ? parsed.data : undefined;
}

function buildCommercialOffer(offer: OfferRow, priceComponents: PriceComponentRow[]): CommercialOfferV1 | undefined {
  const candidate = {
    offer_id: offer.offer_id,
    item_id: offer.item_id,
    variant_id: offer.variant_id ?? undefined,
    source_ref: {
      source_id: offer.source_id,
      snapshot_id: offer.snapshot_id,
      verified_at: offer.verified_at,
    },
    source_class: offer.source_class,
    status: offer.status,
    availability: {
      status: offer.availability_status,
      checked_at: offer.availability_checked_at,
    },
    service_area: offer.service_area_country
      ? {
          country: offer.service_area_country,
          cities: offer.service_area_cities.length > 0 ? offer.service_area_cities : undefined,
          radius_km: toNumberOrUndefined(offer.service_area_radius_km),
        }
      : undefined,
    valid_from: offer.valid_from ?? undefined,
    valid_until: offer.valid_until ?? undefined,
    rental_period_rules:
      offer.rental_minimum_periods !== null && offer.rental_period_unit !== null
        ? { minimum_periods: offer.rental_minimum_periods, period_unit: offer.rental_period_unit }
        : undefined,
    minimum_quantity: offer.minimum_quantity ?? undefined,
    price_components: priceComponents
      .filter((p) => p.offer_id === offer.offer_id)
      .map((p) => ({
        type: p.price_type,
        amount_cop: p.amount_cop,
        service_fee_kind: p.price_type === "service_fee" ? mapComponentKindToServiceFeeKind(p.component_kind) : undefined,
        refundable: p.refundable,
      })),
  };
  const parsed = CommercialOfferV1Schema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function mapComponentKindToServiceFeeKind(
  kind: PriceComponentRow["component_kind"],
): "deposit" | "transport" | "setup" | "labor" | "other" {
  switch (kind) {
    case "deposit":
      return "deposit";
    case "transport":
      return "transport";
    case "installation":
      return "setup";
    case "labor":
      return "labor";
    default:
      return "other";
  }
}

// ---------------------------------------------------------------------------
// Consulta principal
// ---------------------------------------------------------------------------

/**
 * Para cada función pedida, determina si hay cobertura comercial VERIFICADA
 * en Postgres. No consulta `venue_existing` ni `context_non_quotable`: esas
 * dos clases de fuente se confirman por evento concreto (foto/instrucción
 * del usuario), no por catálogo — no son auditables desde esta capa. Un slot
 * cuyo `allowed_sources` incluye `venue_existing` puede terminar cubierto en
 * producción sin pasar por esta función; el auditor de catálogo (Tarea 03.2,
 * `scripts/audit-scene-catalog.ts`) debe reportarlo como "posible con
 * venue_existing, sin evidencia de catálogo" y no como cobertura confirmada
 * — inventar esa confirmación aquí violaría la sección 6.4.
 */
export async function queryVerifiedAssetsForFunctions(
  pool: Queryable,
  query: VerifiedAssetsQuery,
): Promise<Map<string, SceneFunctionCoverageResult>> {
  const sceneFunctions = Array.from(new Set(query.sceneFunctions));
  const asOf = query.asOf ?? new Date().toISOString();
  const minConfidence = query.minConfidence ?? DEFAULT_MIN_CAPABILITY_CONFIDENCE;
  const results = new Map<string, SceneFunctionCoverageResult>();

  if (sceneFunctions.length === 0) {
    return results;
  }

  // 1. Capacidades candidatas por función pedida (sección 5.3/8.1).
  const capabilityRes = await pool.query<CapabilityRow>(
    `SELECT item_id, scene_function, confidence::text AS confidence, evidence
       FROM catalog_product_capabilities
      WHERE scene_function = ANY($1) AND confidence >= $2`,
    [sceneFunctions, minConfidence],
  );
  const capabilitiesByFunction = new Map<string, CapabilityRow[]>();
  for (const row of capabilityRes.rows) {
    const list = capabilitiesByFunction.get(row.scene_function) ?? [];
    list.push(row);
    capabilitiesByFunction.set(row.scene_function, list);
  }

  const allCandidateItemIds = Array.from(new Set(capabilityRes.rows.map((r) => r.item_id)));

  // Funciones sin NINGUNA fila de capacidad: NO_CAPABILITY_ROW inmediato.
  for (const fn of sceneFunctions) {
    if (!capabilitiesByFunction.has(fn)) {
      results.set(fn, { sceneFunction: fn, status: "NO_CAPABILITY_ROW" });
    }
  }
  if (allCandidateItemIds.length === 0) {
    return results;
  }

  // 2. De esos candidatos, ¿cuáles tienen oferta verificada (fuente activa +
  //    verificada, status comercial válido, vigente a `asOf`, área de
  //    servicio compatible si se pidió ciudad)?
  const offerRes = await pool.query<OfferRow>(
    `SELECT o.offer_id, o.item_id, o.variant_id, o.source_id, o.snapshot_id, o.verified_at::text AS verified_at,
            o.source_class, o.status, o.availability_status, o.availability_checked_at::text AS availability_checked_at,
            o.service_area_country, o.service_area_cities, o.service_area_radius_km::text AS service_area_radius_km,
            o.valid_from::text AS valid_from, o.valid_until::text AS valid_until,
            o.rental_minimum_periods, o.rental_period_unit, o.minimum_quantity
       FROM catalog_commercial_offers o
       JOIN catalog_sources s ON s.source_id = o.source_id
      WHERE o.item_id = ANY($1)
        AND o.status IN ('PRICED', 'QUOTE_REQUIRED')
        AND s.status = 'active'
        AND s.verified_at IS NOT NULL
        AND (o.valid_from IS NULL OR o.valid_from <= $2::timestamptz)
        AND (o.valid_until IS NULL OR o.valid_until >= $2::timestamptz)
        AND ($3::text IS NULL OR o.service_area_cities = '{}' OR $3 = ANY(o.service_area_cities))`,
    [allCandidateItemIds, asOf, query.city ?? null],
  );

  const verifiedItemIds = Array.from(new Set(offerRes.rows.map((o) => o.item_id)));

  // Funciones con capacidad pero sin NINGÚN item verificado: CAPABILITY_ROWS_NO_VERIFIED_OFFER.
  for (const [fn, rows] of capabilitiesByFunction.entries()) {
    const hasVerified = rows.some((r) => verifiedItemIds.includes(r.item_id));
    if (!hasVerified) {
      const distinctItemIds = Array.from(new Set(rows.map((r) => r.item_id)));
      results.set(fn, {
        sceneFunction: fn,
        status: "CAPABILITY_ROWS_NO_VERIFIED_OFFER",
        candidateItemCount: distinctItemIds.length,
        candidateItemIds: distinctItemIds,
      });
    }
  }

  if (verifiedItemIds.length === 0) {
    return results;
  }

  // 3. Componentes de precio de las ofertas verificadas.
  const offerIds = offerRes.rows.map((o) => o.offer_id);
  const priceRes = await pool.query<PriceComponentRow>(
    `SELECT offer_id, price_type, component_kind, amount_cop, refundable, period_unit,
            valid_from::text AS valid_from, valid_until::text AS valid_until
       FROM catalog_price_components
      WHERE offer_id = ANY($1)`,
    [offerIds],
  );

  // 4. Forma física de los items con oferta verificada.
  const shapeRes = await pool.query<ItemShapeRow>(
    `SELECT ci.item_id, ci.category_v3, ci.product_id, ci.variant_id,
            p.image_urls AS product_image_urls, v.image_url AS variant_image_url,
            sp.width_cm::text AS width_cm, sp.height_cm::text AS height_cm, sp.depth_cm::text AS depth_cm,
            sp.weight_kg::text AS weight_kg, sp.indoor_outdoor, sp.requires_support, sp.supports, sp.mounting
       FROM catalog_items ci
       JOIN catalog_products p ON p.product_id = ci.product_id
       LEFT JOIN catalog_variants v ON v.variant_id = ci.variant_id
       LEFT JOIN catalog_product_spatial sp ON sp.item_id = ci.item_id
      WHERE ci.item_id = ANY($1)`,
    [verifiedItemIds],
  );
  const shapeByItemId = new Map(shapeRes.rows.map((r) => [r.item_id, r]));

  // 5. Ensamblar VerifiedCatalogAsset por función, solo con items+ofertas que sí validan como Zod completos.
  for (const [fn, rows] of capabilitiesByFunction.entries()) {
    if (results.has(fn)) continue; // ya resuelto como NO_CAPABILITY_ROW o CAPABILITY_ROWS_NO_VERIFIED_OFFER arriba.
    const assets: VerifiedCatalogAsset[] = [];
    for (const capability of rows) {
      const shapeRow = shapeByItemId.get(capability.item_id);
      if (!shapeRow) continue;
      const item = buildCatalogItem(shapeRow, capabilityRes.rows);
      if (!item) continue;
      const offersForItem = offerRes.rows.filter((o) => o.item_id === capability.item_id);
      for (const offerRow of offersForItem) {
        const offer = buildCommercialOffer(offerRow, priceRes.rows);
        if (!offer) continue;
        assets.push({
          item,
          offer,
          matchedFunction: fn,
          confidence: Number(capability.confidence),
          evidence: capability.evidence,
        });
      }
    }
    results.set(fn, assets.length > 0 ? { sceneFunction: fn, status: "VERIFIED", assets } : {
      sceneFunction: fn,
      status: "CAPABILITY_ROWS_NO_VERIFIED_OFFER",
      candidateItemCount: new Set(rows.map((r) => r.item_id)).size,
      candidateItemIds: Array.from(new Set(rows.map((r) => r.item_id))),
    });
  }

  return results;
}

/** Envoltorio para una sola función — conveniencia sobre `queryVerifiedAssetsForFunctions`. */
export async function queryVerifiedAssetsForFunction(
  pool: Queryable,
  sceneFunction: string,
  options: Omit<VerifiedAssetsQuery, "sceneFunctions"> = {},
): Promise<SceneFunctionCoverageResult> {
  const results = await queryVerifiedAssetsForFunctions(pool, { ...options, sceneFunctions: [sceneFunction] });
  return results.get(sceneFunction) ?? { sceneFunction, status: "NO_CAPABILITY_ROW" };
}
