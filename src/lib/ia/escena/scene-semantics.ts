import { z } from "zod";
import { TIPOS_ESTRUCTURA, UBICACIONES } from "@/lib/plan/composicion";

export const FLUX_STRUCTURE_TYPES = TIPOS_ESTRUCTURA;

export const FLUX_PLACEMENTS = UBICACIONES;

export const FLUX_DESIGN_ROLES = ["focal", "soporte", "acento"] as const;
export const FLUX_DENSITIES = ["sencilla", "media", "lujosa"] as const;

export const VisualSemanticsSchema = z
  .object({
    structure_type: z.enum(FLUX_STRUCTURE_TYPES),
    placement: z.enum(FLUX_PLACEMENTS),
    design_role: z.enum(FLUX_DESIGN_ROLES),
    repetition_group: z.string().trim().min(1).max(80),
    dimensions_m: z
      .object({
        width: z.number().positive().max(100).optional(),
        height: z.number().positive().max(100).optional(),
        length: z.number().positive().max(100).optional(),
      })
      .strict()
      .optional(),
    density: z.enum(FLUX_DENSITIES),
  })
  .strict();

export type FluxStructureType = (typeof FLUX_STRUCTURE_TYPES)[number];
export type FluxPlacement = (typeof FLUX_PLACEMENTS)[number];
export type FluxDesignRole = (typeof FLUX_DESIGN_ROLES)[number];
export type FluxDensity = (typeof FLUX_DENSITIES)[number];
export type VisualSemantics = z.infer<typeof VisualSemanticsSchema>;
