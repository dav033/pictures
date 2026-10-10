import type { z } from "zod";
import { PlanActualGuiadoSchema, PropuestaComposicionSchema, type PlanActualGuiado } from "@/lib/ia/contracts/asistente-guiado-v1";
import type { MotorGuiada } from "@/lib/guiada-motor/tipos";

type Propuesta = z.infer<typeof PropuestaComposicionSchema>;

/** Lo que se le dice al cliente cuando el plan no dice cómo se armó y rehacerlo desde aquí reduciría sus piezas. */
export const TEXTO_RECALCULO_NO_POSIBLE = "No pude volver a armar tu plan desde aquí. Pídeme otra vez el cambio que quieres y lo armo con el método de siempre; tu plan sigue como estaba.";

/**
 * La propuesta que un plan guarda para «Recalcular mi plan» (P-049). Solo la guarda un plan del 3D: los de Python no la usan, y
 * una conversación guardada con ella la rechazaría un despliegue anterior (los esquemas del plan son estrictos).
 */
export function propuestaParaGuardar(motor: MotorGuiada, propuesta: Propuesta): Propuesta | undefined {
  return motor === "3d" ? propuesta : undefined;
}

/** Qué pide «Recalcular mi plan» a `aceptarPropuesta`: la propuesta y el plan al que sustituye (que activa la nota «recalculado»). */
export type PreparacionRecalculo = { propuesta: Propuesta; planAnterior: PlanActualGuiado };

/** Lo que del plan hace falta para saber si `planActual` lo describe entero: las repeticiones de cada pieza que trae. */
export type PiezasDelPlan = ReadonlyArray<{ repeticiones: number }>;

/** `planActualDesdePlan` deja fuera las piezas sin estructura oficial, pasa de 8 y recorta a 12 repeticiones: sin pérdida o no vale. */
function describeTodoElPlan(planActual: PlanActualGuiado, piezas: PiezasDelPlan): boolean {
  const sumar = (cantidades: readonly number[]) => cantidades.reduce((suma, cantidad) => suma + cantidad, 0);
  return planActual.piezas.length === piezas.length && sumar(planActual.piezas.map((pieza) => pieza.cantidad)) === sumar(piezas.map((pieza) => pieza.repeticiones));
}

function planActualDePropuesta(propuesta: Propuesta): PlanActualGuiado | null {
  const plan = PlanActualGuiadoSchema.safeParse({
    colores: propuesta.colores,
    piezas: propuesta.piezas.map((pieza) => ({
      estructura: pieza.estructura,
      cantidad: pieza.cantidad,
      ...(pieza.nombre ? { nombre: pieza.nombre } : {}),
      ...(pieza.ubicacion ? { ubicacion: pieza.ubicacion } : {}),
      ...(pieza.medidas ? { medidas: pieza.medidas } : {}),
    })),
  });
  return plan.success ? plan.data : null;
}

function propuestaDePlanActual(planActual: PlanActualGuiado): Propuesta | null {
  const propuesta = PropuestaComposicionSchema.safeParse({
    frase: "Vuelvo a armar tu plan con el método de siempre.",
    colores: planActual.colores,
    piezas: planActual.piezas.map((pieza) => ({
      estructura: pieza.estructura,
      cantidad: pieza.cantidad,
      ...(pieza.nombre ? { nombre: pieza.nombre } : {}),
      ...(pieza.ubicacion ? { ubicacion: pieza.ubicacion } : {}),
      ...(pieza.medidas ? { medidas: pieza.medidas } : {}),
    })),
  });
  return propuesta.success ? propuesta.data : null;
}

/**
 * Con qué volver a armar un plan que el corte del 3D dejó (P-049), por el mismo camino que «Intentar de nuevo»: `aceptarPropuesta`
 * con su plan anterior, que con el consentimiento ya dado recalcula con Python.
 * - Un plan nuevo del 3D guarda la propuesta que lo armó; el plan anterior es `planActual` o, si el plan no lo da, lo que dice esa
 *   propuesta. Sin plan anterior no habría nota «recalculado» ni se conservarían medidas y colores.
 * - Un plan sin propuesta (guardado antes, o cambiado después con «Ajustar mi plan») se reconstruye de `planActual`, y solo si lo
 *   describe entero: la instrucción dice «SOLO las piezas de esta lista», así que una pieza que faltara se perdería sin decirlo.
 * - Si nada sirve, `null`: quien llama no puede recalcular desde aquí y se lo dice al cliente sin mandar nada.
 */
export function prepararRecalculo3d(entrada: { guardada: Propuesta | undefined; planActual: PlanActualGuiado | null; piezasDelPlan: PiezasDelPlan }): PreparacionRecalculo | null {
  const { guardada, planActual, piezasDelPlan } = entrada;
  if (guardada) {
    const planAnterior = planActual ?? planActualDePropuesta(guardada);
    return planAnterior ? { propuesta: guardada, planAnterior } : null;
  }
  if (!planActual || !describeTodoElPlan(planActual, piezasDelPlan)) return null;
  const propuesta = propuestaDePlanActual(planActual);
  return propuesta ? { propuesta, planAnterior: planActual } : null;
}
