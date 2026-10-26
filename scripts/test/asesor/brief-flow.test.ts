import assert from "node:assert/strict";
import { test } from "node:test";
import { diffBrief, formatBriefChange } from "../../../src/lib/asesor/brief-changes";
import { createBriefProjection } from "../../../src/lib/asesor/brief";
import { EventBriefSchema, parseEventBriefState, type EventBriefState } from "../../../src/lib/asesor/contracts";
import { calculateBriefProgress } from "../../../src/lib/asesor/progress";
import { applyQuickReplyToState, BUDGET_REPLIES, BUDGET_UNDISCLOSED_REPLY, PRIORITY_REPLIES } from "../../../src/lib/asesor/quick-replies";
import { applyAdvisorTool, customerConsent, type BriefMutator } from "../../../src/lib/asesor/tools";
import { parseAdvisorSnapshot } from "../../../src/components/asesor/conversation-contract";
import { contactMessage } from "../../../src/components/asesor/ContactForm";
import { summarySections } from "../../../src/components/asesor/SummaryCard";
import { consultedAt } from "../../../src/components/asesor/OfferCards";

const sofia = {
  eventKind: "birthday", honoreeName: "Sofía", date: "10 sep", startTime: "17:00", guestCount: 10, venueType: "salón", city: "Barranquilla",
  address: "Calle 80 # 50-20", contactName: "Laura", contactPhone: "3001234567", theme: "Frozen", contactPermission: true, addressPermission: true,
};

function store(initial: unknown) {
  let state = initial;
  let version = 1;
  const mutateBrief: BriefMutator = async (mutate) => { state = mutate(state, version); version += 1; return { version, state }; };
  return { mutateBrief, read: () => parseEventBriefState(state) };
}
const call = (nombre: string, args: Record<string, unknown>) => ({ id: `${nombre}-1`, nombre, args });

test("after the taste the advisor asks what matters most, then the budget, before the start time", () => {
  const step = (patch: Record<string, unknown>) => calculateBriefProgress(EventBriefSchema.parse({ ...sofia, startTime: null, contactName: null, contactPhone: null, ...patch }));
  assert.deepEqual([step({ theme: null }).step, step({ theme: null }).ask], ["preferences", undefined], "taste first");
  assert.deepEqual([step({}).step, step({}).ask], ["preferences", "priority"]);
  assert.deepEqual([step({ organiserPriority: "personalise" }).step, step({ organiserPriority: "personalise" }).ask], ["preferences", "budget"]);
  assert.equal(step({ budgetRange: "Hasta $300.000" }).step, "start_time", "a band answers the budget even without a priority");
  assert.equal(step({ budgetUndisclosed: true }).step, "start_time", "«prefiero no decir» is an answer");
  assert.equal(step({ budget: 500_000 }).step, "start_time");
  assert.equal(calculateBriefProgress(EventBriefSchema.parse(sofia)).step, "summary", "a complete brief never goes back to ask");
});

test("quick-pick chips are applied by the server exactly; other text is left to the model", () => {
  const state = parseEventBriefState({ brief: sofia, summary: { version: 2, text: "x", briefVersion: 3 } });
  assert.equal(applyQuickReplyToState(state, PRIORITY_REPLIES.personalise.message, "t1"), true);
  assert.equal(state.brief.organiserPriority, "personalise");
  assert.equal(state.summary, null, "a new answer invalidates the summary");
  assert.equal(applyQuickReplyToState(state, BUDGET_REPLIES[1].message, "t2"), true);
  assert.deepEqual([state.brief.budgetRange, state.brief.budgetUndisclosed], ["$300.000–$600.000", false]);
  assert.equal(applyQuickReplyToState(state, BUDGET_UNDISCLOSED_REPLY.message, "t3"), true);
  assert.deepEqual([state.brief.budgetRange, state.brief.budgetUndisclosed], [null, true]);
  assert.equal(state.changes.length, 1, "replacing a stated band is a change; the first answers are not");
  assert.equal(applyQuickReplyToState(state, "Lo más importante para mí es que esté bonito", "t4"), false);
  assert.equal(applyQuickReplyToState(state, PRIORITY_REPLIES.best_price.message, "t5"), true);
  assert.equal(formatBriefChange(state.changes.at(-1)!), "Lo más importante: Personalizarla → El mejor precio");
});

test("the change history records only facts that changed after being given", () => {
  const before = EventBriefSchema.parse({ ...sofia, colors: ["azul"] });
  assert.deepEqual(diffBrief(EventBriefSchema.parse({}), before, "t0"), [], "first values are not changes");
  const changes = diffBrief(before, EventBriefSchema.parse({ ...sofia, guestCount: 15, honoreeName: "Sofía y Valeria", colors: ["azul", "plata"] }), "t1");
  assert.deepEqual(changes.map(formatBriefChange), ["Homenajeado/a: Sofía → Sofía y Valeria", "Invitados: 10 → 15", "Colores: azul → azul, plata"]);
  assert.equal(changes.find((change) => change.field === "guestCount")?.impact, "Se recalcula la propuesta de Happia");
  assert.equal(changes[0].turnId, "t1");
});

test("save_event_fields records the change with its turn and the summary carries story, priority, budget and history", async () => {
  const brief = store({ brief: { ...sofia, story: "Su primera fiesta con los amigos del colegio nuevo", organiserPriority: "personalise", budgetRange: "Hasta $300.000", brandRequests: "Globos Sempertex" } });
  await applyAdvisorTool({ call: call("save_event_fields", { guestCount: 15 }), operationId: "turn-7:0:0", currentCustomerText: "Al final seríamos 15", mutateBrief: brief.mutateBrief, turnId: "turn-7" });
  assert.deepEqual(brief.read().changes.map((change) => [change.field, change.from, change.to, change.turnId]), [["guestCount", "10", "15", "turn-7"]]);
  await applyAdvisorTool({ call: call("propose_standard_package", {}), operationId: "turn-8:0:0", currentCustomerText: "dale", mutateBrief: brief.mutateBrief, loadCatalogue: async () => ({ status: "unavailable", reason: "request_failed" }) });
  await applyAdvisorTool({ call: call("propose_summary", {}), operationId: "turn-8:0:1", currentCustomerText: "dale", mutateBrief: brief.mutateBrief });
  const text = brief.read().summary?.text ?? "";
  assert.match(text, /^Por qué es especial: Su primera fiesta con los amigos del colegio nuevo$/m);
  assert.match(text, /^Lo más importante: Personalizarla$/m);
  assert.match(text, /^Marcas o proveedores: Globos Sempertex$/m);
  assert.match(text, /^Presupuesto: Hasta \$300\.000$/m);
  assert.match(text, /^Cambio: Invitados: 10 → 15 \(Se recalcula la propuesta de Happia\)$/m);
  const sections = summarySections(text);
  assert.deepEqual(sections.changes, ["Invitados: 10 → 15 (Se recalcula la propuesta de Happia)"]);
  assert.ok(sections.rows.some((row) => row.label === "Presupuesto"));
});

test("the vendor brief hides the budget band, the «prefiero no decir» marker and changes to private fields", () => {
  const state: EventBriefState = parseEventBriefState({
    brief: { ...sofia, budgetRange: "Hasta $300.000", budgetUndisclosed: false, story: "Primera fiesta" },
    changes: [
      { field: "budgetRange", from: "Hasta $300.000", to: "Más de $600.000", turnId: "t1", impact: null },
      { field: "honoreeName", from: "Sofía", to: "Sofía y Valeria", turnId: "t2", impact: null },
      { field: "guestCount", from: "10", to: "15", turnId: "t2", impact: "Se recalcula la propuesta de Happia" },
    ],
    summary: { version: 1, text: "x", briefVersion: 1 },
  });
  const vendor = createBriefProjection(state, [], "vendor");
  assert.equal("budgetRange" in vendor.brief, false);
  assert.equal("budgetUndisclosed" in vendor.brief, false);
  assert.deepEqual(vendor.changes.map((change) => change.field), ["guestCount"]);
  assert.match(vendor.summary.text, /Por qué es especial: Primera fiesta/);
  assert.equal(createBriefProjection(state, [], "full").changes.length, 3);
});

test("the chat header, change notes and package card come from the server state", () => {
  const snapshot = parseAdvisorSnapshot({
    conversation: { id: "conv-1" }, messages: [{ id: "t2", role: "user", content: "Seríamos 15" }, { id: "t2:assistant", role: "assistant", content: "¡Doble celebración!" }],
    state: { directionOffers: [], standardPackage: null, summary: null, approval: null, brief: { ...sofia, guestCount: 15 },
      changes: [{ field: "guestCount", from: "10", to: "15", turnId: "t2", impact: null }] },
    progress: { complete: false, completed: 8, required: 10, missing: ["startTime"], step: "preferences", ask: "budget" }, briefVersion: 3,
  });
  assert.deepEqual(snapshot?.headline, { title: "Cumpleaños de Sofía", facts: ["10 sep", "17:00", "15 invitados", "Barranquilla"], city: "Barranquilla", guests: 15 });
  assert.deepEqual(snapshot?.changes, [{ turnId: "t2", text: "Invitados: 10 → 15", impact: null }]);
  assert.equal(snapshot?.progress.ask, "budget");
  const iso = parseAdvisorSnapshot({ conversation: { id: "c" }, messages: [], state: { directionOffers: [], standardPackage: null, summary: null, approval: null, brief: { ...sofia, date: "2026-12-10" } }, progress: { complete: false, completed: 1, required: 10, missing: [] }, briefVersion: 1 });
  assert.equal(iso?.headline.facts[0], "10 de dic");
  assert.match(consultedAt("2026-10-23T15:00:00.000Z") ?? "", /2026/, "the catalogue time is formatted, not a raw ISO string");
  assert.doesNotMatch(consultedAt("2026-10-23T15:00:00.000Z") ?? "", /T15:00/);
});

test("the contact form sends the consent phrases the server recognises", () => {
  const message = contactMessage({ name: "Laura Gómez", reach: "300 123 4567", address: "Calle 80 # 50-20" });
  assert.deepEqual(customerConsent(message), { contact: true, address: true, refusedContact: false, refusedAddress: false });
  assert.match(contactMessage({ name: "Laura", reach: "laura@example.com", address: null }), /mi correo es laura@example\.com/);
});

test("the package within the customer's budget comes first, then the closest guest count", async () => {
  const { budgetCeiling, proposeStandardPackage } = await import("../../../src/lib/asesor/packages");
  assert.equal(budgetCeiling({ budget: null, budgetRange: "$300.000–$600.000" }), 600_000);
  assert.equal(budgetCeiling({ budget: null, budgetRange: "Hasta $300.000" }), 300_000);
  assert.equal(budgetCeiling({ budget: null, budgetRange: "Más de $600.000" }), null);
  assert.equal(budgetCeiling({ budget: 450_000, budgetRange: null }), 450_000);
  const item = (total: number, category: string) => ({ id: `i-${total}`, package_id: "p", total, charge_type: "total", charge_mode: "unit", quantity_editable: false, sale_unit: null, removable: false, suggested_start_time: null, description: null, is_active: true, provider_name: "Proveedor", category_name: category });
  const pkg = (id: string, base: number, items: ReturnType<typeof item>[], name = "Cumpleaños Express") => ({ id, event_type_id: "e", city_id: "c", name, base_guests: base, standard_duration_minutes: null, conditions: null, restrictions: null, is_active: true, is_featured: false, city: "Barranquilla", city_slug: "barranquilla", package_items: items });
  const catalogue = { status: "available", source: "happia_api", fetchedAt: "2026-10-25T20:00:00.000Z", snapshotAgeSeconds: 0,
    data: { services: [], packages: [pkg("caro-15", 15, [item(966_000, "Decoración")], "Cumpleaños Luxury"), pkg("sweet-10", 10, [item(200_000, "Decoración"), item(73_000, "Comida")], "Celebración Sweet"), pkg("futbol-15", 15, [item(100_000, "Decoración")], "Cumpleaños Futbol")] } } as never;
  const brief = EventBriefSchema.parse({ ...sofia, guestCount: 15, budgetRange: "$300.000–$600.000" });
  const outcome = proposeStandardPackage(catalogue, brief);
  assert.equal(outcome.status === "proposal" && outcome.proposal.packageId, "sweet-10");
  assert.deepEqual(outcome.status === "proposal" && outcome.proposal.categories, ["Comida", "Decoración"]);
  const noBudget = proposeStandardPackage(catalogue, EventBriefSchema.parse({ ...sofia, guestCount: 15 }));
  assert.equal(noBudget.status === "proposal" && noBudget.proposal.packageId, "caro-15", "without a budget the guest count decides");
});

test("the model is told today's date in Colombia so a day and month resolve to the next future date", async () => {
  const { todayContext } = await import("../../../src/lib/asesor/agent");
  assert.match(todayContext(new Date("2026-10-26T03:00:00.000Z")), /Fecha de hoy en Colombia: 2026-10-25\./, "Bogotá is UTC-5");
  assert.match(todayContext(new Date("2026-10-26T03:00:00.000Z")), /próxima fecha futura/);
});

test("a package whose name carries another theme or event is never proposed", async () => {
  const { nameCoverage } = await import("../../../src/lib/asesor/packages");
  const frozen = EventBriefSchema.parse({ ...sofia, theme: "Frozen" });
  assert.deepEqual(nameCoverage({ name: "Cumpleaños Futbol" }, frozen), { event: "matches", theme: "excluded" });
  assert.deepEqual(nameCoverage({ name: "Cumpleaños Fútbol" }, EventBriefSchema.parse({ ...sofia, theme: "fútbol" })), { event: "matches", theme: "matches" });
  assert.deepEqual(nameCoverage({ name: "Cumpleaños Rosa Brillante" }, EventBriefSchema.parse({ ...sofia, theme: null, colors: ["rosa"] })).theme, "matches", "colours count as taste");
  assert.deepEqual(nameCoverage({ name: "Celebración Sweet" }, frozen), { event: "unknown", theme: "unknown" }, "generic names stay offerable");
  assert.equal(nameCoverage({ name: "Baby Shower" }, frozen).event, "excluded");
  assert.equal(nameCoverage({ name: "Auditorio Corporativo" }, frozen).event, "excluded");
  assert.equal(nameCoverage({ name: "Celebración Halloween" }, EventBriefSchema.parse({ ...sofia, theme: null })).theme, "excluded", "no stated taste: themed packages are not imposed");
});

test("the model only gets offerable Happia services of the customer's city", async () => {
  const { catalogueForModel } = await import("../../../src/lib/asesor/catalogue-context");
  const service = (name: string | null, city: string, total = 100_000, description: string | null = null) => ({ id: `${name}-${city}`, name, description, total, charge_type: "total", charge_mode: "unit", quantity_editable: false, sale_unit: null, has_delivery: false, image_url: null, image_focus: "center", category_name: "Decoración", provider_name: "Proveedor", city, city_slug: city.toLowerCase(), rating: null });
  const catalogue = { status: "available", source: "happia_api", fetchedAt: "x", snapshotAgeSeconds: 0, data: { packages: [], services: [
    service("Decoración Arco con Globos + Decorador", "Barranquilla", 190_000), service("Decoración", "Barranquilla", 100_000, "Prueba"), service(null, "Barranquilla"),
    service("Kit Decoración Futbol", "Bogotá", 67_200),
  ] } } as never;
  const text = catalogueForModel(catalogue, "Barranquilla");
  assert.match(text, /lo único que se puede ofrecer/);
  assert.match(text, /• id=Decoración Arco con Globos \+ Decorador-Barranquilla · Decoración Arco con Globos \+ Decorador \[Decoración\]/);
  assert.match(text, /por evento \(1 unidad\)/);
  assert.doesNotMatch(text, /Prueba|Kit Decoración Futbol/, "test rows and other cities are left out");
  assert.doesNotMatch(text, /Lugares:/, "nothing about venues is written into the context by hand: the advisor looks them up");
  assert.match(catalogueForModel(catalogue, null), /aún no sabes la ciudad.*Barranquilla, Bogotá/);
  assert.match(catalogueForModel(catalogue, "Cali"), /no hay servicios en Cali/);
  assert.match(catalogueForModel({ status: "unavailable", reason: "request_failed" }, "Barranquilla"), /No propongas servicios, elementos ni precios concretos/);
});

test("the same budget worded differently is not a change; a different one still is", async () => {
  const { diffBrief, sameFact } = await import("../../../src/lib/asesor/brief-changes");
  const base = EventBriefSchema.parse({ ...sofia, budgetRange: "$300.000–$600.000", theme: "Frozen" });
  assert.deepEqual(diffBrief(base, { ...base, budgetRange: "$300.000 - $600.000" }, "t1"), [], "the en dash and the hyphen are the same range");
  assert.deepEqual(diffBrief(base, { ...base, theme: "frozen" }, "t1"), [], "case alone is not a change");
  assert.equal(diffBrief(base, { ...base, budgetRange: "$300.000–$700.000" }, "t1").length, 1);
  assert.equal(diffBrief(base, { ...base, theme: "Fútbol" }, "t1").length, 1);
  assert.ok(sameFact("Más de $1.000.000", "mas de $1.000.000"));
});
