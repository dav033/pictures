import assert from "node:assert/strict";
import { assertLoraCompatibility, LoraCompatibilityError } from "../../src/lib/lora/compatibility";
import { auditStructureCandidates, type StructureCandidate } from "../../src/lib/lora/dataset-builder";
import { configurarPersistenciaTelemetria } from "@sempertex/agente-core";
import { generarConSempertexLora, modeloFluxParaTelemetria, type LoraApplication } from "../../src/lib/ia/kagutsuchi/sempertex-lora";

const candidate = (key: string, sha256: string, groupKey: string, structureTypes: StructureCandidate["structureTypes"], quality?: StructureCandidate["quality"]): StructureCandidate => ({
  key,
  sha256,
  width: 1024,
  height: 1024,
  groupKey,
  structureTypes,
  caption: `eventdecor_structure_v1, ${structureTypes[0]}, organic balloon decoration, installed against the rear wall`,
  quality,
});

const audit = auditStructureCandidates([
  candidate("a.jpg", "a".repeat(64), "event-a", ["arco"]),
  candidate("b.jpg", "b".repeat(64), "event-a", ["semiarco"]),
  candidate("duplicate.jpg", "a".repeat(64), "event-b", ["bouquet"]),
  candidate("people.jpg", "c".repeat(64), "event-c", ["backdrop"], { people: true }),
]);

assert.equal(audit.accepted.length, 2);
assert.equal(audit.rejected.length, 2);
assert.equal(audit.duplicateKeys[0], "duplicate.jpg");
assert.equal(audit.captionAudit.captionsWithExactTrigger, 4);
assert.equal(audit.coverage.trainImages + audit.coverage.validationImages + audit.coverage.testImages, 2);

assert.throws(() => assertLoraCompatibility([
  { artifactId: "product", specialization: "product", providerUrl: "https://v3b.fal.media/product.safetensors", trigger: "eventdecor_style_v2", baseModel: "FLUX.2 [dev]", tokenizerRevision: "r1", resolution: 1024, scale: 0.3 },
  { artifactId: "structure", specialization: "structure", providerUrl: "https://v3b.fal.media/structure.safetensors", trigger: "eventdecor_structure_v1", baseModel: "FLUX.2 [dev]", tokenizerRevision: "r1", resolution: 1024, scale: 0.6 },
]));

assert.throws(() => assertLoraCompatibility([
  { artifactId: "a", specialization: "product", providerUrl: "https://v3b.fal.media/a.safetensors", trigger: "a", baseModel: "FLUX.2 [dev]", tokenizerRevision: "r1", resolution: 1024, scale: 0.3 },
  { artifactId: "b", specialization: "product", providerUrl: "https://v3b.fal.media/b.safetensors", trigger: "b", baseModel: "FLUX.2 [dev]", tokenizerRevision: "r1", resolution: 1024, scale: 0.3 },
]), LoraCompatibilityError);

assert.throws(() => "eventdecor_style_v2, organic balloon arch in a venue", /LORA_MULTI_UNSUPPORTED/);

const prompt = "eventdecor_style_v2, organic balloon arch in a venue";
assert.equal((prompt.match(/eventdecor_style_v2/g) ?? []).length, 1);
assert.equal((prompt.match(/eventdecor_structure_v1/g) ?? []).length, 0);
assert.match(prompt, /^eventdecor_style_v2, organic balloon arch/);

const structureOnlyPrompt = "eventdecor_style_v2, organic balloon arch";
assert.equal((structureOnlyPrompt.match(/eventdecor_style_v2/g) ?? []).length, 0);
assert.equal((structureOnlyPrompt.match(/eventdecor_structure_v1/g) ?? []).length, 1);

// Base mode (FLUX.2 without LoRA weights): an explicit empty list, never a
// trigger. The trigger-free prompt keeps its text; a stray leading trigger the
// base model would not understand is removed.
assert.equal("  organic balloon arch in a venue ", "organic balloon arch in a venue");
assert.equal("eventdecor_style_v3, organic balloon arch", "organic balloon arch");
assert.equal(modeloFluxParaTelemetria([], false), "flux-2/base");
assert.equal(modeloFluxParaTelemetria([], true), "flux-2/base/edit");
const TRAINED: LoraApplication = { path: "https://v3b.fal.media/product.safetensors", trigger: "eventdecor_style_v2", scale: 0.3, specialization: "product" };
assert.equal(modeloFluxParaTelemetria([TRAINED], false), "flux-2/lora");
assert.equal(modeloFluxParaTelemetria([TRAINED], true), "flux-2/lora/edit");

// The fal body, captured without leaving the process (same technique as test-lora-seed.ts).
configurarPersistenciaTelemetria(undefined);
async function capturedFalBody(loras: LoraApplication[], prompt: string): Promise<{ url: string; body: Record<string, unknown> }> {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.FAL_KEY;
  process.env.FAL_KEY = "test-key-never-sent";
  let captured: { url: string; body: Record<string, unknown> } | undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> };
    throw new Error("__CAPTURED__");
  }) as typeof fetch;
  try {
    await generarConSempertexLora(prompt, "3:2", [], { loras });
    assert.fail("the intercepted fetch must abort the call");
  } catch (error) {
    if (!String(error).includes("__CAPTURED__")) throw error;
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = originalKey;
  }
  assert.ok(captured, "payload captured");
  return captured;
}

async function main(): Promise<void> {
  const base = await capturedFalBody([], "organic balloon arch in a garden");
  assert.equal(base.url, "https://queue.fal.run/fal-ai/flux-2/lora", "base uses the same fal pipeline");
  assert.deepEqual(base.body.loras, [], "base mode sends loras: []");
  assert.equal(base.body.prompt, "organic balloon arch in a garden");
  assert.doesNotMatch(String(base.body.prompt), /eventdecor_/, "base mode prompt carries no trigger");

  const trained = await capturedFalBody([TRAINED], "organic balloon arch in a garden");
  assert.deepEqual(trained.body.loras, [{ path: TRAINED.path, scale: TRAINED.scale }]);
  assert.match(String(trained.body.prompt), /^eventdecor_style_v2, organic balloon arch/);

  await assert.rejects(() => generarConSempertexLora("x", "3:2", [], { loras: [TRAINED, { ...TRAINED, trigger: "eventdecor_structure_v1" }] }), /LORA_MULTI_UNSUPPORTED/);
  await assert.rejects(
    // Runtime guard for a caller that bypasses the type: no list is not the base mode.
    () => generarConSempertexLora("x", "3:2", [], { loras: undefined as unknown as LoraApplication[] }),
    /LORA_APPLICATION_REQUIRED/,
  );
  console.log("LoRA specializations: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
