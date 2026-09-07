import { z } from "zod";
import { TIPOS_ESTRUCTURA, UBICACIONES } from "@/lib/plan/composicion";

export const LORA_STRUCTURE_TYPES = TIPOS_ESTRUCTURA;

export const LORA_PLACEMENTS = UBICACIONES;

export const LORA_DESIGN_ROLES = ["focal", "soporte", "acento"] as const;
export const LORA_DENSITIES = ["sencilla", "media", "lujosa"] as const;

export const VisualSemanticsSchema = z
  .object({
    structure_type: z.enum(LORA_STRUCTURE_TYPES),
    placement: z.enum(LORA_PLACEMENTS),
    design_role: z.enum(LORA_DESIGN_ROLES),
    repetition_group: z.string().trim().min(1).max(80),
    dimensions_m: z
      .object({
        width: z.number().positive().max(100).optional(),
        height: z.number().positive().max(100).optional(),
        length: z.number().positive().max(100).optional(),
      })
      .strict()
      .optional(),
    density: z.enum(LORA_DENSITIES),
  })
  .strict();

export type LoraStructureType = (typeof LORA_STRUCTURE_TYPES)[number];
export type LoraPlacement = (typeof LORA_PLACEMENTS)[number];
export type LoraDesignRole = (typeof LORA_DESIGN_ROLES)[number];
export type LoraDensity = (typeof LORA_DENSITIES)[number];
export type VisualSemantics = z.infer<typeof VisualSemanticsSchema>;
