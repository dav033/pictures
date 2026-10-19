import { z } from "zod";
import type { CambioPanelV1, EdicionEspecV1 } from "@/lib/globos3d/motor/v1";
import { PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { RAZONES_RECALCULO } from "./plan-contrato";
import type { PedidoEdicionPlan } from "@/lib/ia/guiado/edicion-plan-chat";

/**
 * Contrato de `POST /api/guiada/motor/editar` (REQ-007, fase 5): los cambios del cliente a un plan que armó el motor 3D.
 * Sin `server-only`: lo comparten la ruta y el navegador (que solo importa TIPOS del motor, nunca su código). El navegador
 * manda el plan vigente (con su token, su hash y su espec firmada) y UNA de tres formas de decir el cambio: las
 * operaciones sobre la espec, el pedido que entendió el chat o el cambio del panel «Ajustar mi plan». El servidor lo
 * convierte en operaciones, las aplica, vuelve a armar y a cotizar y devuelve el plan nuevo con su token nuevo.
 */
export const RUTA_EDITAR_MOTOR = "/api/guiada/motor/editar";

export type EdicionDelCliente =
  | { tipo: "ops"; ediciones: EdicionEspecV1[] }
  | { tipo: "pedido"; pedido: PedidoEdicionPlan }
  | { tipo: "cambio"; cambio: CambioPanelV1 };

export type CuerpoEditarMotor = {
  plan: z.infer<typeof PlanGuiadoSchema>;
  /** El id del turno del chat al que pertenece el cambio (el de la calificación): vuelve en `turno.turnoId`. */
  turnoId?: string;
  edicion: EdicionDelCliente;
};

/** Lo que el servidor no hizo y por qué: la `razon` es estable, el `error` es la frase para el cliente («No pude: …»). */
export const CODIGOS_FALLO_EDITAR = [
  "SESION_REQUERIDA", "CUERPO_INVALIDO", "MOTOR_3D_CORTADO", "PLAN_3D_VENCIDO", "APROBACION_INVALIDA", "PLAN_NO_ES_DEL_MOTOR_3D", "ESPEC_INVALIDA", "PLAN_ALTERADO",
  "EDICION_NO_SOPORTADA", "EDICION_NO_APLICADA", "EDICION_NO_ARMABLE", "SIN_COBERTURA", "PRECIO_FALLIDO", "ERROR_DEL_MOTOR", "LIMITE_EDICIONES",
] as const;
export type CodigoFalloEditar = (typeof CODIGOS_FALLO_EDITAR)[number];

export const FalloEditarMotorSchema = z.object({
  error: z.string(),
  codigo: z.string(),
  /**
   * Con el corte del 3D o una línea del 3D que pasó su límite con la bandera en `python` (P-045): el plan no se cambia aquí;
   * la vista lo muestra como `FalloMotor3dApagado`, que avisa de que habría que recalcularlo. La bandera en `python` NO llega aquí: un plan del 3D abierto se sigue cambiando en el 3D.
   */
  fallback: z.object({ razon: z.enum(RAZONES_RECALCULO) }).strict().optional(),
  noAplicadas: z.array(z.string()).optional(),
  avisos: z.array(z.string()).optional(),
}).passthrough();
export type FalloEditarMotor = z.infer<typeof FalloEditarMotorSchema>;

/** El turno del cambio, como lo espera la calificación del chat: el id y la espec de antes y de después. */
export const TurnoEdicionSchema = z.object({
  turnoId: z.string().min(1).max(100),
  antes: z.object({ especHash: z.string(), espec: z.unknown() }).strict(),
  despues: z.object({ especHash: z.string(), espec: z.unknown() }).strict(),
}).strict();
export type TurnoEdicion = z.infer<typeof TurnoEdicionSchema>;

export const RespuestaEditarMotorSchema = z.object({
  plan: PlanGuiadoSchema,
  cotizacion: z.unknown(),
  /** La línea corta del historial («Último ajuste: …»), en pasado y en palabras del cliente. */
  descripcion: z.string(),
  /** Lo que dice el chat al terminar («Listo: …; lo demás quedó igual.»), con los «No pude: …» si algo quedó sin hacer. */
  confirmacion: z.string(),
  /** Lo que el cliente debe saber además (un color sustituido, una medida acotada). */
  avisos: z.array(z.string()),
  noAplicadas: z.array(z.string()),
  tocadas: z.array(z.string()),
  turno: TurnoEdicionSchema,
}).strict();
export type RespuestaEditarMotor = z.infer<typeof RespuestaEditarMotorSchema>;
