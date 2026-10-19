import detallesRaw from "./detalles-ideas.json";
import { DetalleIdeaSchema, DetallesIdeasArchivoSchema, type DetalleIdea, type LineaIdea } from "./detalle-idea-esquema";

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

/**
 * Los números de la tarjeta salen de la foto de la idea y de su plan guardado; el plan que arma el cliente lo cuenta
 * Python de nuevo con sus colores y puede cerrar en otra cifra (la revisión del 2026-10-11 vio 101 en la tarjeta y 115
 * en el plan). Esta tarjeta no puede calcular ese plan, así que lo dice en vez de prometer una cifra exacta.
 */
export const AVISO_CANTIDAD_APROXIMADA = "Cantidad de la idea como se ve en la foto. El número final es el de tu plan, que se cuenta de nuevo.";

/**
 * Un globo (no una cortina metálica ni una bolsa de confeti): solo los globos van en las piezas, los chips y las tablas
 * «Globo Sempertex»; lo demás lo dice la cabecera aparte («y 1 Cortina Metálica Roja»). Verificador (2026-10-06):
 * deco-real-10, 16, 18, 20 y 22 contaban cortinas y confeti entre los globos Sempertex de sus piezas.
 */
export function esGloboDeIdea(linea: Pick<LineaIdea, "titulo">): boolean {
  return /\bglobo\b/i.test(linea.titulo);
}
