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

export type LoraTrainingReferenceEvidence = {
  imageId: string;
  imageFile: string;
  sourceRef: string | null;
  caption: string;
  conceptVisible: boolean;
  visibleConceptCount: number;
  otherConceptCount: number;
  uncertainties: string[];
};

export type LoraTrainingReferenceEvidenceResponse = {
  conceptId: string;
  canonicalLabel: string;
  requestedSizeCode: string | null;
  records: LoraTrainingReferenceEvidence[];
};

const DATASET_DIR = path.join(process.cwd(), "data", "staging", "lora-v007");
const ANNOTATIONS_DIR = path.join(DATASET_DIR, "anotaciones");
const CAPTIONS_DIR = path.join(DATASET_DIR, "captions");
const APPROVED_SELECTION_PATH = path.join(DATASET_DIR, "aprobadas.json");
const PROPOSED_VOCABULARY_PATH = path.join(process.cwd(), "reports", "lora-vocabulary-v002", "conceptos-propuestos.json");

type Annotation = {
  image_id?: unknown;
  source?: { ref?: unknown };
  anotacion?: {
    structures?: unknown;
    uncertainties?: unknown;
  };
  compilacion?: {
    status?: unknown;
    caption?: unknown;
    concept_ids_resueltos?: unknown;
    tamanos_aplicados?: unknown;
  };
};

type SizeApplication = { concept_id?: unknown; size_code?: unknown };
type AnnotationStructure = { visible_concept_ids?: unknown };

type CatalogConcept = {
  concept_id: string;
  canonical_label: string;
  catalog_product_ids: string[];
};

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

function resolvedConcepts(annotation: Annotation): Set<string> {
  const concepts = new Set(strings(annotation.compilacion?.concept_ids_resueltos));
  const sizes = Array.isArray(annotation.compilacion?.tamanos_aplicados)
    ? annotation.compilacion.tamanos_aplicados.filter((item): item is SizeApplication => Boolean(item && typeof item === "object"))
    : [];
  for (const size of sizes) if (typeof size.concept_id === "string") concepts.add(size.concept_id);
  return concepts;
}

function appliedSizeCodes(annotation: Annotation, conceptId: string): Set<string> {
  const sizes = Array.isArray(annotation.compilacion?.tamanos_aplicados)
    ? annotation.compilacion.tamanos_aplicados.filter((item): item is SizeApplication => Boolean(item && typeof item === "object"))
    : [];
  return new Set(sizes.flatMap((size) => size.concept_id === conceptId && typeof size.size_code === "string" ? [size.size_code] : []));
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

    const concepts = resolvedConcepts(annotation);
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

function catalogConcepts(): CatalogConcept[] {
  const concepts: CatalogConcept[] = PRODUCT_VOCABULARY.map((concept) => ({
    concept_id: concept.concept_id,
    canonical_label: concept.canonical_label,
    catalog_product_ids: concept.catalog_product_ids,
  }));
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
  return concepts;
}

export function readLoraTrainingReferenceCounts(): LoraTrainingReferenceCounts {
  const trainingIds = trainingImageIds();
  const stats = readCorpusStats(trainingIds);
  const countsByCatalogId: Record<string, LoraTrainingReferenceCount> = {};

  const concepts = catalogConcepts();

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

function imageFileFromAnnotation(imageId: string, sourceRef: string | null): string {
  const candidate = sourceRef ? path.basename(sourceRef) : "";
  if (!/\.(jpe?g|png|webp)$/i.test(candidate)) return `${imageId}.jpg`;
  if (/^foto-\d+\.(jpe?g|png|webp)$/i.test(candidate)) return `${imageId}${path.extname(candidate)}`;
  return candidate;
}

function visibleConceptIds(annotation: Annotation): Set<string> {
  const structures = Array.isArray(annotation.anotacion?.structures)
    ? annotation.anotacion.structures.filter((item): item is AnnotationStructure => Boolean(item && typeof item === "object"))
    : [];
  return new Set(structures.flatMap((structure) => strings(structure.visible_concept_ids)));
}

function normalizeEvidenceText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[_./-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasExplicitAlias(text: string, alias: string): boolean {
  return new RegExp(`(?:^| )${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$| )`).test(text);
}

function conceptAliases(concept: CatalogConcept): string[] {
  const labels = [concept.concept_id, concept.canonical_label]
    .map(normalizeEvidenceText)
    .filter((value) => value.length > 0);
  const generic = new Set(["balloon", "balloons", "latex", "round", "modeling", "foil", "silk", "fashion", "satin", "finish", "with", "and", "in", "the", "a", "an"]);
  const terminalCompound = concept.concept_id.split(".").at(-1)?.split("_").filter(Boolean) ?? [];
  const compoundTokens = terminalCompound.length > 1 ? new Set(terminalCompound) : new Set<string>();
  const aliases = new Set<string>(labels);
  if (terminalCompound.length > 1) aliases.add(terminalCompound.join(" "));
  for (const label of labels) {
    const tokens = label.split(" ").filter((token) => token.length >= 3 && !generic.has(token));
    if (tokens.length > 1) aliases.add(tokens.slice(-2).join(" "));
    for (const token of tokens) if (!compoundTokens.has(token)) aliases.add(token);
  }
  return [...aliases].filter((alias) => alias.length >= 3).sort((a, b) => b.length - a.length);
}

/** Solo atribuye una incertidumbre cuando nombra explícitamente el concepto o uno de sus aliases. */
function relevantUncertainties(uncertainties: string[], concept: CatalogConcept): string[] {
  const aliases = conceptAliases(concept);
  return uncertainties.filter((uncertainty) => {
    const text = normalizeEvidenceText(uncertainty);
    return aliases.some((alias) => hasExplicitAlias(text, alias));
  });
}

export function readLoraTrainingReferenceEvidence(
  catalogId: string,
  requestedSizeCode?: string | null,
): LoraTrainingReferenceEvidenceResponse | null {
  const concept = catalogConcepts().find((candidate) => candidate.catalog_product_ids.includes(catalogId));
  if (!concept) return null;

  const trainingIds = trainingImageIds();
  const records: LoraTrainingReferenceEvidence[] = [];
  const recordsWithRequestedSize: LoraTrainingReferenceEvidence[] = [];
  let requestedSizeExists = false;
  if (!fs.existsSync(ANNOTATIONS_DIR)) return {
    conceptId: concept.concept_id,
    canonicalLabel: concept.canonical_label,
    requestedSizeCode: requestedSizeCode ?? null,
    records,
  };

  for (const file of fs.readdirSync(ANNOTATIONS_DIR).filter((entry) => entry.endsWith(".json"))) {
    const annotation = readJson<Annotation>(path.join(ANNOTATIONS_DIR, file));
    const imageId = typeof annotation?.image_id === "string" ? annotation.image_id : file.slice(0, -5);
    if (!annotation || !trainingIds.has(imageId) || annotation.compilacion?.status !== "resolved") continue;
    const captionPath = path.join(CAPTIONS_DIR, `${imageId}.txt`);
    const captionFromFile = fs.existsSync(captionPath) ? fs.readFileSync(captionPath, "utf8").trim() : "";
    if (!captionFromFile || !resolvedConcepts(annotation).has(concept.concept_id)) continue;
    const appliesRequestedSize = Boolean(requestedSizeCode && appliedSizeCodes(annotation, concept.concept_id).has(requestedSizeCode));
    requestedSizeExists ||= appliesRequestedSize;

    const sourceRef = typeof annotation.source?.ref === "string" ? annotation.source.ref : null;
    const visibleConcepts = visibleConceptIds(annotation);
    const uncertainties = relevantUncertainties(strings(annotation.anotacion?.uncertainties), concept);
    const record: LoraTrainingReferenceEvidence = {
      imageId,
      imageFile: imageFileFromAnnotation(imageId, sourceRef),
      sourceRef,
      caption: typeof annotation.compilacion.caption === "string" && annotation.compilacion.caption.trim()
        ? annotation.compilacion.caption.trim()
        : captionFromFile,
      conceptVisible: visibleConcepts.has(concept.concept_id),
      visibleConceptCount: visibleConcepts.size,
      otherConceptCount: [...visibleConcepts].filter((visibleConceptId) => visibleConceptId !== concept.concept_id).length,
      uncertainties,
    };
    records.push(record);
    if (appliesRequestedSize) recordsWithRequestedSize.push(record);
  }

  const selectedRecords = requestedSizeExists ? recordsWithRequestedSize : records;

  return {
    conceptId: concept.concept_id,
    canonicalLabel: concept.canonical_label,
    requestedSizeCode: requestedSizeCode ?? null,
    records: selectedRecords.sort((a, b) => a.imageId.localeCompare(b.imageId, undefined, { numeric: true })),
  };
}
