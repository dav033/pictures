import assert from "node:assert/strict";
import { configurarPersistenciaTelemetria } from "@sempertex/agente-core";
import { LORA_SEED_MAX, parseLoraSeed, resolveLoraSeed } from "../../src/lib/ia/kagutsuchi/lora-seed";
import { generarConSempertexLora, type LoraApplication } from "../../src/lib/ia/kagutsuchi/sempertex-lora";

/**
 * Optional `seed` for /api/generate (LoRA path), used to calibrate creativity
 * levels with the same seed. Deterministic, no network: fal's fetch is
 * intercepted and aborted before leaving the process (see dump-payload-lora.ts).
 * Run: npx tsx --conditions=react-server scripts/test/test-lora-seed.ts
 */

// The aborted fal call still records an "error" telemetry event; importing
// telemetria-llamadas wires it to Postgres. Unwire it so this test never writes
// to a database, whatever DATABASE_URL the shell carries.
configurarPersistenciaTelemetria(undefined);

const LORA: LoraApplication = { artifactId: "debug-artifact", specialization: "structure", path: "https://example.invalid/debug-lora.safetensors", trigger: "eventdecor_style_v2", scale: 0.8 };

// 1. Runtime validation at the HTTP boundary.
assert.deepEqual(parseLoraSeed(undefined), { ok: true, seed: undefined });
assert.deepEqual(parseLoraSeed(null), { ok: true, seed: undefined });
for (const valid of [0, 1, 42, 2_147_483_647, LORA_SEED_MAX]) {
  assert.deepEqual(parseLoraSeed(valid), { ok: true, seed: valid }, String(valid));
}
assert.equal(LORA_SEED_MAX, 4_294_967_295);
for (const invalid of [-1, 1.5, LORA_SEED_MAX + 1, Number.NaN, Number.POSITIVE_INFINITY, "42", true, {}, [7]]) {
  const parsed = parseLoraSeed(invalid);
  assert.equal(parsed.ok, false, `${String(invalid)} must be rejected`);
  if (!parsed.ok) assert.match(parsed.message, /^LORA_SEED_INVALID: /, "stable error code prefix");
}
console.log("[PASS] seed: integers 0..2^32-1 accepted, anything else is LORA_SEED_INVALID");

// 2. Effective seed: the requested one wins; otherwise one random seed is fixed before calling.
let draws = 0;
const random = () => { draws += 1; return 123_456; };
assert.equal(resolveLoraSeed(7, random), 7);
assert.equal(draws, 0, "a requested seed never draws");
assert.equal(resolveLoraSeed(undefined, random), 123_456);
assert.equal(draws, 1);
const drawn = resolveLoraSeed(undefined);
assert.ok(Number.isInteger(drawn) && drawn >= 0 && drawn <= LORA_SEED_MAX, `default random seed in range: ${drawn}`);
console.log("[PASS] seed: requested seed wins, otherwise a random seed is fixed up front");

// 3. The seed reaches the fal payload unchanged.
async function capturedPayload(seed: number | undefined): Promise<Record<string, unknown>> {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.FAL_KEY;
  // The key only gets past the "not connected" guard; fetch never leaves the process.
  process.env.FAL_KEY = "test-key-never-sent";
  let body: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    throw new Error("__CAPTURED__");
  }) as typeof fetch;
  try {
    await generarConSempertexLora("eventdecor_style_v2, a balloon arch", "3:2", [], { loras: [LORA], ...(seed === undefined ? {} : { seed }) });
    assert.fail("the intercepted fetch must abort the call");
  } catch (error) {
    if (!String(error).includes("__CAPTURED__")) throw error;
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = originalKey;
  }
  assert.ok(body, "payload captured");
  return body;
}

async function main(): Promise<void> {
  assert.equal((await capturedPayload(LORA_SEED_MAX)).seed, LORA_SEED_MAX);
  assert.equal((await capturedPayload(0)).seed, 0, "seed 0 is a real seed, not absent");
  assert.equal("seed" in (await capturedPayload(undefined)), false);
  console.log("[PASS] seed: options.seed reaches the fal payload");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
