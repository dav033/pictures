import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { validateDeployedReport } from "./deployed-report";

type Finding = { id: string; severity: string; status: string; taskReferences: string[] };
type AuditFindings = { schema: "audit-findings/1"; revision: string; taskReferences: string[]; findings: Finding[] };
type IntegrationResults = {
  schema: "integration-results/1"; revision: string; task: string; milestone: string; mode: string;
  invocation: string; commands: string[]; outcome: string;
  checks: string[];
  runs: Array<{ revision: string; task: string; command: string; outcome: string }>;
};

const SHA = /^[a-f0-9]{40}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);

function parseFindings(value: unknown): AuditFindings {
  if (!isRecord(value) || value.schema !== "audit-findings/1" || !SHA.test(String(value.revision ?? ""))
    || !isStringArray(value.taskReferences) || value.taskReferences.length === 0 || !Array.isArray(value.findings)) {
    throw new Error("Malformed audit-findings/1 header or findings list.");
  }
  const findings: Finding[] = value.findings.map((item, index) => {
    if (!isRecord(item) || typeof item.id !== "string" || item.id.length === 0
      || typeof item.severity !== "string" || !["critical", "high", "medium", "low", "info"].includes(item.severity.toLowerCase())
      || typeof item.status !== "string" || !["open", "closed", "accepted"].includes(item.status.toLowerCase())
      || !isStringArray(item.taskReferences) || item.taskReferences.length === 0) {
      throw new Error(`Malformed audit finding at index ${index}; id, severity, status and taskReferences are required.`);
    }
    return { id: item.id, severity: item.severity.toLowerCase(), status: item.status.toLowerCase(), taskReferences: item.taskReferences };
  });
  return { schema: "audit-findings/1", revision: String(value.revision), taskReferences: value.taskReferences, findings };
}

function parseIntegrationResults(value: unknown): IntegrationResults {
  if (!isRecord(value) || value.schema !== "integration-results/1" || !SHA.test(String(value.revision ?? ""))
    || typeof value.task !== "string" || !/^T\d+$/i.test(value.task)
    || typeof value.milestone !== "string" || !/^M\d+$/i.test(value.milestone)
    || !["fake-model", "live"].includes(String(value.mode))
    || typeof value.invocation !== "string" || !isStringArray(value.commands)
    || typeof value.outcome !== "string" || !isStringArray(value.checks) || !Array.isArray(value.runs)) {
    throw new Error("Malformed integration-results/1 report.");
  }
  for (const [index, run] of value.runs.entries()) {
    if (!isRecord(run) || !SHA.test(String(run.revision ?? "")) || typeof run.task !== "string"
      || typeof run.command !== "string" || run.command.length === 0 || !["passed", "failed"].includes(String(run.outcome))) {
      throw new Error(`Malformed integration command result at index ${index}.`);
    }
  }
  return value as IntegrationResults;
}

/** Validates a stored integration report on its own: well-formed, every command linked and passed. */
export function validateIntegrationReport(report: unknown): void {
  if (isRecord(report) && report.schema === "deployed-integration-results/1") {
    validateDeployedReport(report);
    return;
  }
  const integration = parseIntegrationResults(report);
  if (integration.outcome !== "passed") throw new Error("Integration outcome must be passed.");
  if (integration.runs.length === 0 || integration.runs.some((run) => run.outcome !== "passed")) {
    throw new Error("Every integration command must have passed.");
  }
  const runCommands = new Set(integration.runs.map((run) => run.command));
  if (integration.commands.some((item) => !runCommands.has(item)) || integration.runs.some((run) => !integration.commands.includes(run.command))) {
    throw new Error("Every integration command must link to a recorded command result.");
  }
  if (!integration.commands.includes("npm run build") || !integration.commands.includes("npm run start")) {
    throw new Error("Integration report lacks the build and start commands.");
  }
}

export function validateFindingsEvidence(input: {
  findings: unknown;
  integrationResults: unknown;
  task: string;
  knownTasks: readonly string[];
  expectedRevision: string;
}): void {
  const findings = parseFindings(input.findings);
  const integration = parseIntegrationResults(input.integrationResults);
  if (!SHA.test(input.expectedRevision)) throw new Error("Expected revision must be a full git SHA.");
  if (findings.revision !== input.expectedRevision || integration.revision !== input.expectedRevision) {
    throw new Error("Audit and integration evidence must match the expected revision.");
  }
  if (integration.task !== input.task || !findings.taskReferences.includes(input.task)) {
    throw new Error(`Task linkage is missing for ${input.task}.`);
  }
  if (integration.outcome !== "passed") throw new Error("Integration outcome must be passed.");
  if (input.task === "T7" && integration.mode !== "live") throw new Error("T7 acceptance evidence requires the live Gemini and Supabase run.");
  if (input.task === "T7") {
    const requiredChecks = [
      "user login and persisted conversation creation",
      "real Gemini text conversation and proposed summary",
      "same-device reload restores persisted conversation",
      "correction persisted and invalidated stale summary",
      "corrected summary has a new version",
      "approved brief is persisted and visible to the user",
      "admin API and page deny advisor role",
      "admin login sees approved brief",
      "provider failure is reported and the customer message remains persisted",
    ];
    const missing = requiredChecks.filter((check) => !integration.checks.includes(check));
    if (missing.length) throw new Error(`Required M1 integration step missing: ${missing.join(", ")}`);
  }
  if (integration.runs.length === 0 || integration.runs.some((run) => run.revision !== input.expectedRevision
    || run.task !== input.task || run.outcome !== "passed")) {
    throw new Error("Every integration command must pass on the same revision and task.");
  }
  const command = integration.invocation;
  if (!command.includes("scripts/e2e/asesor/run.ts") || !command.includes("--start")
    || !command.includes(integration.mode === "live" ? "--live" : "--fake-model")
    || !command.includes(`--milestone ${integration.milestone}`) || !command.includes(`--task ${input.task}`)
    || !integration.commands.includes("npm run build") || !integration.commands.includes("npm run start")) {
    throw new Error("Integration command evidence is incomplete or not linked to the M1 real-entry-point run.");
  }
  const runCommands = new Set(integration.runs.map((run) => run.command));
  if (integration.commands.some((item) => !runCommands.has(item))
    || integration.runs.some((run) => !integration.commands.includes(run.command))) {
    throw new Error("Every integration command must link to a recorded command result.");
  }
  const knownTasks = new Set(input.knownTasks);
  const references = [...findings.taskReferences, ...findings.findings.flatMap((finding) => finding.taskReferences)];
  if (!references.length || references.some((reference) => !knownTasks.has(reference))) {
    throw new Error("Audit findings contain absent or unknown task references.");
  }
  const openBlocker = findings.findings.find((finding) => finding.status === "open" && ["critical", "high"].includes(finding.severity));
  if (openBlocker) throw new Error(`Open ${openBlocker.severity} finding: ${openBlocker.id}`);
}

export function validateAuditEditBoundary(changedPaths: readonly string[], reportPath: string, ledgerPath: string): void {
  const allowed = new Set([path.normalize(reportPath), path.normalize(ledgerPath)]);
  const unexpected = changedPaths.map((file) => path.normalize(file)).filter((file) => !allowed.has(file));
  if (unexpected.length) throw new Error(`Audit edits outside findings report and ledger: ${unexpected.join(", ")}`);
}

type CliOptions = { findings: string; results: string; task: string; knownTasks: string[]; revision: string; ledger: string; auditRoot: string; checkAuditDiff: boolean };

export function parseArgs(args: string[]): CliOptions {
  const values = new Map<string, string>();
  const positional: string[] = [];
  let checkAuditDiff = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--check-audit-diff") {
      checkAuditDiff = true;
      continue;
    }
    const equalsIndex = arg.indexOf("=");
    const key = equalsIndex > 0 ? arg.slice(0, equalsIndex) : arg;
    if (key.startsWith("--")) {
      const value = equalsIndex > 0 ? arg.slice(equalsIndex + 1) : args[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${key}.`);
      values.set(key, value);
      if (equalsIndex < 0) index += 1;
      continue;
    }
    positional.push(arg);
  }
  const get = (key: string, fallback?: string) => values.get(key) ?? fallback;
  return {
    findings: path.resolve(get("--findings", positional[0] ?? "reports/audit/audit-findings.json")!),
    results: path.resolve(get("--results", get("--integration-results", "reports/e2e/asesor/integration-results.json"))!),
    task: get("--task", "T7")!,
    knownTasks: (get("--known-tasks", "T7")!).split(",").filter(Boolean),
    revision: get("--revision", "")!,
    ledger: path.resolve(get("--ledger", "reports/audit/ledger.json")!),
    auditRoot: path.resolve(get("--audit-root", "reports/audit")!),
    checkAuditDiff,
  };
}

export function resolveExpectedRevision(input: {
  explicitRevision: string;
  environmentRevision?: string;
  gitRevision?: string;
  findingsRevision: string;
}): { revision: string; fromLedger: boolean } {
  const revision = input.explicitRevision || input.environmentRevision || input.gitRevision || input.findingsRevision;
  if (!SHA.test(revision)) throw new Error("Expected revision must be a full git SHA.");
  return { revision, fromLedger: input.gitRevision === undefined && !input.explicitRevision && !input.environmentRevision };
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}

function changedAuditPaths(root: string): string[] {
  const status = spawnSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", root], { encoding: "utf8" });
  if (status.status !== 0) throw new Error("Unable to inspect audit edit boundary.");
  return status.stdout.split("\0").filter(Boolean).map((entry) => entry.slice(3));
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args);
  const [findings, integrationResults] = await Promise.all([readJson(options.findings), readJson(options.results)]);
  const findingsRevision = isRecord(findings) && typeof findings.revision === "string" ? findings.revision : "";
  const git = options.revision || process.env.AUDIT_EXPECTED_REVISION
    ? undefined : spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  const expected = resolveExpectedRevision({
    explicitRevision: options.revision,
    environmentRevision: process.env.AUDIT_EXPECTED_REVISION,
    gitRevision: git?.status === 0 ? git.stdout.trim() : undefined,
    findingsRevision,
  });
  if (expected.fromLedger) console.log("Git is unavailable; using the findings ledger revision.");
  validateFindingsEvidence({ findings, integrationResults, task: options.task, knownTasks: options.knownTasks, expectedRevision: expected.revision });
  if (options.checkAuditDiff) {
    const worktree = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
    if (worktree.status !== 0) {
      console.log("Git is unavailable; audit edit-boundary check skipped (snapshot gate owns this check).");
    } else {
      validateAuditEditBoundary(changedAuditPaths(options.auditRoot), path.relative(process.cwd(), options.findings), path.relative(process.cwd(), options.ledger));
    }
  }
  console.log("Audit findings and integration evidence are valid.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[FAIL] findings check: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  });
}
