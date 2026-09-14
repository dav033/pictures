import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.PLAN_APPROVAL_SECRET = "local-plan-rollback-secret-20260911";
process.env.PYTHON_BACKEND_ENABLED = "true";
process.env.PYTHON_BACKEND_KILL_SWITCH = "true";
process.env.DATABASE_URL = "postgresql://demo:demo@127.0.0.1:5432/demo_rag";

const fixture = JSON.parse(readFileSync(join(process.cwd(), "contracts", "domain", "v1", "fixtures", "plan-resuelto-ok.json"), "utf8")) as Record<string, unknown>;
const planHash = "a".repeat(64);

async function main(): Promise<void> {
  const [{ crearTokenPlan }, { POST: generate }, { POST: edit }] = await Promise.all([
    import("../src/lib/plan/aprobacion"),
    import("../src/app/api/generate/route"),
    import("../src/app/api/plan-editar/route"),
  ]);
  const approvalToken = crearTokenPlan({
    planHash,
    requestId: "00000000-0000-4000-8000-000000000001",
    backend: "python",
    catalogSnapshotId: "snapshot-rollback-smoke",
    allowlist: [{ product_id: "prod-rojo", variant_ids: ["var-rojo-12"] }],
  });
  const approvedPlan = {
    ...fixture,
    plan_hash: planHash,
    approval_token: approvalToken,
  };

  const generationResponse = await generate(new Request("http://127.0.0.1/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan: approvedPlan }),
  }));
  const generationBody = await generationResponse.json() as { causa?: string };
  assert.equal(generationResponse.status, 409);
  assert.equal(generationBody.causa, "PYTHON_NO_SELECCIONADO");

  const editResponse = await edit(new Request("http://127.0.0.1/api/plan-editar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      modo: "aplicar",
      base: approvedPlan,
      edicion: {
        accion: "quitar",
        estructura_id: "EST_01_ARCO",
        objetivo_variant_id: "var-rojo-12",
      },
    }),
  }));
  const editBody = await editResponse.json() as { causa?: string };
  assert.equal(editResponse.status, 409);
  assert.equal(editBody.causa, "PYTHON_NO_SELECCIONADO");

  console.log("[PASS] rollback Python: /api/generate y /api/plan-editar devuelven 409 PYTHON_NO_SELECCIONADO sin re-resolver con TypeScript");
}

main().catch((error: unknown) => {
  console.error(`[FAIL] rollback Python — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
