import { z } from "zod";

/** Rectangle around a rendered sign, expressed as fractions of the captured image. */
export const CajaLetreroFotoV1Schema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  ancho: z.number().finite().gt(0).max(1),
  alto: z.number().finite().gt(0).max(1),
}).strict().superRefine((caja, contexto) => {
  if (caja.x + caja.ancho > 1.000001) contexto.addIssue({ code: "custom", path: ["ancho"], message: "The sign box exceeds the image width." });
  if (caja.y + caja.alto > 1.000001) contexto.addIssue({ code: "custom", path: ["alto"], message: "The sign box exceeds the image height." });
});

/** Versioned additive request metadata; older callers omit it and keep the original render path. */
export const CajasLetreroFotoV1Schema = z.array(CajaLetreroFotoV1Schema).max(50).default([]);
export type CajaLetreroFotoV1 = z.infer<typeof CajaLetreroFotoV1Schema>;

export const RespuestaRenderFotoV1Schema = z.union([
  z.object({
    imagen: z.string().regex(/^data:image\/(?:png|jpeg|webp);base64,/),
    aviso: z.string().trim().min(1).max(240).optional(),
  }),
  z.object({
    error: z.string().trim().min(1).max(300),
  }),
]);
