import type { MotorGuiada } from "./tipos";
import type { ResultadoCotizacionIdea } from "./cotizar-idea";

/**
 * «¿Cuánto cuesta?» de una idea del carrusel (REQ-007, ruling Q3): con la bandera en `3d` el precio sale de lo que cuenta el
 * motor; si la bandera dice `python`, o el motor no arma la idea o falla, queda la lista curada de siempre. Sin importar el
 * motor: quien llama pasa `cotizarConMotor`, que carga el motor y el cruce (250 KB) con un `import()` dinámico, así el motor
 * solo se carga cuando la bandera está en `3d` y ese camino se prueba sin él. Nunca lanza.
 */
export type DecisionCarrusel =
  | { usar: "motor"; resultado: Extract<ResultadoCotizacionIdea, { ok: true }> }
  | { usar: "curada"; motivo: "bandera_python" | "no_se_pudo_leer_la_bandera" | Extract<ResultadoCotizacionIdea, { ok: false }>["razon"] | "error_del_motor"; detalle?: string };

export async function decidirCotizacionDelCarrusel(ideaId: string, deps: { leerMotor: () => Promise<MotorGuiada>; cotizarConMotor: (ideaId: string) => Promise<ResultadoCotizacionIdea> }): Promise<DecisionCarrusel> {
  let motor: MotorGuiada;
  try { motor = await deps.leerMotor(); } catch { return { usar: "curada", motivo: "no_se_pudo_leer_la_bandera" }; }
  if (motor !== "3d") return { usar: "curada", motivo: "bandera_python" };
  try {
    const resultado = await deps.cotizarConMotor(ideaId);
    return resultado.ok ? { usar: "motor", resultado } : { usar: "curada", motivo: resultado.razon, ...(resultado.detalle ? { detalle: resultado.detalle } : {}) };
  } catch (error) {
    return { usar: "curada", motivo: "error_del_motor", detalle: error instanceof Error ? error.message : "error" };
  }
}
