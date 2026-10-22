import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

function releaseIdentity(revision: string) {
  const script = `import {GET} from './src/app/api/asesor/login/route.ts';
    const r=await GET(); console.log(JSON.stringify({status:r.status,cache:r.headers.get('cache-control'),body:await r.json()}));`;
  const child = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", script], {
    encoding: "utf8", timeout: 15_000, env: { ...process.env, REGISTRO_VERSION: revision },
  });
  assert.equal(child.status, 0, child.stderr);
  const result: unknown = JSON.parse(child.stdout);
  assert.ok(typeof result === "object" && result !== null && !Array.isArray(result));
  return result as Record<string, unknown>;
}

test("public advisor GET exposes only versioned immutable release identity without caching", () => {
  const revision = "a".repeat(40);
  const result = releaseIdentity(revision);
  assert.equal(result.status, 200);
  assert.equal(result.cache, "no-store");
  assert.deepEqual(result.body, { schema: "asesor-deployment/1", revision });
});

test("advisor identity fails closed without a full deployment SHA", () => {
  const result = releaseIdentity("unknown-release");
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { code: "DEPLOYMENT_IDENTITY_UNAVAILABLE" });
});
