"use client";

import { useCallback, useEffect, useState } from "react";
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
 * El motor de la guiada (REQ-007, fase 0). Arranca en `python` (nada del primer pintado depende del servidor) y se
 * corrige al leer `/api/guiada/motor`. `alCrearPlan` vuelve a leerlo para un plan nuevo y deja la lectura en la
 * auditoría de la conversación; las fases 1 y 2 ramificarán la creación del plan con su resultado.
 */
export function useMotorGuiada(): { motor: MotorGuiada; alCrearPlan: () => Promise<MotorGuiada> } {
  const [motor, setMotor] = useState<MotorGuiada>(MOTOR_POR_DEFECTO);

  useEffect(() => {
    const control = new AbortController();
    void pedirMotorGuiada({ signal: control.signal }).then((lectura) => { if (!control.signal.aborted) setMotor(lectura.motor); });
    return () => control.abort();
  }, []);

  const alCrearPlan = useCallback(async () => {
    const lectura = await pedirMotorGuiada({ para: PARA_PLAN_NUEVO });
    setMotor(lectura.motor);
    return lectura.motor;
  }, []);

  return { motor, alCrearPlan };
}
