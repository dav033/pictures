import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { buildReport, renderText } from "./report";
import type { BenchDataset } from "./types";
import { validateDataset, validatePricing } from "./validation";

const REAL_ENV_ACK = "YES_I_ACCEPT_PAID_PROVIDER_AND_REMOTE_DB";
const PAID_CLI_ACK = "I_ACCEPT_PAID_PROVIDER_CALLS";
const DB_CLI_ACK = "I_ACCEPT_REMOTE_DATABASE_ACCESS";

type CliOptions = {
  mode: "fixture" | "real";
  json: boolean;
  driver?: string;
  driverArgs: string[];
  paidAck?: string;
  dbAck?: string;
};

function parseOptions(argv: string[]): CliOptions {
  const options: CliOptions = { mode: "fixture", json: false, driverArgs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") options.json = true;
    else if (argument === "--mode=fixture") options.mode = "fixture";
    else if (argument === "--mode=real") options.mode = "real";
    else if (argument.startsWith("--driver=")) options.driver = argument.slice("--driver=".length);
    else if (argument.startsWith("--ack-paid=")) options.paidAck = argument.slice("--ack-paid=".length);
    else if (argument.startsWith("--ack-remote-db=")) options.dbAck = argument.slice("--ack-remote-db=".length);
    else if (argument === "--") options.driverArgs = argv.slice(index + 1);
    else throw new Error(`Argumento no reconocido: ${argument}`);
    if (argument === "--") break;
  }
  return options;
}

export function assertRealModeGate(
  options: CliOptions,
  environment: Readonly<Record<string, string | undefined>>,
): void {
  if (options.mode !== "real") return;
  const missing: string[] = [];
  if (environment.IA_BENCH_ENABLE_REAL !== REAL_ENV_ACK) {
    missing.push(`IA_BENCH_ENABLE_REAL=${REAL_ENV_ACK}`);
  }
  if (options.paidAck !== PAID_CLI_ACK) missing.push(`--ack-paid=${PAID_CLI_ACK}`);
  if (options.dbAck !== DB_CLI_ACK) missing.push(`--ack-remote-db=${DB_CLI_ACK}`);
  if (!options.driver) missing.push("--driver=<ejecutable instrumentado>");
  if (missing.length > 0) {
    throw new Error(`Modo real bloqueado. Faltan confirmaciones exactas: ${missing.join(", ")}`);
  }
}

async function jsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function runRealDriver(options: CliOptions): Promise<unknown> {
  const driver = options.driver;
  if (!driver) throw new Error("Driver real ausente");
  return await new Promise((resolve, reject) => {
    let timedOut = false;
    const child = spawn(driver, options.driverArgs, {
      shell: false,
      windowsHide: true,
      env: process.env,
      stdio: ["ignore", "pipe", "inherit"],
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 10 * 60 * 1000);
    let output = "";
    const limit = 10 * 1024 * 1024;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (output.length > limit) child.kill();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) return reject(new Error("Driver real superó límite de 10 minutos"));
      if (output.length > limit) return reject(new Error("Salida del driver supera 10 MiB"));
      if (code !== 0) return reject(new Error(`Driver real terminó con código ${code ?? "desconocido"}`));
      try {
        resolve(JSON.parse(output) as unknown);
      } catch {
        reject(new Error("Driver real no devolvió un único JSON válido por stdout"));
      }
    });
  });
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  assertRealModeGate(options, process.env);
  const root = process.cwd();
  const pricing = validatePricing(
    await jsonFile(path.join(root, "eval", "ia", "pricing", "pricing-v001.json")),
  );
  const rawDataset =
    options.mode === "fixture"
      ? await jsonFile(path.join(root, "eval", "ia", "fixtures", "chapter-3-v001.json"))
      : await runRealDriver(options);
  const dataset: BenchDataset = validateDataset(rawDataset);
  if (dataset.procedencia.tipo !== options.mode) {
    throw new Error(`Driver declaró procedencia ${dataset.procedencia.tipo}; se esperaba ${options.mode}`);
  }
  const report = buildReport(dataset, pricing);
  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderText(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`ia:bench falló: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
