import type { EstampadoGlobo } from "./decoraciones";
import type { CapaImpreso } from "./estampados";
import { IMPRESOS_TIENDA } from "./impresos-catalogo";

/**
 * Lo impreso o pegado sobre un globo, como lo nombra la hoja de armado: el producto de la tienda si el dibujo es el de uno de
 * `impresos-catalogo.ts` («impreso «GLOBO REDONDO INFINITY® …»»); si no, lo que lleva dibujado («impreso de «te amo» + ícono
 * de corazón», «dibujo pegado»: ojos, manchas, lunares…). `clave` distingue dos dibujos distintos aunque se describan igual:
 * dos globos del mismo color con impresos distintos no son el mismo globo; dos con el mismo dibujo pegado (los mismos colores,
 * aunque sus polígonos se calculen globo a globo) sí.
 */
export type ImpresoHoja = { clave: string; texto: string };

let productosPorDibujo: Map<string, string> | undefined;

/** El nombre del producto de la tienda que lleva ese dibujo (también los dibujos por color de un mismo producto). */
function productoDelDibujo(dibujo: string): string | undefined {
  if (!productosPorDibujo) {
    productosPorDibujo = new Map();
    for (const producto of IMPRESOS_TIENDA) {
      for (const variante of [producto.estampado, ...Object.values(producto.porColor ?? {})]) {
        const clave = JSON.stringify(variante);
        if (!productosPorDibujo.has(clave)) productosPorDibujo.set(clave, producto.nombre);
      }
    }
  }
  return productosPorDibujo.get(dibujo);
}

function textoDeCapa(capa: CapaImpreso): string {
  switch (capa.tipo) {
    case "texto": return `«${capa.texto.replace(/\s*\n\s*/g, " ")}»`;
    case "icono": return `ícono de ${capa.icono}`;
    case "cara": return `cara (${capa.expresion})`;
    case "patron": return `patrón de ${capa.motivo}`;
  }
}

/** FNV-1a de 32 bits: una clave corta y estable para un dibujo. */
function resumen(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Los globos impresos de una pieza comparten el objeto del estampado a menudo; se describe una vez. */
const yaDescritos = new WeakMap<EstampadoGlobo, ImpresoHoja>();

export function impresoDe(estampado: EstampadoGlobo | undefined): ImpresoHoja | undefined {
  if (!estampado) return undefined;
  const previo = yaDescritos.get(estampado);
  if (previo) return previo;
  const dibujo = estampado.impreso ? JSON.stringify(estampado.impreso) : undefined;
  const producto = dibujo ? productoDelDibujo(dibujo) : undefined;
  const texto = producto
    ? `impreso «${producto}»`
    : estampado.impreso?.capas.length
      ? `impreso de ${[...new Set(estampado.impreso.capas.map(textoDeCapa))].join(" + ")}`
      : "dibujo pegado";
  // Los polígonos de un dibujo pegado se calculan globo a globo (las manchas de una vaca, los ojos de una araña): la clave es lo
  // impreso y los colores de lo pegado, no su forma, para que dos globos con el mismo dibujo vayan juntos.
  const colores = [...new Set(estampado.capas.map((c) => c.hex.toLowerCase()))].sort();
  const impreso = { clave: resumen(JSON.stringify([estampado.impreso ?? null, colores])), texto };
  yaDescritos.set(estampado, impreso);
  return impreso;
}

/**
 * Dónde queda un impreso dentro del grupo de globos que se está armando (`de` completa la frase: «de la capa», «de cada
 * cuarteto», «del tramo»):
 * - `posicion`: el anillo o el cuarteto tienen su orden (el 1, el 2…) y el motor pone cada impreso en un globo concreto;
 * - `numerados`: una pared numera los globos de un extremo al otro;
 * - `libre`: la hoja no numera los globos del grupo (una franja de altura, la capa de un cono): se dice la parte de la pieza que
 *   lleva el impreso si la hay (los ojos de una figura) y, si no, «cualquier posición».
 */
export type LugarDeImpresos = { tipo: "posicion" | "numerados" | "libre"; de: string };

/** Hasta cuántos números se escriben antes de decir «y N más». */
const MAX_POSICIONES = 6;

function unirNumeros(numeros: readonly number[]): string {
  const visibles = numeros.slice(0, MAX_POSICIONES).map(String);
  if (numeros.length > visibles.length) visibles.push(`${numeros.length - visibles.length} más`);
  return visibles.length === 1 ? visibles[0]! : `${visibles.slice(0, -1).join(", ")} y ${visibles[visibles.length - 1]}`;
}

/**
 * Las partes de la pieza (los ojos, la cabeza) que solo llevan el impreso: las de `propias` si todas tienen parte y ninguna otra
 * globo del grupo (`otras`) comparte una. Si el impreso cae en una parte que también tienen globos sin él (una columna orgánica:
 * todos son «columna»), la parte no dice dónde va y se devuelve vacío.
 */
export function partesPropias(propias: ReadonlyArray<string | undefined>, otras: ReadonlyArray<string | undefined>): string[] {
  if (propias.some((p) => p === undefined)) return [];
  const partes = [...new Set(propias as string[])];
  return partes.some((p) => otras.includes(p)) ? [] : partes;
}

/** «globos 1 y 3 de la capa», «todos los globos del tramo», «la parte «copa/ojos»» o «cualquier posición del tramo»: dónde van `numeros` de los `total` globos del grupo. */
export function textoUbicacion(lugar: LugarDeImpresos, numeros: readonly number[], total: number, partes: readonly string[] = []): string {
  if (numeros.length >= total) return `todos los globos ${lugar.de}`;
  if (lugar.tipo === "libre" && partes.length) return `${partes.length === 1 ? "la parte" : "las partes"} ${partes.map((p) => `«${p}»`).join(" y ")}`;
  if (lugar.tipo === "libre") return `cualquier posición ${lugar.de}`;
  return `${numeros.length === 1 ? "globo" : "globos"} ${unirNumeros(numeros)} ${lugar.de}`;
}
