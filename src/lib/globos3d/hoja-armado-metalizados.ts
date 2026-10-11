import type { Escena, EscenaArmada } from "./escena";
import { altoMetalizadoCm, armarMetalizado, metalizadoPorUrl, nombreMetalizado, type OpcionesMetalizado } from "./metalizados";

/**
 * Los globos metalizados (foil) de la hoja de armado: números, letras y figuras que no son látex y no llevan globos en la
 * pieza armada. Cada uno dice qué comprar (el producto de la tienda y las tallas en que lo vende, o que no hay uno igual) y lo
 * poco que el motor sabe de cómo se pone: una letra por globo en fila, la cinta con que flota, si va acostado y el texto
 * impreso. No se inventa más.
 */

export type LineaMetalizada = {
  /** Globos de todas las copias (las letras de una palabra son un globo cada una). */
  cantidad: number;
  /** «Número 4 dorado mate 32"». */
  nombre: string;
  /** El nombre exacto del producto de la tienda; `null` si no hay uno igual (se compra uno parecido). */
  producto: string | null;
  /** Las tallas en que la tienda vende el producto frente a la que pide la escena; `null` si no se sabe o no hay producto igual. */
  tallas: string | null;
  comoArmar: string[];
};

/** «16"», «16" y 32"», «16", 18" y 27"». */
function textoTallas(tallas: readonly number[]): string {
  const todas = tallas.map((t) => `${t}"`);
  return todas.length <= 1 ? (todas[0] ?? "") : `${todas.slice(0, -1).join(", ")} y ${todas[todas.length - 1]}`;
}

/** La talla que pide la escena y las que vende la tienda: el producto existe, pero no siempre en la talla del pedido. */
function tallasDelProducto(url: string, pulgadas: number): string | null {
  const vende = metalizadoPorUrl(url)?.tallas;
  if (!vende?.length) return null;
  return vende.includes(pulgadas) ? `la tienda lo vende en ${textoTallas(vende)}; la escena lo pide de ${pulgadas}"` : `la escena lo pide de ${pulgadas}", pero la tienda lo vende en ${textoTallas(vende)}`;
}

/** Lo que dice el motor de cómo se pone un metalizado (el helio de los que flotan va en cada línea; el de los demás, en la nota de la sección). */
function comoArmarMetalizado(m: OpcionesMetalizado): string[] {
  const pasos = [`Mide unos ${altoMetalizadoCm(m.forma, m.pulgadas)} cm de alto, inflado.`];
  if (m.forma.tipo === "letras") pasos.push(`Una letra por globo, en fila y en orden: «${m.forma.texto.toUpperCase()}».`);
  if (m.cinta) pasos.push(`Flota con helio: la cinta mide ${m.cinta.largoCm} cm y baja hasta el peso.`);
  if (m.acostado) pasos.push("Va acostado, mirando al techo.");
  if (m.impreso?.texto) pasos.push(`Lleva impreso «${m.impreso.texto.replace(/\s*\n\s*/g, " ")}».`);
  return pasos;
}

/** Los metalizados de la escena por las veces que quedaron puestos; los iguales se suman. */
export function metalizadosDeEscena(escena: Escena, armada: EscenaArmada): LineaMetalizada[] {
  const lineas = new Map<string, LineaMetalizada>();
  for (const nodo of escena.nodos) {
    if (nodo.pieza.tipo !== "metalizado") continue;
    const copias = armada.porNodo.find((n) => n.id === nodo.id)?.copias ?? 0;
    if (copias <= 0) continue;
    const m = nodo.pieza.metalizado;
    const nombre = nombreMetalizado(m);
    const comoArmar = comoArmarMetalizado(m);
    for (const p of armarMetalizado(m).productos) {
      const producto = p.generico ? null : p.nombre;
      const tallas = p.generico ? null : tallasDelProducto(p.url, m.pulgadas);
      const clave = JSON.stringify([nombre, producto, tallas, comoArmar]);
      const previa = lineas.get(clave);
      if (previa) previa.cantidad += p.cantidad * copias;
      else lineas.set(clave, { cantidad: p.cantidad * copias, nombre, producto, tallas, comoArmar });
    }
  }
  return [...lineas.values()];
}

/** Lo que va una vez en la sección, antes de las líneas: no son látex y su helio, si lo llevan, no está en los litros de la hoja. */
export const NOTA_METALIZADOS = "Los metalizados no son látex ni pasan por la bomba. Si se llenan con helio (los que flotan con cinta), ese helio no entra en los litros de «Helio y cinta»: pídelo aparte.";
