import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createServer, type Server } from "node:http";
import { loadEnvConfig } from "@next/env";
import { runM1Scenario } from "./scenarios/m1";
import { runM2Scenario } from "./scenarios/m2";
import { loadLiveScenarioAudio } from "./scenarios/voice";
import { firmarPedido } from "@/lib/voz/firma";
import { runDeployed } from "./deployed";
import { validateIntegrationReport } from "./check-findings";

type Mode = "fake-model" | "live";
type Options = { start: boolean; mode: Mode; milestone: string; reportPath: string; task: string };

function parseArgs(args: string[]): Options {
  if (args.includes("--help")) {
    console.log("Usage: run.ts --start (--fake-model | --live) --milestone M1|M2 [--task T7] [--report PATH]");
    process.exit(0);
  }
  const value = (name: string, fallback?: string) => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1)
    ?? (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
    ?? fallback;
  const mode: Mode | undefined = args.includes("--fake-model") ? "fake-model" : args.includes("--live") ? "live" : undefined;
  if (!args.includes("--start") || !mode) throw new Error("Required flags: --start and exactly one of --fake-model or --live.");
  if (args.includes("--fake-model") && args.includes("--live")) throw new Error("Choose only one run mode.");
  const milestone = value("--milestone");
  if (milestone !== "M1" && milestone !== "M2") throw new Error("Supported milestones are --milestone M1 and --milestone M2.");
  const task = value("--task", "T7")!;
  if (!/^T\d+$/.test(task)) throw new Error("--task must be a task reference such as T7.");
  return {
    start: true,
    mode,
    milestone,
    task,
    reportPath: path.resolve(value("--report", "reports/e2e/asesor/integration-results.json")!),
  };
}

function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env, shell: process.platform === "win32" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code ?? signal ?? "unknown"}`)));
  });
}

function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (process.platform === "win32" || !child.pid) child.kill("SIGKILL");
      else { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
    }, 5_000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    if (process.platform === "win32" || !child.pid) child.kill("SIGTERM");
    else { try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); } }
  });
}

async function createPasswordHash(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, 64, { N: 16_384, r: 8, p: 1 }, (error, key) => error ? reject(error) : resolve(key));
  });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

function requiredEnvironment(mode: Mode, milestone: string): { env: NodeJS.ProcessEnv; userPassword: string; adminPassword: string } {
  // This runner exercises the Vercel production shape, where `next start` is supported.
  const env: NodeJS.ProcessEnv = { ...process.env, VERCEL: "1", NEXT_TELEMETRY_DISABLED: "1", HOSTNAME: "127.0.0.1" };
  if (mode === "live") {
    const required = ["GEMINI_API_KEY", "SUPABASE_DB_URL", "ASESOR_SESSION_SECRET", "ASESOR_USER_PASSWORD_HASH", "ASESOR_ADMIN_PASSWORD_HASH", "ASESOR_E2E_USER_PASSWORD", "ASESOR_E2E_ADMIN_PASSWORD"];
    if (milestone === "M2") required.push("VOZ_ENABLED", "VOZ_URL", "VOZ_SECRETO", "ASESOR_E2E_AUDIO_FILE");
    const missing = required.filter((name) => !env[name] || (name === "VOZ_ENABLED" && !/^(1|true|yes|si|sí|on)$/i.test(env[name]!)));
    if (missing.length) throw new Error(`Live ${milestone} dependencies missing: ${missing.join(", ")}`);
    return { env, userPassword: env.ASESOR_E2E_USER_PASSWORD!, adminPassword: env.ASESOR_E2E_ADMIN_PASSWORD! };
  }
  const testDatabase = env.ASESOR_TEST_DATABASE_URL;
  if (!testDatabase) throw new Error("ASESOR_TEST_DATABASE_URL is required for --fake-model.");
  env.SUPABASE_DB_URL = testDatabase;
  env.ASESOR_E2E_FAKE_MODEL = "1";
  if (milestone === "M2") {
    env.VOZ_ENABLED = "true";
    env.VOZ_SECRETO = randomBytes(32).toString("base64url");
  }
  env.ASESOR_SESSION_SECRET = randomBytes(48).toString("base64url");
  const userPassword = `e2e-user-${randomBytes(24).toString("hex")}`;
  const adminPassword = `e2e-admin-${randomBytes(24).toString("hex")}`;
  return { env, userPassword, adminPassword };
}

async function reservePort(): Promise<number> {
  const { createServer } = await import("node:net");
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to reserve local port.");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForReady(origin: string, child: ChildProcess, spawnError: () => string | null): Promise<void> {
  const deadline = Date.now() + 90_000;
  let lastStatus = "no response";
  while (Date.now() < deadline) {
    const error = spawnError();
    if (error) throw new Error(`Unable to start npm run start: ${error}`);
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Next start exited before readiness (${child.exitCode ?? child.signalCode}).`);
    try {
      const response = await fetch(`${origin}/asesor/login`, { signal: AbortSignal.timeout(2_000) });
      if (response.status === 200) return;
      lastStatus = `HTTP ${response.status}`;
    } catch (error) {
      lastStatus = error instanceof Error ? error.name : "connection error";
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Next start did not become ready in 90 seconds (${lastStatus}).`);
}

export async function run(options: Options): Promise<void> {
  loadEnvConfig(process.cwd());
  const setup = requiredEnvironment(options.mode, options.milestone);
  const providerFailureToken = randomBytes(48).toString("base64url");
  setup.env.ASESOR_E2E_PROVIDER_FAILURE_TOKEN = providerFailureToken;
  if (options.mode === "fake-model") {
    setup.env.ASESOR_USER_PASSWORD_HASH = await createPasswordHash(setup.userPassword);
    setup.env.ASESOR_ADMIN_PASSWORD_HASH = await createPasswordHash(setup.adminPassword);
  }
  const commands: string[] = [];
  const runs: Array<{ revision: string; task: string; command: string; outcome: "passed" | "failed" }> = [];
  const checks: string[] = [];
  const revisionResult = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  const revision = revisionResult.status === 0 ? revisionResult.stdout.trim() : "unknown";
  const startedAt = new Date().toISOString();
  let child: ChildProcess | undefined;
  let transcriptionStub: Server | undefined;
  let outcome: "passed" | "failed" = "failed";
  let failure: string | undefined;
  const trackedCommand = async (label: string, command: string, args: string[]) => {
    commands.push(label);
    const run: { revision: string; task: string; command: string; outcome: "passed" | "failed" } = { revision, task: options.task, command: label, outcome: "failed" };
    runs.push(run);
    await runCommand(command, args, setup.env);
    run.outcome = "passed";
  };
  try {
    let audio: Buffer | undefined;
    if (options.milestone === "M2") {
      if (options.mode === "fake-model") {
        audio = Buffer.from([82, 73, 70, 70, 1, 2, 3, 4]);
        transcriptionStub = createServer(async (request, response) => {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const body = Buffer.concat(chunks);
          const timestamp = Number(request.headers["x-voz-timestamp"]);
          const signature = request.headers["x-voz-firma"];
          const valid = request.method === "POST" && request.url === "/v1/transcribir"
            && request.headers["content-type"] === "audio/wav"
            && Number.isSafeInteger(timestamp)
            && signature === firmarPedido(setup.env.VOZ_SECRETO!, timestamp, body);
          response.writeHead(valid ? 200 : 401, { "content-type": "application/json" });
          response.end(valid ? JSON.stringify({ texto: "Voz de prueba para la recepción.", duracion_s: 1, ms: 1 }) : JSON.stringify({ error: "invalid request" }));
        });
        await new Promise<void>((resolve, reject) => {
          transcriptionStub!.once("error", reject);
          transcriptionStub!.listen(0, "127.0.0.1", resolve);
        });
        const address = transcriptionStub.address();
        if (!address || typeof address === "string") throw new Error("Unable to start the transcription stub.");
        setup.env.VOZ_URL = `http://127.0.0.1:${address.port}`;
      } else {
        audio = await loadLiveScenarioAudio(setup.env.ASESOR_E2E_AUDIO_FILE!);
      }
    }
    await trackedCommand("npm run build --workspaces --if-present", "npm", ["run", "build", "--workspaces", "--if-present"]);
    await trackedCommand("npm run build", "npm", ["run", "build"]);
    if (options.mode === "fake-model") {
      await trackedCommand("npx tsx --conditions=react-server scripts/migrate-asesor.ts --test-target", "npx", ["tsx", "--conditions=react-server", "scripts/migrate-asesor.ts", "--test-target"]);
    }
    const port = await reservePort();
    setup.env.PORT = String(port);
    setup.env.HOSTNAME = "127.0.0.1";
    setup.env.APP_ORIGINS = `http://127.0.0.1:${port}`;
    commands.push("npm run start");
    const startRun: { revision: string; task: string; command: string; outcome: "passed" | "failed" } = { revision, task: options.task, command: "npm run start", outcome: "failed" };
    runs.push(startRun);
    child = spawn("npm", ["run", "start"], {
      stdio: "inherit", env: setup.env, detached: process.platform !== "win32",
    });
    let startError: string | null = null;
    child.once("error", (error) => { startError = error.message; });
    const origin = `http://127.0.0.1:${port}`;
    await waitForReady(origin, child, () => startError);
    startRun.outcome = "passed";
    const scenarioCommand = `scripts/e2e/asesor/run.ts --start --${options.mode} --milestone ${options.milestone} --task ${options.task}`;
    commands.push(scenarioCommand);
    const scenarioRun: { revision: string; task: string; command: string; outcome: "passed" | "failed" } = { revision, task: options.task, command: scenarioCommand, outcome: "failed" };
    runs.push(scenarioRun);
    const result = options.milestone === "M1"
      ? await runM1Scenario({
        origin,
        userPassword: setup.userPassword,
        adminPassword: setup.adminPassword,
        live: options.mode === "live",
        providerFailureToken,
      })
      : await runM2Scenario({
        origin,
        userPassword: setup.userPassword,
        adminPassword: setup.adminPassword,
        live: options.mode === "live",
        audio: audio!,
      });
    checks.push(...result.checks);
    scenarioRun.outcome = "passed";
    outcome = "passed";
  } catch (error) {
    failure = error instanceof Error ? error.message : "Unknown E2E failure";
    throw error;
  } finally {
    if (child) await terminate(child);
    if (transcriptionStub) await new Promise<void>((resolve, reject) => transcriptionStub!.close((error) => error ? reject(error) : resolve()));
    const report = {
      schema: "integration-results/1",
      milestone: options.milestone,
      task: options.task,
      revision,
      mode: options.mode,
      invocation: `npx tsx --conditions=react-server scripts/e2e/asesor/run.ts --start --${options.mode === "live" ? "live" : "fake-model"} --milestone ${options.milestone} --task ${options.task}`,
      startedAt,
      completedAt: new Date().toISOString(),
      commands,
      runs,
      outcome,
      checks,
      ...(failure ? { failure } : {}),
    };
    await mkdir(path.dirname(options.reportPath), { recursive: true });
    await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(`${options.milestone} ${outcome}; evidence: ${options.reportPath}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--deployed")) {
    runDeployed(process.argv.slice(2)).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "Deployed check failed");
      process.exitCode = 1;
    });
  } else {
  const args = process.argv.slice(2);
  const checkIndex = args.indexOf("--check-results");
  if (checkIndex >= 0) {
    const file = args[checkIndex + 1];
    if (!file || file.startsWith("--")) throw new Error("--check-results requires a report path.");
    const strict = args.includes("--strict");
    readFile(path.resolve(file), "utf8")
      .then((text) => validateIntegrationReport(JSON.parse(text) as unknown, strict))
      .then(() => console.log(`Integration report is valid: ${file}`))
      .catch((error: unknown) => {
        console.error(`[FAIL] asesor results: ${error instanceof Error ? error.message : "unknown error"}`);
        process.exitCode = 1;
      });
  } else {
  const options = parseArgs(args);
  run(options).catch((error: unknown) => {
    console.error(`[FAIL] asesor ${options.milestone}: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  });
  }
  }
}
