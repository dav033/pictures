import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SELECTION_PATH = path.join(ROOT, "data", "staging", "recaption-v005", "seleccion-300.json");
const SOURCE_ROOT = path.join(ROOT, "data", "staging", "sempertex-full-v001");

type SelectionEntry = {
  nombre: string;
  origen: string;
  captionListo: boolean;
  role?: string;
  theme?: string;
  coverage?: { kind?: string; status?: string };
  [key: string]: unknown;
};

type Selection = {
  total: number;
  captionListos: number;
  captionsPendientes: number;
  entradas: SelectionEntry[];
  [key: string]: unknown;
};

function parseCatalogReferences(sourceCaption: string): string[] {
  const match = sourceCaption.trim().match(/catalog references\s+(.+)$/i);
  return match
    ? [...new Set(match[1].split(",").map((value) => value.trim().toUpperCase()).filter(Boolean))]
    : [];
}

async function main(): Promise<void> {
  const selection = JSON.parse(await readFile(SELECTION_PATH, "utf8")) as Selection;
  let completed = 0;

  for (const entry of selection.entradas) {
    if (entry.origen === "recaption-v004") continue;
    const base = path.parse(entry.nombre).name;
    const sourceCaptionPath = path.join(SOURCE_ROOT, `${base}.txt`);
    const references = parseCatalogReferences(await readFile(sourceCaptionPath, "utf8"));
    if (entry.role === "venue_scene" && references.length > 0) {
      throw new Error(`${base}: una escena no puede tener referencias de producto`);
    }
    if (entry.role !== "venue_scene" && references.length === 0) {
      throw new Error(`${base}: faltan referencias de catálogo`);
    }
    entry.captionListo = true;
    entry.catalogReferences = references;
    entry.coverage = {
      status: "confirmed",
      kind: entry.role === "venue_scene" ? "environment_only" : "catalog_references",
    };
    completed += 1;
  }

  selection.captionListos = selection.entradas.filter((entry) => entry.captionListo).length;
  selection.captionsPendientes = selection.entradas.length - selection.captionListos;
  selection.cobertura = {
    status: "complete",
    total: selection.entradas.length,
    confirmed: selection.captionListos,
    pending: selection.captionsPendientes,
    catalogLinked: selection.entradas.filter((entry) => entry.coverage?.kind === "catalog_references").length,
    environmentOnly: selection.entradas.filter((entry) => entry.coverage?.kind === "environment_only").length,
  };
  await writeFile(SELECTION_PATH, `${JSON.stringify(selection, null, 2)}\n`, "utf8");
  console.log(`Cobertura v005 completada: ${completed} entradas nuevas confirmadas; ${selection.captionListos}/300 totales.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
