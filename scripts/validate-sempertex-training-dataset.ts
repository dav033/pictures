import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const DATABASE_PATH = argument("--database", "data/processed/sempertex-training-final-database-v001.json");
const REPORT_PATH = argument("--report", "data/reports/sempertex-training-v001/validation.json");

type RecordItem = {
  selectionId: string;
  imageRole: "venue_scene" | "assembled_decoration" | "product";
  localImage: string;
  imageSha256: string;
  width: number;
  height: number;
  qualityStatus: string;
  caption: string;
  triggerToken: string;
  searchText: string;
  variants: Array<{ sku?: string | null }>;
};

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const database = JSON.parse(await readFile(DATABASE_PATH, "utf-8")) as {
    datasetVersion: string;
    counts: Record<string, number>;
    products: RecordItem[];
  };
  const errors: Array<{ selectionId: string; reason: string }> = [];
  const warnings: Array<{ selectionId: string; reason: string }> = [];
  const hashes = new Map<string, string>();

  for (const item of database.products) {
    const expectedTrigger = item.imageRole === "product" ? "sempertex_product_v1" : "eventdecor_style_v1";
    if (item.qualityStatus !== "approved") errors.push({ selectionId: item.selectionId, reason: `quality:${item.qualityStatus}` });
    if (item.triggerToken !== expectedTrigger || !item.caption.startsWith(`${expectedTrigger},`)) {
      errors.push({ selectionId: item.selectionId, reason: "trigger_mismatch" });
    }
    if (/<[^>]+>|font-family|font-size|background-color|\{\s*color\s*:/i.test(item.caption)) {
      errors.push({ selectionId: item.selectionId, reason: "caption_contains_html_or_style" });
    }
    if (item.caption.length > 1800) warnings.push({ selectionId: item.selectionId, reason: `long_caption:${item.caption.length}` });
    if (Math.min(item.width, item.height) < 512) errors.push({ selectionId: item.selectionId, reason: "short_side_below_512" });

    const imagePath = path.resolve(item.localImage);
    const stem = imagePath.slice(0, -path.extname(imagePath).length);
    const captionPath = `${stem}.txt`;
    const licensePath = `${stem}.license.json`;
    if (!await exists(imagePath)) errors.push({ selectionId: item.selectionId, reason: "image_missing" });
    if (!await exists(captionPath)) errors.push({ selectionId: item.selectionId, reason: "caption_sidecar_missing" });
    if (!await exists(licensePath)) errors.push({ selectionId: item.selectionId, reason: "license_sidecar_missing" });

    if (await exists(imagePath)) {
      const hash = createHash("sha256").update(await readFile(imagePath)).digest("hex");
      if (hash !== item.imageSha256) errors.push({ selectionId: item.selectionId, reason: "sha256_mismatch" });
      const prior = hashes.get(hash);
      if (prior) errors.push({ selectionId: item.selectionId, reason: `duplicate_of:${prior}` });
      else hashes.set(hash, item.selectionId);
    }
    if (await exists(captionPath)) {
      const sidecar = (await readFile(captionPath, "utf-8")).trim();
      if (sidecar !== item.caption) errors.push({ selectionId: item.selectionId, reason: "caption_sidecar_mismatch" });
    }
    if (await exists(licensePath)) {
      const license = JSON.parse(await readFile(licensePath, "utf-8")) as { owner?: string; source?: string; license?: string };
      if (license.owner !== "Sempertex" || !license.source || !license.license) {
        errors.push({ selectionId: item.selectionId, reason: "license_incomplete" });
      }
    }

    const skus = item.variants.map((variant) => variant.sku).filter((sku): sku is string => Boolean(sku));
    for (const sku of skus) {
      if (!item.searchText.includes(sku)) errors.push({ selectionId: item.selectionId, reason: `sku_missing_from_search_text:${sku}` });
    }
    if (skus.length && !skus.some((sku) => item.caption.includes(sku))) {
      warnings.push({ selectionId: item.selectionId, reason: "caption_has_no_sku_reference" });
    }
  }

  const roleCounts = Object.fromEntries(["venue_scene", "assembled_decoration", "product"].map((role) => [
    role,
    database.products.filter((item) => item.imageRole === role).length,
  ]));
  if (database.products.length !== 200) errors.push({ selectionId: "dataset", reason: `count:${database.products.length}` });
  if (roleCounts.venue_scene !== 15 || roleCounts.assembled_decoration !== 105 || roleCounts.product !== 80) {
    errors.push({ selectionId: "dataset", reason: `role_counts:${JSON.stringify(roleCounts)}` });
  }

  const report = {
    datasetVersion: database.datasetVersion,
    validatedAt: new Date().toISOString(),
    status: errors.length ? "failed" : "passed",
    counts: {
      records: database.products.length,
      uniqueHashes: hashes.size,
      roles: roleCounts,
      errors: errors.length,
      warnings: warnings.length,
    },
    errors,
    warnings,
  };
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  console.log(JSON.stringify({ report: path.resolve(REPORT_PATH), ...report.counts, status: report.status }, null, 2));
  if (errors.length) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
