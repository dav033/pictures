import detallesRaw from "./detalles-ideas.json";
import { DetalleIdeaSchema, DetallesIdeasArchivoSchema, type DetalleIdea } from "./detalle-idea-esquema";

export { DetalleIdeaSchema, LineaIdeaSchema, PiezaIdeaSchema, type DetalleIdea, type LineaIdea, type PiezaIdea } from "./detalle-idea-esquema";

/**
 * El detalle precomputado de una idea de la biblioteca (`detalles-ideas.json`, lo escribe
 * `scripts/biblioteca/precomputar-detalles-ideas.ts`). Se lee una sola vez y cada entrada se valida al pedirla: una
 * entrada inválida se ignora con un aviso y la tarjeta vuelve a su vista sencilla; nunca rompe la vista.
 */

let ideas: Readonly<Record<string, unknown>> | null = null;
const leidas = new Map<string, DetalleIdea | null>();

function registro(): Readonly<Record<string, unknown>> {
  if (ideas) return ideas;
  const archivo = DetallesIdeasArchivoSchema.safeParse(detallesRaw);
  if (!archivo.success) console.warn("[biblioteca] detalles-ideas.json con forma inesperada", archivo.error.issues.slice(0, 3));
  ideas = archivo.success ? archivo.data.ideas : {};
  return ideas;
}

export function detalleDeIdea(id: string): DetalleIdea | null {
  if (leidas.has(id)) return leidas.get(id) ?? null;
  const crudo = registro()[id];
  let detalle: DetalleIdea | null = null;
  if (crudo !== undefined) {
    const leido = DetalleIdeaSchema.safeParse(crudo);
    if (leido.success) detalle = leido.data;
    else console.warn(`[biblioteca] detalle de ${id} inválido; se muestra la vista sencilla`, leido.error.issues.slice(0, 3));
  }
  leidas.set(id, detalle);
  return detalle;
}
