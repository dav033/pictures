import assert from "node:assert/strict";
import { test } from "node:test";
import { analysisCacheKey } from "./analysis-cache-key.server";

const parts = {
  model: "mock-model",
  systemPromptHash: "prompt",
  images: [{ image_id: "REF_01", mime: "image/jpeg", base64: "YWJj" }],
};

test("analysis cache keys preserve the existing SHA-256 and default schema version", () => {
  assert.equal(analysisCacheKey(parts), "f0f77be88413ca9cd778d35ea8f5f0947a602b02e3261e3531d11886d0a32466");
  assert.equal(analysisCacheKey({ ...parts, schemaVersion: "2.0" }), analysisCacheKey(parts));
  assert.equal(analysisCacheKey({ ...parts, schemaVersion: "3.0" }), "58fe2013bf22326e84669ee2c51981fad9be5de5cf01b6dc11a02e6b2dbefda7");
});

test("analysis cache keys preserve all image fields and their ordered hashing", () => {
  const images = [...parts.images, { image_id: "REF_02", mime: "image/png", base64: "ZGVm" }];
  assert.equal(analysisCacheKey({ ...parts, images }), "c11c269cee07f979a407050be29c08c07172ee68b5d2635231380a12c08b4816");
  assert.equal(analysisCacheKey({ ...parts, images: [...images].reverse() }), "7b22a4b009d38c24bd23c6fce384e8f23d17a5e54fcced9f4a4af654270e44de");
  for (const field of ["image_id", "mime", "base64"] as const) {
    assert.notEqual(analysisCacheKey({ ...parts, images: [{ ...parts.images[0]!, [field]: "changed" }] }), analysisCacheKey(parts));
  }
  assert.notEqual(analysisCacheKey({ ...parts, model: "changed" }), analysisCacheKey(parts));
  assert.notEqual(analysisCacheKey({ ...parts, systemPromptHash: "changed" }), analysisCacheKey(parts));
});
