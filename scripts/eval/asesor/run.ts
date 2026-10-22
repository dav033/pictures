import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ChatPort, FragmentoChat, PeticionChat } from "@/lib/ia/nucleo/tipos";
import { runAdvisorTurn } from "@/lib/asesor/agent";
import { parseEventBriefState } from "@/lib/asesor/contracts";
import { calculateBriefProgress } from "@/lib/asesor/progress";
import { ADVISOR_SYSTEM_PROMPT } from "@/lib/asesor/prompts/base";
import type { StoredMessage } from "@/lib/asesor/repository";

type Scenario = { id: string; turns: string[]; attachment?: string };
type ScenarioSet = { schema: "advisor-conversations/1"; scenarios: Scenario[] };
type Mode = "fake-model" | "live";

function parseMode(args: string[]): Mode {
  const selected = args.filter((arg) => arg === "--live" || arg === "--fake-model");
  if (selected.length !== 1) throw new Error("Choose exactly one of --live or --fake-model.");
  return selected[0] === "--live" ? "live" : "fake-model";
}

function fakeChat(): ChatPort {
  return {
    id: "gemini", modelo: "deterministic-advisor-eval",
    async turno() { throw new Error("fake evaluation only supports streaming"); },
    async *turnoStream(_input: PeticionChat): AsyncIterable<FragmentoChat> {
      const text = "Puedo ayudarte a organizarlo. ¿Confirmas qué tipo de evento planeas?";
      yield { tipo: "texto", delta: text };
      yield { tipo: "fin", texto: text, llamadas: [], modelo: "deterministic-advisor-eval", uso: { entrada: 0, salida: 0 } };
    },
  };
}

async function loadScenarios(): Promise<ScenarioSet> {
  const file = path.join(process.cwd(), "scripts/eval/asesor/scenarios.json");
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  assert.equal(typeof parsed, "object");
  assert.ok(parsed !== null && !Array.isArray(parsed));
  const value = parsed as Record<string, unknown>;
  assert.equal(value.schema, "advisor-conversations/1");
  assert.ok(Array.isArray(value.scenarios));
  const scenarios = value.scenarios as Scenario[];
  assert.ok(scenarios.length >= 9, "the versioned scenario set must cover the advisor conversation matrix");
  assert.equal(new Set(scenarios.map(({ id }) => id)).size, scenarios.length, "scenario IDs must be unique");
  return { schema: "advisor-conversations/1", scenarios };
}

async function runScenario(scenario: Scenario, chat: ChatPort): Promise<{ id: string; turns: number; assertions: string[] }> {
  let state: unknown = null;
  const transcript: StoredMessage[] = [];
  const mutateBrief = async (mutate: (input: unknown, version: number) => unknown) => {
    state = mutate(state, state === null ? 0 : 1);
    return { version: state === null ? 0 : 1, state };
  };
  const assertions: string[] = [];
  for (let index = 0; index < scenario.turns.length; index++) {
    const user: StoredMessage = {
      id: `${scenario.id}-${index + 1}`,
      role: "user",
      content: scenario.turns[index],
      attachments: scenario.attachment && index === 0
        ? (() => {
          const data = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/F3sAAAAASUVORK5CYII=", "base64");
          return [{ id: `${scenario.id}-photo`, mimeType: "image/png", byteSize: data.length, data, kind: "inspiration" as const, confirmed: null, preference: "neutral" as const }];
        })()
        : [],
    };
    transcript.push(user);
    let response = "";
    for await (const event of runAdvisorTurn({
      chat,
      messages: [...transcript],
      turnId: user.id,
      mutateBrief,
      readBrief: async () => state,
      appendAssistant: async (id, content) => {
        transcript.push({ id, role: "assistant", content, attachments: [] });
      },
      savePhotoFeedback: async () => true,
    })) {
      if (event.type === "text") response += event.delta;
      if (event.type === "error") throw new Error(`Scenario ${scenario.id} advisor turn failed: ${event.code}`);
    }
    const latest = parseEventBriefState(state);
    const progress = calculateBriefProgress(latest.brief);
    if (latest.summary) assert.equal(progress.complete, true, `${scenario.id}: summary must be gated by complete server progress`);
    if (!/apruebo|confirmo|acepto|estoy de acuerdo/i.test(user.content)) assert.equal(latest.approval, null, `${scenario.id}: approval requires explicit current-turn confirmation`);
    if (scenario.attachment && index === 0) {
      assert.match(response, /confirm/i, `${scenario.id}: photo reading must be presented for customer confirmation`);
      assertions.push("photo confirmation requested");
    }
    assert.doesNotMatch(response, /\b(?:COP|USD)\s*\$?\s*\d|\$\s*\d|\b(?:direction|package)\s*(?:id|#)\s*[:#]?\s*[a-z0-9-]{4,}/i,
      `${scenario.id}: no direction/package ID or price can be claimed without a catalogue adapter result`);
    assertions.push("server completeness and approval gates held");
  }
  // The prompt forbids model-originated catalogue facts unless returned by an available catalogue tool.
  assert.ok(ADVISOR_SYSTEM_PROMPT.includes("precios deben provenir de esos resultados"));
  assertions.push("catalogue claims require sourced tool results");
  return { id: scenario.id, turns: scenario.turns.length, assertions: [...new Set(assertions)] };
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  let chat: ChatPort;
  if (mode === "live") {
    if (!process.env.GEMINI_API_KEY) throw new Error("--live requires GEMINI_API_KEY in the environment.");
    const { crearChatGemini } = await import("@sempertex/agente-core/gemini");
    chat = crearChatGemini();
  } else chat = fakeChat();
  const scenarios = await loadScenarios();
  const outcomes = [];
  for (const scenario of scenarios.scenarios) outcomes.push(await runScenario(scenario, chat));
  // Only scenario identifiers and invariant labels are emitted; model text and input are excluded.
  process.stdout.write(`${JSON.stringify({ schema: "advisor-evaluation/1", mode, model: chat.modelo, outcomes }, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`Advisor evaluation failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});
