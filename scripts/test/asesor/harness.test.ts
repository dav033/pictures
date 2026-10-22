import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs, resolveExpectedRevision, validateAuditEditBoundary, validateFindingsEvidence, validateIntegrationReport } from "../../e2e/asesor/check-findings";

const revision = "a".repeat(40);
const findings = {
  schema: "audit-findings/1",
  revision,
  taskReferences: ["T7"],
  findings: [{ id: "OBS-1", severity: "medium", status: "closed", taskReferences: ["T7"] }],
};
const integrationResults = {
  schema: "integration-results/1",
  revision,
  task: "T7",
  milestone: "M1",
  mode: "live",
  invocation: "npx tsx --conditions=react-server scripts/e2e/asesor/run.ts --start --live --milestone M1 --task T7",
  commands: ["npm run build", "npm run start", "scripts/e2e/asesor/run.ts --start --live --milestone M1 --task T7"],
  runs: ["npm run build", "npm run start", "scripts/e2e/asesor/run.ts --start --live --milestone M1 --task T7"].map((command) => ({ revision, task: "T7", command, outcome: "passed" })),
  outcome: "passed",
  checks: [
    "user login and persisted conversation creation",
    "real Gemini text conversation and proposed summary",
    "same-device reload restores persisted conversation",
    "correction persisted and invalidated stale summary",
    "corrected summary has a new version",
    "approved brief is persisted and visible to the user",
    "admin API and page deny advisor role",
    "admin login sees approved brief",
    "provider failure is reported and the customer message remains persisted",
  ],
};

function valid() {
  validateFindingsEvidence({ findings, integrationResults, task: "T7", knownTasks: ["T7"], expectedRevision: revision });
}

test("findings checker accepts linked audit and integration evidence", () => {
  assert.doesNotThrow(valid);
});

test("findings checker rejects malformed audit-findings/1 and missing task references", () => {
  assert.throws(() => validateFindingsEvidence({ findings: { ...findings, schema: "audit-findings/0" }, integrationResults, task: "T7", knownTasks: ["T7"], expectedRevision: revision }), /Malformed audit-findings/);
  assert.throws(() => validateFindingsEvidence({ findings: { ...findings, taskReferences: [] }, integrationResults, task: "T7", knownTasks: ["T7"], expectedRevision: revision }), /Malformed audit-findings/);
  const unreferencedFinding = { ...findings, findings: [{ id: "OBS-2", severity: "low", status: "closed", taskReferences: [] }] };
  assert.throws(() => validateFindingsEvidence({ findings: unreferencedFinding, integrationResults, task: "T7", knownTasks: ["T7"], expectedRevision: revision }), /Malformed audit finding/);
  const unknownTask = { ...findings, findings: [{ id: "OBS-3", severity: "low", status: "closed", taskReferences: ["T99"] }] };
  assert.throws(() => validateFindingsEvidence({ findings: unknownTask, integrationResults, task: "T7", knownTasks: ["T7"], expectedRevision: revision }), /unknown task references/);
});

test("findings checker rejects open critical and high findings", () => {
  for (const severity of ["critical", "high"]) {
    const blocked = { ...findings, findings: [{ id: `OPEN-${severity}`, severity, status: "open", taskReferences: ["T7"] }] };
    assert.throws(() => validateFindingsEvidence({ findings: blocked, integrationResults, task: "T7", knownTasks: ["T7"], expectedRevision: revision }), new RegExp(`Open ${severity} finding`));
  }
});

test("T7 findings cannot pass on offline fake-model evidence", () => {
  const offline = { ...integrationResults, mode: "fake-model", invocation: integrationResults.invocation.replace("--live", "--fake-model") };
  assert.throws(() => validateFindingsEvidence({ findings, integrationResults: offline, task: "T7", knownTasks: ["T7"], expectedRevision: revision }), /requires the live Gemini and Supabase run/);
  const skipped = { ...integrationResults, checks: integrationResults.checks.filter((check) => check !== "real Gemini text conversation and proposed summary") };
  assert.throws(() => validateFindingsEvidence({ findings, integrationResults: skipped, task: "T7", knownTasks: ["T7"], expectedRevision: revision }), /Required M1 integration step missing/);
});

test("findings checker links command outcomes, task and revision", () => {
  assert.throws(() => validateFindingsEvidence({ findings, integrationResults: { ...integrationResults, outcome: "failed" }, task: "T7", knownTasks: ["T7"], expectedRevision: revision }), /outcome must be passed/);
  assert.throws(() => validateFindingsEvidence({ findings, integrationResults: { ...integrationResults, revision: "b".repeat(40) }, task: "T7", knownTasks: ["T7"], expectedRevision: revision }), /match the expected revision/);
  const badCommand = { ...integrationResults, invocation: "npm run test", runs: [{ revision, task: "T7", command: "npm run test", outcome: "passed" }] };
  assert.throws(() => validateFindingsEvidence({ findings, integrationResults: badCommand, task: "T7", knownTasks: ["T7"], expectedRevision: revision }), /command evidence is incomplete/);
  const failedCommand = { ...integrationResults, runs: integrationResults.runs.map((run, index) => index === 0 ? { ...run, outcome: "failed" } : run) };
  assert.throws(() => validateFindingsEvidence({ findings, integrationResults: failedCommand, task: "T7", knownTasks: ["T7"], expectedRevision: revision }), /Every integration command must pass/);
  const unlinkedCommand = { ...integrationResults, commands: integrationResults.commands.slice(0, 2) };
  assert.throws(() => validateFindingsEvidence({ findings, integrationResults: unlinkedCommand, task: "T7", knownTasks: ["T7"], expectedRevision: revision }), /link to a recorded command result/);
  const absentResult = { ...integrationResults, runs: integrationResults.runs.filter((run) => run.command !== "npm run build") };
  assert.throws(() => validateFindingsEvidence({ findings, integrationResults: absentResult, task: "T7", knownTasks: ["T7"], expectedRevision: revision }), /link to a recorded command result/);
});

test("audit edits are limited to the findings report and ledger", () => {
  assert.doesNotThrow(() => validateAuditEditBoundary(["reports/audit/audit-findings.json", "reports/audit/ledger.json"], "reports/audit/audit-findings.json", "reports/audit/ledger.json"));
  assert.throws(() => validateAuditEditBoundary(["reports/audit/audit-findings.json", "reports/audit/README.md"], "reports/audit/audit-findings.json", "reports/audit/ledger.json"), /outside findings report and ledger/);
});

test("findings CLI accepts positional reports and the integration-results alias", () => {
  const options = parseArgs(["docs/req-020/T15.findings.json", "--check-audit-diff", "--integration-results", "docs/req-020/integration-results.json"]);
  assert.match(options.findings, /docs\/req-020\/T15\.findings\.json$/);
  assert.match(options.results, /docs\/req-020\/integration-results\.json$/);
  assert.equal(options.checkAuditDiff, true);
  assert.match(parseArgs(["docs/findings.json", "--findings", "explicit.json"]).findings, /explicit\.json$/);
  assert.throws(() => parseArgs(["--integration-results"]), /Missing value for --integration-results/);
});

test("findings revision falls back to the ledger only when Git is unavailable", () => {
  assert.deepEqual(resolveExpectedRevision({ explicitRevision: "", environmentRevision: "", gitRevision: undefined, findingsRevision: revision }), { revision, fromLedger: true });
  assert.deepEqual(resolveExpectedRevision({ explicitRevision: "", environmentRevision: "b".repeat(40), gitRevision: undefined, findingsRevision: revision }), { revision: "b".repeat(40), fromLedger: false });
  assert.throws(() => resolveExpectedRevision({ explicitRevision: "", gitRevision: undefined, findingsRevision: "invalid" }), /full git SHA/);
});

test("stored integration report is validated on its own, without a revision match", () => {
  assert.doesNotThrow(() => validateIntegrationReport(integrationResults));
  assert.throws(() => validateIntegrationReport({ ...integrationResults, outcome: "failed" }), /must be passed/);
  assert.throws(() => validateIntegrationReport({ ...integrationResults, runs: integrationResults.runs.map((run, index) => index ? run : { ...run, outcome: "failed" }) }), /must have passed/);
});

test("run.ts --check-results exits non-zero for a missing report", async () => {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync("npx", ["tsx", "--conditions=react-server", "scripts/e2e/asesor/run.ts", "--check-results", "does-not-exist.json"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
});
