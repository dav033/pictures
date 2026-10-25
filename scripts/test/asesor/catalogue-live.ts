// Live read of the real Happia catalogue (counts only). Default: exit 1 unless available with at least one package.
//   catalogue-live.ts [--report PATH]      read live, optionally write happia-catalogue-live/1
//   catalogue-live.ts --check-results PATH validate such a file offline
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0;

export function validateLiveReport(value: unknown): void {
  if (!isRecord(value) || value.schema !== "happia-catalogue-live/1" || typeof value.checkedAt !== "string"
    || !Number.isFinite(Date.parse(value.checkedAt)) || !count(value.packages) || !count(value.services)) {
    throw new Error("Malformed happia-catalogue-live/1 report.");
  }
  if (value.status !== "available" || value.source !== "happia_api" || (value.packages as number) < 1) {
    throw new Error("The live catalogue report is not an available happia_api read with at least one package.");
  }
}

async function main(args: string[]): Promise<void> {
  const valueOf = (flag: string) => {
    const index = args.indexOf(flag);
    if (index < 0) return undefined;
    const next = args[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`${flag} requires a path.`);
    return next;
  };
  const checkPath = valueOf("--check-results");
  if (checkPath) {
    validateLiveReport(JSON.parse(await readFile(path.resolve(checkPath), "utf8")) as unknown);
    console.log(`Live catalogue report is valid: ${checkPath}`);
    return;
  }
  const reportPath = valueOf("--report");
  const { getHappiaCatalogue } = await import("../../../src/lib/asesor/catalogue");
  const result = await getHappiaCatalogue();
  const available = result.status === "available";
  const report = {
    schema: "happia-catalogue-live/1", checkedAt: new Date().toISOString(),
    status: result.status, source: available ? result.source : null,
    packages: available ? result.data.packages.length : 0, services: available ? result.data.services.length : 0,
    ...(available ? {} : { reason: result.reason }),
  };
  if (reportPath) {
    await mkdir(path.dirname(path.resolve(reportPath)), { recursive: true });
    await writeFile(path.resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  }
  console.log(`Happia catalogue ${report.status}: ${report.packages} packages, ${report.services} services`);
  if (!available || report.packages < 1) throw new Error(available ? "The live catalogue has no packages." : `The live catalogue is unavailable (${result.reason}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`[FAIL] happia catalogue live: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  });
}
