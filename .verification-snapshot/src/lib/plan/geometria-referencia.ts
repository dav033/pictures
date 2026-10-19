import { z } from "zod";

/** Caja normalizada y forma de la foto para dimensionar piezas en Python. */
export const PistaGeometriaSchema = z.object({
  referencia_element_id: z.string().trim().min(1).max(80),
  source_image_id: z.string().trim().min(1).max(40),
  caja: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
  }).strict(),
  aspect_ratio: z.number().min(0.1).max(10).optional(),
  confianza: z.number().min(0).max(1),
}).strict();

export type PistaGeometria = z.infer<typeof PistaGeometriaSchema>;
