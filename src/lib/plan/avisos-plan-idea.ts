/**
 * Si el plan de una idea salió EXACTO y, si no, por qué, en palabras de cliente. Puro (sin red ni servidor).
 *
 * Por qué existe (verificador 127, 2026-10-07): «Crear mi plan con esta idea» y «Agregar al plan» prometen «las
 * cantidades exactas», y `planDesdeIdea` ya sabía si lo eran (`exacto`, `tallasDeIdea`, las sustituciones y lo que no
 * había), pero solo lo mandaba al registro: la ruta devolvía `avisos: []` y el cliente nunca se enteraba de que la
 * idea había salido con otros tamaños. Ahora la tarjeta lo dice en una línea discreta.
 *
 * Solo cuenta lo de las piezas de la IDEA (`nuevas`): lo que ya tenía el plan vigente no es cosa de la idea.
 */

export type SustitucionPlan = { estructura_id: string; pedido: string; entregado: string };
export type FaltantePlan = { estructura_id: string; tamano: string };

export type EntradaAvisosIdea = {
  /** Globos de la idea en su tarjeta (`planes-ideas.json`). */
  globosIdea: number;
  /** Globos de las piezas de la idea en el plan que resolvió Python. */
  globosDeIdeaEnPlan: number;
  /** Las piezas de la idea en el plan (las demás ya estaban). */
  nuevas: readonly string[];
  sustituciones: readonly SustitucionPlan[];
  sinCobertura: readonly FaltantePlan[];
  /** Se pidieron las tallas de la idea y hubo que resolver sin ellas para no cambiar lo que ya había. */
  sinTallasDeIdea: boolean;
};

export type AvisosIdea = { exacto: boolean; avisos: string[] };

const TALLA = /^R-?(\d+(?:[.,]\d+)?)$/i;

/** «R-36» → «36″»; otra cosa, tal cual. */
function pulgadas(codigo: string): string {
  const talla = TALLA.exec(codigo.trim());
  return talla ? `${talla[1]!.replace(".", ",")}″` : codigo.trim();
}

function unicos(valores: readonly string[]): string[] {
  return [...new Set(valores)];
}

function lista(valores: readonly string[]): string {
  if (valores.length <= 1) return valores[0] ?? "";
  return `${valores.slice(0, -1).join(", ")} y ${valores[valores.length - 1]}`;
}

export function avisosPlanDeIdea(entrada: EntradaAvisosIdea): AvisosIdea {
  const deIdea = new Set(entrada.nuevas);
  const sustituciones = entrada.sustituciones.filter((item) => deIdea.has(item.estructura_id));
  const tallas = unicos(sustituciones.filter((item) => TALLA.test(item.pedido.trim())).map((item) => `${pulgadas(item.pedido)} por ${pulgadas(item.entregado)}`));
  const colores = unicos(sustituciones.filter((item) => !TALLA.test(item.pedido.trim())).map((item) => `${item.pedido.trim()} por ${item.entregado.trim()}`));
  const faltan = unicos(entrada.sinCobertura.filter((item) => deIdea.has(item.estructura_id)).map((item) => pulgadas(item.tamano)));
  const mismaCifra = entrada.globosDeIdeaEnPlan === entrada.globosIdea;
  const exacto = mismaCifra && !tallas.length && !colores.length && !faltan.length && !entrada.sinTallasDeIdea;
  if (exacto) return { exacto, avisos: [] };
  const avisos: string[] = [];
  if (tallas.length) avisos.push(`Ajustamos ${tallas.length === 1 ? "un tamaño que no había" : `${tallas.length} tamaños que no había`}: ${lista(tallas)}.`);
  if (colores.length) avisos.push(`Cambiamos ${colores.length === 1 ? "un color que no había" : `${colores.length} colores que no había`}: ${lista(colores)}.`);
  if (faltan.length) avisos.push(`No hay globos de ${lista(faltan)} disponibles ahora; la idea va sin ellos.`);
  if (entrada.sinTallasDeIdea) avisos.push("Para no cambiar las piezas que ya tenías, la idea se armó con otros tamaños.");
  if (!mismaCifra) avisos.push(`La idea lleva ${entrada.globosIdea} globos; en tu plan salen ${entrada.globosDeIdeaEnPlan}.`);
  return { exacto, avisos: avisos.slice(0, 4) };
}
