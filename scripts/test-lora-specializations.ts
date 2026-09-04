import assert from "node:assert/strict";
import { assertLoraCompatibility, LoraCompatibilityError } from "../src/lib/lora/compatibility";
import { auditStructureCandidates, type StructureCandidate } from "../src/lib/lora/dataset-builder";
import { ensureLoraTriggers } from "../src/lib/ia/sempertex-lora";

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

assert.doesNotThrow(() => assertLoraCompatibility([
  { artifactId: "product", specialization: "product", providerUrl: "https://v3b.fal.media/product.safetensors", trigger: "eventdecor_style_v2", baseModel: "FLUX.2 [dev]", tokenizerRevision: "r1", resolution: 1024, scale: 0.3 },
  { artifactId: "structure", specialization: "structure", providerUrl: "https://v3b.fal.media/structure.safetensors", trigger: "eventdecor_structure_v1", baseModel: "FLUX.2 [dev]", tokenizerRevision: "r1", resolution: 1024, scale: 0.6 },
]));

assert.throws(() => assertLoraCompatibility([
  { artifactId: "a", specialization: "product", providerUrl: "https://v3b.fal.media/a.safetensors", trigger: "a", baseModel: "FLUX.2 [dev]", tokenizerRevision: "r1", resolution: 1024, scale: 0.3 },
  { artifactId: "b", specialization: "product", providerUrl: "https://v3b.fal.media/b.safetensors", trigger: "b", baseModel: "FLUX.2 [dev]", tokenizerRevision: "r1", resolution: 1024, scale: 0.3 },
]), LoraCompatibilityError);

const prompt = ensureLoraTriggers("eventdecor_style_v2, organic balloon arch in a venue", [
  { path: "https://v3b.fal.media/product.safetensors", trigger: "eventdecor_style_v2", scale: 0.3, specialization: "product" },
  { path: "https://v3b.fal.media/structure.safetensors", trigger: "eventdecor_structure_v1", scale: 0.6, specialization: "structure" },
]);
assert.equal((prompt.match(/eventdecor_style_v2/g) ?? []).length, 1);
assert.equal((prompt.match(/eventdecor_structure_v1/g) ?? []).length, 1);
assert.match(prompt, /^eventdecor_style_v2, eventdecor_structure_v1,/);

const structureOnlyPrompt = ensureLoraTriggers("eventdecor_style_v2, organic balloon arch", [
  { path: "https://v3b.fal.media/structure.safetensors", trigger: "eventdecor_structure_v1", scale: 0.6, specialization: "structure" },
]);
assert.equal((structureOnlyPrompt.match(/eventdecor_style_v2/g) ?? []).length, 0);
assert.equal((structureOnlyPrompt.match(/eventdecor_structure_v1/g) ?? []).length, 1);

console.log("LoRA specializations: OK");
