import { z } from "zod";

/**
 * Qué motor arma el plan de la guiada: `python` (el de siempre) o `3d` (globos3d, REQ-007). Sin `server-only` a propósito:
 * lo comparten el servidor (la bandera) y el navegador (el widget del plan y el hook).
 */
export const MotorGuiadaSchema = z.enum(["3d", "python"]);
export type MotorGuiada = z.infer<typeof MotorGuiadaSchema>;

/** Los planes y las sesiones guardadas antes de la bandera no traen motor: son de Python. */
export const MOTOR_POR_DEFECTO: MotorGuiada = "python";

/** De dónde salió el motor vigente, de más a menos prioritario (D-024). */
export const FUENTES_MOTOR = ["cookie", "ajuste", "env", "defecto"] as const;
export type FuenteMotor = (typeof FUENTES_MOTOR)[number];

export const RespuestaMotorSchema = z.object({ motor: MotorGuiadaSchema, fuente: z.enum(FUENTES_MOTOR) }).strict();
export type RespuestaMotor = z.infer<typeof RespuestaMotorSchema>;

/** Fase 0: el plan se arma siempre con Python, diga lo que diga la bandera. Las fases 1 y 2 sustituyen esta constante por el motor realmente usado. */
export const MOTOR_EFECTIVO_FASE_0: MotorGuiada = "python";

export const RUTA_MOTOR_GUIADA = "/api/guiada/motor";
/** `?para=plan_nuevo`: la lectura es para crear un plan y el servidor la deja en la auditoría de la conversación. */
export const PARA_PLAN_NUEVO = "plan_nuevo";
