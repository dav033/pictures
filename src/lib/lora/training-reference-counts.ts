import "server-only";

import fs from "node:fs";
import path from "node:path";
import { PRODUCT_VOCABULARY } from "./product-vocabulary-data";

export type LoraTrainingReferenceCount = {
  conceptId: string;
  canonicalLabel: string;
  total: number;
  bySize: Record<string, number>;
};

export type LoraTrainingReferenceCounts = {
  datasetVersion: "v007";
  trainingImageCount: number;
  countsByCatalogId: Record<string, LoraTrainingReferenceCount>;
};

const DATASET_DIR = path.join(process.cwd(), "data", "staging", "lora-v007");
const ANNOTATIONS_DIR = path.join(DATASET_DIR, "anotaciones");
const CAPTIONS_DIR = path.join(DATASET_DIR, "captions");
const APPROVED_SELECTION_PATH = path.join(DATASET_DIR, "aprobadas.json");
const PROPOSED_VOCABULARY_PATH = path.join(process.cwd(), "reports", "lora-vocabulary-v002", "conceptos-propuestos.json");

type Annotation = {
  image_id?: unknown;
  compilacion?: {
    status?: unknown;
    concept_ids_resueltos?: unknown;
    tamanos_aplicados?: unknown;
  };
};

type SizeApplication = { concept_id?: unknown; size_code?: unknown };

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function trainingImageIds(): Set<string> {
  const approved = readJson<{ seleccion?: unknown }>(APPROVED_SELECTION_PATH);
  const selected = new Set(strings(approved?.seleccion));
  const candidates = selected.size > 0
    ? [...selected]
    : fs.existsSync(CAPTIONS_DIR)
      ? fs.readdirSync(CAPTIONS_DIR)
      .filter((file) => file.endsWith(".txt"))
      .map((file) => file.slice(0, -4))
      : [];
  return new Set(candidates.filter((imageId) => {
    const captionPath = path.join(CAPTIONS_DIR, `${imageId}.txt`);
    const annotationPath = path.join(ANNOTATIONS_DIR, `${imageId}.json`);
    return fs.existsSync(annotationPath) && fs.existsSync(captionPath) && Boolean(fs.readFileSync(captionPath, "utf8").trim());
  }));
}

function addImageReference(
  stats: Map<string, { imageIds: Set<string>; bySize: Map<string, Set<string>> }>,
  conceptId: string,
  imageId: string,
  sizeCode?: string,
): void {
  const current = stats.get(conceptId) ?? { imageIds: new Set<string>(), bySize: new Map<string, Set<string>>() };
  current.imageIds.add(imageId);
  if (sizeCode) {
    const imageIds = current.bySize.get(sizeCode) ?? new Set<string>();
    imageIds.add(imageId);
    current.bySize.set(sizeCode, imageIds);
  }
  stats.set(conceptId, current);
}

function readCorpusStats(trainingIds: Set<string>): Map<string, { imageIds: Set<string>; bySize: Map<string, Set<string>> }> {
  const stats = new Map<string, { imageIds: Set<string>; bySize: Map<string, Set<string>> }>();
  if (!fs.existsSync(ANNOTATIONS_DIR)) return stats;

  for (const file of fs.readdirSync(ANNOTATIONS_DIR).filter((entry) => entry.endsWith(".json"))) {
    const annotation = readJson<Annotation>(path.join(ANNOTATIONS_DIR, file));
    const imageId = typeof annotation?.image_id === "string" ? annotation.image_id : file.slice(0, -5);
    if (!trainingIds.has(imageId)) continue;
    const captionPath = path.join(CAPTIONS_DIR, `${imageId}.txt`);
    if (!fs.existsSync(captionPath) || !fs.readFileSync(captionPath, "utf8").trim()) continue;
    if (annotation?.compilacion?.status !== "resolved") continue;

    const concepts = new Set(strings(annotation.compilacion.concept_ids_resueltos));
    const sizes = Array.isArray(annotation.compilacion.tamanos_aplicados)
      ? annotation.compilacion.tamanos_aplicados.filter((item): item is SizeApplication => Boolean(item && typeof item === "object"))
      : [];
    const conceptSizes = new Map<string, Set<string>>();
    for (const size of sizes) {
      if (typeof size.concept_id !== "string" || typeof size.size_code !== "string") continue;
      const codes = conceptSizes.get(size.concept_id) ?? new Set<string>();
      codes.add(size.size_code);
      conceptSizes.set(size.concept_id, codes);
      concepts.add(size.concept_id);
    }

    for (const conceptId of concepts) {
      const codes = conceptSizes.get(conceptId);
      if (!codes || codes.size === 0) addImageReference(stats, conceptId, imageId);
      else for (const code of codes) addImageReference(stats, conceptId, imageId, code);
    }
  }

  return stats;
}

export function readLoraTrainingReferenceCounts(): LoraTrainingReferenceCounts {
  const trainingIds = trainingImageIds();
  const stats = readCorpusStats(trainingIds);
  const countsByCatalogId: Record<string, LoraTrainingReferenceCount> = {};

  const concepts = [...PRODUCT_VOCABULARY.map((concept) => ({
    concept_id: concept.concept_id,
    canonical_label: concept.canonical_label,
    catalog_product_ids: concept.catalog_product_ids,
  }))];
  const knownConceptIds = new Set(concepts.map((concept) => concept.concept_id));
  const proposed = readJson<{ propuestas?: unknown }>(PROPOSED_VOCABULARY_PATH)?.propuestas;
  if (Array.isArray(proposed)) {
    for (const item of proposed) {
      if (!item || typeof item !== "object") continue;
      const proposal = item as Record<string, unknown>;
      const conceptId = typeof proposal.concept_id === "string" ? proposal.concept_id : "";
      const canonicalLabel = typeof proposal.canonical_label === "string" ? proposal.canonical_label : "";
      const catalogProductIds = strings(proposal.catalog_product_ids);
      if (!conceptId || !canonicalLabel || !catalogProductIds.length || knownConceptIds.has(conceptId)) continue;
      knownConceptIds.add(conceptId);
      concepts.push({ concept_id: conceptId, canonical_label: canonicalLabel, catalog_product_ids: catalogProductIds });
    }
  }

  for (const concept of concepts) {
    const current = stats.get(concept.concept_id);
    if (!current || current.imageIds.size === 0) continue;
    const bySize = Object.fromEntries(
      [...current.bySize.entries()]
        .map(([sizeCode, imageIds]) => [sizeCode, imageIds.size])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    );
    const count: LoraTrainingReferenceCount = {
      conceptId: concept.concept_id,
      canonicalLabel: concept.canonical_label,
      total: current.imageIds.size,
      bySize,
    };
    for (const catalogId of concept.catalog_product_ids) countsByCatalogId[catalogId] = count;
  }

  return {
    datasetVersion: "v007",
    trainingImageCount: trainingIds.size,
    countsByCatalogId,
  };
}
