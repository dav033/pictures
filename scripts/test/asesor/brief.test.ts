import assert from "node:assert/strict";
import { test } from "node:test";
import { createBriefGetHandler, createBriefProjection } from "@/lib/asesor/brief";
import { getBriefDisplayEntries } from "@/lib/asesor/brief-display";
import { EventBriefSchema, parseEventBriefState } from "@/lib/asesor/contracts";
import { applyAdvisorTool, type BriefMutator } from "@/lib/asesor/tools";
import type { LlamadaHerramienta } from "@/lib/ia/nucleo/tipos";

const suppliedBrief = EventBriefSchema.parse({
  eventKind: "birthday", eventName: "Cumpleaños", date: "2026-11-14", startTime: "15:00", endTime: "19:00", guestCount: 24,
  venueType: "casa", venueName: "Casa Jardín", address: "Calle 18 # 20-30", city: "Bogotá", department: "Cundinamarca",
  budget: 2_500_000, currency: "COP", honoreeName: "Sofía Pérez", honoreeAge: 8, theme: "Jardín", colors: ["lila", "verde"],
  style: "natural", organiserPriority: "personalise", likes: "Flores", dislikes: "Globos metálicos",
  brandRequests: "Contactar a Ana Pérez al 3001234567 o ana@example.test; entregar en Calle 18 # 20-30; presupuesto COP $2,500,000",
  proposedPackage: "Arco floral", contactName: "Ana Pérez", contactPhone: "3001234567", contactEmail: "ana@example.test",
  contactPermission: true, addressPermission: true, notes: "Ana Pérez, ana@example.test, 3001234567. Enviar a Calle 18 # 20-30.",
});

function toolCall(name: string, args: Record<string, unknown>): LlamadaHerramienta { return { nombre: name, args }; }

function makeMutator(initial: unknown): { mutateBrief: BriefMutator; read: () => unknown; revision: () => number } {
  let state = initial;
  let revision = 1;
  const mutateBrief: BriefMutator = async (mutate) => {
    const next = mutate(state, revision);
    if (JSON.stringify(next) !== JSON.stringify(state)) { state = next; revision += 1; }
    return { state, version: revision };
  };
  return { mutateBrief, read: () => state, revision: () => revision };
}

test("correcting a summarized field advances the summary version and requires fresh approval", async () => {
  const store = makeMutator({ brief: suppliedBrief, summary: null, summarySequence: 0, approval: null, refused: { contact: false, address: false } });
  const first = await applyAdvisorTool({ call: toolCall("propose_summary", {}), operationId: "proposal-1", currentCustomerText: "Revísalo", mutateBrief: store.mutateBrief });
  assert.equal(first.state.summary?.version, 1);
  await applyAdvisorTool({ call: toolCall("save_event_fields", { theme: "Bosque" }), operationId: "edit-1", currentCustomerText: "Cámbialo a bosque", mutateBrief: store.mutateBrief });
  assert.equal(parseEventBriefState(store.read()).brief.eventKind, "birthday");
  assert.equal(parseEventBriefState(store.read()).approval, null);
  assert.equal(parseEventBriefState(store.read()).summary, null);
  const second = await applyAdvisorTool({ call: toolCall("propose_summary", {}), operationId: "proposal-2", currentCustomerText: "Mira la corrección", mutateBrief: store.mutateBrief });
  assert.equal(second.state.summary?.version, 2, String((second.result as { message: string }).message));
  const approval = await applyAdvisorTool({ call: toolCall("approve_summary", { summaryVersion: 2 }), operationId: "approve-1", currentCustomerText: "Confirmo el resumen", mutateBrief: store.mutateBrief, now: () => new Date("2026-10-20T12:00:00.000Z") });
  const revisionAfterApproval = store.revision();
  const repeated = await applyAdvisorTool({ call: toolCall("approve_summary", { summaryVersion: 2 }), operationId: "approve-2", currentCustomerText: "Confirmo el resumen", mutateBrief: store.mutateBrief, now: () => new Date("2026-10-20T13:00:00.000Z") });
  assert.equal(approval.state.approval?.summaryVersion, 2);
  assert.deepEqual(repeated.state.approval, approval.state.approval);
  assert.equal(store.revision(), revisionAfterApproval);
});

test("full brief retains R11 fields and vendor projection excludes personal fields and echoed personal text", () => {
  const state = parseEventBriefState({
    brief: suppliedBrief,
    summary: { version: 4, briefVersion: 9, text: "contains private fields" },
    summarySequence: 4,
    approval: { summaryVersion: 4, confirmedAt: "2026-10-20T12:00:00.000Z" },
  });
  const photos = [{ id: "photo-1", mimeType: "image/jpeg", thumbnailUrl: "data:image/jpeg;base64,AA==" }];
  const full = createBriefProjection(state, photos, "full");
  assert.equal(full.brief.budget, 2_500_000);
  assert.equal(full.brief.address, "Calle 18 # 20-30");
  assert.equal(full.brief.likes, "Flores");
  assert.equal(full.brief.dislikes, "Globos metálicos");
  assert.equal(full.brief.organiserPriority, "personalise");
  assert.equal(full.brief.honoreeName, "Sofía Pérez");
  assert.equal(full.brief.proposedPackage, "Arco floral");
  assert.equal(full.photos[0].id, "photo-1");
  assert.ok(getBriefDisplayEntries(full).some((entry) => entry.label === "Homenajeado/a" && entry.value === "Sofía Pérez"));

  const echoedPrivateData = parseEventBriefState({ ...state, brief: {
    ...state.brief,
    eventName: "Celebración de Ana Pérez al 3001234567",
    venueName: "ana@example.test · Calle 18 # 20-30",
    proposedPackage: "Diseño para Ana Pérez en Calle 18 # 20-30",
  }, summary: { ...state.summary, text: "Ana Pérez, 3001234567, ana@example.test, Calle 18 # 20-30" } });
  const vendor = createBriefProjection(echoedPrivateData, photos, "vendor");
  const serialized = JSON.stringify(vendor);
  for (const key of ["contactName", "contactPhone", "contactEmail", "contactPermission", "addressPermission", "address", "budget", "honoreeName"]) {
    assert.ok(!(key in vendor.brief), `vendor projection leaked ${key}`);
  }
  for (const value of ["Ana Pérez", "3001234567", "ana@example.test", "Calle 18 # 20-30", "2500000", "2,500,000"]) {
    assert.ok(!serialized.includes(value), `vendor projection leaked ${value}`);
  }
  assert.equal(vendor.brief.likes, "Flores");
  assert.deepEqual(vendor.photos, photos);
  assert.equal(vendor.approval, null);
});

test("brief API authorizes before storage and returns only the requested server projection", async () => {
  const state = { brief: suppliedBrief, summary: { version: 1, briefVersion: 1, text: "customer only" }, summarySequence: 1, approval: { summaryVersion: 1, confirmedAt: "today" } };
  const repository = {
    async upsertAccount(externalId: string) { return { id: externalId }; },
    async getConversation(id: string) { return id === "event-1" ? { id, accountId: "advisor:user", title: null, updatedAt: "today" } : null; },
    async latestBrief() { return { conversationId: "event-1", version: 3, state }; },
    async listMessages() { return [{ id: "photo-message", role: "user" as const, content: "", attachments: [{ id: "photo-1", mimeType: "image/jpeg", byteSize: 1, data: Buffer.from([1]) }] }]; },
  };
  const handler = createBriefGetHandler({
    authorize: (request) => request.headers.get("authorization") === "Bearer customer" ? { role: "user" } : Response.json({ code: "ADVISOR_UNAUTHENTICATED" }, { status: 401 }),
    repository: () => repository,
    thumbnail: async () => "data:image/jpeg;base64,AA==",
  });
  const denied = await handler(new Request("https://example.test/api/asesor/briefs/event-1"), { params: Promise.resolve({ id: "event-1" }) });
  assert.equal(denied.status, 401);
  const response = await handler(new Request("https://example.test/api/asesor/briefs/event-1?projection=vendor", { headers: { authorization: "Bearer customer" } }), { params: Promise.resolve({ id: "event-1" }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const body = await response.json() as { projection: string; brief: Record<string, unknown>; photos: Array<{ id: string }> };
  assert.equal(body.projection, "vendor");
  assert.ok(!("budget" in body.brief));
  assert.ok(!JSON.stringify(body).includes("Ana Pérez"));
  assert.equal(body.photos[0].id, "photo-1");
});
