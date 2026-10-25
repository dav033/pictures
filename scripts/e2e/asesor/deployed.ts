import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { runM1Scenario } from "./scenarios/m1";
import { runM2Scenario } from "./scenarios/m2";
import { runPackageScenario } from "./scenarios/package";
import { loadLiveScenarioAudio } from "./scenarios/voice";
import { deployedReport, verifiedDeploymentRevision } from "./deployed-report";

export function deployedOptions(args: string[], env: Readonly<Record<string, string | undefined>>) {
  if (!args.includes("--deployed") || !args.includes("--live") || args.includes("--start") || args.includes("--fake-model")) {
    throw new Error("Deployed checks require --live --deployed and cannot start a local server.");
  }
  const value = (key: string) => {
    const index = args.indexOf(key);
    return args.find((item) => item.startsWith(`${key}=`))?.slice(key.length + 1)
      ?? (index >= 0 ? args[index + 1] : undefined);
  };
  const milestone = value("--milestone");
  if (milestone !== "M1" && milestone !== "M2" && milestone !== "M3") throw new Error("Supported milestones are M1, M2 and M3.");
  const task = value("--task");
  if (task !== undefined && !/^T\d+[a-z]?(?:\.\d+[a-z]?)*$/.test(task)) throw new Error("--task must be a task reference such as T15.11.");
  const url = new URL(value("--origin") ?? env.ASESOR_E2E_DEPLOYED_URL ?? "");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(loopback && url.protocol === "http:"))
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Deployed origin must be an HTTPS origin without credentials, path, query or fragment.");
  }
  const revision = value("--revision") ?? env.ASESOR_E2E_DEPLOYED_REVISION;
  if (!revision || !/^[0-9a-f]{40}$/.test(revision)) throw new Error("An exact deployed revision is required.");
  const userPassword = env.ASESOR_E2E_USER_PASSWORD;
  const adminPassword = env.ASESOR_E2E_ADMIN_PASSWORD;
  if (!userPassword || !adminPassword) throw new Error("Advisor E2E user/admin passwords are required.");
  return { origin: url.origin, revision, milestone, ...(task ? { task } : {}), userPassword, adminPassword,
    reportPath: path.resolve(value("--report") ?? `reports/e2e/asesor/deployed-${milestone}.json`) };
}

export async function runDeployed(args: string[]): Promise<void> {
  loadEnvConfig(process.cwd());
  const options = deployedOptions(args, process.env);
  const startedAt = new Date().toISOString();
  let checks: string[] = [];
  let verifiedRevision: string | undefined;
  let failure: string | undefined;
  let outcome: "passed" | "failed" = "failed";
  try {
    const ready = await fetch(`${options.origin}/asesor/login`, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    if (ready.status !== 200) throw new Error(`Deployed advisor login returned HTTP ${ready.status}; no credentials sent.`);
    const readRevision = async () => {
      const response = await fetch(`${options.origin}/api/asesor/login`, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`Published advisor identity unavailable (HTTP ${response.status}).`);
      const body: unknown = await response.json();
      return verifiedDeploymentRevision(body, options.revision);
    };
    verifiedRevision = await readRevision();
    const scenario = options.milestone === "M1"
      ? await runM1Scenario({ ...options, live: true })
      : options.milestone === "M3"
        ? await runPackageScenario(options)
        : await runM2Scenario({ ...options, live: true,
          audio: await loadLiveScenarioAudio(process.env.ASESOR_E2E_AUDIO_FILE ?? "") });
    checks = scenario.checks;
    await readRevision();
    outcome = "passed";
  } catch (error) {
    failure = error instanceof Error ? error.message : "Unknown deployed check failure";
    throw error;
  } finally {
    await mkdir(path.dirname(options.reportPath), { recursive: true });
    await writeFile(options.reportPath, JSON.stringify(deployedReport({
      revision: options.revision, verifiedRevision, origin: options.origin, milestone: options.milestone,
      startedAt, outcome, checks, ...(options.task ? { task: options.task } : {}), ...(failure ? { failure } : {}),
    }), null, 2) + "\n", { mode: 0o600 });
    console.log(`Deployed ${options.milestone} ${outcome}; evidence: ${options.reportPath}`);
  }
}
