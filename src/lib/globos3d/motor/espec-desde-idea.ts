import type { PlanDecoracion } from "@/lib/plan/tipos";
import { MAX_PIEZAS_PLAN } from "@/lib/plan/piezas-individuales";
import type { EspecClienteV1, PiezaEspec } from "./espec-cliente-v1";
import { especDesdePlan } from "./espec-desde-plan";
import type { ResultadoEspec } from "./espec-desde-propuesta";
import { resolverProductoDeIdeas } from "./productos-ideas";

/**
 * **Ideas de la biblioteca -> espec.** El plan guardado de una idea (sus estructuras, medidas y productos) se convierte
 * en espec con los productos que usan las ideas (`productos-ideas.ts`). «Agregar a mi plan» suma las piezas de la idea
 * a la espec de un plan del motor 3D: las del plan quedan intactas y las nuevas toman ids libres.
 */
export function especDesdeIdeaGuardada(plan: PlanDecoracion, ideaId: string): ResultadoEspec {
  return especDesdePlan(plan, { resolverProducto: resolverProductoDeIdeas, origen: { tipo: "idea", ideaIds: [ideaId] } });
}

const ID_PIEZA = /^EST_(\d{2})_([A-Z_]+)$/;

export type SumaDeIdea = { ok: true; espec: EspecClienteV1; nuevas: string[] } | { ok: false; motivo: "tope_de_piezas"; maximo: number };

export function sumarIdeaAEspec(base: EspecClienteV1, idea: EspecClienteV1, ideaId: string): SumaDeIdea {
  if (base.piezas.length + idea.piezas.length > MAX_PIEZAS_PLAN) return { ok: false, motivo: "tope_de_piezas", maximo: MAX_PIEZAS_PLAN };
  const usados = new Set(base.piezas.map((pieza) => pieza.id));
  let siguiente = Math.max(0, ...base.piezas.map((pieza) => Number(ID_PIEZA.exec(pieza.id)?.[1] ?? 0)));
  const nuevas: PiezaEspec[] = idea.piezas.map((pieza) => {
    const sufijo = ID_PIEZA.exec(pieza.id)?.[2] ?? "PIEZA";
    let id: string;
    do { siguiente += 1; id = `EST_${String(siguiente).padStart(2, "0")}_${sufijo}`; } while (usados.has(id));
    usados.add(id);
    return { ...pieza, id };
  });
  const ideaIds = [...new Set([...(base.origen.ideaIds ?? []), ideaId])].slice(-MAX_PIEZAS_PLAN);
  return { ok: true, espec: { version: base.version, origen: { tipo: "idea_sumada", ideaIds }, piezas: [...base.piezas, ...nuevas] }, nuevas: nuevas.map((pieza) => pieza.id) };
}
