import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  LoraDatasetManifestSchema,
  LoraTrainingReceiptSchema,
} from "../src/lib/lora/schema";
import { createLocalLoraArtifactStore } from "../src/lib/lora/artifact-store-local";
import { normalizeArtifactKey } from "../src/lib/lora/artifact-store";

async function main(): Promise<void> {
  const imageSha = "a".repeat(64);
  const captionSha = "b".repeat(64);
  const zipSha = "c".repeat(64);
  const manifest = LoraDatasetManifestSchema.parse({
    schemaVersion: "lora-dataset-manifest.v1",
    dataset: { id: "dataset-test", label: "fixture", trigger: "eventdecor_style_v2", imageCount: 1, captionCount: 1, zipSha256: zipSha },
    sourceDefinition: { kind: "fixture" },
    images: [{
      key: "001.jpg",
      imageSha256: imageSha,
      captionSha256: captionSha,
      width: 1200,
      height: 800,
      mimeType: "image/jpeg",
      source: { kind: "legacy_import", ref: "fixture" },
      captionWordCount: 4,
      reviewStatus: "confirmed",
      metadata: {},
      elements: [{
        elementKind: "structure",
        canonicalId: "structure:arch",
        label: "Arco",
        evidenceKind: "controlled_caption",
      }],
    }],
    statistics: { structures: [], shopifyVariants: [], environment: [], spatialRelations: [] },
  });
  assert.equal(manifest.images.length, 1);
  assert.throws(() => LoraDatasetManifestSchema.parse({
    ...manifest,
    dataset: { ...manifest.dataset, imageCount: 2 },
  }));

  const receipt = LoraTrainingReceiptSchema.parse({
    schemaVersion: "lora-training-receipt.v1",
    trainingRun: {
      id: "run-test",
      label: "fixture-run",
      datasetId: "dataset-test",
      datasetSha256: zipSha,
      provider: "fal",
      trainerEndpoint: "fal-ai/test",
      steps: 1000,
      learningRate: 0.00005,
    },
    result: { weightSha256: "d".repeat(64), weightBytes: 10, rank: 16 },
    evaluation: { protocolVersion: "v1", loraScale: 0.8, passedCount: 5, totalCount: 6, verdict: "approved" },
  });
  assert.equal(receipt.evaluation.verdict, "approved");

  assert.equal(normalizeArtifactKey("datasets/test/manifest.json"), "datasets/test/manifest.json");
  assert.throws(() => normalizeArtifactKey("../secret.txt"));
  assert.throws(() => normalizeArtifactKey("/secret.txt"));

  const root = await mkdtemp(path.join(os.tmpdir(), "lora-registry-test-"));
  try {
    const store = createLocalLoraArtifactStore(root);
    const contents = new TextEncoder().encode("fixture artifact");
    const saved = await store.put("runs/run-test/receipt.json", contents);
    assert.equal(saved.bytes, contents.byteLength);
    assert.equal(await store.exists(saved.key), true);
    assert.deepEqual(await store.read(saved.key), Buffer.from(contents));
    await store.remove(saved.key);
    assert.equal(await store.exists(saved.key), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  console.log("[PASS] contratos y artifact store LoRA");
}

main().catch((error) => {
  console.error("[FAIL] test-lora-registry", error);
  process.exitCode = 1;
});
