/**
 * Auditoría de brechas de catálogo por receta (Tarea 03.2 —
 * `PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md`, Plan 03 / sección 11).
 *
 * Para una receta registrada (`src/lib/scene/recipes.ts`) y un perfil de
 * complejidad, expande la receta a un `SceneProgramV1`
 * (`expandIntentToProgram`) y, para CADA slot, consulta
 * `src/lib/rag/sources/verified-assets.ts` contra Postgres para saber si
 * existe cobertura comercial REAL (venta/alquiler verificados). Nunca
 * inventa una fuente para tapar una brecha: si el catálogo no alcanza, el
 * script lista exactamente qué tipo de fuente falta por slot y termina con
 * código de salida distinto de cero — ese es el comportamiento esperado
 * mientras el catálogo real siga limitado (sección 2.2), no un bug del
 * script.
 *
 * Reutiliza el motor de recetas y cobertura real de la Tarea 01.2
 * (`expandIntentToProgram` + `computeCoverageReport`) en vez de reinventar
 * la lógica de cobertura — el `SceneCoverageReport` que produce
 * `computeCoverageReport` es la fuente de verdad para status/perfil
 * logrado/cobertura ponderada. Lo único que este script agrega por encima
 * es, por cada `required_gap`, una razón MÁS PRECISA que la genérica de
 * `computeCoverageReport` (que no distingue "nadie etiquetó nada" de "hay
 * candidatos pero ninguno tiene oferta verificada") — usando directamente
 * el `SceneFunctionCoverageResult` de `verified-assets.ts`, que sí hace esa
 * distinción.
 *
 * Uso:
 *   npx tsx scripts/audit-scene-catalog.ts --recipe wedding-ceremony-garden@1 --require-balanced
 *   npx tsx scripts/audit-scene-catalog.ts --recipe wedding_ceremony_garden@1 --require-focal-only
 *   npx tsx scripts/audit-scene-catalog.ts --recipe wedding_ceremony_garden@1 --require-balanced --city Bogotá
 *
 * Flags de perfil (mutuamente excluyentes; default: --require-balanced,
 * porque la sección 5.1 fija `balanced_scene` como "valor predeterminado
 * para 'boda'"):
 *   --require-focal-only | --require-balanced | --require-immersive | --require-full-event
 *
 * --mock-rich-catalog: SOLO para verificación/pruebas de este script (ver
 * Tarea 03.2, paso de verificación 2: "confirma... que el mismo script SÍ
 * termina en código 0 cuando la cobertura comercial es completa"). Sustituye
 * la consulta real a Postgres por activos sintéticos, CLARAMENTE marcados
 * como simulación (provider_name = "MOCK...", item_id con prefijo "mock-",
 * banner de advertencia en stderr). Nunca se debe invocar en una auditoría
 * real — existe únicamente para demostrar que el script no está siempre
 * retornando distinto-de-cero sin importar los datos.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { Pool } from "pg";
import { expandIntentToProgram, findSceneRecipe, listRegisteredSceneRecipeIds } from "../src/lib/scene/recipes";
import { computeCoverageReport } from "../src/lib/scene/coverage";
import type { ComplexityProfile, EventIntentV2, SceneSlot, SlotCandidate, SupplySourceClass } from "../src/lib/scene/tipos";
import {
  queryVerifiedAssetsForFunction,
  type Queryable,
  type SceneFunctionCoverageResult,
  type VerifiedCatalogAsset,
} from "../src/lib/rag/sources/verified-assets";
import type { CatalogItemV3, CommercialOfferV1 } from "../src/lib/rag/catalog/scene-asset-schema";

for (const archivo of [".env.local", ".env"]) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

type ParsedArgs = {
  recipeId: string;
  profile: ComplexityProfile;
  city?: string;
  asOf?: string;
  mockRichCatalog: boolean;
};

const PROFILE_FLAGS: Record<string, ComplexityProfile> = {
  "--require-focal-only": "focal_only",
  "--require-balanced": "balanced_scene",
  "--require-immersive": "immersive_scene",
  "--require-full-event": "full_event",
};

function parseArgs(argv: readonly string[]): ParsedArgs {
  let recipeId: string | undefined;
  let profile: ComplexityProfile | undefined;
  let city: string | undefined;
  let asOf: string | undefined;
  let mockRichCatalog = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--recipe") {
      recipeId = argv[i + 1];
      i += 1;
    } else if (arg === "--city") {
      city = argv[i + 1];
      i += 1;
    } else if (arg === "--as-of") {
      asOf = argv[i + 1];
      i += 1;
    } else if (arg === "--mock-rich-catalog") {
      mockRichCatalog = true;
    } else if (arg && PROFILE_FLAGS[arg]) {
      if (profile) {
        throw new Error(`Flags de perfil mutuamente excluyentes: ya se pidió "${profile}", no se puede agregar "${arg}"`);
      }
      profile = PROFILE_FLAGS[arg];
    }
  }

  if (!recipeId) {
    throw new Error(
      `Falta --recipe <recipeId>. Recetas registradas: ${listRegisteredSceneRecipeIds().join(", ") || "(ninguna)"}`,
    );
  }

  // Perfil por defecto: balanced_scene (sección 5.1: "valor predeterminado para 'boda'").
  return { recipeId, profile: profile ?? "balanced_scene", city, asOf, mockRichCatalog };
}

// ---------------------------------------------------------------------------
// Intención sintética de auditoría
//
// El auditor no representa a un usuario real: solo necesita una
// `EventIntentV2` mínima y válida para expandir la receta al perfil pedido.
// No lleva presupuesto, fecha ni ubicación reales -- una auditoría de
// catálogo evalúa qué EXISTE, no cuánto costaría un evento concreto (eso es
// Plan 05). `--city`, si se pasa, solo filtra `verified-assets.ts` por área
// de servicio; no se refleja en la intención en sí.
// ---------------------------------------------------------------------------

function buildAuditIntent(profile: ComplexityProfile, requestedViews: EventIntentV2["requested_views"]): EventIntentV2 {
  return {
    schema_version: "event-intent-v2",
    event_type: "wedding",
    event_scope: "ceremony",
    requested_views: requestedViews,
    complexity_requested: profile,
    venue: { existing_asset_refs: [] },
    palette: [],
    style_terms: [],
    hard_constraints: [],
  };
}

// ---------------------------------------------------------------------------
// Mock de catálogo rico (--mock-rich-catalog) -- SOLO para verificación.
// ---------------------------------------------------------------------------

function mockVerifiedCoverageForFunction(sceneFunction: string): SceneFunctionCoverageResult {
  const itemId = `mock-item-${sceneFunction}`;
  const offerId = `mock-offer-${sceneFunction}`;
  const item: CatalogItemV3 = {
    item_id: itemId,
    category_v3: "furniture",
    media_refs: [],
    scene_functions: [
      {
        // El auditor recibe `slot.function` como `string` genérico (SceneSlot.function no está acotado al
        // enum SceneFunctionV3 en tipos.ts); en la práctica toda receta registrada usa valores de esa
        // taxonomía, así que el cast es seguro aquí -- este mock nunca se usa fuera de --mock-rich-catalog.
        function: sceneFunction as CatalogItemV3["scene_functions"][number]["function"],
        confidence: 1,
        evidence: "mock-rich-catalog: fixture sintético de verificación",
      },
    ],
    compatibility: {},
  };
  const offer: CommercialOfferV1 = {
    offer_id: offerId,
    item_id: itemId,
    source_ref: { source_id: "mock-source", snapshot_id: "mock-snapshot-1", verified_at: new Date().toISOString() },
    source_class: "catalog_sale",
    status: "PRICED",
    availability: { status: "available", checked_at: new Date().toISOString() },
    price_components: [{ type: "unit_sale", amount_cop: 50000 }],
  };
  const asset: VerifiedCatalogAsset = { item, offer, matchedFunction: sceneFunction, confidence: 1, evidence: "mock-rich-catalog" };
  return { sceneFunction, status: "VERIFIED", assets: [asset] };
}

// ---------------------------------------------------------------------------
// SlotCandidate a partir de un SceneFunctionCoverageResult
// ---------------------------------------------------------------------------

function candidatesFromCoverage(slotId: string, coverage: SceneFunctionCoverageResult): SlotCandidate[] {
  if (coverage.status !== "VERIFIED") return [];
  return coverage.assets.map((asset) => {
    const supply_binding: SlotCandidate["supply_binding"] =
      asset.offer.source_class === "catalog_sale"
        ? { kind: "sale", item_id: asset.item.item_id, offer_id: asset.offer.offer_id, snapshot_id: asset.offer.source_ref.snapshot_id }
        : // periods=1: el auditor de catálogo no conoce el período real de un evento concreto (eso es
          // Plan 05/una EventIntentV2 real con rental_period). Este placeholder solo sirve para que la
          // forma de SupplyBinding sea válida dentro de esta auditoría de EXISTENCIA -- nunca se usa
          // para cotizar ni se persiste como una selección real.
          { kind: "rental", item_id: asset.item.item_id, offer_id: asset.offer.offer_id, snapshot_id: asset.offer.source_ref.snapshot_id, periods: 1 };
    return {
      slot_id: slotId,
      item: asset.item,
      offer: asset.offer,
      supply_binding,
      retrieval: { lexical: 0, semantic: 0, rerank: 0 },
      eligibility: {
        pass: true,
        reasons: [
          `oferta verificada ${asset.offer.offer_id} (fuente activa+verificada, snapshot ${asset.offer.source_ref.snapshot_id}), función "${asset.matchedFunction}" con confianza ${asset.confidence}`,
        ],
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Mensaje de brecha preciso a partir de SceneFunctionCoverageResult
// ---------------------------------------------------------------------------

function commercialSourcesOf(allowedSources: readonly SupplySourceClass[]): SupplySourceClass[] {
  return allowedSources.filter((s): s is "catalog_sale" | "catalog_rental" => s === "catalog_sale" || s === "catalog_rental");
}

function preciseGapDescription(slot: SceneSlot, coverage: SceneFunctionCoverageResult | undefined): string {
  const commercial = commercialSourcesOf(slot.allowed_sources);
  const allowsVenueExisting = slot.allowed_sources.includes("venue_existing");
  const venueNote = allowsVenueExisting
    ? " Este slot también admite venue_existing, pero eso solo se confirma con evidencia del lugar por evento concreto -- no es auditable desde el catálogo."
    : "";

  if (!coverage || coverage.status === "NO_CAPABILITY_ROW") {
    return commercial.length > 0
      ? `Ningún producto del catálogo está etiquetado con la función "${slot.function}" (0 filas en catalog_product_capabilities). ` +
          `Falta un proveedor de ${commercial.join("/")} para esta función.${venueNote}`
      : `Ningún producto del catálogo está etiquetado con la función "${slot.function}".${venueNote}`;
  }
  if (coverage.status === "CAPABILITY_ROWS_NO_VERIFIED_OFFER") {
    return (
      `Hay ${coverage.candidateItemCount} producto(s) etiquetado(s) con la función "${slot.function}" ` +
      `(${coverage.candidateItemIds.slice(0, 5).join(", ")}${coverage.candidateItemIds.length > 5 ? ", ..." : ""}), ` +
      `pero ninguno tiene una oferta comercial verificada (status PRICED/QUOTE_REQUIRED desde una catalog_sources activa y verificada). ` +
      `Falta completar la incorporación de un proveedor de ${commercial.join("/") || "venta/alquiler"} (ver docs/catalog/SCENE_SOURCE_ONBOARDING.md).${venueNote}`
    );
  }
  // status === "VERIFIED" no debería llegar aquí (no sería una brecha), pero se documenta por completitud.
  return `Cobertura verificada encontrada para "${slot.function}"; si este slot sigue en required_gaps, revisar la lógica de computeCoverageReport.`;
}

// ---------------------------------------------------------------------------
// Ejecución principal
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const recipe = findSceneRecipe(args.recipeId); // lanza con mensaje claro si el recipeId no existe.
  const requestedViews = Array.from(new Set(recipe.slots.map((s) => s.view_type)));
  const intent = buildAuditIntent(args.profile, requestedViews);
  const program = expandIntentToProgram(intent, args.recipeId);

  if (args.mockRichCatalog) {
    console.warn(
      "[WARN] --mock-rich-catalog activo: NO se está consultando Postgres. Esta corrida usa activos sintéticos " +
        "SOLO para verificar que el script puede terminar en código 0 -- no representa cobertura real. Nunca usar " +
        "este flag para reportar disponibilidad comercial real.",
    );
  }

  let pool: Pool | undefined;
  if (!args.mockRichCatalog) {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL es obligatoria (salvo con --mock-rich-catalog)");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }

  try {
    const coverageByFunction = new Map<string, SceneFunctionCoverageResult>();
    const candidatesBySlot: Record<string, SlotCandidate[]> = {};

    for (const slot of program.slots) {
      const coverage = args.mockRichCatalog
        ? mockVerifiedCoverageForFunction(slot.function)
        : await queryVerifiedAssetsForFunction(pool as Queryable, slot.function, { city: args.city, asOf: args.asOf });
      coverageByFunction.set(slot.function, coverage);
      candidatesBySlot[slot.slot_id] = candidatesFromCoverage(slot.slot_id, coverage);
    }

    const report = computeCoverageReport(program, candidatesBySlot, args.profile);

    // -------------------------------------------------------------------
    // Reporte legible
    // -------------------------------------------------------------------
    console.log(`\nAuditoría de catálogo de escena`);
    console.log(`  receta:              ${recipe.id}@${recipe.version} (${recipe.label})`);
    console.log(`  perfil solicitado:   ${report.requested_profile}`);
    console.log(`  perfil logrado:      ${report.achieved_profile}`);
    console.log(`  cobertura ponderada: ${(report.weighted_coverage * 100).toFixed(1)}%`);
    console.log(`  familias distintas:  ${report.distinct_families.length} (${report.distinct_families.join(", ") || "ninguna"})`);
    console.log(`  estado:              ${report.status}`);
    console.log(`  slots obligatorios cubiertos: ${report.required_covered.length} (${report.required_covered.join(", ") || "ninguno"})`);
    console.log(`  slots opcionales/condicionales cubiertos: ${report.optional_covered.length} (${report.optional_covered.join(", ") || "ninguno"})`);

    if (report.required_gaps.length === 0) {
      console.log(`\n[COMPLETE] Todos los slots obligatorios de "${recipe.id}@${recipe.version}" en perfil "${args.profile}" tienen cobertura comercial verificada.`);
    } else {
      console.log(`\nBrechas obligatorias (${report.required_gaps.length}):\n`);
      for (const gap of report.required_gaps) {
        const slot = program.slots.find((s) => s.slot_id === gap.slot_id);
        if (!slot) {
          console.log(`  - ${gap.slot_id}: ${gap.reason}`);
          continue;
        }
        const coverage = coverageByFunction.get(slot.function);
        console.log(`  - slot "${slot.slot_id}" (zona "${slot.zone}", función "${slot.function}", fuentes permitidas: ${slot.allowed_sources.join("/")}):`);
        console.log(`      ${preciseGapDescription(slot, coverage)}`);
      }
    }

    console.log("");
    process.exitCode = report.status === "COMPLETE" ? 0 : 1;
  } finally {
    await pool?.end();
  }
}

main().catch((error) => {
  console.error(`[FAIL] audit-scene-catalog — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
