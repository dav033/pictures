import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CATALOG_RECOMMENDATIONS_MAX_LORA_VARIANTS,
  PLAN_RESOLUTION_MAX_LORA_VARIANTS,
  PlanResolutionRequestV1Schema,
  CatalogRecommendationsRequestV1Schema,
  CatalogRecommendationsResultV1Schema,
  CatalogSelectionRequestV1Schema,
  CatalogSelectionResultV1Schema,
  DomainContractSchemas,
  PlanResueltoV1Schema,
  QuoteV1Schema,
} from "../../src/lib/ia/contracts/domain-v1";
import {
  HappiePackageV1Schema,
  HappieRecommendationRequestV1Schema,
  HappieRecommendationResponseV1Schema,
} from "../../src/lib/ia/contracts/happie-v1";
import { MaterialEstimateSchema } from "../../src/lib/materiales/estimacion";
import { PlanDecoracionSchema } from "../../src/lib/plan/tipos";

const fixtureDirectory = path.join(process.cwd(), "contracts", "domain", "v1", "fixtures");

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(fixtureDirectory, name), "utf8")) as unknown;
}

const request = CatalogSelectionRequestV1Schema.parse(fixture("catalog-selection-request.json"));
const result = CatalogSelectionResultV1Schema.parse(fixture("catalog-selection-result.json"));
assert.equal(result.operation_schema_version, "catalog-selection-result.v1");
assert.equal(result.total_cop, 288000);
assert.equal(result.status, "partial");

const recommendationsRequest = CatalogRecommendationsRequestV1Schema.parse(
  fixture("catalog-recommendations-request.json"),
);
assert.equal(recommendationsRequest.reference_variant_id, "var-rojo-12");
const recommendationsResult = CatalogRecommendationsResultV1Schema.parse(
  fixture("catalog-recommendations-result.json"),
);
assert.equal(recommendationsResult.operation_schema_version, "catalog-recommendations-result.v1");
assert.equal(recommendationsResult.candidates.length, 2);
assert.equal(recommendationsResult.candidates.flatMap((candidate) => candidate.variants).length, 3);
assert.ok(
  recommendationsResult.candidates.every((candidate) =>
    candidate.variants.every((variant) => variant.variant_id !== recommendationsResult.reference.variant_id),
  ),
);
const [firstRecommendation] = recommendationsResult.candidates;
assert.ok(firstRecommendation);
const [firstRecommendedVariant] = firstRecommendation.variants;
assert.ok(firstRecommendedVariant);
const withVariant = (variant: Record<string, unknown>) => ({
  ...recommendationsResult,
  candidates: [{ ...firstRecommendation, variants: [variant] }],
});
assert.throws(() => CatalogRecommendationsResultV1Schema.parse(withVariant({ ...firstRecommendedVariant, available: false })));
assert.throws(() => CatalogRecommendationsResultV1Schema.parse(withVariant({ ...firstRecommendedVariant, price: 0 })));
assert.throws(() => CatalogRecommendationsResultV1Schema.parse(withVariant({ ...firstRecommendedVariant, extra: true })));
assert.throws(() => CatalogRecommendationsResultV1Schema.parse({ ...recommendationsResult, extra: true }));
assert.throws(() =>
  CatalogRecommendationsResultV1Schema.parse({
    ...recommendationsResult,
    candidates: [{ ...firstRecommendation, variants: [] }],
  }),
);
assert.throws(() => CatalogRecommendationsRequestV1Schema.parse({ ...recommendationsRequest, lora_variant_ids: [] }));
assert.throws(() => CatalogRecommendationsRequestV1Schema.parse({ ...recommendationsRequest, limit: 101 }));
assert.throws(() => CatalogRecommendationsRequestV1Schema.parse({ ...recommendationsRequest, extra: true }));
const unrestrictedRequest = {
  schema_version: recommendationsRequest.schema_version,
  catalog_snapshot_id: recommendationsRequest.catalog_snapshot_id,
  reference_variant_id: recommendationsRequest.reference_variant_id,
  limit: recommendationsRequest.limit,
};
assert.equal(CatalogRecommendationsRequestV1Schema.parse(unrestrictedRequest).lora_variant_ids, undefined);

const plan = PlanDecoracionSchema.parse(fixture("plan-decoracion-ok.json"));
assert.equal(plan.plan_version, "1.0");

// The same LoRA dataset pool reaches plan resolution and recommendations, so
// both requests share one bound. 492 is the training_1 pool that broke 256.
assert.equal(PLAN_RESOLUTION_MAX_LORA_VARIANTS, CATALOG_RECOMMENDATIONS_MAX_LORA_VARIANTS);
const shopifyIds = (count: number) => Array.from({ length: count }, (_, index) => String(46_594_221_000_000 + index));
const planResolutionRequest = (loraVariantIds: string[]) => ({
  schema_version: "plan-resolution.v1",
  plan,
  allowlist: [{ product_id: "prod-rojo", variant_ids: ["var-rojo-12"] }],
  catalog_snapshot_id: "products_catalog:test",
  lora_variant_ids: loraVariantIds,
});
assert.equal(PlanResolutionRequestV1Schema.parse(planResolutionRequest(shopifyIds(492))).lora_variant_ids?.length, 492);
assert.equal(
  PlanResolutionRequestV1Schema.parse(planResolutionRequest(shopifyIds(PLAN_RESOLUTION_MAX_LORA_VARIANTS))).lora_variant_ids?.length,
  PLAN_RESOLUTION_MAX_LORA_VARIANTS,
);
assert.throws(() => PlanResolutionRequestV1Schema.parse(planResolutionRequest(shopifyIds(PLAN_RESOLUTION_MAX_LORA_VARIANTS + 1))));

const resolved = PlanResueltoV1Schema.parse(fixture("plan-resuelto-ok.json"));
assert.equal(resolved.plan_hash, "sha256:fixture-plan");
assert.equal(resolved.compras[0]?.variant_id, "var-rojo-12");

const estimate = MaterialEstimateSchema.parse(fixture("material-estimate-ok.json"));
assert.equal(estimate.version, "design-material-estimate-v1");

const quote = QuoteV1Schema.parse(fixture("quote-ok.json"));
assert.equal(quote.currency, "COP");
assert.equal(quote.total_cop, 12000);

const happiePackage = HappiePackageV1Schema.parse({
  id: "pkg-fixture",
  event_type_id: "event-fixture",
  name: "Paquete fixture",
  base_guests: 20,
  standard_duration_minutes: 180,
  conditions: null,
  restrictions: null,
  is_active: true,
  is_featured: false,
  package_items: [{
    id: "item-fixture",
    total: 120000,
    is_active: true,
    package_id: "pkg-fixture",
    charge_type: "fixed",
    description: "Decoración fixture",
    suggested_start_time: null,
    provider_name: null,
    category_name: "decoracion",
  }],
});
assert.equal(happiePackage.package_items[0]?.total, 120000);
const happieRequest = HappieRecommendationRequestV1Schema.parse({
  tipoEvento: "Cumpleaños",
  invitados: 20,
  presupuesto: 500000,
});
assert.equal(happieRequest.invitados, 20);
assert.throws(() => HappiePackageV1Schema.parse({ ...happiePackage, package_items: [{ ...happiePackage.package_items[0], total: -1 }] }));
assert.throws(() => HappieRecommendationResponseV1Schema.parse({ schema_version: "happie.v1", recomendaciones: [], resumen: "" }));

assert.ok(Object.keys(DomainContractSchemas).length >= 24);
assert.throws(() => CatalogSelectionRequestV1Schema.parse({ ...request, items: [] }));
assert.throws(() => QuoteV1Schema.parse({ ...quote, currency: "USD" }));
assert.throws(() => PlanDecoracionSchema.parse({ ...plan, estructuras: [] }));

console.log("Domain contracts: OK");
