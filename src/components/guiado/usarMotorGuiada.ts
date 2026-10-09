"use client";

import { useCallback } from "react";
import { MOTOR_POR_DEFECTO, PARA_PLAN_NUEVO, RUTA_MOTOR_GUIADA, RespuestaMotorSchema, type FuenteMotor, type MotorGuiada } from "@/lib/guiada-motor/tipos";

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

/**
 * La bandera de motor de la guiada (REQ-007, fase 0). No lee nada al montar: nada del primer pintado la usa. `alCrearPlan`
 * la lee al crear un plan y deja la lectura en la auditoría de la conversación (`bandera` frente a `efectivo`: en la
 * fase 0 el plan sigue saliendo de Python). Las fases 1 y 2 ramificarán la creación del plan con su resultado.
 */
export function useMotorGuiada(): { alCrearPlan: () => Promise<MotorGuiada> } {
  const alCrearPlan = useCallback(async () => (await pedirMotorGuiada({ para: PARA_PLAN_NUEVO })).motor, []);
  return { alCrearPlan };
}
