import assert from "node:assert/strict";

type Options = { origin: string; cookie: string; conversationId: string };
type Event = { type: string; data: Record<string, unknown> };

async function send(options: Options, content: string): Promise<Event[]> {
  const response = await fetch(`${options.origin}/api/asesor/conversar`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: options.origin, cookie: options.cookie },
    body: JSON.stringify({ conversationId: options.conversationId, turnId: crypto.randomUUID(), content }),
  });
  assert.equal(response.status, 200);
  const events: Event[] = [];
  for (const block of (await response.text()).split("\n\n")) {
    const type = block.match(/^event: ([^\n]+)/m)?.[1];
    const data = block.match(/^data: (.+)$/m)?.[1];
    if (type && data) events.push({ type, data: JSON.parse(data) as Record<string, unknown> });
  }
  assert.equal(events.at(-1)?.type, "final");
  return events;
}

function latestState(events: Event[]): Record<string, unknown> {
  const state: unknown = events.at(-1)?.data.state;
  assert.equal(typeof state, "object");
  assert.ok(state !== null);
  return state as Record<string, unknown>;
}

export async function runDirectionsScenario(options: Options): Promise<string[]> {
  const shown = await send(options, "Aún no sé qué idea elegir.");
  assert.equal(shown.filter((event) => event.type === "tool" && event.data.name === "show_directions").length, 1,
    "one customer request must produce one show_directions tool result");
  const shownState = latestState(shown);
  const offers = shownState.directionOffers as Array<Record<string, unknown>>;
  assert.equal(offers.length, 12, "customer did not receive twelve configured directions");
  assert.ok(offers.every((offer) => typeof offer.photoUrl === "string" && typeof offer.provenance === "object"));
  const selectedId = String(offers[11]?.id);
  const beforeBrief = shownState.brief as Record<string, unknown>;
  const selected = await send(options, `Quiero elegir esta dirección: ${selectedId}`);
  assert.equal(selected.filter((event) => event.type === "tool" && event.data.name === "select_direction").length, 1,
    "one customer selection must produce one select_direction tool result");
  const state = latestState(selected);
  assert.equal(state.selectedDirectionId, selectedId, "offered direction reference was not stored");
  assert.deepEqual(state.brief, beforeBrief, "direction selection changed existing event fields");
  return ["twelve configured direction cards shown", "selected direction persisted while event fields remained unchanged"];
}
