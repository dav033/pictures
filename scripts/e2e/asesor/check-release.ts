// Offline check of a release bundle: check-release.ts <dir> --task <id>. Exits 1 unless every record exists, passes and agrees.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateDeployedReport } from "./deployed-report";
import { validateLiveReport } from "../../test/asesor/catalogue-live";

export const RELEASE_GATES = [
  "npm run gate", "npm run happie:test-webhook", "npm run lint",
  "npm run build --workspaces --if-present", "npx tsc --noEmit", "npm run build",
] as const;
const TARGETS = ["vercel", "vps"] as const;
const MILESTONES = ["M1", "M2", "M3"] as const;
const SHA = /^[0-9a-f]{40}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;

async function readJson(file: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    throw new Error(`${label} is missing or is not valid JSON.`);
  }
}

function section(release: Record<string, unknown>, key: string, fields: string[]): Record<string, unknown> {
  const value = release[key];
  if (!isRecord(value) || !fields.every((field) => text(value[field]))) throw new Error(`release.json ${key} must record ${fields.join(", ")}.`);
  return value;
}

export async function checkRelease(dir: string, task: string): Promise<void> {
  const release = await readJson(path.join(dir, "release.json"), "release.json");
  if (!isRecord(release) || release.schema !== "asesor-release/1") throw new Error("release.json must use schema asesor-release/1.");
  const revision = release.revision;
  if (typeof revision !== "string" || !SHA.test(revision)) throw new Error("release.json revision must be a full SHA.");
  if (release.task !== task) throw new Error(`release.json task must be ${task}.`);

  const gates = release.gates;
  if (!Array.isArray(gates) || gates.length !== RELEASE_GATES.length
    || !RELEASE_GATES.every((command) => gates.some((gate) => isRecord(gate) && gate.command === command && gate.exitCode === 0))) {
    throw new Error("release.json must record all six gate commands with exit code 0.");
  }

  const vercel = section(release, "vercel", ["origin", "deploymentId", "previousDeploymentId"]);
  const vps = section(release, "vps", ["origin", "releaseDir", "image", "rollbackImage", "previousRevision"]);
  if (vercel.deploymentId === vercel.previousDeploymentId) throw new Error("The previous Vercel deployment must differ from the released one.");
  if (vps.rollbackImage === vps.image) throw new Error("The VPS rollback image must differ from the released image.");
  if (vps.previousRevision === revision) throw new Error("The VPS previous revision must differ from the released revision.");
  if (!String(vps.image).endsWith(`:${revision}`) || !String(vps.releaseDir).endsWith(revision)) {
    throw new Error("The VPS image and release directory must be those of the released revision.");
  }

  validateLiveReport(await readJson(path.join(dir, "catalogue-live.json"), "catalogue-live.json"));

  for (const target of TARGETS) {
    const origin = target === "vercel" ? vercel.origin : vps.origin;
    for (const milestone of MILESTONES) {
      const label = `deployed-${target}-${milestone}.json`;
      const report = await readJson(path.join(dir, label), label);
      try {
        validateDeployedReport(report);
      } catch {
        throw new Error(`${label} is not a passing deployed report.`);
      }
      const record = report as Record<string, unknown>;
      if (record.revision !== revision) throw new Error(`${label} revision does not match release.json.`);
      if (record.task !== task) throw new Error(`${label} task does not match ${task}.`);
      if (record.milestone !== milestone) throw new Error(`${label} is not a ${milestone} report.`);
      if (record.origin !== origin) throw new Error(`${label} origin does not match release.json.`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const dir = args.find((arg) => !arg.startsWith("--") && args[args.indexOf(arg) - 1] !== "--task");
  const task = args[args.indexOf("--task") + 1];
  if (!dir || args.indexOf("--task") < 0 || !task) {
    console.error("[FAIL] release bundle: usage check-release.ts <dir> --task <id>");
    process.exitCode = 1;
  } else {
    checkRelease(dir, task)
      .then(() => console.log(`Release bundle is valid: ${dir}`))
      .catch((error: unknown) => {
        console.error(`[FAIL] release bundle: ${error instanceof Error ? error.message : "unknown error"}`);
        process.exitCode = 1;
      });
  }
}
