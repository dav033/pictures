import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CatalogSelectionRequestV1Schema,
  CatalogSelectionResultV1Schema,
  DomainContractSchemas,
  PlanResueltoV1Schema,
  QuoteV1Schema,
} from "../src/lib/ia/contracts/domain-v1";
import {
  HappiePackageV1Schema,
  HappieRecommendationRequestV1Schema,
  HappieRecommendationResponseV1Schema,
} from "../src/lib/ia/contracts/happie-v1";
import { MaterialEstimateSchema } from "../src/lib/materiales/estimacion";
import { PlanDecoracionSchema } from "../src/lib/plan/tipos";

const fixtureDirectory = path.join(process.cwd(), "contracts", "domain", "v1", "fixtures");

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(fixtureDirectory, name), "utf8")) as unknown;
}

const request = CatalogSelectionRequestV1Schema.parse(fixture("catalog-selection-request.json"));
const result = CatalogSelectionResultV1Schema.parse(fixture("catalog-selection-result.json"));
assert.equal(request.request_id, result.request_id);
assert.equal(result.total_cop, 288000);
assert.equal(result.status, "partial");

const plan = PlanDecoracionSchema.parse(fixture("plan-decoracion-ok.json"));
assert.equal(plan.plan_version, "1.0");

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
