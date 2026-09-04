import { z } from "zod";

export const LoraSpecializationSchema = z.enum(["product", "structure"]);
export type LoraSpecialization = z.infer<typeof LoraSpecializationSchema>;

export const LoraStructureTypeSchema = z.enum([
  "arco",
  "semiarco",
  "guirnalda",
  "columna",
  "bouquet",
  "backdrop",
  "instalacion_completa",
]);
export type LoraStructureType = z.infer<typeof LoraStructureTypeSchema>;

export const LoraCanonicalTrainingRunStatusSchema = z.enum([
  "draft",
  "ready",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type LoraCanonicalTrainingRunStatus = z.infer<typeof LoraCanonicalTrainingRunStatusSchema>;

export const LoraLicenseStatusSchema = z.enum(["pending", "verified", "rejected"]);
export type LoraLicenseStatus = z.infer<typeof LoraLicenseStatusSchema>;

export const LoraEvaluationStatusSchema = z.enum(["pending", "running", "approved", "rejected"]);
export type LoraEvaluationStatus = z.infer<typeof LoraEvaluationStatusSchema>;

export const LoraCaptionAuditSchema = z.object({
  totalImages: z.number().int().nonnegative(),
  captionsWithExactTrigger: z.number().int().nonnegative(),
  captionsWithForbiddenTerms: z.number().int().nonnegative(),
  captionsWithProductIdentity: z.number().int().nonnegative(),
  language: z.enum(["en", "mixed", "unknown"]),
  vocabularyPass: z.boolean(),
  manualReviewRequired: z.boolean(),
  auditedAt: z.string().datetime().optional(),
});
export type LoraCaptionAudit = z.infer<typeof LoraCaptionAuditSchema>;

export const LoraCoverageSchema = z.object({
  totalImages: z.number().int().nonnegative(),
  trainImages: z.number().int().nonnegative(),
  validationImages: z.number().int().nonnegative(),
  testImages: z.number().int().nonnegative(),
  byStructureType: z.record(z.string(), z.object({
    train: z.number().int().nonnegative(),
    validation: z.number().int().nonnegative(),
    test: z.number().int().nonnegative(),
  })).default({}),
});
export type LoraCoverage = z.infer<typeof LoraCoverageSchema>;

export const LoraArtifactKindSchema = z.enum([
  "dataset_zip",
  "manifest",
  "caption_bundle",
  "checkpoint",
  "weights",
  "receipt",
  "evaluation_report",
  "log",
]);
export type LoraArtifactKind = z.infer<typeof LoraArtifactKindSchema>;

export const LoraArtifactSelectionSchema = z.object({
  artifactId: z.string().trim().min(1).max(200),
  scale: z.number().min(0).max(1.5).optional(),
});

export const LoraSelectionSchema = z.object({
  product: LoraArtifactSelectionSchema.optional(),
  structure: LoraArtifactSelectionSchema.optional(),
}).refine((selection) => Boolean(selection.product || selection.structure), {
  message: "Selecciona al menos un LoRA",
});
export type LoraSelection = z.infer<typeof LoraSelectionSchema>;

export const LoraModeSlugSchema = z.enum(["unlimited", "training_1", "training_2"]);
export type LoraModeSlug = z.infer<typeof LoraModeSlugSchema>;

export const LoraDatasetStatusSchema = z.enum(["building", "ready", "failed", "archived"]);
export type LoraDatasetStatus = z.infer<typeof LoraDatasetStatusSchema>;

export const LoraCoverageStatusSchema = z.enum(["complete", "partial", "unknown"]);
export type LoraCoverageStatus = z.infer<typeof LoraCoverageStatusSchema>;

export const LoraDatasetImageReviewStatusSchema = z.enum([
  "confirmed",
  "empty_confirmed",
  "pending",
]);

export const LoraDatasetSourceKindSchema = z.enum([
  "order_feedback",
  "approved_manifest",
  "manual",
  "legacy_import",
]);

export const LoraElementKindSchema = z.enum([
  "structure",
  "shopify_variant",
  "environment",
  "spatial_relation",
]);
export type LoraElementKind = z.infer<typeof LoraElementKindSchema>;

export const LoraEvidenceKindSchema = z.enum([
  "feedback_confirmed",
  "controlled_caption",
  "manual_review",
  "imported_snapshot",
]);

const LoraJsonObjectSchema = z.record(z.string(), z.unknown());

export const LoraDatasetSourceSchema = z.object({
  kind: LoraDatasetSourceKindSchema,
  order: z.string().optional(),
  photoIndex: z.number().int().nonnegative().optional(),
  ref: z.string().optional(),
});

export const LoraDatasetImageElementSchema = z.object({
  elementKind: LoraElementKindSchema,
  canonicalId: z.string().min(1),
  label: z.string().min(1),
  productId: z.string().optional(),
  variantId: z.string().optional(),
  sku: z.string().optional(),
  evidenceKind: LoraEvidenceKindSchema,
  evidenceRef: z.string().optional(),
});

export const LoraDatasetManifestImageSchema = z.object({
  key: z.string().min(1),
  imageSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  captionSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  mimeType: z.string().min(1).optional(),
  source: LoraDatasetSourceSchema,
  captionWordCount: z.number().int().nonnegative().default(0),
  reviewStatus: LoraDatasetImageReviewStatusSchema,
  metadata: LoraJsonObjectSchema.default({}),
  elements: z.array(LoraDatasetImageElementSchema).default([]),
});

export const LoraDatasetStatisticSchema = z.object({
  canonicalId: z.string().min(1),
  label: z.string().min(1),
  productId: z.string().optional(),
  variantId: z.string().optional(),
  sku: z.string().optional(),
  imageCount: z.number().int().nonnegative(),
  representationPct: z.number().min(0).max(100),
  imageKeys: z.array(z.string().min(1)),
});

export const LoraDatasetStatisticsSchema = z.object({
  structures: z.array(LoraDatasetStatisticSchema).default([]),
  shopifyVariants: z.array(LoraDatasetStatisticSchema).default([]),
  environment: z.array(LoraDatasetStatisticSchema).default([]),
  spatialRelations: z.array(LoraDatasetStatisticSchema).default([]),
});

export const LoraDatasetManifestSchema = z.object({
  schemaVersion: z.literal("lora-dataset-manifest.v1"),
  dataset: z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    trigger: z.string().min(1),
    imageCount: z.number().int().nonnegative(),
    captionCount: z.number().int().nonnegative(),
    zipSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  }),
  sourceDefinition: LoraJsonObjectSchema,
  images: z.array(LoraDatasetManifestImageSchema),
  statistics: LoraDatasetStatisticsSchema,
}).superRefine((manifest, context) => {
  if (manifest.dataset.imageCount !== manifest.images.length) {
    context.addIssue({
      code: "custom",
      path: ["dataset", "imageCount"],
      message: "imageCount debe coincidir con cantidad de imágenes del manifiesto",
    });
  }
  if (manifest.dataset.captionCount !== manifest.images.length) {
    context.addIssue({
      code: "custom",
      path: ["dataset", "captionCount"],
      message: "captionCount debe coincidir con cantidad de imágenes del manifiesto",
    });
  }
});
export type LoraDatasetManifest = z.infer<typeof LoraDatasetManifestSchema>;

export const LoraDatasetManifestV2ImageSchema = LoraDatasetManifestImageSchema.extend({
  split: z.enum(["train", "validation", "test"]),
  assemblyId: z.string().min(1),
  eventKey: z.string().min(1),
  structureTypes: z.array(LoraStructureTypeSchema).min(1),
  productMentionPolicy: z.enum(["forbidden", "generic_only"]).default("forbidden"),
});

export const LoraDatasetManifestV2Schema = z.object({
  schemaVersion: z.literal("lora-dataset-manifest.v2"),
  dataset: z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    specialization: z.literal("structure"),
    trigger: z.literal("eventdecor_structure_v1"),
    baseModel: z.string().min(1),
    tokenizerRevision: z.string().min(1),
    resolution: z.number().int().positive(),
    imageCount: z.number().int().nonnegative(),
    captionCount: z.number().int().nonnegative(),
    zipSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  }),
  sourceDefinition: LoraJsonObjectSchema,
  licenseStatus: LoraLicenseStatusSchema,
  captionAudit: LoraCaptionAuditSchema,
  coverage: LoraCoverageSchema,
  images: z.array(LoraDatasetManifestV2ImageSchema),
}).superRefine((manifest, context) => {
  if (manifest.dataset.imageCount !== manifest.images.length) context.addIssue({ code: "custom", path: ["dataset", "imageCount"], message: "imageCount no coincide con images" });
  if (manifest.dataset.captionCount !== manifest.images.length) context.addIssue({ code: "custom", path: ["dataset", "captionCount"], message: "captionCount no coincide con images" });
  if (manifest.licenseStatus !== "verified") context.addIssue({ code: "custom", path: ["licenseStatus"], message: "Las referencias requieren licencia verificada" });
});
export type LoraDatasetManifestV2 = z.infer<typeof LoraDatasetManifestV2Schema>;

export const LoraTrainingRunStatusSchema = z.enum([
  "draft",
  "uploading",
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export type LoraTrainingRunStatus = z.infer<typeof LoraTrainingRunStatusSchema>;

export const LoraArtifactStatusSchema = z.enum(["pending", "backed_up", "invalid"]);
export const LoraEvaluationVerdictSchema = z.enum(["pending", "approved", "rejected"]);

export const LoraTrainingReceiptSchema = z.object({
  schemaVersion: z.literal("lora-training-receipt.v1"),
  trainingRun: z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    datasetId: z.string().min(1),
    datasetSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    provider: z.string().min(1),
    trainerEndpoint: z.string().min(1),
    steps: z.number().int().positive(),
    learningRate: z.number().positive(),
    estimatedCostUsd: z.number().nonnegative().optional(),
    actualCostUsd: z.number().nonnegative().optional(),
    providerRequestId: z.string().min(1).optional(),
  }),
  result: z.object({
    resultUrl: z.string().url().optional(),
    weightStorageKey: z.string().min(1).optional(),
    weightSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    weightBytes: z.number().int().nonnegative().optional(),
    rank: z.number().int().positive().optional(),
    architecture: z.string().min(1).optional(),
  }),
  evaluation: z.object({
    protocolVersion: z.string().min(1),
    loraScale: z.number().min(0).max(2),
    passedCount: z.number().int().nonnegative(),
    totalCount: z.number().int().nonnegative(),
    verdict: LoraEvaluationVerdictSchema,
  }),
}).superRefine((receipt, context) => {
  if (receipt.evaluation.passedCount > receipt.evaluation.totalCount) {
    context.addIssue({
      code: "custom",
      path: ["evaluation", "passedCount"],
      message: "passedCount no puede superar totalCount",
    });
  }
});
export type LoraTrainingReceipt = z.infer<typeof LoraTrainingReceiptSchema>;

export const LoraJobKindSchema = z.enum([
  "dataset_export",
  "training_sync",
  "weight_backup",
  "evaluation",
]);
export const LoraJobStatusSchema = z.enum(["pending", "running", "succeeded", "failed"]);
