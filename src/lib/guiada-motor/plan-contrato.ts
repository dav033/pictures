import { z } from "zod";
import { BriefGuiadoSchema, PlanGuiadoSchema, PropuestaComposicionSchema } from "@/lib/ia/contracts/asistente-guiado-v1";

/**
 * Contrato de `POST /api/guiada/motor/plan` (REQ-007, fase 2): el plan de la vista guiada armado por el motor 3D.
 * Sin `server-only`: lo comparten la ruta y el navegador. Un fallo TIPADO (`fallback`) quiere decir «este plan no sale
 * del motor 3D»: quien llama lo resuelve por el camino de Python y deja el motivo en el registro.
 */
export const RUTA_PLAN_MOTOR = "/api/guiada/motor/plan";

export const RAZONES_FALLBACK = [
  /** La bandera dice `python` (o cambió mientras tanto) y el plan es nuevo. Un plan del 3D abierto (`base`) no la mira. */
  "bandera_python",
  /**
   * El corte del 3D (P-045): ningún plan sale del 3D, tampoco el que rehace un plan del 3D abierto. Con `base`, la vista
   * avisa al cliente de que su plan se recalcula (y el precio puede cambiar) antes de hacerlo con Python.
   */
  "motor_3d_cortado",
  /**
   * Con la bandera en `python`, un plan del 3D cuya línea empezó hace más de `LIMITE_CONTINUIDAD_3D_MS` (P-045): ya no sigue
   * en el 3D. La vista avisa igual que con el corte antes de recalcularlo.
   */
  "plan_3d_vencido",
  /**
   * La aprobación del plan del 3D que se rehace ya no sirve (vencida tras 24 h sin cambios, de otro navegador o de otro plan):
   * el 3D no puede seguir con él. Como con el corte, la vista avisa antes de recalcularlo.
   */
  "aprobacion_invalida",
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

/** Las razones por las que un plan del 3D ABIERTO deja el 3D: el cliente lo lee antes de que se recalcule (D-023). */
export const RAZONES_RECALCULO = ["motor_3d_cortado", "plan_3d_vencido", "aprobacion_invalida"] as const satisfies readonly RazonFallback[];
export type RazonRecalculo = (typeof RAZONES_RECALCULO)[number];
export const esRazonRecalculo = (razon: string): razon is RazonRecalculo => (RAZONES_RECALCULO as readonly string[]).includes(razon);

export const CuerpoPlanMotorSchema = z.discriminatedUnion("desde", [
  /** Con `base`, el plan vigente DEL MOTOR 3D que esta propuesta rehace: sigue en el motor aunque la bandera diga `python` (salvo el corte). Sin ella, un plan nuevo (pide la bandera en `3d`). */
  z.object({ desde: z.literal("propuesta"), propuesta: PropuestaComposicionSchema, brief: BriefGuiadoSchema.optional(), base: PlanGuiadoSchema.optional() }).strict(),
  /** Con `base`, el plan vigente DEL MOTOR 3D al que se suman las piezas de la idea (sigue en el 3D, salvo el corte); sin ella, un plan nuevo. */
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
