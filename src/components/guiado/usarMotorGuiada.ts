"use client";

import { useCallback } from "react";
import type { z } from "zod";
import type { BriefGuiadoSchema, PlanGuiadoSchema, PropuestaComposicionSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { MOTOR_POR_DEFECTO, PARA_PLAN_NUEVO, RUTA_MOTOR_GUIADA, RespuestaMotorSchema, type FuenteMotor, type MotorGuiada } from "@/lib/guiada-motor/tipos";
import { cuerpoDeIdea, cuerpoDePropuesta, pedirPlanAlMotor3d, type IntentoMotor3d } from "./plan-motor3d";
import { pedirPlanDeIdea, type PlanExacto } from "./plan-exacto-idea";

type Fetch = (entrada: string, init?: RequestInit) => Promise<Response>;

/** Lo más que espera el cliente la lectura de la bandera: pasado esto, Python (la bandera nunca retrasa el plan del cliente). */
export const TIMEOUT_BANDERA_MS = 1000;

export type LecturaBandera = { motor: MotorGuiada; fuente: FuenteMotor | null; /** El cliente tocó «Detener» antes o durante la lectura: no se arma ningún plan. */ detenido: boolean };

/**
 * Pregunta al servidor con qué motor se crea un plan nuevo. No bloquea: espera `timeoutMs` (1 s) como mucho y cualquier fallo
 * (red, 401, respuesta rara, tiempo) devuelve `python`. Si `signal` ya estaba abortada o se aborta durante la lectura
 * («Detener»), devuelve `detenido`: quien llama NO sigue con ningún plan.
 */
export async function pedirMotorGuiada(opciones: { para?: typeof PARA_PLAN_NUEVO; signal?: AbortSignal; fetchImpl?: Fetch; timeoutMs?: number } = {}): Promise<LecturaBandera> {
  const { para, signal, fetchImpl = fetch, timeoutMs = TIMEOUT_BANDERA_MS } = opciones;
  const sinLectura = (): LecturaBandera => ({ motor: MOTOR_POR_DEFECTO, fuente: null, detenido: signal?.aborted === true });
  if (signal?.aborted) return sinLectura();
  try {
    const limite = AbortSignal.timeout(timeoutMs);
    const respuesta = await fetchImpl(para ? `${RUTA_MOTOR_GUIADA}?para=${para}` : RUTA_MOTOR_GUIADA, { cache: "no-store", signal: signal ? AbortSignal.any([signal, limite]) : limite });
    if (!respuesta.ok) return sinLectura();
    const lectura = RespuestaMotorSchema.safeParse(await respuesta.json());
    return lectura.success ? { ...lectura.data, detenido: signal?.aborted === true } : sinLectura();
  } catch {
    return sinLectura();
  }
}

type PlanGuiado = z.infer<typeof PlanGuiadoSchema>;

/**
 * La bandera de motor de la guiada (REQ-007). No lee nada al montar: nada del primer pintado la usa. Se lee CADA VEZ que se
 * arma un plan (queda en la auditoría de la conversación) y manda: con `python` todo plan nuevo, rehecho o con una idea
 * sumada sale de Python, incluso si el plan en pantalla era del 3D (marcha atrás inmediata). Un plan ya creado conserva
 * su motor para su imagen y sus cambios (`WidgetPlan.motor`), que el 3D todavía no tiene.
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

const DETENIDO: IntentoMotor3d = { ok: false, razon: "red", detalle: "detenido por el cliente", estado: null, detenido: true };

export function useMotorGuiada(): {
  alCrearPlan: (signal?: AbortSignal) => Promise<MotorGuiada>;
  planDePropuesta: (entrada: EntradaPlanDePropuesta) => Promise<IntentoMotor3d | null>;
  planDeIdea: (entrada: EntradaPlanDeIdea) => Promise<PlanExacto & PlanDeMotor>;
} {
  const leerBandera = useCallback((signal?: AbortSignal) => pedirMotorGuiada({ para: PARA_PLAN_NUEVO, ...(signal ? { signal } : {}) }), []);
  const alCrearPlan = useCallback(async (signal?: AbortSignal) => (await leerBandera(signal)).motor, [leerBandera]);
  const planDePropuesta = useCallback(async ({ propuesta, brief, anterior3d, deFoto, signal, alFallback }: EntradaPlanDePropuesta): Promise<IntentoMotor3d | null> => {
    // Un plan de foto va por Python (Q5). Todo lo demás obedece la bandera, también rehacer un plan que ya era del 3D:
    // con `python` el plan se rehace entero con Python (marcha atrás inmediata).
    if (deFoto) return null;
    const lectura = await leerBandera(signal);
    if (lectura.detenido) return DETENIDO;
    if (lectura.motor !== "3d") return null;
    const intento = await pedirPlanAlMotor3d(cuerpoDePropuesta(propuesta, brief, anterior3d), signal);
    if (!intento.ok) alFallback(intento);
    // Cualquier fallo del 3D (bandera, pieza sin constructor, precio, red, base rechazada…) se rehace con Python: nunca queda el cliente sin plan.
    return intento.ok || intento.detenido ? intento : null;
  }, [leerBandera]);
  const planDeIdea = useCallback(async ({ ideaId, base, signal, alFallback }: EntradaPlanDeIdea): Promise<PlanExacto & PlanDeMotor> => {
    // Sumar a un plan de Python sigue en Python (un plan, un dueño de las cantidades). En lo demás manda la bandera: un plan nuevo
    // o la suma a un plan del 3D solo van al 3D si la bandera dice `3d`.
    if (base?.motor === "python") return { ...(await pedirPlanDeIdea(ideaId, base.plan, signal)), motor: "python" };
    const lectura = await leerBandera(signal);
    if (lectura.detenido) return { ok: false, motivo: "detenido por el cliente", estado: null, detenido: true, motor: "3d" };
    if (lectura.motor === "3d") {
      const intento = await pedirPlanAlMotor3d(cuerpoDeIdea(ideaId, base?.plan ?? null), signal);
      if (intento.ok) return { ok: true, plan: intento.plan, cotizacion: intento.cotizacion, nuevas: intento.nuevas, globosIdea: intento.globosIdea, exacto: intento.exacto, avisos: intento.exacto ? [] : intento.avisos, motor: "3d" };
      alFallback(intento);
      // Sobre un plan del 3D, quien llama rehace el plan completo desde la propuesta de la idea (que también obedece la bandera y cae a Python).
      if (base || intento.detenido) return { ok: false, motivo: intento.detalle, estado: intento.estado, detenido: intento.detenido, motor: "3d" };
    } else if (base) {
      alFallback({ ok: false, razon: "bandera_python", detalle: "la bandera dice python: el plan del 3D se rehace con Python", estado: 409, detenido: false });
      return { ok: false, motivo: "bandera_python", estado: 409, detenido: false, motor: "3d" };
    }
    return { ...(await pedirPlanDeIdea(ideaId, null, signal)), motor: "python" };
  }, [leerBandera]);
  return { alCrearPlan, planDePropuesta, planDeIdea };
}
