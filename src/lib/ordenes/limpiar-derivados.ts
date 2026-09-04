import { readdir, rm } from "node:fs/promises";
import path from "node:path";

const DERIVED_ROOTS = [
  path.join(process.cwd(), "data", "staging"),
  path.join(process.cwd(), "data", "lora-artifacts", "datasets"),
];
const DERIVED_FILE = /\.(?:jpe?g|png|webp|txt)$/i;

async function removeMatchingFiles(directory: string, matches: (baseName: string) => boolean): Promise<number> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  let removed = 0;

  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      removed += await removeMatchingFiles(target, matches);
      continue;
    }
    if (!DERIVED_FILE.test(entry.name)) continue;
    const baseName = entry.name.replace(/\.[^.]+$/, "");
    if (!matches(baseName)) continue;
    await rm(target, { force: true });
    removed += 1;
  }

  return removed;
}

export async function limpiarDerivadosDeFoto(numero: string, indice: number): Promise<number> {
  return limpiarDerivadosDeFotos([`${numero}-${indice}`]);
}

export async function limpiarDerivadosDeFotos(imageIds: string[]): Promise<number> {
  const ids = new Set(imageIds);
  if (ids.size === 0) return 0;
  let removed = 0;
  for (const root of DERIVED_ROOTS) removed += await removeMatchingFiles(root, (baseName) => ids.has(baseName));
  return removed;
}

export async function limpiarDerivadosDeOrden(numero: string): Promise<number> {
  const prefix = `${numero}-`;
  let removed = 0;
  for (const root of DERIVED_ROOTS) {
    removed += await removeMatchingFiles(root, (baseName) => baseName.startsWith(prefix) && /^\d+-\d+$/.test(baseName));
  }
  return removed;
}


