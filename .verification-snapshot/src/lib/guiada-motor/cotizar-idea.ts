import "server-only";
import { armarDesdeEspec, cotizarBom, especDesdeIdeaGuardada, type DependenciasCotizacion } from "@/lib/globos3d/motor/v1";
import type { PlanIdeaGuardado } from "@/lib/plan/plan-de-idea";
import { cotizacionDeLaTarjeta, type CotizacionIdea } from "./cotizacion-de-tarjeta";

/**
 * «¿Cuánto cuesta?» de una idea del carrusel con el motor 3D (REQ-007, ruling Q3): con la bandera en `3d`, el precio sale
 * de la lista de materiales que cuenta el motor para el plan guardado de la idea (los mismos globos que verá el cliente
 * en su plan), con merma y paquetes cerrados por Python. Lo que no tiene plan guardado (las figuras y los ejemplos) se
 * cotiza con la misma regla desde su lista curada (`cotizar-curada.ts`). Nunca lanza.
 */
export type ResultadoCotizacionIdea =
  | { ok: true; cotizacion: CotizacionIdea; globos: number; avisos: string[]; planHash?: string }
  | { ok: false; razon: "sin_plan_guardado" | "no_representable" | "sin_cobertura" | "precio_fallido"; detalle?: string };

export async function cotizarIdeaConMotor(ideaId: string, deps: DependenciasCotizacion & { planGuardado: (id: string) => PlanIdeaGuardado | null }): Promise<ResultadoCotizacionIdea> {
  const guardado = deps.planGuardado(ideaId);
  if (!guardado) return { ok: false, razon: "sin_plan_guardado" };
  let resultado: ReturnType<typeof armarDesdeEspec>;
  try {
    resultado = armarDesdeEspec(especDesdeIdeaGuardada(guardado.plan, ideaId).espec);
  } catch (error) {
    return { ok: false, razon: "no_representable", detalle: error instanceof Error ? error.message : "el motor no armó la idea" };
  }
  if (resultado.noRepresentable.length) return { ok: false, razon: "no_representable", detalle: resultado.noRepresentable.map((n) => `${n.piezaId}: ${n.motivo}`).join("; ") };
  const cotizada = await cotizarBom(resultado.bom, deps);
  if (!cotizada.ok) return cotizada.razon === "sin_cobertura" ? { ok: false, razon: "sin_cobertura", detalle: cotizada.faltantes.map((f) => `${f.formatoId} ${f.codigo}: ${f.motivo}`).join("; ") } : { ok: false, razon: "precio_fallido", detalle: cotizada.detalle };
  const cotizacion = cotizacionDeLaTarjeta(cotizada);
  return cotizacion.success
    ? { ok: true, cotizacion: cotizacion.data, globos: resultado.bom.total.reduce((suma, l) => suma + l.cantidad, 0), avisos: resultado.avisos, planHash: resultado.especHash }
    : { ok: false, razon: "precio_fallido", detalle: "la cotización del motor no cumple el contrato" };
}
