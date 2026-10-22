import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatPort, FragmentoChat, LlamadaHerramienta } from "@/lib/ia/nucleo/tipos";
import { parseEventBriefState } from "@/lib/asesor/contracts";
import { runAdvisorTurn } from "@/lib/asesor/agent";

const complete = { eventKind: "corporate", date: "2026-11-14", startTime: "18:00", guestCount: 80,
  venueType: "salón", city: "Bogotá", address: "Calle de prueba", contactName: "Contacto de prueba",
  contactEmail: "test@example.invalid", companyName: "Empresa de prueba", contactPermission: true, addressPermission: true };

async function turn(initial: unknown, calls: LlamadaHerramienta[] = [], stopAfterTools = false) {
  let state = parseEventBriefState(initial);
  let version = 1;
  let count = 0;
  const chat: ChatPort = {
    id: "gemini", modelo: "summary-test",
    async turno() { throw new Error("unused"); },
    async *turnoStream(): AsyncIterable<FragmentoChat> {
      if (stopAfterTools && count > 0) throw new Error("completed summary must not require another model call");
      yield { tipo: "texto", delta: "Datos recibidos." };
      yield { tipo: "fin", texto: "Datos recibidos.", llamadas: count++ === 0 ? calls : [],
        modelo: "summary-test", uso: { entrada: 1, salida: 1 } };
    },
  };
  const events = [];
  for await (const event of runAdvisorTurn({ chat, turnId: "summary-turn",
    messages: [{ id: "summary-turn", role: "user", content: "Corrige el tema a Terraza azul.", attachments: [] }],
    mutateBrief: async (mutate) => { state = parseEventBriefState(mutate(structuredClone(state), version++)); return { state, version }; },
    readBrief: async () => state, appendAssistant: async () => {},
  })) events.push(event);
  assert.equal(events.at(-1)?.type, "final");
  return state;
}

test("complete facts produce a persisted summary even when the model omits propose_summary", async () => {
  const state = await turn({ brief: complete });
  assert.ok(state.summary);
  assert.equal(state.summary.version, 1);
  assert.equal(state.approval, null);
});

test("incomplete facts never produce a summary automatically", async () => {
  const state = await turn({ brief: { ...complete, venueType: null } });
  assert.equal(state.summary, null);
  assert.equal(state.approval, null);
});

test("a complete correction regenerates the summary and requires new approval", async () => {
  const state = await turn({ brief: { ...complete, theme: "Jardín" },
    summary: { version: 4, briefVersion: 1, text: "Old approved summary" }, summarySequence: 4,
    approval: { summaryVersion: 4, confirmedAt: "2026-10-22T00:00:00Z" },
  }, [{ nombre: "save_event_fields", args: { theme: "Terraza azul" } }]);
  assert.equal(state.summary?.version, 5);
  assert.match(state.summary.text, /Terraza azul/);
  assert.equal(state.approval, null);
});

test("a persisted summary completes without a redundant provider round trip", async () => {
  const state = await turn({ brief: complete }, [{ nombre: "propose_summary", args: {} }], true);
  assert.ok(state.summary);
  assert.equal(state.approval, null);
});
