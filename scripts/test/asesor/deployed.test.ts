import assert from "node:assert/strict";
import { test } from "node:test";
import { deployedOptions } from "../../e2e/asesor/deployed";
import { deployedReport, verifiedDeploymentRevision } from "../../e2e/asesor/deployed-report";
import { validateIntegrationReport } from "../../e2e/asesor/check-findings";

const env = { ASESOR_E2E_USER_PASSWORD: "test-user", ASESOR_E2E_ADMIN_PASSWORD: "test-admin",
  ASESOR_E2E_DEPLOYED_URL: "https://example.invalid", ASESOR_E2E_DEPLOYED_REVISION: "a".repeat(40) };
const args = ["--live", "--deployed", "--milestone", "M1"];

test("deployed mode resolves a remote origin and exact release", () => {
  const options = deployedOptions(args, env);
  assert.equal(options.origin, env.ASESOR_E2E_DEPLOYED_URL);
  assert.equal(options.revision, env.ASESOR_E2E_DEPLOYED_REVISION);
  assert.equal(options.milestone, "M1");
});

test("deployed mode cannot silently run locally or use fake providers", () => {
  for (const extra of ["--start", "--fake-model"]) assert.throws(() => deployedOptions([...args, extra], env));
  assert.throws(() => deployedOptions(args.filter((item) => item !== "--live"), env));
});

test("deployed mode validates target and credentials before HTTP", () => {
  for (const url of ["http://example.invalid", "https://user:password@example.invalid", "https://example.invalid/path", "https://example.invalid?token=x"]) {
    assert.throws(() => deployedOptions(args, { ...env, ASESOR_E2E_DEPLOYED_URL: url }));
  }
  assert.throws(() => deployedOptions(args, { ...env, ASESOR_E2E_DEPLOYED_REVISION: "main" }));
  assert.throws(() => deployedOptions(args, { ...env, ASESOR_E2E_ADMIN_PASSWORD: "" }));
});

test("deployed producer emits evidence accepted by the shared validator without local build/start", () => {
  const report = deployedReport({ revision: env.ASESOR_E2E_DEPLOYED_REVISION,
    verifiedRevision: env.ASESOR_E2E_DEPLOYED_REVISION, origin: env.ASESOR_E2E_DEPLOYED_URL,
    milestone: "M1", outcome: "passed", checks: ["authenticated scenario completed"], startedAt: new Date().toISOString() });
  assert.doesNotThrow(() => validateIntegrationReport(report));
  assert.throws(() => validateIntegrationReport({ ...report, verifiedRevision: "b".repeat(40) }));
  assert.throws(() => validateIntegrationReport({ ...report, runs: [{ ...report.runs[0], revision: "b".repeat(40) }] }));
  assert.throws(() => validateIntegrationReport({ ...report, schema: "integration-results/1" }));
});

test("published release identity must match the expected full SHA", () => {
  const revision = env.ASESOR_E2E_DEPLOYED_REVISION;
  assert.equal(verifiedDeploymentRevision({ schema: "asesor-deployment/1", revision }, revision), revision);
  for (const value of [null, { revision }, { schema: "asesor-deployment/1", revision: "b".repeat(40) }, { schema: "asesor-deployment/1", revision: revision.slice(0, 12) }]) {
    assert.throws(() => verifiedDeploymentRevision(value, revision));
  }
});
