import { z } from "zod";
import { BriefGuiadoSchema, PlanGuiadoSchema, PropuestaComposicionSchema } from "@/lib/ia/contracts/asistente-guiado-v1";

/**
 * Contrato de `POST /api/guiada/motor/plan` (REQ-007, fase 2): el plan de la vista guiada armado por el motor 3D.
 * Sin `server-only`: lo comparten la ruta y el navegador. Un fallo TIPADO (`fallback`) quiere decir «este plan no sale
 * del motor 3D»: quien llama lo resuelve por el camino de Python y deja el motivo en el registro.
 */
export const RUTA_PLAN_MOTOR = "/api/guiada/motor/plan";

export const RAZONES_FALLBACK = [
  /** La bandera dice `python` (o cambió mientras tanto) y el plan es nuevo. */
  "bandera_python",
  /** Alguna pieza no tiene constructor en el motor (figura, centro de mesa, aro parcial, pared ligera…) o pasó de los topes. */
  "no_representable",
  /** El catálogo no vende algún globo del plan en esa talla o color. */
  "sin_cobertura",
  /** El servicio de precios falló o rechazó la lista. */
  "precio_fallido",
  /** La idea no tiene plan guardado en la biblioteca. */
  "sin_plan_guardado",
  /** Sumar la idea pasa del tope de piezas del plan. */
  "tope_de_piezas",
  /** La espec salió pero no cabe en el contrato del plan (`PlanGuiadoSchema`). */
  "sobre_invalido",
] as const;
export type RazonFallback = (typeof RAZONES_FALLBACK)[number];

export const CuerpoPlanMotorSchema = z.discriminatedUnion("desde", [
  /** Con `base`, el plan vigente DEL MOTOR 3D que esta propuesta rehace: sigue en el motor aunque la bandera haya cambiado. Sin ella, un plan nuevo (pide la bandera en `3d`). */
  z.object({ desde: z.literal("propuesta"), propuesta: PropuestaComposicionSchema, brief: BriefGuiadoSchema.optional(), base: PlanGuiadoSchema.optional() }).strict(),
  /** Con `base`, el plan vigente DEL MOTOR 3D al que se suman las piezas de la idea; sin ella, un plan nuevo. */
  z.object({ desde: z.literal("idea"), idea_id: z.string().trim().min(1).max(200), base: PlanGuiadoSchema.optional() }).strict(),
]);
export type CuerpoPlanMotor = z.infer<typeof CuerpoPlanMotorSchema>;

export const FalloPlanMotorSchema = z.object({
  error: z.string(),
  codigo: z.string(),
  fallback: z.object({
    razon: z.enum(RAZONES_FALLBACK),
    detalle: z.string().optional(),
    piezas: z.array(z.object({ piezaId: z.string(), motivo: z.string() }).strict()).optional(),
  }).strict().optional(),
}).passthrough();
export type FalloPlanMotor = z.infer<typeof FalloPlanMotorSchema>;

export const RespuestaPlanMotorSchema = z.object({
  plan: PlanGuiadoSchema,
  cotizacion: z.unknown(),
  nuevas: z.array(z.string()),
  globosIdea: z.number().nullable(),
  exacto: z.boolean(),
  avisos: z.array(z.string()),
}).strict();
export type RespuestaPlanMotor = z.infer<typeof RespuestaPlanMotorSchema>;
