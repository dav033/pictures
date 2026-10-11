import { CotizacionGuiadaSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import type { Cotizacion } from "@/lib/cotizacion/motor";
import { pedidoDeIdeaSola, type EntradaAllowlist, type PlanIdeaGuardado } from "@/lib/plan/plan-de-idea";
import type { PlanDecoracion } from "@/lib/plan/tipos";
import type { ResultadoCotizacionIdea } from "./cotizar-idea";

/**
 * «¿Cuánto cuesta?» de una idea con el plan de Python (D-038, cotización única): el precio es el del plan que el cliente
 * recibe al elegirla. Se le pide a Python exactamente lo que pide «Crear mi plan con esta idea» (`pedidoDeIdeaSola`: el
 * plan guardado, su allowlist y su snapshot), así que la tarjeta y el plan dan el mismo total. Antes la tarjeta cotizaba la
 * lista curada (`decoraciones.json`, sin reserva y con otros paquetes) y el plan costaba otra cosa. Nunca lanza.
 */
export type PedidoPython = { plan: PlanDecoracion; allowlist: EntradaAllowlist[]; catalogSnapshotId: string };

/** Lo que puede tardar Python en resolver la idea dentro de un turno de la guiada (60 s, con el modelo hablando después). */
export const DEADLINE_COTIZAR_IDEA_MS = 20_000;

export type DependenciasCotizacionPython = {
  planGuardado: (ideaId: string) => PlanIdeaGuardado | null;
  /** `resolverPlan` con la solicitud y la correlación ya puestas por quien llama. */
  resolver: (pedido: PedidoPython) => Promise<{ cotizacion: Cotizacion }>;
};

export async function cotizarIdeaConPython(ideaId: string, deps: DependenciasCotizacionPython): Promise<ResultadoCotizacionIdea> {
  const guardado = deps.planGuardado(ideaId);
  if (!guardado) return { ok: false, razon: "sin_plan_guardado" };
  const { combinado, allowlist, catalogSnapshotId } = pedidoDeIdeaSola(guardado);
  if (!combinado.ok) return { ok: false, razon: "no_representable", detalle: combinado.detalle };
  let cotizacion: Cotizacion;
  try {
    ({ cotizacion } = await deps.resolver({ plan: combinado.plan, allowlist, catalogSnapshotId }));
  } catch (error) {
    return { ok: false, razon: "precio_fallido", detalle: error instanceof Error ? error.message : "Python no resolvió el plan de la idea" };
  }
  const lineas = cotizacion.lineas.filter((linea) => linea.cantidadNecesaria > 0).map((linea) => ({
    id: linea.id, tamano: linea.tamano, cantidadNecesaria: linea.cantidadNecesaria, disponible: linea.disponible, varianteId: linea.varianteId ?? linea.id, nombre: linea.nombre ?? linea.tamano,
    precioPaquete: linea.precioPaquete ?? 0, unidadesPaquete: linea.unidadesPaquete ?? 1, paquetes: linea.paquetes ?? 0, subtotal: linea.subtotal ?? 0, sobrante: linea.sobrante ?? 0,
  }));
  const guiada = CotizacionGuiadaSchema.safeParse({ lineas, total: cotizacion.total, mermaPorcentaje: cotizacion.mermaPorcentaje, incluyeIva: true, complementosSoportados: false });
  if (!guiada.success) return { ok: false, razon: "precio_fallido", detalle: "la cotización de Python no cumple el contrato de la tarjeta" };
  return { ok: true, cotizacion: guiada.data, globos: lineas.reduce((suma, linea) => suma + linea.cantidadNecesaria, 0), avisos: [], ...(cotizacion.plan_hash ? { planHash: cotizacion.plan_hash } : {}) };
}
