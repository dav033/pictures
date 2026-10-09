"use client";

import { useCallback } from "react";
import type { z } from "zod";
import type { BriefGuiadoSchema, PlanGuiadoSchema, PropuestaComposicionSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { MOTOR_POR_DEFECTO, PARA_PLAN_NUEVO, RUTA_MOTOR_GUIADA, RespuestaMotorSchema, type FuenteMotor, type MotorGuiada } from "@/lib/guiada-motor/tipos";
import { cuerpoDeIdea, cuerpoDePropuesta, pedirPlanAlMotor3d, type IntentoMotor3d } from "./plan-motor3d";
import { pedirPlanDeIdea, type PlanExacto } from "./plan-exacto-idea";

type Fetch = (entrada: string, init?: RequestInit) => Promise<Response>;

/**
 * Pregunta al servidor con qué motor se crea un plan nuevo. Cualquier fallo (red, 401, respuesta rara) devuelve
 * `python`: la bandera nunca puede impedir que el cliente tenga su plan.
 */
export async function pedirMotorGuiada(opciones: { para?: typeof PARA_PLAN_NUEVO; signal?: AbortSignal; fetchImpl?: Fetch } = {}): Promise<{ motor: MotorGuiada; fuente: FuenteMotor | null }> {
  const { para, signal, fetchImpl = fetch } = opciones;
  try {
    const respuesta = await fetchImpl(para ? `${RUTA_MOTOR_GUIADA}?para=${para}` : RUTA_MOTOR_GUIADA, { cache: "no-store", signal });
    if (!respuesta.ok) return { motor: MOTOR_POR_DEFECTO, fuente: null };
    const lectura = RespuestaMotorSchema.safeParse(await respuesta.json());
    return lectura.success ? lectura.data : { motor: MOTOR_POR_DEFECTO, fuente: null };
  } catch {
    return { motor: MOTOR_POR_DEFECTO, fuente: null };
  }
}

type PlanGuiado = z.infer<typeof PlanGuiadoSchema>;

/**
 * La bandera de motor de la guiada (REQ-007). No lee nada al montar: nada del primer pintado la usa. Se lee AL CREAR un
 * plan (queda en la auditoría de la conversación) y decide con qué motor sale; un plan ya creado conserva el suyo
 * (`WidgetPlan.motor`): sus ediciones e imágenes siguen con él aunque la bandera cambie.
 *
 * - `alCrearPlan`: la lectura de la bandera.
 * - `planDePropuesta` / `planDeIdea`: piden el plan al motor 3D si toca. Devuelven `null` (propuesta) o un plan de Python
 *   (idea) cuando la bandera dice `python`, cuando el plan viene de una foto, o cuando el 3D no lo arma (fallo tipado,
 *   con su motivo en `alFallback`). Un plan que ya era del 3D nunca cae a Python: o sale del 3D o no sale.
 */
export type PlanDeMotor = { motor: MotorGuiada };
export type FalloMotor3d = Extract<IntentoMotor3d, { ok: false }>;
export type EntradaPlanDePropuesta = {
  propuesta: z.infer<typeof PropuestaComposicionSchema>;
  brief?: z.infer<typeof BriefGuiadoSchema>;
  /** El plan vigente si es del motor 3D: esta propuesta lo rehace en el 3D. */
  anterior3d: PlanGuiado | null;
  /** El plan sale de una foto: va por Python (Q5). */
  deFoto: boolean;
  signal: AbortSignal;
  /** Se llama con el motivo cuando el 3D no armó el plan (para dejarlo en el registro). */
  alFallback: (fallo: FalloMotor3d) => void;
};
export type EntradaPlanDeIdea = {
  ideaId: string;
  /** El plan vigente y su motor, o null si la idea crea el plan. */
  base: { plan: PlanGuiado; motor: MotorGuiada } | null;
  signal: AbortSignal;
  alFallback: (fallo: FalloMotor3d) => void;
};

export function useMotorGuiada(): {
  alCrearPlan: () => Promise<MotorGuiada>;
  planDePropuesta: (entrada: EntradaPlanDePropuesta) => Promise<IntentoMotor3d | null>;
  planDeIdea: (entrada: EntradaPlanDeIdea) => Promise<PlanExacto & PlanDeMotor>;
} {
  const alCrearPlan = useCallback(async () => (await pedirMotorGuiada({ para: PARA_PLAN_NUEVO })).motor, []);
  const planDePropuesta = useCallback(async ({ propuesta, brief, anterior3d, deFoto, signal, alFallback }: EntradaPlanDePropuesta): Promise<IntentoMotor3d | null> => {
    // Un plan de foto va por Python (Q5); uno que ya era del 3D se rehace en el 3D; uno nuevo, según la bandera.
    if (deFoto && !anterior3d) return null;
    if (!anterior3d && (await alCrearPlan()) !== "3d") return null;
    const intento = await pedirPlanAlMotor3d(cuerpoDePropuesta(propuesta, brief, anterior3d), signal);
    if (!intento.ok) alFallback(intento);
    return intento.ok || anterior3d || intento.detenido ? intento : null;
  }, [alCrearPlan]);
  const planDeIdea = useCallback(async ({ ideaId, base, signal, alFallback }: EntradaPlanDeIdea): Promise<PlanExacto & PlanDeMotor> => {
    // Sumar a un plan del 3D sigue en el 3D; sumar a uno de Python, en Python; un plan nuevo, según la bandera.
    const motor = base ? base.motor : await alCrearPlan();
    if (motor === "3d") {
      const intento = await pedirPlanAlMotor3d(cuerpoDeIdea(ideaId, base?.plan ?? null), signal);
      if (intento.ok) return { ok: true, plan: intento.plan, cotizacion: intento.cotizacion, nuevas: intento.nuevas, globosIdea: intento.globosIdea, exacto: intento.exacto, avisos: intento.exacto ? [] : intento.avisos, motor: "3d" };
      alFallback(intento);
      if (base || intento.detenido) return { ok: false, motivo: intento.detalle, estado: intento.estado, detenido: intento.detenido, motor: "3d" };
    }
    return { ...(await pedirPlanDeIdea(ideaId, base?.motor === "python" ? base.plan : null, signal)), motor: "python" };
  }, [alCrearPlan]);
  return { alCrearPlan, planDePropuesta, planDeIdea };
}
