const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const sha = /^[a-f0-9]{40}$/;

export function verifiedDeploymentRevision(value: unknown, expected: string): string {
  if (!record(value) || value.schema !== "asesor-deployment/1" || typeof value.revision !== "string"
    || !sha.test(value.revision) || value.revision !== expected) {
    throw new Error("Published advisor revision does not match the requested release.");
  }
  return value.revision;
}

/** The recorded invocation; `--task` appears only when the run named one, so earlier T14a reports stay valid. */
function deployedCommand(origin: string, revision: string, milestone: string, task?: string): string {
  return `scripts/e2e/asesor/run.ts --live --deployed --origin ${origin} --revision ${revision} --milestone ${milestone}${task ? ` --task ${task}` : ""}`;
}

export function deployedReport(input: {
  revision: string; verifiedRevision?: string; origin: string; milestone: string; startedAt: string;
  outcome: "passed" | "failed"; checks: string[]; failure?: string; task?: string;
}) {
  const task = input.task ?? "T14a";
  const command = deployedCommand(input.origin, input.revision, input.milestone, input.task);
  const result = {
    schema: "deployed-integration-results/1", mode: "live", target: "deployed",
    ...input, task, completedAt: new Date().toISOString(), invocation: command,
    commands: [command], runs: [{ revision: input.revision, task, command, outcome: input.outcome }],
  };
  if (input.outcome === "passed") validateDeployedReport(result);
  return result;
}

export function validateDeployedReport(value: unknown): void {
  if (!record(value) || value.schema !== "deployed-integration-results/1" || value.mode !== "live"
    || value.target !== "deployed" || value.outcome !== "passed" || typeof value.revision !== "string"
    || !sha.test(value.revision) || value.verifiedRevision !== value.revision
    || typeof value.task !== "string" || !/^T\d+[a-z]?(?:\.\d+[a-z]?)*$/.test(value.task)
    || typeof value.milestone !== "string" || !/^M[123]$/.test(value.milestone)
    || typeof value.origin !== "string" || typeof value.invocation !== "string"
    || !Array.isArray(value.checks) || value.checks.length === 0 || !value.checks.every((x) => typeof x === "string" && x.length > 0)
    || !Array.isArray(value.commands) || value.commands.length !== 1 || value.commands[0] !== value.invocation
    || !Array.isArray(value.runs) || value.runs.length !== 1) {
    throw new Error("Malformed or unsuccessful deployed-integration-results/1 report.");
  }
  const url = new URL(value.origin);
  if (url.origin !== value.origin || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error("Invalid deployed report origin.");
  }
  const run: unknown = value.runs[0];
  const command = deployedCommand(value.origin, value.revision, value.milestone, value.task === "T14a" ? undefined : value.task);
  if (value.invocation !== command || !record(run) || run.revision !== value.revision || run.task !== value.task
    || run.command !== command || run.outcome !== "passed") throw new Error("Deployed command evidence does not match its revision and task.");
}
