import assert from "node:assert/strict";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkRelease, RELEASE_GATES } from "../../e2e/asesor/check-release";
import { deployedReport } from "../../e2e/asesor/deployed-report";

const revision = "a".repeat(40);
const task = "T15.11";
const origins = { vercel: "https://demo-decoracion.vercel.app", vps: "https://185-147-157-25.sslip.io" };

type Bundle = Record<string, unknown>;

function release(): Bundle {
  return {
    schema: "asesor-release/1", revision, task,
    gates: RELEASE_GATES.map((command) => ({ command, exitCode: 0 })),
    vercel: { origin: origins.vercel, deploymentId: "dpl_new", previousDeploymentId: "dpl_old" },
    vps: { origin: origins.vps, releaseDir: `/opt/deployments/pictures/releases/${revision}`, image: `demo-decoracion:${revision}`, rollbackImage: "demo-decoracion:rollback", previousRevision: "b".repeat(40) },
  };
}

async function bundle(mutate: (files: Record<string, unknown>) => void = () => {}): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "release-bundle-"));
  const files: Record<string, unknown> = {
    "release.json": release(),
    "catalogue-live.json": { schema: "happia-catalogue-live/1", checkedAt: "2026-10-25T12:00:00.000Z", status: "available", source: "happia_api", packages: 18, services: 57 },
  };
  for (const target of ["vercel", "vps"] as const) {
    for (const milestone of ["M1", "M2", "M3"]) {
      files[`deployed-${target}-${milestone}.json`] = deployedReport({
        revision, verifiedRevision: revision, origin: origins[target], milestone, task, outcome: "passed",
        checks: ["scenario completed"], startedAt: "2026-10-25T12:00:00.000Z",
      });
    }
  }
  mutate(files);
  for (const [name, value] of Object.entries(files)) await writeFile(path.join(dir, name), JSON.stringify(value));
  return dir;
}

async function rejects(mutate: (files: Record<string, unknown>) => void, pattern: RegExp): Promise<void> {
  const dir = await bundle(mutate);
  try {
    await assert.rejects(checkRelease(dir, task), pattern);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("a complete bundle for the released revision passes", async () => {
  const dir = await bundle();
  try {
    await checkRelease(dir, task);
    await assert.rejects(checkRelease(dir, "T15.12"), /task/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a missing M3 report is rejected", async () => {
  const dir = await bundle();
  try {
    await unlink(path.join(dir, "deployed-vps-M3.json"));
    await assert.rejects(checkRelease(dir, task), /deployed-vps-M3\.json/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a report for another revision is rejected", async () => {
  await rejects((files) => {
    files["deployed-vercel-M2.json"] = deployedReport({
      revision: "c".repeat(40), verifiedRevision: "c".repeat(40), origin: origins.vercel, milestone: "M2", task, outcome: "passed",
      checks: ["scenario completed"], startedAt: "2026-10-25T12:00:00.000Z",
    });
  }, /revision/);
});

test("a failed outcome is rejected", async () => {
  await rejects((files) => {
    files["deployed-vps-M1.json"] = { ...(files["deployed-vps-M1.json"] as Bundle), outcome: "failed" };
  }, /passing deployed report/);
  await rejects((files) => {
    (files["release.json"] as { gates: Array<{ exitCode: number }> }).gates[2]!.exitCode = 1;
  }, /gate/);
});

test("missing or unchanged rollback targets are rejected", async () => {
  await rejects((files) => { delete ((files["release.json"] as Bundle).vps as Bundle).rollbackImage; }, /vps/);
  await rejects((files) => { ((files["release.json"] as Bundle).vercel as Bundle).previousDeploymentId = "dpl_new"; }, /previous Vercel/);
  await rejects((files) => { ((files["release.json"] as Bundle).vps as Bundle).previousRevision = revision; }, /previous revision/);
});

test("reports must match the origins recorded in release.json", async () => {
  await rejects((files) => { ((files["release.json"] as Bundle).vps as Bundle).origin = "https://other.example"; }, /origin/);
});
