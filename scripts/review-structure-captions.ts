import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { LoraStructureType } from "../src/lib/lora/schema";

const ROOT = process.cwd();
const DATASET_ROOT = path.join(ROOT, "data", "staging", "structure-v001");
const PAYLOAD_ROOT = path.join(DATASET_ROOT, "payload");
const SAMPLE_ROOT = path.join(DATASET_ROOT, "review-sample-25");
const MANIFEST_PATH = path.join(DATASET_ROOT, "manifest.json");
const SOURCE_ROOT = path.join(ROOT, "data", "staging", "recaption-v004");
const SOURCE_CAPTIONS = path.join(SOURCE_ROOT, "nuevo");
const SAMPLE_JSON = path.join(DATASET_ROOT, "review-sample-25.json");
const SAMPLE_JSONL = path.join(DATASET_ROOT, "review-sample-25.jsonl");
const REPORT_PATH = path.join(DATASET_ROOT, "caption-review-report.json");
const CONTACT_SHEET_PATH = path.join(DATASET_ROOT, "review-sample-25-contact-sheet.jpg");
const TRIGGER = "eventdecor_structure_v1";

type DatasetImage = {
  key: string;
  imageSha256: string;
  captionSha256: string;
  width?: number;
  height?: number;
  captionWordCount?: number;
  caption?: string;
  structureTypes: LoraStructureType[];
  split: "train" | "validation" | "test";
  source?: { ref?: string };
};

type DatasetManifest = {
  images: DatasetImage[];
  dataset: { id: string; imageCount: number; captionCount: number; trigger: string };
};

const DESCRIPTORS: Record<LoraStructureType, string> = {
  arco: "balloon arch",
  semiarco: "balloon half arch",
  guirnalda: "organic balloon garland",
  columna: "balloon column",
  bouquet: "balloon bouquet",
  backdrop: "decorative backdrop",
  instalacion_completa: "complete event decoration installation",
};

const ORDER: LoraStructureType[] = ["arco", "semiarco", "guirnalda", "columna", "bouquet", "backdrop", "instalacion_completa"];
const FORBIDDEN = /(?:\bSKU\b|\bcatalog\b|product\s+id|variant\s+id|\bprice\b|\bUSD\b|\bCOP\b|\bpackage\b|\bpaquete\b|\bshopify\b)/i;
const NON_ENGLISH = /[Ã¡Ã©Ã­Ã³ÃºÃ¼Ã±Â¿Â¡]/i;
const CAPTION_CORRECTIONS: Record<string, Array<[RegExp, string]>> = {
  "10357-1.jpg": [[/paired with two fabric-wrapped cylindrical plinths nearby wrapped in a smaller balloon garland arrangement/gi, "paired with a single fabric-wrapped cylindrical plinth nearby accompanied by a smaller balloon garland arrangement"]],
  "10457-1.jpg": [[/flanked by matte blue and red balloon clusters attached on either side/gi, "flanked on one side by a tall matte blue, red, and navy balloon garland reaching toward the ceiling"]],
  "11073-1.jpg": [[/a number marquee to one side, and a balloon column on the opposite side/gi, "a number marquee light and a balloon column both positioned to one side"]],
  "15468-1.jpg": [[/paper butterfly accents/gi, "metallic gold butterfly accents"]],
};

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function captionExpected(sourceCaption: string, types: LoraStructureType[], key: string): string {
  let body = sourceCaption
    .replace(/^eventdecor_style_v2\s*,\s*/i, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  for (const [pattern, replacement] of CAPTION_CORRECTIONS[key] ?? []) body = body.replace(pattern, replacement);
  return [TRIGGER, ...types.map((type) => DESCRIPTORS[type]), body].filter(Boolean).join(", ");
}

function selectSample(images: DatasetImage[], limit = 25): DatasetImage[] {
  const selected = new Map<string, DatasetImage>();
  const buckets = new Map<LoraStructureType, DatasetImage[]>();
  for (const type of ORDER) buckets.set(type, images.filter((image) => image.structureTypes.includes(type)).sort((a, b) => a.key.localeCompare(b.key)));
  let cursor = 0;
  while (selected.size < Math.min(limit, images.length)) {
    let added = false;
    for (const type of ORDER) {
      const bucket = buckets.get(type) ?? [];
      const candidate = bucket[cursor];
      if (candidate && !selected.has(candidate.key)) {
        selected.set(candidate.key, candidate);
        added = true;
        if (selected.size >= limit) break;
      }
    }
    if (!added) break;
    cursor += 1;
  }
  return [...selected.values()].sort((a, b) => a.key.localeCompare(b.key));
}

async function contactSheet(images: DatasetImage[]): Promise<void> {
  const columns = 5;
  const tileWidth = 280;
  const imageHeight = 235;
  const labelHeight = 55;
  const rows = Math.ceil(images.length / columns);
  const canvas = sharp({ create: { width: columns * tileWidth, height: rows * (imageHeight + labelHeight), channels: 3, background: "#e9e5df" } });
  const layers: Array<{ input: Buffer; left: number; top: number }> = [];
  for (const [index, image] of images.entries()) {
    const sourcePath = path.join(PAYLOAD_ROOT, image.key);
    const thumb = await sharp(sourcePath).resize(tileWidth - 12, imageHeight - 12, { fit: "cover" }).jpeg({ quality: 84 }).toBuffer();
    const label = image.structureTypes.map((type) => type === "instalacion_completa" ? "instalacion" : type).join(" + ");
    const svg = Buffer.from(`<svg width="${tileWidth}" height="${labelHeight}"><rect width="100%" height="100%" fill="#e9e5df"/><text x="8" y="22" font-family="Arial" font-size="14" fill="#302d2a">${image.key}</text><text x="8" y="43" font-family="Arial" font-size="13" fill="#6d4c41">${label}</text></svg>`);
    const x = (index % columns) * tileWidth + 6;
    const y = Math.floor(index / columns) * (imageHeight + labelHeight) + 6;
    layers.push({ input: thumb, left: x, top: y });
    layers.push({ input: svg, left: (index % columns) * tileWidth, top: Math.floor(index / columns) * (imageHeight + labelHeight) + imageHeight });
  }
  await canvas.composite(layers).jpeg({ quality: 88 }).toFile(CONTACT_SHEET_PATH);
}

async function main(): Promise<void> {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as DatasetManifest;
  const files = new Set(await readdir(PAYLOAD_ROOT));
  const issues: Array<{ key: string; reasons: string[] }> = [];
  const checked: Array<DatasetImage & { caption: string }> = [];
  for (const image of manifest.images) {
    const reasons: string[] = [];
    const imagePath = path.join(PAYLOAD_ROOT, image.key);
    const captionPath = path.join(PAYLOAD_ROOT, `${path.parse(image.key).name}.txt`);
    if (!files.has(image.key) || !existsSync(imagePath)) reasons.push("missing_image");
    if (!existsSync(captionPath)) reasons.push("missing_caption_file");
    const caption = existsSync(captionPath) ? (await readFile(captionPath, "utf8")).trim() : "";
    if ((caption.match(new RegExp(`\\b${TRIGGER}\\b`, "g")) ?? []).length !== 1) reasons.push("trigger_count_invalid");
    if (caption.includes("eventdecor_style_v2")) reasons.push("old_trigger_present");
    if (!caption || captionExpected(await readFile(path.join(SOURCE_CAPTIONS, `${path.parse(image.key).name}.txt`), "utf8"), image.structureTypes, image.key) !== caption) reasons.push("caption_transform_mismatch");
    if (FORBIDDEN.test(caption)) reasons.push("forbidden_product_term");
    if (NON_ENGLISH.test(caption)) reasons.push("non_english_character");
    for (const type of image.structureTypes) if (!caption.includes(DESCRIPTORS[type])) reasons.push(`missing_descriptor_${type}`);
    if (image.width && image.height && (image.width < 512 || image.height < 512)) reasons.push("low_resolution");
    if (existsSync(imagePath)) {
      const actualImageHash = sha256(await readFile(imagePath));
      if (actualImageHash.toLowerCase() !== image.imageSha256.toLowerCase()) reasons.push("image_hash_mismatch");
    }
    if (existsSync(captionPath)) {
      const actualCaptionHash = sha256(Buffer.from(`${caption}\n`, "utf8"));
      if (actualCaptionHash.toLowerCase() !== image.captionSha256.toLowerCase()) reasons.push("caption_hash_mismatch");
    }
    if (reasons.length) issues.push({ key: image.key, reasons: [...new Set(reasons)] });
    checked.push({ ...image, caption });
  }
  const sample = selectSample(checked, 25);
  await rm(SAMPLE_ROOT, { recursive: true, force: true });
  await mkdir(SAMPLE_ROOT, { recursive: true });
  const sampleRows: Array<Record<string, unknown>> = [];
  for (const image of sample) {
    await copyFile(path.join(PAYLOAD_ROOT, image.key), path.join(SAMPLE_ROOT, image.key));
    await writeFile(path.join(SAMPLE_ROOT, `${path.parse(image.key).name}.txt`), `${image.caption}\n`, "utf8");
    sampleRows.push({ key: image.key, file: path.join("data", "staging", "structure-v001", "review-sample-25", image.key), captionFile: path.join("data", "staging", "structure-v001", "review-sample-25", `${path.parse(image.key).name}.txt`), structureTypes: image.structureTypes, split: image.split, caption: image.caption });
  }
  await writeFile(SAMPLE_JSON, JSON.stringify({ datasetId: manifest.dataset.id, maxItems: 25, count: sample.length, items: sampleRows }, null, 2), "utf8");
  await writeFile(SAMPLE_JSONL, `${sampleRows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  await contactSheet(sample);
  const classes = Object.fromEntries(ORDER.map((type) => [type, checked.filter((image) => image.structureTypes.includes(type)).length]));
  const report = { datasetId: manifest.dataset.id, checkedImages: checked.length, checkedCaptions: checked.length, issues, sampleCount: sample.length, classes, verification: { expectedTransform: "deterministic_source_caption_plus_structure_labels", visualSampleRequired: true, licenseStatus: "pending" } };
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
