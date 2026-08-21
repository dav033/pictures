import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

type LicenseRecord = {
  source?: unknown;
  license?: unknown;
  owner?: unknown;
};

type ManifestRecord = {
  id: string;
  relative_path: string;
  sha256: string;
  source: string | null;
  license: string | null;
  width: number | null;
  height: number | null;
  split: "train" | "validation" | "test" | null;
  status: "approved" | "quarantine" | "pending_human_review";
  reasons: string[];
};

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MIN_SIDE = 1024;

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function filesRecursively(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesRecursively(fullPath));
    if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
  }
  return files;
}

function dimensions(bytes: Buffer): { width: number; height: number } | null {
  const png = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (png) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };

  const webp = bytes.length >= 30 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (webp && bytes.subarray(12, 16).toString("ascii") === "VP8X") {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    };
  }

  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > bytes.length) break;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    const isStartOfFrame = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
    if (isStartOfFrame && segmentLength >= 7) {
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += segmentLength;
  }
  return null;
}

function normalizedStem(filePath: string): string {
  return path.basename(filePath, path.extname(filePath))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function licenseFor(filePath: string): Promise<LicenseRecord | null> {
  try {
    const raw = await readFile(`${filePath}.license.json`, "utf8");
    const parsed = JSON.parse(raw) as LicenseRecord;
    return parsed;
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function main(): Promise<void> {
  const input = path.resolve(argument("--input", "data/raw"));
  const manifestPath = path.resolve(argument("--manifest", "data/manifests/dataset-v001.jsonl"));
  const quarantinePath = path.resolve(argument("--quarantine", "data/manifests/quarantine-v001.jsonl"));
  const files = await filesRecursively(input).catch(() => []);
  const previousSplits = new Map<string, "train" | "validation" | "test">();
  try {
    const previous = await readFile(manifestPath, "utf8");
    for (const line of previous.split(/\r?\n/).filter(Boolean)) {
      const record = JSON.parse(line) as { sha256?: unknown; split?: unknown };
      if (typeof record.sha256 === "string" && (record.split === "train" || record.split === "validation" || record.split === "test")) {
        previousSplits.set(record.sha256, record.split);
      }
    }
  } catch {
    // First run has no previous split assignment.
  }
  const records: ManifestRecord[] = [];
  const seen = new Map<string, string>();

  for (let index = 0; index < files.length; index += 1) {
    const filePath = files[index];
    const bytes = await readFile(filePath);
    const relativePath = path.relative(process.cwd(), filePath).replaceAll("\\", "/");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const license = await licenseFor(filePath);
    const size = await stat(filePath);
    const imageSize = dimensions(bytes);
    const reasons: string[] = [];
    if (seen.has(hash)) reasons.push(`duplicate_of:${seen.get(hash)}`);
    else seen.set(hash, relativePath);
    if (!imageSize) reasons.push("unsupported_or_corrupt_image_header");
    if (imageSize && Math.min(imageSize.width, imageSize.height) < MIN_SIDE) reasons.push(`min_side_below_${MIN_SIDE}`);
    if (!license) reasons.push("license_sidecar_missing");
    if (!text(license?.source)) reasons.push("source_missing");
    if (!text(license?.license)) reasons.push("license_missing");
    if (normalizedStem(filePath) !== path.basename(filePath, path.extname(filePath)).toLowerCase()) reasons.push("name_normalization_required");
    if (size.size === 0) reasons.push("empty_file");

    const status: ManifestRecord["status"] = reasons.some((reason) => reason.startsWith("duplicate_of") || reason.includes("corrupt") || reason === "empty_file")
      ? "quarantine"
      : reasons.length
        ? "pending_human_review"
        : "approved";
    records.push({
      id: `img-${String(index + 1).padStart(4, "0")}`,
      relative_path: relativePath,
      sha256: hash,
      source: text(license?.source),
      license: text(license?.license),
      width: imageSize?.width ?? null,
      height: imageSize?.height ?? null,
      split: previousSplits.get(hash) ?? null,
      status,
      reasons,
    });
  }

  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""), "utf8");
  await writeFile(quarantinePath, records.filter((record) => record.status !== "approved").map((record) => JSON.stringify(record)).join("\n") + (records.some((record) => record.status !== "approved") ? "\n" : ""), "utf8");

  const approved = records.filter((record) => record.status === "approved").length;
  const quarantine = records.filter((record) => record.status === "quarantine").length;
  const review = records.filter((record) => record.status === "pending_human_review").length;
  console.log(JSON.stringify({ files: records.length, approved, quarantine, pending_human_review: review, min_side: MIN_SIDE, writes: [manifestPath, quarantinePath] }));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Dataset validation failed.");
  process.exitCode = 1;
});
