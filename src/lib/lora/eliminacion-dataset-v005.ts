import "server-only";

import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { eliminarFotoDeOrden } from "@/lib/ordenes/eliminacion";
import { limpiarDerivadosDeFotos } from "@/lib/ordenes/limpiar-derivados";

const WEB_STAGING_DIR = path.join(process.cwd(), "data", "staging", "lora-v006-orders-web-v001");
const WEB_IMAGE_DIR = path.join(WEB_STAGING_DIR, "original");
const WEB_MANIFEST_PATH = path.join(WEB_STAGING_DIR, "manifest.json");
const WEB_SELECTION_PATH = path.join(WEB_STAGING_DIR, "selection.json");
const WEB_IMAGE_FILE = /\.(?:jpe?g|png|webp)$/i;

type WebRecord = {
  id?: unknown;
  image?: unknown;
  [key: string]: unknown;
};

type WebManifest = {
  records?: WebRecord[];
  [key: string]: unknown;
};

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function webImageId(id: string): boolean {
  return /^web-\d+$/.test(id);
}

function orderImageId(id: string): { numero: string; indice: number } | null {
  const match = id.match(/^(\d+)-(\d+)$/);
  if (!match) return null;
  return { numero: match[1], indice: Number(match[2]) };
}

function imageFileFromRecord(record: WebRecord | undefined, id: string): string | null {
  if (typeof record?.image === "string") {
    const fileName = path.basename(record.image);
    if (fileName === record.image || record.image.endsWith(`/${fileName}`)) {
      if (WEB_IMAGE_FILE.test(fileName) && fileName.replace(/\.[^.]+$/, "") === id) return fileName;
    }
  }
  return null;
}

async function findWebImageFile(id: string, records: WebRecord[]): Promise<string | null> {
  const fromManifest = imageFileFromRecord(records.find((record) => record.id === id), id);
  if (fromManifest) return fromManifest;
  const files = await readdir(WEB_IMAGE_DIR).catch(() => [] as string[]);
  return files.find((file) => WEB_IMAGE_FILE.test(file) && file.replace(/\.[^.]+$/, "") === id) ?? null;
}

async function deleteWebImages(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const manifest = await readJson<WebManifest>(WEB_MANIFEST_PATH);
  if (!manifest || !Array.isArray(manifest.records)) throw new Error("No existe el manifiesto web del dataset.");
  const idSet = new Set(ids);
  const files = await Promise.all(ids.map((id) => findWebImageFile(id, manifest.records ?? [])));

  await Promise.all(files.filter((file): file is string => Boolean(file)).map((file) => rm(path.join(WEB_IMAGE_DIR, file), { force: true })));
  manifest.records = manifest.records.filter((record) => !idSet.has(String(record.id)));
  await writeFile(WEB_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const selection = await readJson<WebRecord[]>(WEB_SELECTION_PATH);
  if (Array.isArray(selection)) {
    await writeFile(
      WEB_SELECTION_PATH,
      `${JSON.stringify(selection.filter((record) => !idSet.has(String(record.id))), null, 2)}\n`,
      "utf8",
    );
  }
}

export async function eliminarImagenesDataset(imageIds: string[]): Promise<string[]> {
  const ids = [...new Set(imageIds)];
  if (ids.length === 0) throw new Error("No se recibieron imÃ¡genes para borrar.");

  const deleted: string[] = [];
  const orderImageIds: string[] = [];
  const webIds: string[] = [];
  for (const id of ids) {
    const order = orderImageId(id);
    if (order) {
      await eliminarFotoDeOrden(order.numero, order.indice, false);
      orderImageIds.push(id);
      deleted.push(id);
      continue;
    }
    if (webImageId(id)) {
      webIds.push(id);
      continue;
    }
    throw new Error(`Identificador de imagen invÃ¡lido: ${id}`);
  }

  await limpiarDerivadosDeFotos(orderImageIds);
  await deleteWebImages(webIds);
  return [...deleted, ...webIds];
}


