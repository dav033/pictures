import { z } from "zod";

/** El ambiente de la sala que la IA o una escena guardada pueden traer (`AmbienteSala` en `escena.ts`): todo opcional. */
export const AmbienteSalaSchema = z.object({
  piso: z.enum(["madera", "liso"]).optional(),
  luces: z.boolean().optional(),
  ventana: z.boolean().optional(),
});
