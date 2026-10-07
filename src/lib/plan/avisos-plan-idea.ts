import { colorDeSustitucionTalla, nombreColorCliente, tallaNormal } from "./presentacion-cliente";

/**
 * Si el plan de una idea salió EXACTO y, si no, por qué, en palabras de cliente. Puro (sin red ni servidor).
 *
 * Por qué existe (verificador 127, 2026-10-07): «Crear mi plan con esta idea» y «Agregar al plan» prometen «las
 * cantidades exactas», y `planDesdeIdea` ya sabía si lo eran (`exacto`, `tallasDeIdea`, las sustituciones y lo que no
 * había), pero solo lo mandaba al registro: la ruta devolvía `avisos: []` y el cliente nunca se enteraba de que la
 * idea había salido con otros tamaños. Ahora la tarjeta lo dice en una línea discreta.
 *
 * Probador 141, I-5: la línea listaba las tallas sin su color («Ajustamos 2 tamaños que no había: 18″ por 24″ y 24″
 * por 18″», «…24″ por 18″. No hay globos de 24″…») y se leía como una contradicción; además repetía, sin color, lo que
 * «Ajustes que hice» de la misma tarjeta ya dice pieza por pieza (`ajustes-python.ts`). Ahora dice UNA vez que no salió
 * idéntica y en qué colores, y deja el detalle (talla por talla, con su color y su pieza) a «Ajustes que hice».
 *
 * Solo cuenta lo de las piezas de la IDEA (`nuevas`): lo que ya tenía el plan vigente no es cosa de la idea.
 */

export type SustitucionPlan = { estructura_id: string; pedido: string; entregado: string; motivo?: string };
export type FaltantePlan = { estructura_id: string; tamano: string; product_id?: string };

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
  /** El color de cada producto del plan (`materiales[].product_id` → `color`): de qué color es la talla que falta. */
  coloresDeProducto?: Readonly<Record<string, string>>;
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
  const deTalla = sustituciones.filter((item) => TALLA.test(item.pedido.trim()));
  // La misma talla escrita de otra forma («R-18», «18») es el mismo cambio.
  const tallas = unicos(deTalla.map((item) => `${tallaNormal(item.pedido)}|${tallaNormal(item.entregado)}`));
  const colores = unicos(sustituciones.filter((item) => !TALLA.test(item.pedido.trim())).map((item) => `${item.pedido.trim()} por ${item.entregado.trim()}`));
  const faltantes = entrada.sinCobertura.filter((item) => deIdea.has(item.estructura_id));
  const faltan = unicos(faltantes.map((item) => pulgadas(item.tamano)));
  const mismaCifra = entrada.globosDeIdeaEnPlan === entrada.globosIdea;
  const exacto = mismaCifra && !tallas.length && !colores.length && !faltan.length && !entrada.sinTallasDeIdea;
  if (exacto) return { exacto, avisos: [] };
  // De qué color es cada talla cambiada (el motivo de Python lo dice) o que falta (su producto).
  const coloresTalla = unicos([
    ...deTalla.flatMap((item) => { const color = colorDeSustitucionTalla(item.motivo); return color ? [nombreColorCliente(color)] : []; }),
    ...faltantes.flatMap((item) => { const color = item.product_id ? entrada.coloresDeProducto?.[item.product_id] : undefined; return color ? [nombreColorCliente(color)] : []; }),
  ]);
  const avisos: string[] = [];
  if (tallas.length || faltan.length) {
    // UNA frase, con los colores y sin las tallas: el detalle lo da «Ajustes que hice», pieza por pieza.
    const que = tallas.length && faltan.length ? "usé los más cercanos y, donde no había ninguno, va sin ellos" : tallas.length ? "usé los más cercanos" : "va sin ellos";
    avisos.push(`El catálogo no tiene algunos tamaños de la idea${coloresTalla.length ? ` en ${lista(coloresTalla)}` : ""}: ${que} (el detalle está en «Ajustes que hice»).`);
  }
  if (colores.length) avisos.push(`Cambiamos ${colores.length === 1 ? "un color que no había" : `${colores.length} colores que no había`}: ${lista(colores)}.`);
  if (entrada.sinTallasDeIdea) avisos.push("Para no cambiar las piezas que ya tenías, la idea se armó con otros tamaños.");
  if (!mismaCifra) avisos.push(`La idea lleva ${entrada.globosIdea} globos; en tu plan salen ${entrada.globosDeIdeaEnPlan}.`);
  return { exacto, avisos: avisos.slice(0, 4) };
}
