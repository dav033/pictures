import { createHash } from "node:crypto";
import { z } from "zod";
import { VisualSemanticsSchema } from "./lora-semantics";

const texto = (max: number) => z.string().trim().min(1).max(max);

export const BBoxSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
  })
  .strict();

export const ReferenceRoleSchema = z.enum([
  "composition_reference",
  "element_reference",
  "palette_reference",
  "style_reference",
  "catalog_product_reference",
  "venue_base",
]);

const QuantitySchema = z
  .object({
    mode: z.enum(["exact", "approximate", "range"]),
    min: z.number().int().min(0).max(999),
    max: z.number().int().min(0).max(999),
  })
  .strict()
  .refine((value) => value.max >= value.min, "quantity.max must be >= quantity.min");

const AppearanceSchema = z
  .object({
    observed_colors: z.array(texto(80)).max(8),
    resolved_colors: z.array(texto(80)).max(8),
    color_policy: z.enum(["match_reference", "adapt_to_event_palette", "custom"]),
    material: texto(160),
    shape: texto(160),
    // Cómo se arma físicamente el elemento cuando necesita más de un material
    // (ej. "60% globos rojos en la base, 30% verdes subiendo, 10% acentos
    // dorados en la punta") — sin esto, un elemento multi-material solo tenía
    // una `shape` de texto libre sin desglose real de proporciones.
    composition: texto(240).default("single uniform material"),
  })
  .strict();

const RelationshipSchema = z
  .object({
    type: z.enum(["behind", "in_front_of", "overlaps", "aligned_with", "supports"]),
    target_element_id: texto(80),
  })
  .strict();

// Una línea de material del "bill of materials": qué producto real, qué rol
// cumple en el armado (ej. "base verde", "acentos dorados"), y qué fracción
// de la cantidad total del elemento representa. `catalog_product_id` en
// `CatalogResolutionSchema` sigue siendo el material principal (primer/mayor
// share) para no romper el código que solo lee un id — `bill_of_materials`
// es la lista completa cuando el elemento necesita más de un material.
const MaterialLineSchema = z
  .object({
    catalog_product_id: texto(160),
    role: texto(160),
    share: z.number().min(0).max(1),
  })
  .strict();

const CatalogResolutionSchema = z
  .object({
    action: z.enum(["include", "omit"]),
    catalog_product_id: texto(160).optional(),
    match_type: z.enum(["exact", "closest", "none"]),
    reason: texto(260),
    adaptation: texto(260),
    // Un plan puede expandir hasta 6 materiales declarados por 4 tamaños
    // físicos en una estructura; conservar todas las variantes evita perder
    // la mezcla real de tamaños antes de construir el scene spec.
    bill_of_materials: z.array(MaterialLineSchema).max(24).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === "include" && value.match_type !== "none" && !value.catalog_product_id) {
      ctx.addIssue({ code: "custom", path: ["catalog_product_id"], message: "Included catalog matches require a product id." });
    }
    if (value.action === "omit" && value.catalog_product_id) {
      ctx.addIssue({ code: "custom", path: ["catalog_product_id"], message: "Omitted elements cannot select a catalog product." });
    }
  });

export const ReferenceElementSchema = z
  .object({
    element_id: texto(80),
    source_image_id: texto(40),
    name: texto(160),
    category: z.enum([
      "curtain",
      "drape",
      "backdrop",
      "panel",
      "balloon_structure",
      "plinth",
      "furniture",
      "floral",
      "signage",
      "lighting",
      "tableware",
      "other",
    ]),
    scene_role: z.enum(["backdrop", "midground", "foreground", "accent", "lighting"]),
    detection_confidence: z.number().min(0).max(1),
    visible_evidence: texto(320),
    reference_bbox: BBoxSchema,
    depth_layer: z.number().int().min(0).max(99),
    include_policy: z.enum(["include", "exclude", "ask"]),
    approved: z.boolean(),
    source_type: z.enum(["catalog_backed", "reference_only"]),
    quantity: QuantitySchema,
    appearance: AppearanceSchema,
    relationships: z.array(RelationshipSchema).max(12),
    // Semántica tipada del plan. Opcional para blueprints antiguos y referencias
    // externas que todavía no pasan por el compilador LoRA v2.
    visual_semantics: VisualSemanticsSchema.optional(),
    resolved_finishes: z.array(texto(80)).max(8).optional(),
    uncertainties: z.array(texto(180)).max(8),
    model_decision: CatalogResolutionSchema.optional(),
  })
  .strict();

const SourceImageSchema = z
  .object({
    image_id: texto(40),
    approved_roles: z.array(ReferenceRoleSchema).min(1).max(6),
  })
  .strict();

const CompositionSchema = z
  .object({
    focal_point: texto(240),
    density: z.enum(["sparse", "moderate", "dense", "unknown"]),
    symmetry: z.enum(["symmetric", "asymmetric", "unknown"]),
    negative_space: z.array(texto(120)).max(12),
  })
  .strict();

const PaletteSchema = z
  .object({
    observed: z.array(texto(80)).max(12),
    priority: z.array(texto(80)).max(8),
  })
  .strict();

const DecisionSchema = z
  .object({
    decision_id: texto(60),
    element_id: texto(80),
    question: texto(240),
  })
  .strict();

export const ReferenceBlueprintV2Schema = z
  .object({
    schema_version: z.literal("2.0"),
    source_images: z.array(SourceImageSchema).min(1).max(10),
    elements: z.array(ReferenceElementSchema).max(80),
    composition: CompositionSchema,
    palette: PaletteSchema,
    unresolved_decisions: z.array(DecisionSchema).max(40),
  })
  .strict()
  .superRefine((value, ctx) => {
    const imageIds = new Set(value.source_images.map((image) => image.image_id));
    const elementIds = new Set<string>();
    for (const element of value.elements) {
      if (!imageIds.has(element.source_image_id)) {
        ctx.addIssue({ code: "custom", path: ["elements"], message: `Unknown source image: ${element.source_image_id}` });
      }
      if (elementIds.has(element.element_id)) {
        ctx.addIssue({ code: "custom", path: ["elements"], message: `Duplicate element id: ${element.element_id}` });
      }
      elementIds.add(element.element_id);
      if (element.source_type === "catalog_backed" && !element.approved) {
        ctx.addIssue({ code: "custom", path: ["elements"], message: "Catalog-backed element must be approved before generation." });
      }
      if (element.approved && element.include_policy === "exclude") {
        ctx.addIssue({ code: "custom", path: ["elements"], message: "Excluded element cannot be approved." });
      }
    }
    for (const element of value.elements) {
      for (const relation of element.relationships) {
        if (!elementIds.has(relation.target_element_id)) {
          ctx.addIssue({ code: "custom", path: ["elements"], message: `Unknown relationship target: ${relation.target_element_id}` });
        }
      }
    }
    detectLayerCycles(value.elements, ctx);
  });

export type ReferenceBlueprintV2 = z.infer<typeof ReferenceBlueprintV2Schema>;
export type ReferenceElement = z.infer<typeof ReferenceElementSchema>;
export type ReferenceBBox = z.infer<typeof BBoxSchema>;
export type MaterialLine = z.infer<typeof MaterialLineSchema>;

export function stableElementId(sourceImageId: string, index: number): string {
  return `${sourceImageId}_E${String(index + 1).padStart(2, "0")}`;
}

export function analysisCacheKey(parts: {
  model: string;
  schemaVersion?: string;
  systemPromptHash: string;
  images: Array<{ image_id: string; mime: string; base64: string }>;
}): string {
  const hash = createHash("sha256")
    .update(parts.model)
    .update(parts.schemaVersion ?? "2.0")
    .update(parts.systemPromptHash);
  for (const image of parts.images) hash.update(image.image_id).update(image.mime).update(image.base64);
  return hash.digest("hex");
}

export function bboxOverlap(a: ReferenceBBox, b: ReferenceBBox): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union ? intersection / union : 0;
}

function detectLayerCycles(elements: ReferenceElement[], ctx: z.RefinementCtx): void {
  const edges = new Map(elements.map((element) => [element.element_id, element.relationships
    .filter((relation) => relation.type === "behind" || relation.type === "in_front_of")
    .map((relation) => relation.target_element_id)]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, path: string[]) => {
    if (visiting.has(id)) {
      ctx.addIssue({ code: "custom", path: ["elements"], message: `Layer relationship cycle: ${[...path, id].join(" -> ")}` });
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of edges.get(id) ?? []) visit(next, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const element of elements) visit(element.element_id, []);
}
