import { z } from "zod";
import {
  CATEGORIAS_SUJETO_ESCULTURA,
  DISTRIBUCIONES_ESPACIALES,
  FUNCIONES_PARTE_ESCULTURA,
  RELACIONES_FISICAS,
  TIPOS_ANCLA_ESPACIO,
} from "@/lib/plan/composicion";

const text = (max: number) => z.string().trim().min(1).max(max);

export const SceneElementKindSchema = z.enum(["balloon_structure", "catalog_prop", "backdrop"]);
export type SceneElementKind = z.infer<typeof SceneElementKindSchema>;

export const QuantitySemanticsSchema = z.enum(["material_units", "physical_instances"]);
export type QuantitySemantics = z.infer<typeof QuantitySemanticsSchema>;

export const CatalogVisualPatternSchema = z.object({
  kind: text(60),
  motif: text(180).optional(),
  text_policy: z.enum(["none", "graphic_lettering", "exact_approved"]).default("none"),
  approved_text: text(120).optional(),
  evidence_ref: text(160).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.text_policy === "exact_approved" && (!value.approved_text || !value.evidence_ref)) {
    ctx.addIssue({ code: "custom", path: ["text_policy"], message: "exact_approved requiere approved_text y evidence_ref." });
  }
  if (value.text_policy !== "exact_approved" && (value.approved_text || value.evidence_ref)) {
    ctx.addIssue({ code: "custom", path: ["approved_text"], message: "approved_text/evidence_ref solo aplican a exact_approved." });
  }
});
export type CatalogVisualPattern = z.infer<typeof CatalogVisualPatternSchema>;

export const CatalogVisualDescriptorSchema = z.object({
  descriptor_perceptual_en: text(420),
  pattern: CatalogVisualPatternSchema,
  concept_id: text(160).optional(),
}).strict();
export type CatalogVisualDescriptor = z.infer<typeof CatalogVisualDescriptorSchema>;

export const PhysicalFormPartSchema = z.object({
  parte_id: text(60),
  funcion: z.enum(FUNCIONES_PARTE_ESCULTURA),
  descriptor_perceptual_en: text(200),
  variant_ids: z.array(text(160)).min(1).max(12),
}).strict();

export const PhysicalFormSchema = z.object({
  categoria_sujeto: z.enum(CATEGORIAS_SUJETO_ESCULTURA),
  sujeto: text(80),
  descripcion_perceptual_en: text(400),
  partes: z.array(PhysicalFormPartSchema).min(1).max(12),
}).strict();
export type PhysicalForm = z.infer<typeof PhysicalFormSchema>;

export const SceneAnchorSchema = z.object({
  anchor_id: text(80),
  tipo: z.enum(TIPOS_ANCLA_ESPACIO),
  evidencia: text(240),
  bbox: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).strict().optional(),
}).strict();
export type SceneAnchor = z.infer<typeof SceneAnchorSchema>;

const RelationTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ancla_espacio"), id: text(80) }).strict(),
  z.object({ kind: z.literal("elemento_plan"), id: text(80) }).strict(),
]);

export const PhysicalRelationSchema = z.object({
  relacion: z.enum(RELACIONES_FISICAS),
  target: RelationTargetSchema,
  prioridad: z.enum(["primaria", "secundaria"]),
  distribucion: z.enum(DISTRIBUCIONES_ESPACIALES).optional(),
}).strict();
export type PhysicalRelation = z.infer<typeof PhysicalRelationSchema>;
