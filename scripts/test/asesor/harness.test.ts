import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAuditEditBoundary, validateFindingsEvidence } from "../../e2e/asesor/check-findings";

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
});

test("audit edits are limited to the findings report and ledger", () => {
  assert.doesNotThrow(() => validateAuditEditBoundary(["reports/audit/audit-findings.json", "reports/audit/ledger.json"], "reports/audit/audit-findings.json", "reports/audit/ledger.json"));
  assert.throws(() => validateAuditEditBoundary(["reports/audit/audit-findings.json", "reports/audit/README.md"], "reports/audit/audit-findings.json", "reports/audit/ledger.json"), /outside findings report and ledger/);
});
