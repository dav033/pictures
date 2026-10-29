import assert from "node:assert/strict";
import { test } from "node:test";
import { EventBriefSchema, parseEventBriefState, type EventBriefState } from "../../../src/lib/asesor/contracts";
import type { HappiaCatalogueResult, HappiaService } from "../../../src/lib/asesor/catalogue";
import { buildCustomPackage } from "../../../src/lib/asesor/custom-package";
import { calculateStateProgress } from "../../../src/lib/asesor/progress";
import { applyAdvisorTool, type BriefMutator } from "../../../src/lib/asesor/tools";
import { getBriefDisplayEntries } from "../../../src/lib/asesor/brief-display";
import { createBriefProjection } from "../../../src/lib/asesor/brief";

function service(id: string, name: string | null, total: number, extra: Partial<HappiaService> = {}): HappiaService {
  return { id, name, description: null, total, charge_type: "total", charge_mode: "unit", quantity_editable: true, sale_unit: null, has_delivery: false, image_url: null,
    image_focus: "50% 50%", category_name: "Decoración", provider_name: "Sempertex", city: "Barranquilla", city_slug: "barranquilla", rating: null, ...extra } as HappiaService;
}
const SERVICES = [
  service("kit", "Kit Decoracion", 44_050),
  service("desechables", "Kit Desechables", 73_000, { description: "Paquete de desechables para 20 invitados, velitas" }),
  service("guirnalda", "Decoración Guirnalda + Decorador", 115_000, { charge_mode: "event", quantity_editable: false }),
  service("pizza", "Pizza", 7_500, { charge_type: "per_person", charge_mode: "per_person", category_name: "Comida" }),
  service("torta", "Torta de Chocolate 1/2lb", 75_000, { category_name: "Comida" }),
  service("futbol-bogota", "Kit Decoración Futbol", 67_200, { city: "Bogotá", city_slug: "bogota" }),
  service("prueba", "Decoración", 100_000, { description: "Prueba" }),
  service("sin-nombre", null, 4_200),
  service("catering-8", "Catering de comida", 8, { charge_type: "per_person", charge_mode: "per_person", category_name: "Comida" }),
];
const catalogue = (services = SERVICES): HappiaCatalogueResult => ({ status: "available", data: { packages: [], services }, source: "happia_api", snapshotAgeSeconds: 0, fetchedAt: "2026-10-25T20:00:00.000Z" });
const brief = (patch: Record<string, unknown> = {}) => EventBriefSchema.parse({ eventKind: "birthday", city: "Barranquilla", guestCount: 40, theme: "fiesta de futbol", ...patch });

test("a custom proposal is priced by the server: per-person services follow the guests, units take the asked quantity", () => {
  const result = buildCustomPackage(catalogue(), brief(), { name: "Fiesta de fútbol de David", items: [{ serviceId: "desechables", quantity: 2 }, { serviceId: "guirnalda", quantity: 5 }, { serviceId: "pizza", quantity: 3 }, { serviceId: "torta" }] });
  assert.equal(result.status, "proposal");
  if (result.status !== "proposal") return;
  const { proposal } = result;
  assert.equal(proposal.kind, "custom");
  assert.equal(proposal.name, "Fiesta de fútbol de David");
  const byId = Object.fromEntries(proposal.lines.map((line) => [line.serviceId, line]));
  assert.equal(byId.desechables.quantity, 2); assert.equal(byId.desechables.subtotalCop, 146_000);
  assert.equal(byId.guirnalda.quantity, 1, "an event-priced service is one unit whatever the model asks");
  assert.equal(byId.pizza.quantity, 40, "per-person services use the guest count"); assert.equal(byId.pizza.subtotalCop, 300_000);
  assert.equal(byId.torta.quantity, 1);
  assert.equal(proposal.estimate.subtotalCop, 146_000 + 115_000 + 300_000 + 75_000);
  assert.deepEqual(proposal.categories, ["Comida", "Decoración"]);
  assert.equal(proposal.coverage.city, "matches");
  assert.ok(proposal.disclosures.some((text) => /Ningún servicio del catálogo de Barranquilla es específico de la temática/.test(text)), "no football service in this city: said, not hidden");
  assert.ok(proposal.disclosures.some((text) => /Kit Desechables.*capacidad/.test(text)));
  assert.ok(result.card.content.startsWith("Me interesa la propuesta"));
});

test("nothing outside the city's offerable catalogue can be proposed", () => {
  const reject = (items: Array<{ serviceId: string }>, patch: Record<string, unknown> = {}) => buildCustomPackage(catalogue(), brief(patch), { items });
  for (const bad of ["inventado", "futbol-bogota", "prueba", "sin-nombre", "catering-8"]) {
    const result = reject([{ serviceId: "kit" }, { serviceId: bad }]);
    assert.equal(result.status, "rejected", bad);
    assert.match((result as { reason: string }).reason, new RegExp(bad));
  }
  assert.match((reject([{ serviceId: "kit" }], { city: "Medellín" }) as { reason: string }).reason, /no tiene servicios en Medellín/);
  assert.match((reject([{ serviceId: "kit" }], { city: null }) as { reason: string }).reason, /ciudad/);
  assert.match((reject([{ serviceId: "kit" }], { guestCount: null }) as { reason: string }).reason, /invitados/);
  assert.equal(reject([]).status, "rejected");
  assert.equal(buildCustomPackage({ status: "unavailable", reason: "request_failed" }, brief(), { items: [{ serviceId: "kit" }] }).status, "rejected");
});

test("a repeated unit service adds up, a repeated fixed one does not, and an over-budget total is disclosed", () => {
  const result = buildCustomPackage(catalogue(), brief({ budgetRange: "$300.000–$600.000", theme: "Frozen" }), { items: [{ serviceId: "kit", quantity: 2 }, { serviceId: "kit", quantity: 3 }, { serviceId: "guirnalda" }, { serviceId: "guirnalda" }, { serviceId: "pizza" }] });
  assert.ok(result.status === "proposal");
  const byId = Object.fromEntries(result.proposal.lines.map((line) => [line.serviceId, line]));
  assert.equal(byId.kit.quantity, 5); assert.equal(byId.guirnalda.quantity, 1);
  assert.equal(result.proposal.lines.length, 3);
  assert.equal(result.proposal.estimate.subtotalCop, 5 * 44_050 + 115_000 + 300_000);
  assert.ok(result.proposal.disclosures.some((text) => /supera el presupuesto indicado \(\$300\.000–\$600\.000\)/.test(text)));
});

test("a service that names the requested theme counts as matching it", () => {
  const result = buildCustomPackage(catalogue([...SERVICES, service("futbol-bq", "Kit Decoración Futbol", 67_200)]), brief(), { items: [{ serviceId: "futbol-bq" }] });
  assert.ok(result.status === "proposal" && result.proposal.coverage.theme === "matches" && !result.proposal.disclosures.some((text) => /específico de la temática/.test(text)));
});

function memory(initial: unknown = {}) {
  let state: unknown = initial; let version = 1;
  const mutate: BriefMutator = async (fn) => { state = fn(state, version); version += 1; return { version, state }; };
  return { mutate, get state() { return parseEventBriefState(state); } };
}

test("the tool stores the proposal, returns its card, replays idempotently and invalidates it when the guests change", async () => {
  const store = memory({ brief: brief() });
  const call = { nombre: "propose_custom_package", args: { name: "Fiesta", items: [{ serviceId: "desechables", quantity: 2 }, { serviceId: "pizza" }] } };
  const first = await applyAdvisorTool({ call, operationId: "t1:0:0", currentCustomerText: "arma algo", mutateBrief: store.mutate, loadCatalogue: async () => catalogue() });
  const card = (first.result as { card: { id: string; title: string } }).card;
  assert.equal(card.title, "Fiesta");
  assert.equal(store.state.standardPackage?.kind, "custom");
  assert.match((first.result as { message: string }).message, /Propuesta a medida armada.*Kit Desechables x2 = 146000 COP.*Pizza x40 = 300000 COP/);
  const replay = await applyAdvisorTool({ call, operationId: "t1:0:0", currentCustomerText: "arma algo", mutateBrief: store.mutate, loadCatalogue: async () => { throw new Error("must not reload"); } });
  assert.equal((replay.result as { card: { id: string } }).card.id, card.id);
  assert.equal(calculateStateProgress(store.state).step, "event", "the proposal counts as presented once built");
  await applyAdvisorTool({ call: { nombre: "save_event_fields", args: { guestCount: 25 } }, operationId: "t2:0:0", currentCustomerText: "somos 25", mutateBrief: store.mutate });
  assert.equal(store.state.standardPackage, null, "quantities depend on the guests: the proposal is dropped");
});

test("an unknown service id builds nothing and keeps the previous state", async () => {
  const store = memory({ brief: brief() });
  const out = await applyAdvisorTool({ call: { nombre: "propose_custom_package", args: { items: [{ serviceId: "inventado" }] } }, operationId: "t1:0:0", currentCustomerText: "x", mutateBrief: store.mutate, loadCatalogue: async () => catalogue() });
  assert.match((out.result as { message: string }).message, /no existen en el catálogo de Barranquilla: inventado/);
  assert.equal(store.state.standardPackage, null);
  const bad = await applyAdvisorTool({ call: { nombre: "propose_custom_package", args: { items: [{ serviceId: "kit", price: 1 }] } }, operationId: "t1:1:0", currentCustomerText: "x", mutateBrief: store.mutate, loadCatalogue: async () => catalogue() });
  assert.match((bad.result as { message: string }).message, /argumentos de la herramienta no son válidos/, "the model cannot slip a price in");
});

test("the brief and the summary list every service with its price", async () => {
  const store = memory({ brief: brief({ contactName: "Laura" }) });
  await applyAdvisorTool({ call: { nombre: "propose_custom_package", args: { items: [{ serviceId: "torta" }] } }, operationId: "t1:0:0", currentCustomerText: "x", mutateBrief: store.mutate, loadCatalogue: async () => catalogue() });
  const entries = getBriefDisplayEntries(createBriefProjection(store.state as EventBriefState, [], "full"));
  assert.ok(entries.some((entry) => entry.label === "Propuesta a medida"));
  assert.ok(entries.some((entry) => /^Servicio · Comida$/.test(entry.label) && /Torta de Chocolate 1\/2lb \(Sempertex\) x1: .*75\.000/.test(entry.value)));
  assert.ok(entries.some((entry) => entry.label === "Total de referencia" && /75\.000/.test(entry.value)));
});

test("an amount replaces the quick-pick band (and vice versa): the brief never keeps two budgets", async () => {
  const store = memory({ brief: brief({ budgetRange: "$300.000–$600.000" }) });
  await applyAdvisorTool({ call: { nombre: "save_event_fields", args: { budget: 1_200_000 } }, operationId: "b1:0:0", currentCustomerText: "cambiar el presupuesto a 1.2m", mutateBrief: store.mutate });
  assert.equal(store.state.brief.budget, 1_200_000);
  assert.equal(store.state.brief.budgetRange, null, "the old band is gone");
  assert.equal(store.state.changes.length, 1);
  assert.match(store.state.changes[0].from, /300\.000.*600\.000/); assert.match(store.state.changes[0].to, /1\.200\.000/);
  await applyAdvisorTool({ call: { nombre: "save_event_fields", args: { budgetRange: "Hasta $300.000" } }, operationId: "b2:0:0", currentCustomerText: "mejor hasta 300 mil", mutateBrief: store.mutate });
  assert.equal(store.state.brief.budget, null); assert.equal(store.state.brief.budgetRange, "Hasta $300.000");
  assert.equal(store.state.changes.length, 2);
  await applyAdvisorTool({ call: { nombre: "save_event_fields", args: { budgetRange: "Hasta $300.000" } }, operationId: "b3:0:0", currentCustomerText: "eso", mutateBrief: store.mutate });
  assert.equal(store.state.changes.length, 2, "saying the same budget again changes nothing");
});

test("find_venues looks the places up in the live catalogue instead of assuming anything", async () => {
  const ask = async (cat: HappiaCatalogueResult, city: string | null) => {
    const store = memory({ brief: brief({ city }) });
    const out = await applyAdvisorTool({ call: { nombre: "find_venues", args: {} }, operationId: "v:0:0", currentCustomerText: "no tenemos lugar", mutateBrief: store.mutate, loadCatalogue: async () => cat });
    return String((out.result as { message: string }).message);
  };
  const hall = service("salon-1", "Salón Jardín", 900_000, { category_name: "Salones", provider_name: "Casa Jardín", description: "Salón para 60 personas con terraza." });
  assert.match(await ask(catalogue(), "Barranquilla"), /no tiene lugares ni salones disponibles ahora.*no ofrezcas, busques ni recomiendes lugares/i, "no venue service: told so, from the data");
  const withHall = await ask(catalogue([...SERVICES, hall]), "Barranquilla");
  assert.match(withHall, /Lugares del catálogo de Happia en Barranquilla.*id=salon-1 · Salón Jardín · Casa Jardín · \$\s?900\.000.*60 personas/);
  assert.doesNotMatch(await ask(catalogue([...SERVICES, hall]), "Bogotá"), /salon-1/, "a hall of another city is never offered");
  assert.match(await ask(catalogue([...SERVICES, hall]), null), /pregúntala/, "no city: ask it first");
  assert.match(await ask({ status: "unavailable", reason: "request_failed" }, "Barranquilla"), /No hay catálogo de Happia disponible ahora/);
  // And the hall can then go into the custom proposal like any other service.
  const proposal = buildCustomPackage(catalogue([...SERVICES, hall]), brief(), { items: [{ serviceId: "salon-1" }, { serviceId: "kit" }] });
  assert.ok(proposal.status === "proposal" && proposal.proposal.lines.some((line) => line.serviceId === "salon-1"));
});

test("assembly and transport are held back until the customer confirms them", () => {
  const montaje = service("montaje", "Montaje y Transporte", 780_000, { provider_name: "Marcial Acuña Decoración" });
  const incluido = service("arco", "Arco con montaje incluido", 190_000);
  const services = catalogue([...SERVICES, montaje, incluido]);
  const asked = [{ serviceId: "guirnalda" }, { serviceId: "montaje" }, { serviceId: "arco" }];

  const held = buildCustomPackage(services, brief(), { items: asked });
  assert.equal(held.status, "proposal");
  if (held.status !== "proposal") return;
  assert.deepEqual(held.heldBack, ["Montaje y Transporte"]);
  assert.deepEqual(held.proposal.lines.map((line) => line.serviceId).sort(), ["arco", "guirnalda"]);
  assert.ok(held.proposal.disclosures.every((text) => !/montaje/i.test(text)), "the customer-facing notices do not carry the model instruction");

  const confirmed = buildCustomPackage(services, brief(), { items: asked, logisticsConfirmed: true });
  assert.equal(confirmed.status === "proposal" && confirmed.proposal.lines.some((line) => line.serviceId === "montaje"), true);
  assert.equal(confirmed.status === "proposal" && confirmed.heldBack.length, 0);

  const only = buildCustomPackage(services, brief(), { items: [{ serviceId: "montaje" }] });
  assert.equal(only.status, "rejected");
});
