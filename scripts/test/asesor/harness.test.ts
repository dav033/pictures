import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs, resolveExpectedRevision, validateAuditEditBoundary, validateFindingsEvidence, validateIntegrationReport } from "../../e2e/asesor/check-findings";
import { deployedReport } from "../../e2e/asesor/deployed-report";

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
  commands: ["npm run build", "npm run start", "scripts/e2e/asesor/run.ts --start --live --milestone M1 --task T7", "liveEntryPoint", "deployedEntryPoint"],
  runs: ["npm run build", "npm run start", "scripts/e2e/asesor/run.ts --start --live --milestone M1 --task T7", "liveEntryPoint", "deployedEntryPoint"].map((command) => ({ revision, task: "T7", command, outcome: "passed" })),
  liveEntryPoint: { outcome: "passed" },
  deployedEntryPoint: { outcome: "passed" },
  coverageGaps: ["photo scenario not run"],
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

test("findings checker accepts task aliases, fixed status, and every supported severity", () => {
  const severities = ["critical", "high", "medium", "low", "info"];
  const aliasedLedger = {
    ...findings,
    taskReferences: undefined,
    tasks: ["T7"],
    findings: severities.map((severity, index) => ({
      id: `OBS-${index + 1}`, severity, status: "fixed", tasks: ["T7"],
    })),
  };
  assert.doesNotThrow(() => validateFindingsEvidence({ findings: aliasedLedger, integrationResults, task: "T7", knownTasks: ["T7"], expectedRevision: revision }));
  const mixedAliases = {
    ...findings,
    findings: [{ id: "OBS-1", severity: "info", status: "accepted", tasks: ["T7"] }],
  };
  assert.doesNotThrow(() => validateFindingsEvidence({ findings: mixedAliases, integrationResults, task: "T7", knownTasks: ["T7"], expectedRevision: revision }));
  assert.throws(() => validateFindingsEvidence({
    findings: { ...findings, taskReferences: ["T7"], tasks: ["T8"] }, integrationResults,
    task: "T7", knownTasks: ["T7", "T8"], expectedRevision: revision,
  }), /Malformed audit-findings/);
  assert.throws(() => validateFindingsEvidence({
    findings: { ...findings, tasks: ["not-a-task-id"] }, integrationResults,
    task: "T7", knownTasks: ["T7"], expectedRevision: revision,
  }), /Malformed audit-findings/);
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
  assert.throws(() => validateFindingsEvidence({ findings, integrationResults: { ...integrationResults, revision: "b".repeat(40) }, task: "T7", knownTasks: ["T7"], expectedRevision: revision }), /Audit ledger revision a{40} does not match integration evidence revision b{40}/);
  assert.throws(() => validateFindingsEvidence({ findings, integrationResults, task: "T7", knownTasks: ["T7"], expectedRevision: "b".repeat(40) }), /ledger revision a{40} and integration evidence revision a{40} must match expected revision b{40}/);
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
  const defaults = parseArgs([]);
  assert.equal(defaults.task, "");
  assert.deepEqual(defaults.knownTasks, []);
  assert.match(defaults.findings, /docs\/req-020\/T15\.findings\.json$/);
  assert.match(defaults.results, /docs\/req-020\/integration-results\.json$/);
  assert.match(defaults.ledger, /docs\/req-020\/T15\.md$/);
  assert.match(parseArgs(["docs/findings.json", "--findings", "explicit.json"]).findings, /explicit\.json$/);
  assert.throws(() => parseArgs(["--integration-results"]), /Missing value for --integration-results/);
});

test("clean snapshot findings revision falls back to the ledger and validates linked evidence", () => {
  const expected = resolveExpectedRevision({ explicitRevision: "", environmentRevision: "", gitRevision: undefined, findingsRevision: revision });
  assert.deepEqual(expected, { revision, fromLedger: true });
  assert.doesNotThrow(() => validateFindingsEvidence({ findings, integrationResults, task: "T7", knownTasks: ["T7"], expectedRevision: expected.revision }));
  assert.throws(() => validateFindingsEvidence({
    findings, integrationResults: { ...integrationResults, revision: "b".repeat(40) },
    task: "T7", knownTasks: ["T7"], expectedRevision: expected.revision,
  }), /Audit ledger revision a{40} does not match integration evidence revision b{40}/);
  assert.deepEqual(resolveExpectedRevision({ explicitRevision: "", environmentRevision: "b".repeat(40), gitRevision: undefined, findingsRevision: revision }), { revision: "b".repeat(40), fromLedger: false });
  assert.throws(() => resolveExpectedRevision({ explicitRevision: "", gitRevision: undefined, findingsRevision: "invalid" }), /full git SHA/);
});

test("findings CLI reports open blockers and producer tasks before stale integration revisions", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const currentRevision = "a".repeat(40);
  const directory = mkdtempSync(join(tmpdir(), "asesor-findings-cli-"));
  const findingsPath = join(directory, "findings.json");
  const integrationPath = join(directory, "integration-results.json");
  writeFileSync(findingsPath, JSON.stringify({
    schema: "audit-findings/1",
    revision: currentRevision,
    taskReferences: ["T14a", "T14.4a"],
    findings: [{ id: "H1", severity: "high", status: "open", taskReferences: ["T14.4a"] }],
  }));
  writeFileSync(integrationPath, JSON.stringify({
    schema: "integration-results/1",
    revision: "34a3abc1108e2337185a3c2d5721b64cce403aa2",
    task: "T14a",
    milestone: "M1+M2",
    mode: "mixed",
    invocation: "historical integration run",
    commands: [],
    outcome: "failed",
    checks: [],
    runs: [],
  }));
  try {
    const result = spawnSync("npx", [
      "tsx", "--conditions=react-server", "scripts/e2e/asesor/check-findings.ts",
      "--findings", findingsPath, "--integration-results", integrationPath,
      "--revision", currentRevision,
    ], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /Open high finding: H1 \(producer tasks: T14\.4a\)/);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /revision .* does not match/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("findings checker accepts deployed integration evidence", () => {
  const deployed = deployedReport({
    revision, verifiedRevision: revision, origin: "https://advisor.example.com", milestone: "M1",
    startedAt: "2026-10-23T12:00:00.000Z", outcome: "passed", checks: ["advisor route responds"],
  });
  const ledger = {
    schema: "audit-findings/1", revision, tasks: ["T14a"],
    findings: [{ id: "OBS-1", severity: "low", status: "closed", tasks: ["T14a"] }],
  };
  assert.doesNotThrow(() => validateFindingsEvidence({ findings: ledger, integrationResults: deployed, task: "T14a", knownTasks: ["T14a"], expectedRevision: revision }));
});

test("stored integration report validates evidence integrity without requiring product success", () => {
  assert.doesNotThrow(() => validateIntegrationReport(integrationResults));
  const reportedFailure = {
    ...integrationResults,
    outcome: "failed",
    runs: integrationResults.runs.map((run, index) => index === 0 ? { ...run, outcome: "failed", failedOwningTask: "T14.4a" } : run),
  };
  assert.doesNotThrow(() => validateIntegrationReport(reportedFailure));
  assert.throws(() => validateIntegrationReport(reportedFailure, true), /Strict integration results require every outcome to be passed/);
  assert.throws(() => validateIntegrationReport({ ...reportedFailure, runs: reportedFailure.runs.map((run, index) => index === 0 ? { ...run, failedOwningTask: undefined } : run) }), /must name failedOwningTask/);
  const coordinatorPending = {
    ...integrationResults,
    liveEntryPoint: { outcome: "coordinator-pending" },
    deployedEntryPoint: { outcome: "coordinator-pending" },
    runs: integrationResults.runs.map((run) => run.command === "liveEntryPoint" || run.command === "deployedEntryPoint" ? { ...run, outcome: "coordinator-pending" } : run),
  };
  assert.doesNotThrow(() => validateIntegrationReport(coordinatorPending));
  assert.throws(() => validateIntegrationReport(coordinatorPending, true), /Strict integration results require every outcome to be passed/);
  assert.throws(() => validateIntegrationReport({ ...integrationResults, coverageGaps: undefined }), /must list coverageGaps/);
  assert.throws(() => validateIntegrationReport({ ...integrationResults, runs: [...integrationResults.runs, { revision, task: "T14a", command: "run.ts --check-results report.json", outcome: "failed", failedOwningTask: "T14a" }] }), /must not record its own --check-results invocation/);
});

test("run.ts --check-results exits non-zero for a missing report", async () => {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync("npx", ["tsx", "--conditions=react-server", "scripts/e2e/asesor/run.ts", "--check-results", "does-not-exist.json"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
});

test("run.ts --check-results accepts attributed failures unless --strict is requested", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "asesor-results-"));
  const reportPath = join(directory, "integration-results.json");
  const failed = {
    ...integrationResults,
    outcome: "failed",
    runs: integrationResults.runs.map((run, index) => index === 0 ? { ...run, outcome: "failed", failedOwningTask: "T14.4a" } : run),
  };
  writeFileSync(reportPath, JSON.stringify(failed));
  try {
    const accepted = spawnSync("npx", ["tsx", "--conditions=react-server", "scripts/e2e/asesor/run.ts", "--check-results", reportPath], { encoding: "utf8" });
    assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
    const strict = spawnSync("npx", ["tsx", "--conditions=react-server", "scripts/e2e/asesor/run.ts", "--check-results", reportPath, "--strict"], { encoding: "utf8" });
    assert.notEqual(strict.status, 0);
    assert.match(`${strict.stderr}${strict.stdout}`, /Strict integration results require every outcome to be passed/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
