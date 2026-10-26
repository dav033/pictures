import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { EventBriefSchema, parseEventBriefState } from "../../../src/lib/asesor/contracts";
import type { HappiaCatalogueResult, HappiaService } from "../../../src/lib/asesor/catalogue";
import { buildCustomPackage } from "../../../src/lib/asesor/custom-package";
import { applyProposalEdit, createCatalogueHandler, createProposalHandler, listServices } from "../../../src/lib/asesor/proposal-editor";
import { coverageOf, scaleServes, servesOfService, servesText } from "../../../src/lib/asesor/servings";

function service(id: string, name: string, total: number, extra: Partial<HappiaService> = {}): HappiaService {
  return { id, name, description: null, total, charge_type: "total", charge_mode: "unit", quantity_editable: true, sale_unit: null, has_delivery: false, image_url: null,
    image_focus: "50% 50%", category_name: "Comida", provider_name: "Dulcerna", city: "Barranquilla", city_slug: "barranquilla", rating: null, ...extra } as HappiaService;
}
const SERVICES = [
  service("picadas", "Picadas-Minidedito x20 + Miniquibbe x20", 70_000),
  service("torta", "Torta de Vanilla de 1/2lb", 62_000),
  service("gaseosa", "Gaseosa 1.5lts (1 unidad)", 12_000, { category_name: "Bebidas" }),
  service("arco", "Decoración Arco con Globos + Decorador", 190_000, { category_name: "Decoración", provider_name: "Marcial Acuña", charge_mode: "event", quantity_editable: false, image_url: "https://cdn.test/arco.jpg" }),
  service("pizza", "Pizza", 7_500, { charge_type: "per_person", charge_mode: "per_person", provider_name: "20 DE JULIO" }),
  service("budin", "Pudín de Arequipe Fit", 139_000, { category_name: "Reposteria y Pasteleria", provider_name: "Let’s Dough It", description: "Pudín saludable. 12-14 porciones." }),
  service("salon", "Salón Jardín", 900_000, { category_name: "Salones", provider_name: "Casa Jardín" }),
  service("bogota", "Torta 8-10 PORCIONES VAINILLA", 67_000, { city: "Bogotá", city_slug: "bogota" }),
];
const catalogue = (services = SERVICES): HappiaCatalogueResult => ({ status: "available", data: { packages: [], services }, source: "happia_api", snapshotAgeSeconds: 0, fetchedAt: "2026-10-25T20:00:00.000Z" });
const brief = (patch: Record<string, unknown> = {}) => EventBriefSchema.parse({ eventKind: "birthday", city: "Barranquilla", guestCount: 50, ...patch });
const ofName = (id: string) => SERVICES.find((item) => item.id === id) as HappiaService;

test("what a service yields is read from the catalogue and the estimates are labelled", () => {
  assert.deepEqual(servesOfService(ofName("picadas")), { amount: 40, unit: "piezas", estimated: false });
  assert.deepEqual(servesOfService(service("m", "Minihamburguesas x15", 250_000)), { amount: 15, unit: "piezas", estimated: false });
  assert.deepEqual(servesOfService(ofName("torta")), { amount: 5, unit: "trozos", estimated: true });
  assert.deepEqual(servesOfService(ofName("gaseosa")), { amount: 6, unit: "vasos", estimated: true });
  assert.deepEqual(servesOfService(ofName("budin")), { amount: 12, unit: "porciones", estimated: false }, "the low end of 12-14");
  assert.deepEqual(servesOfService(ofName("bogota")), { amount: 8, unit: "porciones", estimated: false });
  assert.equal(servesOfService(ofName("arco")), null, "decoration yields nothing");
  assert.equal(servesOfService(service("p", "Pizzeta", 13_000)), null, "no data, no guess");
  assert.equal(servesText({ amount: 5, unit: "trozos", estimated: true }), "≈ 5 trozos (estimado)");
  assert.equal(servesText({ amount: 40, unit: "piezas", estimated: false }), "40 piezas");
  assert.deepEqual(scaleServes({ amount: 40, unit: "piezas", estimated: false }, 3), { amount: 120, unit: "piezas", estimated: false });
});

test("the real case: half a pound of cake, 120 pieces and 7.5 L do NOT cover 50 guests, and the server says so", () => {
  const result = buildCustomPackage(catalogue(), brief(), { items: [{ serviceId: "arco" }, { serviceId: "picadas", quantity: 3 }, { serviceId: "torta" }, { serviceId: "gaseosa", quantity: 5 }] });
  assert.ok(result.status === "proposal");
  const { proposal } = result;
  assert.equal(proposal.quantityCheck, "short");
  const notes = proposal.disclosures.filter((text) => text.startsWith("Alcance:")).join(" | ");
  assert.match(notes, /tortas y postres suman unas 5 porciones para 50 invitados; no alcanzan \(faltan ~45\)/);
  assert.match(notes, /bebidas rinden unos 30 vasos.*para 50 invitados; no alcanzan/);
  assert.match(notes, /comida por piezas suma 120 \(2\.4 por invitado\); son pocas/);
  assert.deepEqual(proposal.lines.find((line) => line.serviceId === "picadas")?.serves, { amount: 120, unit: "piezas", estimated: false });
  assert.equal(proposal.lines.find((line) => line.serviceId === "arco")?.basis, "event");
});

test("enough food is reported as ok, missing yield data as unknown, and no food as none", () => {
  const lines = (...items: Array<[string, number]>) => {
    const proposal = buildCustomPackage(catalogue(), brief({ guestCount: 10 }), { items: items.map(([serviceId, quantity]) => ({ serviceId, quantity })) });
    assert.ok(proposal.status === "proposal");
    return proposal.proposal;
  };
  assert.equal(lines(["torta", 2], ["picadas", 1]).quantityCheck, "ok", "10 slices and 4 pieces per guest for 10 guests");
  assert.equal(lines(["arco", 1]).quantityCheck, "none");
  const noData = coverageOf([{ name: "Pizzeta", category: "Comida", quantity: 1, serves: null }], 10);
  assert.equal(noData.check, "unknown");
  assert.match(noData.notes.join(" "), /no hay dato de cuánto rinde «Pizzeta»/);
});

test("the explorer lists the city's services with their basis and yield, never another city's, and flags places", () => {
  const listing = listServices(catalogue(), "Barranquilla", 50);
  assert.ok(listing.status === "ok");
  const byId = Object.fromEntries(listing.services.map((item) => [item.id, item]));
  assert.equal(byId.pizza.basis, "per_person"); assert.equal(byId.arco.basis, "event"); assert.equal(byId.torta.basis, "unit");
  assert.equal(byId.arco.imageUrl, "https://cdn.test/arco.jpg"); assert.equal(byId.torta.imageUrl, null);
  assert.equal(byId.salon.venue, true); assert.equal(byId.torta.venue, false);
  assert.ok(!("bogota" in byId), "a Bogotá service is not offered in Barranquilla");
  assert.equal(listServices(catalogue(), null, 50).status, "no_city");
  assert.equal(listServices({ status: "unavailable", reason: "request_failed" }, "Barranquilla", 50).status, "unavailable");
  assert.equal(listServices(catalogue(), "Cali", 50).status, "no_services");
});

test("editing the proposal adds, changes, removes and clears; the server prices it and drops the summary and approval", () => {
  const fresh = () => parseEventBriefState({ brief: brief(), summary: { version: 1, text: "x", briefVersion: 1 }, approval: { summaryVersion: 1, confirmedAt: "t" } });
  const first = applyProposalEdit(fresh(), catalogue(), [{ serviceId: "torta", quantity: 2 }, { serviceId: "arco" }, { serviceId: "pizza" }]);
  assert.ok(first.status === "ok");
  assert.equal(first.state.summary, null); assert.equal(first.state.approval, null);
  const lines = Object.fromEntries((first.state.standardPackage?.lines ?? []).map((line) => [line.serviceId, line]));
  assert.equal(lines.torta.subtotalCop, 124_000); assert.equal(lines.pizza.quantity, 50); assert.equal(lines.pizza.subtotalCop, 375_000); assert.equal(lines.arco.quantity, 1);
  assert.equal(first.state.standardPackage?.estimate.subtotalCop, 124_000 + 190_000 + 375_000);
  const reduced = applyProposalEdit(first.state, catalogue(), [{ serviceId: "torta", quantity: 1 }]);
  assert.ok(reduced.status === "ok" && reduced.state.standardPackage?.estimate.subtotalCop === 62_000, "reduce a quantity and remove lines");
  const cleared = applyProposalEdit(reduced.state, catalogue(), []);
  assert.ok(cleared.status === "ok" && cleared.state.standardPackage === null && cleared.state.brief.proposedPackage === null);
  const bogus = applyProposalEdit(fresh(), catalogue(), [{ serviceId: "inventado" }]);
  assert.ok(bogus.status === "rejected" && /no existen en el catálogo de Barranquilla/.test(bogus.reason));
  assert.ok(applyProposalEdit(fresh(), catalogue(), [{ serviceId: "bogota" }]).status === "rejected", "another city's service is rejected");
});

function fakeRepository(state: unknown, owner = "account-1") {
  let current = state; let version = 1;
  return {
    async upsertAccount() { return { id: "account-1" }; },
    async getConversation(id: string) { return id === "c1" ? { id, accountId: owner, title: null, updatedAt: "now" } : null; },
    async latestBrief() { return { conversationId: "c1", version, state: current }; },
    async mutateBrief(_id: string, mutate: (raw: unknown, v: number) => unknown) { const next = mutate(current, version); if (JSON.stringify(next) !== JSON.stringify(current)) { current = next; version += 1; } return { version, state: next }; },
    peek: () => current,
  };
}
const deps = (repository: ReturnType<typeof fakeRepository>, overrides: Partial<{ role: "user" | "admin" | null; origin: boolean }> = {}) => ({
  authorize: () => (overrides.role === null ? new Response(null, { status: 401 }) : { role: overrides.role ?? "user" as const }),
  repository: () => repository as never, loadCatalogue: async () => catalogue(), sameOrigin: () => overrides.origin ?? true,
});
const put = (body: unknown) => new Request("https://example.test/api/asesor/proposal", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("the catalogue and proposal routes check the session, the owner and the origin, and answer with the priced state", async () => {
  const repository = fakeRepository({ brief: brief() });
  const get = createCatalogueHandler(deps(repository));
  const listing = await (await get(new Request("https://example.test/api/asesor/catalogue?conversationId=c1"))).json() as { status: string; guests: number; services: unknown[] };
  assert.equal(listing.status, "ok"); assert.equal(listing.guests, 50); assert.ok(listing.services.length >= 6);
  assert.equal((await get(new Request("https://example.test/api/asesor/catalogue?conversationId=other"))).status, 404);
  assert.equal((await createCatalogueHandler(deps(repository, { role: null }))(new Request("https://example.test/api/asesor/catalogue?conversationId=c1"))).status, 401);
  assert.equal((await createCatalogueHandler(deps(fakeRepository({ brief: brief() }, "someone-else")))(new Request("https://example.test/api/asesor/catalogue?conversationId=c1"))).status, 404, "not the owner");

  const update = createProposalHandler(deps(repository));
  const ok = await update(put({ conversationId: "c1", items: [{ serviceId: "torta", quantity: 3 }, { serviceId: "arco" }] }));
  assert.equal(ok.status, 200);
  const body = await ok.json() as { state: { standardPackage: { estimate: { subtotalCop: number } } }; progress: { step: string }; briefVersion: number };
  assert.equal(body.state.standardPackage.estimate.subtotalCop, 3 * 62_000 + 190_000);
  assert.ok(body.briefVersion >= 2 && body.progress.step);
  const rejected = await update(put({ conversationId: "c1", items: [{ serviceId: "inventado" }] }));
  assert.equal(rejected.status, 422); assert.equal(((await rejected.json()) as { code: string }).code, "PROPOSAL_REJECTED");
  assert.equal(parseEventBriefState(repository.peek()).standardPackage?.estimate.subtotalCop, 3 * 62_000 + 190_000, "a rejected edit changes nothing");
  assert.equal((await update(put({ conversationId: "c1", items: [{ serviceId: "torta", price: 1 }] }))).status, 400, "the client cannot send a price");
  assert.equal((await createProposalHandler(deps(repository, { origin: false }))(put({ conversationId: "c1", items: [] }))).status, 403);
  assert.equal((await update(put({ conversationId: "other", items: [] }))).status, 404);
  const cleared = await update(put({ conversationId: "c1", items: [] }));
  assert.equal(cleared.status, 200); assert.equal(parseEventBriefState(repository.peek()).standardPackage, null);
});

test("the explorer sheet offers add, change quantity and remove, and the chat opens it from the footer and the card", () => {
  const sheet = readFileSync("src/components/asesor/ProposalSheet.tsx", "utf8");
  for (const control of ["`Agregar ${service.name}`", "`Menos ${row.name}`", "`Más ${row.name}`", "`Quitar ${row.name}`", "Explorar servicios", "Buscar servicios"]) assert.ok(sheet.includes(control), control);
  assert.match(sheet, /saveProposal\(conversationId, itemsOf\(nextRows\)\)/, "every edit is saved whole and priced by the server");
  assert.match(sheet, /SAVE_DELAY_MS/, "edits are debounced");
  const view = readFileSync("src/components/asesor/ChatView.tsx", "utf8");
  assert.match(view, /Explorar servicios de Happia/);
  assert.match(view, /onEdit=\{\(\) => setSheetOpen\(true\)\}/);
  assert.match(view, /onSaved=\{conversation\.applyProposalPatch\}/);
  assert.match(readFileSync("src/components/asesor/OfferCards.tsx", "utf8"), /Editar o agregar servicios/);
});

test("a per-person food service covers every guest and is never reported as missing its yield", () => {
  const proposal = buildCustomPackage(catalogue(), brief({ guestCount: 10 }), { items: [{ serviceId: "pizza" }, { serviceId: "torta", quantity: 2 }] });
  assert.ok(proposal.status === "proposal");
  assert.equal(proposal.proposal.quantityCheck, "ok");
  assert.ok(!proposal.proposal.disclosures.some((text) => /no hay dato de cuánto rinde/.test(text)));
});
