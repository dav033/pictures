import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAdvisorEvent, parseAdvisorSnapshot, type AdvisorComposerCard } from "../../../src/components/asesor/conversation-contract";

const progress = { complete: true, completed: 5, required: 5, missing: [] };
const direction = { id: "garden", title: "Jardín luminoso", description: "Flores y globos", photoUrl: "/biblioteca-sempertex/referencias/jardin.jpg",
  provenance: { kind: "real", label: null }, themedItems: { status: "available", items: [{ id: "catalog-1", name: "Paquete floral", price: 125000, source: "package" }] } };
const state = { directionOffers: [direction], standardPackage: { packageId: "pkg-1", name: "Paquete Fiesta", baseGuests: 40, guestCount: 80,
  estimate: { status: "available", subtotalCop: 250000, basis: "before_vat_and_commission", source: "postgres", fetchedAt: "2026-10-23T10:00:00.000Z", snapshotAgeSeconds: 120, notice: "Estimado sujeto a confirmación." },
  coverage: { event: "unknown", theme: "unknown", city: "unknown", guests: "differs_from_base" }, disclosures: ["El catálogo no indica para qué tipo de evento aplica este paquete; hay que confirmarlo.", "El catálogo no indica temáticas para este paquete; no se garantiza que encaje con la temática.", "El catálogo no indica la ciudad de este paquete; no se garantiza cobertura en la ciudad del evento.", "El paquete está pensado para 40 invitados; el costo y la capacidad para 80 se confirman con el equipo."] },
  summary: { version: 3, briefVersion: 8, text: "Evento corporativo en Bogotá." }, approval: { summaryVersion: 3, confirmedAt: "2026-10-23T12:00:00Z" } };

test("restore validates structured cards, sourced prices, summary approval, and photo references", () => {
  const snapshot = parseAdvisorSnapshot({ conversation: { id: "conversation-1" }, messages: [{ id: "turn-1", role: "user", content: "Foto", attachments: [{ id: "photo-1", mimeType: "image/jpeg", byteSize: 12, kind: "venue", confirmed: null, preference: "neutral" }] }], progress, briefVersion: 9, state });
  assert.equal(snapshot?.approved, true);
  assert.equal(snapshot?.summary?.text, "Evento corporativo en Bogotá.");
  assert.equal(snapshot?.messages[0]?.attachments?.[0]?.id, "photo-1");
  assert.equal(snapshot?.cards.length, 2);
  assert.match(snapshot?.cards[0]?.description ?? "", /125\.000/);
  assert.match(snapshot?.cards[0]?.description ?? "", /paquete/);
  assert.equal(snapshot?.cards[0]?.imageUrl, direction.photoUrl);
  assert.match(snapshot?.cards[1]?.description ?? "", /250\.000/);
  assert.match(snapshot?.cards[1]?.description ?? "", /2026-10-23/);
  assert.match(snapshot?.cards[1]?.description ?? "", /no indica temáticas/);
  assert.equal(parseAdvisorSnapshot({ conversation: { id: "conversation-1" }, messages: [], progress, briefVersion: 1, state: { ...state, directionOffers: [{ ...direction, photoUrl: "javascript:alert(1)" }] } }), null);
  assert.equal(parseAdvisorSnapshot({ conversation: { id: "conversation-1" }, messages: [], progress, briefVersion: 1, state: { ...state, directionOffers: [{ ...direction, photoUrl: "//external.invalid/photo.jpg" }] } }), null);
});

test("SSE text, state, terminal, and error events are validated before use", () => {
  assert.deepEqual(parseAdvisorEvent({ type: "text", delta: "Hola" }), { type: "text", delta: "Hola" });
  const final = parseAdvisorEvent({ type: "final", state, progress, briefVersion: 9, messageId: "turn-1:assistant" });
  assert.equal(final?.type, "final");
  if (final?.type === "final") {
    assert.equal(final.approved, true);
    assert.equal(final.summary?.version, 3);
    assert.equal(final.cards[0]?.kind, "direction");
    assert.match(final.cards[1]?.description ?? "", /120 segundos/);
  }
  assert.equal(parseAdvisorEvent({ type: "tool", state: {}, progress, briefVersion: 9 }), null);
  assert.equal(parseAdvisorEvent({ type: "final", state, progress, briefVersion: "9", messageId: "x" }), null);
  assert.equal(parseAdvisorEvent({ type: "error", state, progress: { ...progress, missing: "no" }, briefVersion: 9, message: "Falló" }), null);
});

test("composer card types remain discriminated after fixture parsing", () => {
  const snapshot = parseAdvisorSnapshot({ conversation: { id: "conversation-1" }, messages: [], progress, briefVersion: 9, state });
  const cards: AdvisorComposerCard[] = snapshot?.cards ?? [];
  assert.deepEqual(cards.map(({ kind }) => kind), ["direction", "package"]);
  assert.equal(cards[1]?.content, "Me interesa el paquete Paquete Fiesta.");
});
