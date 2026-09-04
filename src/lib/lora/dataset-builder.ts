import { LoraStructureTypeSchema, type LoraCaptionAudit, type LoraCoverage, type LoraStructureType } from "./schema";

export type StructureCandidate = {
  key: string;
  sha256: string;
  width: number;
  height: number;
  groupKey: string;
  structureTypes: LoraStructureType[];
  caption: string;
  sourceRef?: string;
  quality?: {
    people?: boolean;
    text?: boolean;
    watermark?: boolean;
    nearDuplicate?: boolean;
    licenseVerified?: boolean;
  };
};

export type StructureDatasetAudit = {
  accepted: StructureCandidate[];
  rejected: Array<{ key: string; reasons: string[] }>;
  duplicateKeys: string[];
  classes: LoraStructureType[];
  captionAudit: LoraCaptionAudit;
  coverage: LoraCoverage;
};

const TRIGGER = "eventdecor_structure_v1";
const FORBIDDEN_CAPTION = /(?:SKU|catalog|product\s+id|variant\s+id|price|\bUSD\b|\bCOP\b|package|paquete|shopify)/i;
const NON_ENGLISH = /[áéíóúüñ¿¡]/i;

export function auditStructureCandidates(candidates: StructureCandidate[]): StructureDatasetAudit {
  const seen = new Set<string>();
  const duplicateKeys: string[] = [];
  const accepted: StructureCandidate[] = [];
  const rejected: Array<{ key: string; reasons: string[] }> = [];
  let captionsWithExactTrigger = 0;
  let captionsWithForbiddenTerms = 0;
  let captionsWithProductIdentity = 0;

  for (const candidate of candidates) {
    const reasons: string[] = [];
    if (seen.has(candidate.sha256)) {
      duplicateKeys.push(candidate.key);
      reasons.push("duplicate_image");
    }
    seen.add(candidate.sha256);
    if (candidate.width < 512 || candidate.height < 512) reasons.push("low_resolution");
    if (!candidate.structureTypes.length) reasons.push("missing_structure_type");
    if (candidate.structureTypes.some((type) => !LoraStructureTypeSchema.safeParse(type).success)) reasons.push("invalid_structure_type");
    if (candidate.quality?.people) reasons.push("people_detected");
    if (candidate.quality?.text) reasons.push("text_detected");
    if (candidate.quality?.watermark) reasons.push("watermark_detected");
    if (candidate.quality?.nearDuplicate) reasons.push("near_duplicate");
    if (candidate.quality?.licenseVerified === false) reasons.push("license_not_verified");
    const exactTriggerCount = (candidate.caption.match(new RegExp(`\\b${TRIGGER}\\b`, "g")) ?? []).length;
    if (exactTriggerCount === 1) captionsWithExactTrigger += 1;
    else reasons.push("trigger_count_invalid");
    if (FORBIDDEN_CAPTION.test(candidate.caption)) {
      captionsWithForbiddenTerms += 1;
      reasons.push("forbidden_caption_term");
    }
    if (NON_ENGLISH.test(candidate.caption)) reasons.push("caption_language_invalid");
    if (/\b(?:SKU|catalog|variant|product)\b/i.test(candidate.caption)) captionsWithProductIdentity += 1;
    if (reasons.length) rejected.push({ key: candidate.key, reasons: [...new Set(reasons)] });
    else accepted.push(candidate);
  }

  const groups = splitStructureCandidates(accepted);
  const byClass = Object.fromEntries([...new Set(accepted.flatMap((candidate) => candidate.structureTypes))].map((type) => [type, { train: 0, validation: 0, test: 0 }])) as LoraCoverage["byStructureType"];
  for (const candidate of accepted) {
    const split = groups.get(candidate.key) ?? "train";
    for (const type of candidate.structureTypes) byClass[type]![split] += 1;
  }
  const captionAudit: LoraCaptionAudit = {
    totalImages: candidates.length,
    captionsWithExactTrigger,
    captionsWithForbiddenTerms,
    captionsWithProductIdentity,
    language: rejected.some((item) => item.reasons.includes("caption_language_invalid")) ? "mixed" : "en",
    vocabularyPass: rejected.every((item) => !item.reasons.includes("invalid_structure_type") && !item.reasons.includes("forbidden_caption_term")),
    manualReviewRequired: rejected.length > 0 || duplicateKeys.length > 0,
  };
  return {
    accepted,
    rejected,
    duplicateKeys,
    classes: [...new Set(accepted.flatMap((candidate) => candidate.structureTypes))],
    captionAudit,
    coverage: {
      totalImages: accepted.length,
      trainImages: [...groups.values()].filter((split) => split === "train").length,
      validationImages: [...groups.values()].filter((split) => split === "validation").length,
      testImages: [...groups.values()].filter((split) => split === "test").length,
      byStructureType: byClass,
    },
  };
}

export function splitStructureCandidates(candidates: StructureCandidate[]): Map<string, "train" | "validation" | "test"> {
  const groupKeys = [...new Set(candidates.map((candidate) => candidate.groupKey))].sort();
  const splits: Array<"train" | "validation" | "test"> = ["train", "train", "train", "train", "train", "train", "train", "validation", "validation", "test"];
  const byGroup = new Map(groupKeys.map((group, index) => [group, splits[index % splits.length]! ]));
  return new Map(candidates.map((candidate) => [candidate.key, byGroup.get(candidate.groupKey) ?? "train"]));
}

export function buildStructureCaption(input: {
  structureType: LoraStructureType;
  quantity?: number;
  geometry: string;
  support: string;
  colors?: string[];
  relation?: string;
  placement: string;
  environment?: string;
}): string {
  const parts = [
    TRIGGER,
    `${input.quantity && input.quantity > 1 ? `${input.quantity} ` : ""}${input.structureType}`,
    input.geometry,
    input.support,
    ...(input.colors ?? []),
    input.relation,
    input.placement,
    input.environment,
  ].filter(Boolean);
  return parts.join(", ");
}

