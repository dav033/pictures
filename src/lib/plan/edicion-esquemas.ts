import { z } from "zod";
import { PlanDecoracionSchema } from "./tipos";

/**
 * Wire shapes for editing an already-resolved plan: the base plan the client
 * (browser card or chat turn) echoes back, and the edit operation itself.
 *
 * Pure schemas, no server-only code: `src/app/api/plan-editar/route.ts`,
 * `src/lib/plan/aplicar-edicion.ts` (the server-side application of an edit)
 * and `src/lib/ia/contracts/chat-v1.ts` (the chat request's `planVigente`
 * field, bundled into the browser) all import from here instead of keeping
 * their own copy — a single owner for what an edit request must look like.
 */

const BaseLineaSchema = z.object({
  product_id: z.string().min(1),
  variant_id: z.string().min(1),
  color: z.string().nullable().optional(),
}).passthrough();

/**
 * The plan envelope an edit is applied against. `.passthrough()` throughout
 * because callers hold the full `PlanResuelto` (totales, comercial,
 * alternativas...) and send it back as-is; only the fields named here are
 * read.
 */
export const BasePlanSchema = z.object({
  plan: PlanDecoracionSchema,
  plan_hash: z.string().regex(/^[a-f0-9]{64}$/i),
  approval_token: z.string().min(1),
  request_id: z.string().uuid().optional(),
  estructuras: z.array(z.object({
    estructura_id: z.string().min(1),
    lineas: z.array(BaseLineaSchema),
  }).passthrough()).min(1),
  compras: z.array(z.object({
    product_id: z.string().min(1),
    variant_id: z.string().min(1),
  }).passthrough()).min(1),
}).passthrough();

export type BasePlan = z.infer<typeof BasePlanSchema>;

const VarianteEdicionSchema = z.object({
  product_id: z.string().trim().min(1).max(160),
  variant_id: z.string().trim().min(1).max(160),
  color: z.string().trim().min(1).max(80).optional(),
  acabado: z.string().trim().min(1).max(80).optional(),
}).strict();

export const EdicionSchema = z.object({
  accion: z.enum(["agregar", "reemplazar", "quitar"]),
  estructura_id: z.string().trim().min(1).max(160),
  objetivo_variant_id: z.string().trim().min(1).max(160).optional(),
  variante: VarianteEdicionSchema.optional(),
  participacion: z.number().gt(0.01).lt(0.8).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.accion !== "agregar" && !value.objetivo_variant_id) {
    ctx.addIssue({ code: "custom", path: ["objetivo_variant_id"], message: "La operación necesita una variante objetivo." });
  }
  if (value.accion !== "quitar" && !value.variante) {
    ctx.addIssue({ code: "custom", path: ["variante"], message: "La operación necesita una variante del catálogo." });
  }
});

export type Edicion = z.infer<typeof EdicionSchema>;
