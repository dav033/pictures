import "server-only";
import planesIdeasRaw from "@/lib/biblioteca-sempertex/planes-ideas.json";
import { PlanesIdeasArchivoSchema, type PlanIdeaGuardado } from "./plan-de-idea";

/**
 * Los planes guardados de las ideas de la biblioteca (`planes-ideas.json`, generado por
 * `scripts/biblioteca/precomputar-planes-ideas.ts`). Lo leen «Crear mi plan con esta idea» (Python, `plan-desde-idea.ts`) y
 * el motor 3D (`/api/guiada/motor/plan`): un solo lector, validado una vez.
 */
let planes: Readonly<Record<string, PlanIdeaGuardado>> | null = null;

function planesIdeas(): Readonly<Record<string, PlanIdeaGuardado>> {
  if (planes) return planes;
  const leido = PlanesIdeasArchivoSchema.safeParse(planesIdeasRaw);
  if (!leido.success) {
    console.warn("[planes-ideas] planes-ideas.json no es válido: las ideas van por el camino del modelo.", leido.error.issues.slice(0, 3));
    planes = {};
  } else planes = leido.data.ideas;
  return planes;
}

/** El plan guardado de una idea, o null si no tiene (entonces va por el camino de siempre, con el modelo). */
export function planGuardadoDeIdea(id: string): PlanIdeaGuardado | null {
  return planesIdeas()[id] ?? null;
}
