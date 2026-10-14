import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";

test("reference blueprint schemas and helpers can be bundled for the browser", async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./reference-blueprint.ts", import.meta.url))],
    bundle: true,
    platform: "browser",
    write: false,
    logLevel: "silent",
    metafile: true,
  });
  assert.ok(result.outputFiles[0]?.text.includes("ReferenceBlueprintV2Schema"));
  // esbuild resolves `server-only` to its index.js (it only throws at runtime), so assert on the bundled inputs instead.
  const inputs = Object.keys(result.metafile.inputs);
  assert.deepEqual(inputs.filter((file) => file.includes("server-only") || file.includes(".server.")), []);
});
