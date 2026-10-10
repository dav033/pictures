"use client";

import { useCallback } from "react";
import type { z } from "zod";
import type { BriefGuiadoSchema, PlanGuiadoSchema, PropuestaComposicionSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { TEXTO_AVISO_RECALCULO } from "@/lib/guiada-motor/mensajes-cliente";
import { esRazonRecalculo, type CuerpoPlanMotor } from "@/lib/guiada-motor/plan-contrato";
import { MOTOR_POR_DEFECTO, PARA_PLAN_NUEVO, PARA_PLAN_PYTHON, RUTA_MOTOR_GUIADA, RespuestaMotorSchema, type FuenteMotor, type MotorGuiada } from "@/lib/guiada-motor/tipos";
import { avisosRecalculo, type AvisosRecalculo } from "./aviso-recalculo";
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
export async function pedirMotorGuiada(opciones: { para?: typeof PARA_PLAN_NUEVO | typeof PARA_PLAN_PYTHON; signal?: AbortSignal; fetchImpl?: Fetch; timeoutMs?: number } = {}): Promise<LecturaBandera> {
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
 * La bandera de motor de la guiada (REQ-007) con su marcha atrás ordenada (P-045). No lee nada al montar: nada del primer
 * pintado la usa. La bandera decide SOLO el motor de un plan NUEVO y se lee cada vez que se crea uno (queda en la auditoría
 * de la conversación). Un plan ya creado conserva su motor hasta el final (`WidgetPlan.motor`): rehacer un plan del 3D o
 * sumarle una idea va al 3D con ese plan como base, sin leer la bandera, así que volverla a `python` no le cambia el precio a
 * ningún plan abierto. Y al revés: rehacer un plan de Python o sumarle una idea sigue en Python aunque la bandera diga `3d`.
 *
 * La excepción es un plan del 3D que deja el 3D (el corte del motor, `motor_3d_cortado`, o su línea pasó el límite con la
 * bandera en python, `plan_3d_vencido`): la primera vez que se intenta rehacerlo, el intento vuelve con su `aviso` (D-023) y
 * la vista lo muestra con el botón «Recalcular mi plan»; el plan queda como estaba. Si lo vuelve a pedir (o ya lo leyó al
 * intentar cambiarlo), se recalcula con Python. Nunca cambia de precio sin decirlo antes.
 *
 * - `alCrearPlan`: la lectura de la bandera.
 * - `planDePropuesta` / `planDeIdea`: piden el plan al motor 3D si toca. Devuelven `null` (propuesta) o un plan de Python
 *   (idea) cuando el plan es nuevo y la bandera dice `python`, cuando viene de una foto, o cuando el 3D no lo arma (fallo
 *   tipado, con su motivo en `alFallback`). Si el 3D no puede rehacer un plan del 3D (sin corte), la propuesta lo rehace
 *   entero con Python y la vista lo dice; la idea devuelve el fallo y quien llama sigue por la propuesta.
 */
export type PlanDeMotor = { motor: MotorGuiada };
/** Un plan que el 3D no armó. `aviso`: lo que el cliente debe leer antes de que su plan del 3D se recalcule con Python. */
export type FalloMotor3d = Extract<IntentoMotor3d, { ok: false }> & { aviso?: string };
/** Lo que devuelve `planDePropuesta` cuando no es `null` (= «sigue con Python»): el plan del 3D, o un fallo que se dice. */
export type IntentoPropuesta = Extract<IntentoMotor3d, { ok: true }> | FalloMotor3d;
export type EntradaPlanDePropuesta = {
  propuesta: z.infer<typeof PropuestaComposicionSchema>;
  brief?: z.infer<typeof BriefGuiadoSchema>;
  /** El plan vigente si es del motor 3D: esta propuesta lo rehace en el 3D. */
  anterior3d: PlanGuiado | null;
  /** El plan sale de una foto: va por Python (Q5). */
  deFoto: boolean;
  /** El plan vigente es de Python: rehacerlo sigue en Python (el plan conserva su motor); la bandera no decide, solo se audita. */
  anteriorPython?: boolean;
  signal: AbortSignal;
  /** Se llama con el motivo cuando el 3D no armó el plan, para dejarlo en el registro (con `aviso` si se le avisa al cliente). */
  alFallback: (fallo: FalloMotor3d) => void;
};
export type EntradaPlanDeIdea = {
  ideaId: string;
  /** El plan vigente y su motor, o null si la idea crea el plan. */
  base: { plan: PlanGuiado; motor: MotorGuiada } | null;
  signal: AbortSignal;
  alFallback: (fallo: FalloMotor3d) => void;
};

type IdeaDeMotor = PlanExacto & PlanDeMotor;
type AlFallback = (fallo: FalloMotor3d) => void;

const DETENIDO: FalloMotor3d = { ok: false, razon: "red", detalle: "detenido por el cliente", estado: null, detenido: true };
const IDEA_DETENIDA: IdeaDeMotor = { ok: false, motivo: "detenido por el cliente", estado: null, detenido: true, motor: "3d" };

const ideaDel3d = (intento: Extract<IntentoMotor3d, { ok: true }>): IdeaDeMotor => ({
  ok: true, plan: intento.plan, cotizacion: intento.cotizacion, nuevas: intento.nuevas, globosIdea: intento.globosIdea, exacto: intento.exacto, avisos: intento.exacto ? [] : intento.avisos, motor: "3d",
});
const ideaFallida = (intento: Extract<IntentoMotor3d, { ok: false }>): IdeaDeMotor => ({ ok: false, motivo: intento.detalle, estado: intento.estado, detenido: intento.detenido, motor: "3d" });

/**
 * Otra propuesta sobre un plan del 3D: sigue en el 3D diga lo que diga la bandera. Si el plan deja el 3D (corte o límite),
 * la primera vez solo avisa: devuelve el fallo con su `aviso` y el plan queda como estaba. Después, o si el 3D no puede por
 * otro motivo, `null` = rehacerlo con Python.
 */
async function rehacerPlan3d(cuerpo: CuerpoPlanMotor, planHash: string, signal: AbortSignal, alFallback: AlFallback, avisos: AvisosRecalculo): Promise<IntentoPropuesta | null> {
  if (signal.aborted) return DETENIDO;
  const intento = await pedirPlanAlMotor3d(cuerpo, signal);
  if (intento.ok) return intento;
  const avisarAntes = !intento.detenido && esRazonRecalculo(intento.razon) && !avisos.yaAvisado(planHash);
  const dicho: FalloMotor3d = avisarAntes ? { ...intento, aviso: TEXTO_AVISO_RECALCULO } : intento;
  if (avisarAntes) avisos.marcar(planHash);
  alFallback(dicho);
  return intento.detenido || avisarAntes ? dicho : null;
}

/**
 * Sumar una idea a un plan del 3D: sigue en el 3D. Si no se puede (también con el corte) devuelve el fallo sin avisar ni
 * marcar nada: quien llama sigue por la propuesta de la idea (`rehacerPlan3d`), que es la que avisa.
 */
async function sumarIdeaEn3d(ideaId: string, base: PlanGuiado, signal: AbortSignal, alFallback: AlFallback): Promise<IdeaDeMotor> {
  if (signal.aborted) return IDEA_DETENIDA;
  const intento = await pedirPlanAlMotor3d(cuerpoDeIdea(ideaId, base), signal);
  if (intento.ok) return ideaDel3d(intento);
  alFallback(intento);
  return ideaFallida(intento);
}

/** `avisos`: a quién ya se le dijo que su plan se recalcula; por defecto, el de la página (lo comparte con los cambios del plan). */
export function useMotorGuiada(avisos: AvisosRecalculo = avisosRecalculo): {
  alCrearPlan: (signal?: AbortSignal) => Promise<MotorGuiada>;
  planDePropuesta: (entrada: EntradaPlanDePropuesta) => Promise<IntentoPropuesta | null>;
  planDeIdea: (entrada: EntradaPlanDeIdea) => Promise<IdeaDeMotor>;
} {
  const leerBandera = useCallback((signal?: AbortSignal) => pedirMotorGuiada({ para: PARA_PLAN_NUEVO, ...(signal ? { signal } : {}) }), []);
  const alCrearPlan = useCallback(async (signal?: AbortSignal) => (await leerBandera(signal)).motor, [leerBandera]);
  const planDePropuesta = useCallback(async ({ propuesta, brief, anterior3d, deFoto, anteriorPython, signal, alFallback }: EntradaPlanDePropuesta): Promise<IntentoPropuesta | null> => {
    // Un plan de foto va por Python (Q5).
    if (deFoto) return null;
    if (anteriorPython) {
      // Rehacer un plan de Python conserva Python. La lectura no decide nada: deja esa decisión en la auditoría del servidor
      // (como la de un plan nuevo) y, como ella, «Detener» mientras tanto no arma ningún plan.
      const lectura = await pedirMotorGuiada({ para: PARA_PLAN_PYTHON, signal });
      return lectura.detenido ? DETENIDO : null;
    }
    if (anterior3d) return rehacerPlan3d(cuerpoDePropuesta(propuesta, brief, anterior3d), anterior3d.plan_hash, signal, alFallback, avisos);
    const lectura = await leerBandera(signal);
    if (lectura.detenido) return DETENIDO;
    if (lectura.motor !== "3d") return null;
    const intento = await pedirPlanAlMotor3d(cuerpoDePropuesta(propuesta, brief, null), signal);
    if (!intento.ok) alFallback(intento);
    // Un plan nuevo que el 3D no arma (pieza sin constructor, precio, red, la bandera o el corte que cambiaron entre medias) sale
    // de Python: todavía no tenía precio, así que nada cambia para el cliente.
    return intento.ok || intento.detenido ? intento : null;
  }, [leerBandera, avisos]);
  const planDeIdea = useCallback(async ({ ideaId, base, signal, alFallback }: EntradaPlanDeIdea): Promise<IdeaDeMotor> => {
    // Sumar a un plan conserva el motor de ese plan (un plan, un dueño de las cantidades); solo un plan nuevo pregunta a la bandera.
    if (base?.motor === "python") return { ...(await pedirPlanDeIdea(ideaId, base.plan, signal)), motor: "python" };
    if (base) return sumarIdeaEn3d(ideaId, base.plan, signal, alFallback);
    const lectura = await leerBandera(signal);
    if (lectura.detenido) return IDEA_DETENIDA;
    if (lectura.motor === "3d") {
      const intento = await pedirPlanAlMotor3d(cuerpoDeIdea(ideaId, null), signal);
      if (intento.ok) return ideaDel3d(intento);
      alFallback(intento);
      if (intento.detenido) return ideaFallida(intento);
    }
    return { ...(await pedirPlanDeIdea(ideaId, null, signal)), motor: "python" };
  }, [leerBandera]);
  return { alCrearPlan, planDePropuesta, planDeIdea };
}
