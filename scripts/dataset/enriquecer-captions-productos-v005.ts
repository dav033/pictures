import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATASET_ROOT = path.join(ROOT, "data", "staging", "recaption-v005");
const SELECTION_PATH = path.join(DATASET_ROOT, "seleccion-300.json");
const TRIGGER = "eventdecor_style_v2";

type SelectionEntry = {
  nombre: string;
  origen: string;
  role?: string;
  captionListo?: boolean;
  coverage?: { kind?: string; status?: string };
};

type Selection = {
  entradas: SelectionEntry[];
};

function parseProductTitle(sourceCaption: string, sourcePath: string): string {
  const source = sourceCaption.trim();
  const match =
    source.match(/product image of\s+(.*?),\s*product category/i) ??
    source.match(/decoration,\s*(.*?),\s*product category/i);
  if (!match?.[1]) {
    throw new Error(`No se pudo extraer título de producto desde ${sourcePath}`);
  }
  return match[1].trim();
}

function captionBody(caption: string, captionPath: string): string {
  const prefix = `${TRIGGER},`;
  const trimmed = caption.trim();
  if (!trimmed.startsWith(prefix)) {
    throw new Error(`Trigger incorrecto en ${captionPath}`);
  }
  return trimmed.slice(prefix.length).trim();
}

async function main(): Promise<void> {
  const selection = JSON.parse(await readFile(SELECTION_PATH, "utf8")) as Selection;
  const entries = selection.entradas.filter(
    (entry) => entry.origen !== "recaption-v004" && entry.coverage?.kind === "catalog_references",
  );

  if (entries.length !== 131) {
    throw new Error(`Se esperaban 131 imágenes con catálogo confirmado, encontradas ${entries.length}.`);
  }

  for (const entry of entries) {
    const originalPath = path.join(DATASET_ROOT, "original", `${entry.nombre}.txt`);
    const captionPath = path.join(DATASET_ROOT, "nuevo", `${entry.nombre}.txt`);
    const title = parseProductTitle(await readFile(originalPath, "utf8"), originalPath);
    let body = captionBody(await readFile(captionPath, "utf8"), captionPath);
    const productPrefix = `Sempertex catalog product "${title}",`;
    while (body.startsWith(productPrefix)) {
      body = body.slice(productPrefix.length).trimStart();
    }
    const enriched = `${TRIGGER}, ${productPrefix} ${body}\n`;
    await writeFile(captionPath, enriched, "utf8");
  }

  console.log(`Captions enriquecidas: ${entries.length}/131 con nombre de producto confirmado.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
