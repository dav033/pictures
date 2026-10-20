import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

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
      || typeof run.command !== "string" || !["passed", "failed"].includes(String(run.outcome))) {
      throw new Error(`Malformed integration command result at index ${index}.`);
    }
  }
  return value as IntegrationResults;
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

type CliOptions = { findings: string; results: string; task: string; knownTasks: string[]; revision: string; ledger: string; auditRoot: string };

function parseArgs(args: string[]): CliOptions {
  const get = (key: string, fallback?: string) => args.find((arg) => arg.startsWith(`${key}=`))?.slice(key.length + 1)
    ?? (args.includes(key) ? args[args.indexOf(key) + 1] : undefined) ?? fallback;
  return {
    findings: path.resolve(get("--findings", "reports/audit/audit-findings.json")!),
    results: path.resolve(get("--results", "reports/e2e/asesor/integration-results.json")!),
    task: get("--task", "T7")!,
    knownTasks: (get("--known-tasks", "T7")!).split(",").filter(Boolean),
    revision: get("--revision", "")!,
    ledger: path.resolve(get("--ledger", "reports/audit/ledger.json")!),
    auditRoot: path.resolve(get("--audit-root", "reports/audit")!),
  };
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
  if (!options.revision) {
    const revision = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
    if (revision.status !== 0) throw new Error("Unable to resolve expected git revision.");
    options.revision = revision.stdout.trim();
  }
  const [findings, integrationResults] = await Promise.all([readJson(options.findings), readJson(options.results)]);
  validateFindingsEvidence({ findings, integrationResults, task: options.task, knownTasks: options.knownTasks, expectedRevision: options.revision });
  validateAuditEditBoundary(changedAuditPaths(options.auditRoot), path.relative(process.cwd(), options.findings), path.relative(process.cwd(), options.ledger));
  console.log("Audit findings and integration evidence are valid.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[FAIL] findings check: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  });
}
