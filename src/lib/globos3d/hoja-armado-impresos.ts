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
