import type { MotorGuiada } from "./tipos";
import type { ResultadoCotizacionIdea } from "./cotizar-idea";

/**
 * «¿Cuánto cuesta?» de una idea del carrusel (D-038, cotización única): el precio es el del plan que el cliente recibe al
 * elegirla, con la misma regla de compra en todas las superficies.
 * - bandera `3d`: lo que cuenta el motor (el plan del 3D); si el motor no arma la idea o la tienda no vende alguno de sus
 *   globos, el plan cae a Python y la tarjeta también: el plan de Python de la idea guardada. Un fallo pasajero del precio
 *   o del motor no la lleva a Python (el plan del 3D podría salir después con otro número): no hay precio;
 * - bandera `python` (o sin leerla, que es su valor por defecto): el plan de Python de la idea guardada;
 * - la lista curada solo para lo que no tiene plan guardado (las figuras), que no tiene otro precio con que chocar;
 * - si el plan de Python tampoco se puede cotizar, o no se pueden leer los planes guardados, no hay precio (`sin_precio`):
 *   nunca otro número que el del plan.
 * Sin importar el motor: quien llama pasa las cotizaciones, que cargan el motor y los planes guardados con `import()`
 * dinámico, así el motor solo se carga con la bandera en `3d`. Nunca lanza.
 */
type CotizacionOk = Extract<ResultadoCotizacionIdea, { ok: true }>;
type Razon = Extract<ResultadoCotizacionIdea, { ok: false }>["razon"] | "error_del_motor" | "error_de_python" | "error_planes_guardados";

export type DecisionCarrusel =
  | { usar: "motor"; resultado: CotizacionOk }
  | { usar: "plan_python"; resultado: CotizacionOk; motivo: "bandera_python" | "no_se_pudo_leer_la_bandera" | Razon; detalle?: string }
  | { usar: "curada"; motivo: "sin_plan_guardado" }
  | { usar: "sin_precio"; motivo: Razon; detalle?: string };

export type DependenciasCarrusel = {
  leerMotor: () => Promise<MotorGuiada>;
  tienePlanGuardado: (ideaId: string) => Promise<boolean>;
  cotizarConMotor: (ideaId: string) => Promise<ResultadoCotizacionIdea>;
  cotizarConPython: (ideaId: string) => Promise<ResultadoCotizacionIdea>;
};

/** Lo que el motor nunca va a poder cotizar para esta idea, como el plan del 3D, que por eso cae a Python. */
const CAEN_A_PYTHON: ReadonlySet<Razon> = new Set<Razon>(["no_representable", "sin_cobertura"]);

async function intentar(cotizar: () => Promise<ResultadoCotizacionIdea>, siFalla: "error_del_motor" | "error_de_python"): Promise<ResultadoCotizacionIdea | { ok: false; razon: typeof siFalla; detalle: string }> {
  try { return await cotizar(); } catch (error) { return { ok: false, razon: siFalla, detalle: error instanceof Error ? error.message : "error" }; }
}

export async function decidirCotizacionDelCarrusel(ideaId: string, deps: DependenciasCarrusel): Promise<DecisionCarrusel> {
  let conPlan: boolean;
  try { conPlan = await deps.tienePlanGuardado(ideaId); } catch (error) { return { usar: "sin_precio", motivo: "error_planes_guardados", detalle: error instanceof Error ? error.message : "error" }; }
  if (!conPlan) return { usar: "curada", motivo: "sin_plan_guardado" };
  let motor: MotorGuiada | null;
  try { motor = await deps.leerMotor(); } catch { motor = null; }
  let motivo: Extract<DecisionCarrusel, { usar: "plan_python" }>["motivo"] = motor === null ? "no_se_pudo_leer_la_bandera" : "bandera_python";
  let detalle: string | undefined;
  if (motor === "3d") {
    const delMotor = await intentar(() => deps.cotizarConMotor(ideaId), "error_del_motor");
    if (delMotor.ok) return { usar: "motor", resultado: delMotor };
    if (!CAEN_A_PYTHON.has(delMotor.razon)) return { usar: "sin_precio", motivo: delMotor.razon, ...(delMotor.detalle ? { detalle: delMotor.detalle } : {}) };
    motivo = delMotor.razon;
    detalle = delMotor.detalle;
  }
  const dePython = await intentar(() => deps.cotizarConPython(ideaId), "error_de_python");
  if (dePython.ok) return { usar: "plan_python", resultado: dePython, motivo, ...(detalle ? { detalle } : {}) };
  return { usar: "sin_precio", motivo: dePython.razon, ...(dePython.detalle ? { detalle: dePython.detalle } : {}) };
}
