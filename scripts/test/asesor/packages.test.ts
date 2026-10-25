import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyEventBrief, EventBriefSchema, parseEventBriefState, ADVISOR_ESTIMATE_NOTICE, type EventBriefState } from "../../../src/lib/asesor/contracts";
import type { HappiaCatalogueResult } from "../../../src/lib/asesor/catalogue";
import { proposeStandardPackage } from "../../../src/lib/asesor/packages";
import { applyAdvisorTool, ADVISOR_TOOLS, type BriefMutator } from "../../../src/lib/asesor/tools";

type Pkg = Extract<HappiaCatalogueResult, { status: "available" }>["data"]["packages"][number];

function pkg(id: string, extra: Record<string, unknown> = {}, items: { total: number; active?: boolean; charge_type?: string }[] = [{ total: 400000 }]): Pkg {
  return {
    id, event_type_id: "e1", name: `Paquete ${id}`, base_guests: 20, standard_duration_minutes: 120, conditions: null, restrictions: null,
    is_active: true, is_featured: false,
    package_items: items.map((item, index) => ({
      id: `${id}-i${index}`, total: item.total, is_active: item.active ?? true, package_id: id, charge_type: item.charge_type ?? "total", description: null,
      suggested_start_time: null, provider_name: null, category_name: null,
    })),
    ...extra,
  } as Pkg;
}

const catalogue = (packages: Pkg[], overrides: Partial<Extract<HappiaCatalogueResult, { status: "available" }>> = {}): HappiaCatalogueResult =>
  ({ status: "available", data: { packages, services: [] }, source: "happia_api", snapshotAgeSeconds: 0, fetchedAt: "2026-10-21T10:00:00.000Z", ...overrides });
const brief = (patch: Record<string, unknown> = {}) => EventBriefSchema.parse({ eventKind: "birthday", city: "Barranquilla", guestCount: 20, theme: "Jardín", ...patch });

test("only active packages with active items are candidates; metadata excludes, silence is disclosed", () => {
  const result = proposeStandardPackage(catalogue([
    pkg("inactive", { is_active: false }),
    pkg("no-items", {}, [{ total: 1, active: false }]),
    pkg("wedding-only", { event_kind: "boda" }),
    pkg("other-city", { city_slug: "bogota" }),
    pkg("other-theme", { themes: ["Espacial"] }),
    pkg("ok"),
  ]), brief());
  assert.equal(result.status, "proposal");
  if (result.status !== "proposal") return;
  assert.equal(result.proposal.packageId, "ok");
  assert.deepEqual(result.proposal.coverage, { event: "unknown", theme: "unknown", city: "unknown", guests: "matches_base" });
  assert.ok(result.proposal.disclosures.some((line) => /ciudad/.test(line)));
  assert.ok(result.proposal.disclosures.some((line) => /temática/.test(line)));
});

test("declared metadata that matches is reported as matching", () => {
  const result = proposeStandardPackage(catalogue([pkg("m", { event_kinds: ["Cumpleaños"], themes: ["jardin"], city_slug: "barranquilla" })]), brief());
  assert.ok(result.status === "proposal" && result.proposal.coverage.event === "matches" && result.proposal.coverage.theme === "matches" && result.proposal.coverage.city === "matches");
});

test("guest count orders by proximity to base_guests without a hard capacity", () => {
  const packages = [pkg("a", { base_guests: 10 }), pkg("b", { base_guests: 60 }), pkg("c", { base_guests: 45 })];
  const result = proposeStandardPackage(catalogue(packages), brief({ guestCount: 50 }));
  assert.ok(result.status === "proposal");
  if (result.status !== "proposal") return;
  assert.equal(result.proposal.packageId, "c");
  assert.equal(result.proposal.coverage.guests, "differs_from_base");
  const huge = proposeStandardPackage(catalogue([pkg("a", { base_guests: 10 })]), brief({ guestCount: 5000 }));
  assert.equal(huge.status, "proposal");
});

test("no fit and unavailable catalogue return explicit no-match", () => {
  assert.deepEqual(proposeStandardPackage(catalogue([pkg("x", { city_slug: "cali" })]), brief()), { status: "no_match", reason: "no_fitting_package" });
  assert.deepEqual(proposeStandardPackage({ status: "unavailable", reason: "request_failed" }, brief()), { status: "no_match", reason: "catalogue_unavailable" });
});

test("estimate is a COP subtotal of active items with source and freshness; missing prices are unavailable", () => {
  const priced = proposeStandardPackage(catalogue([pkg("p", {}, [{ total: 100000 }, { total: 5000, charge_type: "per_person" }, { total: 999999, active: false }])]), brief());
  assert.ok(priced.status === "proposal");
  if (priced.status !== "proposal") return;
  assert.equal(priced.proposal.estimate.subtotalCop, 200000);
  assert.deepEqual([priced.proposal.estimate.source, priced.proposal.estimate.snapshotAgeSeconds, priced.proposal.estimate.fetchedAt], ["happia_api", 0, "2026-10-21T10:00:00.000Z"]);
  assert.equal(priced.proposal.estimate.notice, ADVISOR_ESTIMATE_NOTICE);
  const free = proposeStandardPackage(catalogue([pkg("z", {}, [{ total: 0 }])]), brief());
  assert.ok(free.status === "proposal" && free.proposal.estimate.status === "unavailable" && free.proposal.estimate.subtotalCop === null);
  assert.match(free.status === "proposal" ? free.card.description : "", /no disponible/);
});

function store(initial: EventBriefState) {
  let state: unknown = initial;
  let version = 1;
  const mutateBrief: BriefMutator = async (mutate) => { state = mutate(state, version); version++; return { version, state }; };
  return { mutateBrief, read: () => parseEventBriefState(state) };
}
const call = (nombre: string, args: Record<string, unknown> = {}) => ({ id: "c1", nombre, args });

test("tool persists the same package, source and subtotal as the card; the model cannot supply ids or prices", async () => {
  const s = store({ ...parseEventBriefState(null), brief: brief() });
  const loadCatalogue = async () => catalogue([pkg("good")]);
  const effect = await applyAdvisorTool({ call: call("propose_standard_package"), operationId: "t:0:0", currentCustomerText: "Qué paquete hay?", mutateBrief: s.mutateBrief, loadCatalogue });
  const card = (effect.result as { card: { id: string; estimate: unknown } }).card;
  const saved = s.read().standardPackage;
  assert.ok(saved);
  assert.equal(card.id, saved.packageId);
  assert.deepEqual(card.estimate, saved.estimate);
  assert.equal(saved.estimate.subtotalCop, 400000);
  assert.match(s.read().brief.proposedPackage ?? "", /good/);
  const replay = await applyAdvisorTool({ call: call("propose_standard_package"), operationId: "t:0:0", currentCustomerText: "Qué paquete hay?", mutateBrief: s.mutateBrief, loadCatalogue: async () => ({ status: "unavailable", reason: "request_failed" }) });
  assert.deepEqual((replay.result as { card: unknown }).card, card);

  const forged = await applyAdvisorTool({ call: call("propose_standard_package", { packageId: "fake", price: 1 }), operationId: "t:1:0", currentCustomerText: "x", mutateBrief: s.mutateBrief, loadCatalogue });
  assert.match((forged.result as { message: string }).message, /argumentos/);
  assert.equal(s.read().standardPackage?.packageId, "good");

  const save = ADVISOR_TOOLS.find((tool) => tool.nombre === "save_event_fields");
  assert.ok(save && !("proposedPackage" in (save.esquema as { properties: object }).properties));
  const write = await applyAdvisorTool({ call: call("save_event_fields", { proposedPackage: "fake" }), operationId: "t:2:0", currentCustomerText: "x", mutateBrief: s.mutateBrief });
  assert.match((write.result as { message: string }).message, /no son válidos/);
});

test("tool reports no-match, clears a stale proposal, and changing fit fields invalidates it", async () => {
  const s = store({ ...parseEventBriefState(null), brief: brief() });
  await applyAdvisorTool({ call: call("propose_standard_package"), operationId: "a:0:0", currentCustomerText: "x", mutateBrief: s.mutateBrief, loadCatalogue: async () => catalogue([pkg("good")]) });
  await applyAdvisorTool({ call: call("save_event_fields", { guestCount: 30 }), operationId: "a:1:0", currentCustomerText: "x", mutateBrief: s.mutateBrief });
  assert.equal(s.read().standardPackage, null);
  assert.equal(s.read().brief.proposedPackage, null);
  const none = await applyAdvisorTool({ call: call("propose_standard_package"), operationId: "a:2:0", currentCustomerText: "x", mutateBrief: s.mutateBrief, loadCatalogue: async () => { throw new Error("down"); } });
  assert.match((none.result as { message: string }).message, /No hay catálogo/);
  assert.equal(s.read().standardPackage, null);
  assert.deepEqual(emptyEventBrief().proposedPackage, null);
});
