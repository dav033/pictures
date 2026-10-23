import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAdvisorEvent, parseAdvisorSnapshot } from "../../../src/components/asesor/conversation-contract";
import { createBriefProjection } from "../../../src/lib/asesor/brief";
import { getBriefDisplayEntries } from "../../../src/lib/asesor/brief-display";
import { parseEventBriefState } from "../../../src/lib/asesor/contracts";
import { applyAdvisorTool, type BriefMutator } from "../../../src/lib/asesor/tools";

const estimate = {
  status: "available" as const,
  subtotalCop: 250_000,
  basis: "before_vat_and_commission" as const,
  source: "postgres" as const,
  fetchedAt: "2026-10-23T10:00:00.000Z",
  snapshotAgeSeconds: 120,
  notice: "Estimado sujeto a confirmación.",
};
const disclosures = [
  "El catálogo no indica para qué tipo de evento aplica este paquete; hay que confirmarlo.",
  "El catálogo no indica temáticas para este paquete; no se garantiza que encaje con la temática.",
  "El catálogo no indica la ciudad de este paquete; no se garantiza cobertura en la ciudad del evento.",
  "El paquete está pensado para 40 invitados; el costo y la capacidad para 80 se confirman con el equipo.",
];
const packageProposal = {
  packageId: "pkg-1", name: "Paquete Fiesta", baseGuests: 40, guestCount: 80,
  estimate, coverage: { event: "unknown" as const, theme: "unknown" as const, city: "unknown" as const, guests: "differs_from_base" as const }, disclosures,
};
const completeBrief = {
  eventKind: "corporate" as const, date: "2026-11-14", startTime: "18:00", guestCount: 80,
  venueType: "salón", city: "Bogotá", address: "Calle de prueba", contactName: "Contacto de prueba",
  contactEmail: "test@example.invalid", companyName: "Empresa de prueba", contactPermission: true, addressPermission: true,
};

function mutator(initial: unknown): BriefMutator {
  let state = parseEventBriefState(initial);
  return async (mutate) => {
    state = parseEventBriefState(mutate(structuredClone(state), 7));
    return { state, version: 8 };
  };
}

test("approved summary and delivered brief preserve package price, source, freshness, and disclosures", async () => {
  const state = parseEventBriefState({ brief: completeBrief, standardPackage: packageProposal });
  const store = mutator(state);
  const proposed = await applyAdvisorTool({
    call: { nombre: "propose_summary", args: {} }, operationId: "summary-1", currentCustomerText: "Revísalo", mutateBrief: store,
  });
  const summary = proposed.state.summary?.text ?? "";
  assert.match(summary, /250\.000/);
  assert.match(summary, /Catálogo Happia|postgres/i);
  assert.match(summary, /2026-10-23T10:00:00\.000Z/);
  assert.match(summary, /120 segundos/);
  for (const disclosure of disclosures) assert.ok(summary.includes(disclosure), disclosure);

  const brief = createBriefProjection(state, [], "full");
  assert.equal(brief.standardPackage?.estimate.subtotalCop, 250_000);
  assert.equal(brief.standardPackage?.estimate.source, "postgres");
  assert.equal(brief.standardPackage?.estimate.fetchedAt, "2026-10-23T10:00:00.000Z");
  for (const disclosure of disclosures) assert.ok(brief.standardPackage?.disclosures.includes(disclosure), disclosure);
  const renderedBrief = getBriefDisplayEntries(brief);
  assert.ok(renderedBrief.some(({ label, value }) => label === "Estimado del paquete" && value.includes("250.000")));
  assert.ok(renderedBrief.some(({ label, value }) => label === "Fuente del estimado" && value === "Catálogo Happia"));
  assert.ok(renderedBrief.some(({ label, value }) => label === "Actualidad del catálogo" && value.includes("2026-10-23T10:00:00.000Z")));
  for (const disclosure of disclosures) assert.ok(renderedBrief.some(({ value }) => value === disclosure), disclosure);
});

test("streaming and restored package cards retain catalogue freshness and unknown-fit disclosures", () => {
  const state = { directionOffers: [], standardPackage: packageProposal, summary: null, approval: null };
  const streamed = parseAdvisorEvent({ type: "final", state, progress: { complete: false, completed: 4, required: 5, missing: ["address"] }, briefVersion: 8, messageId: "turn-1" });
  const restored = parseAdvisorSnapshot({ conversation: { id: "conv-1" }, messages: [], progress: { complete: false, completed: 4, required: 5, missing: ["address"] }, briefVersion: 8, state });
  for (const cards of [streamed?.type === "final" ? streamed.cards : [], restored?.cards ?? []]) {
    const card = cards.find(({ kind }) => kind === "package");
    assert.ok(card);
    assert.match(card.description, /2026-10-23/);
    assert.match(card.description, /tipo de evento/);
    assert.match(card.description, /temáticas/);
    assert.match(card.description, /ciudad/);
    assert.match(card.description, /capacidad para 80/);
    assert.match(card.source ?? "", /Catálogo Happia/);
  }
});
