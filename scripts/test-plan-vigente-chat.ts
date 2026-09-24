/**
 * Offline, no network, no LLM: `planVigenteDelTurno` (src/lib/ia/herramientas/registro-herramientas.ts)
 * is the non-model evidence that decides `hayPropuestaVigente` for §7 "editar
 * una propuesta desde el chat" — it must never trust the browser's plan
 * without verifying the signed token first (signature, TTL,
 * `backend === "python"`, matching `plan_hash`).
 *
 * Run: npx tsx --conditions=react-server scripts/test-plan-vigente-chat.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.PLAN_APPROVAL_SECRET = "local-plan-vigente-chat-secret-20260916";
process.env.DATABASE_URL = "postgresql://demo:demo@127.0.0.1:5432/demo_rag";
process.env.PYTHON_BACKEND_URL = "http://python.test";
process.env.INTERNAL_HMAC_SECRET = "local-only-secret-0123456789abcdef";

const SNAPSHOT = "products_catalog:test";
const PLAN_HASH = "a".repeat(64);
const OTRO_PLAN_HASH = "b".repeat(64);
const REQUEST_ID = "00000000-0000-4000-8000-000000000001";

type Json = Record<string, unknown>;

function esObjeto(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function leerFixture(nombre: string): Json {
  const parsed: unknown = JSON.parse(readFileSync(join(process.cwd(), "contracts", "domain", "v1", "fixtures", nombre), "utf8"));
  assert.ok(esObjeto(parsed));
  return parsed;
}

async function main(): Promise<void> {
  const { planVigenteDelTurno } = await import("../src/lib/ia/herramientas/registro-herramientas");
  const { crearTokenPlan } = await import("../src/lib/plan/aprobacion");
  const { BasePlanSchema } = await import("../src/lib/plan/edicion-esquemas");

  // Same fixture `scripts/test-plan-editar-python.ts` sends as `base`: it
  // already round-trips through `BasePlanSchema`, so this test does not need
  // to hand-build a plan shape of its own.
  const fixture = leerFixture("plan-resuelto-ok.json");
  const allowlist = [{ product_id: "prod-rojo", variant_ids: ["var-rojo-12"] }];
  const basePlan = (overrides: { approval_token: string; plan_hash?: string }) => BasePlanSchema.parse({
    ...fixture,
    plan_hash: overrides.plan_hash ?? PLAN_HASH,
    approval_token: overrides.approval_token,
  });

  // 1. Valid python-backed token, matching plan_hash → vigente.
  const tokenValido = crearTokenPlan({ planHash: PLAN_HASH, requestId: REQUEST_ID, backend: "python", catalogSnapshotId: SNAPSHOT, allowlist });
  const vigente = planVigenteDelTurno(basePlan({ approval_token: tokenValido }));
  assert.ok(vigente, "a valid, unexpired, python-backed, matching-hash token is vigente");
  assert.equal(vigente?.base.plan_hash, PLAN_HASH);
  console.log("[PASS] token válido, backend python, plan_hash coincidente → vigente");

  // 2. Expired token → not vigente.
  const tokenExpirado = crearTokenPlan({ planHash: PLAN_HASH, requestId: REQUEST_ID, backend: "python", catalogSnapshotId: SNAPSHOT, allowlist }, -1000);
  assert.equal(planVigenteDelTurno(basePlan({ approval_token: tokenExpirado })), undefined, "an expired token is never vigente");
  console.log("[PASS] token expirado → no vigente");

  // 3. backend "next" → not vigente (the TypeScript resolver was removed, ADR-0023 step 5).
  const tokenNext = crearTokenPlan({ planHash: PLAN_HASH, requestId: REQUEST_ID, backend: "next", catalogSnapshotId: null, allowlist: [] });
  assert.equal(planVigenteDelTurno(basePlan({ approval_token: tokenNext })), undefined, "a \"next\" token is never vigente");
  console.log("[PASS] token backend:\"next\" → no vigente");

  // 4. plan_hash mismatch between the token and the echoed plan → not vigente.
  const tokenDeOtroPlan = crearTokenPlan({ planHash: OTRO_PLAN_HASH, requestId: REQUEST_ID, backend: "python", catalogSnapshotId: SNAPSHOT, allowlist });
  assert.equal(planVigenteDelTurno(basePlan({ approval_token: tokenDeOtroPlan, plan_hash: PLAN_HASH })), undefined, "a token signed for a different plan_hash is never vigente");
  console.log("[PASS] plan_hash que no coincide con el token → no vigente");

  // 5. Undefined candidate (client sent nothing) → not vigente, no crash.
  assert.equal(planVigenteDelTurno(undefined), undefined, "no candidate is exactly as vigente as an invalid one");
  console.log("[PASS] sin candidato → no vigente (aditivo: un cliente que no manda planVigente no rompe nada)");
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error("[FAIL]", error);
    process.exit(1);
  },
);
