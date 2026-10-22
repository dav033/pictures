const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const sha = /^[a-f0-9]{40}$/;

export function verifiedDeploymentRevision(value: unknown, expected: string): string {
  if (!record(value) || value.schema !== "asesor-deployment/1" || typeof value.revision !== "string"
    || !sha.test(value.revision) || value.revision !== expected) {
    throw new Error("Published advisor revision does not match the requested release.");
  }
  return value.revision;
}

export function deployedReport(input: {
  revision: string; verifiedRevision?: string; origin: string; milestone: string; startedAt: string;
  outcome: "passed" | "failed"; checks: string[]; failure?: string;
}) {
  const command = `scripts/e2e/asesor/run.ts --live --deployed --origin ${input.origin} --revision ${input.revision} --milestone ${input.milestone}`;
  const result = {
    schema: "deployed-integration-results/1", task: "T14a", mode: "live", target: "deployed",
    ...input, completedAt: new Date().toISOString(), invocation: command,
    commands: [command], runs: [{ revision: input.revision, task: "T14a", command, outcome: input.outcome }],
  };
  if (input.outcome === "passed") validateDeployedReport(result);
  return result;
}

export function validateDeployedReport(value: unknown): void {
  if (!record(value) || value.schema !== "deployed-integration-results/1" || value.mode !== "live"
    || value.target !== "deployed" || value.outcome !== "passed" || typeof value.revision !== "string"
    || !sha.test(value.revision) || value.verifiedRevision !== value.revision
    || typeof value.task !== "string" || !/^T\d+[a-z]?(?:\.\d+[a-z]?)*$/.test(value.task)
    || typeof value.milestone !== "string" || !/^M[12]$/.test(value.milestone)
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
  const command = `scripts/e2e/asesor/run.ts --live --deployed --origin ${value.origin} --revision ${value.revision} --milestone ${value.milestone}`;
  const run: unknown = value.runs[0];
  if (value.invocation !== command || !record(run) || run.revision !== value.revision || run.task !== value.task
    || run.command !== command || run.outcome !== "passed") throw new Error("Deployed command evidence does not match its revision and task.");
}
