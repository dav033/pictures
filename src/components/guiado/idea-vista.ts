import type { DetalleIdea, LineaIdea } from "@/lib/biblioteca-sempertex/detalle-idea";
import { fichaGlobo } from "./ficha-globo";
import { hexColor, lineaGlobo, type LineaGlobo, type PiezaVista } from "./piezas-vista";

/**
 * La tarjeta de una idea con el mismo vocabulario que «Tu plan» (`PiezaVista`, `LineaGlobo`): piezas con sus globos
 * Sempertex por producto y tamaño, tal como los dejó `detalles-ideas.json`. Solo traduce: nunca cuenta ni reparte.
 * Sin React, para probarlo sin navegador (`scripts/test/test-detalles-ideas.ts`).
 */

const GRIS = "#9ca3af";

/** Una línea de la idea lista para pintar: su producto Sempertex, su tono del catálogo y su tamaño. */
export function lineaDeIdea(linea: LineaIdea): LineaGlobo | null {
  const base = lineaGlobo({ color: linea.color, tamano_codigo: linea.codigo, titulo: linea.titulo, unidades: linea.unidades });
  if (!base) return null;
  // El tono: el del catálogo para el color de la biblioteca («dorado cromado»), si no el de su color de paleta, si no
  // el que dice el nombre del producto («Fashion Eucalipto»).
  let hex = base.hex;
  if (hex === GRIS && linea.paleta) hex = hexColor(linea.paleta, { titulo: linea.titulo });
  if (hex === GRIS) hex = fichaGlobo({ nombre: linea.titulo }).hex;
  return { ...base, paleta: linea.paleta, liso: linea.liso, producto: linea.producto, hex };
}

/**
 * Un globo (no una cortina metálica ni una bolsa de confeti): solo los globos van en las piezas, los chips y las tablas
 * «Globo Sempertex»; lo demás lo dice la cabecera aparte («y 1 Cortina Metálica Roja»). Verificador (2026-10-06):
 * deco-real-10, 16, 18, 20 y 22 contaban cortinas y confeti entre los globos Sempertex de sus piezas.
 */
export function esGloboDeIdea(linea: Pick<LineaIdea, "titulo">): boolean {
  return /\bglobo\b/i.test(linea.titulo);
}

function lineasVista(lineas: readonly LineaIdea[]): LineaGlobo[] {
  return lineas.filter(esGloboDeIdea).flatMap((linea) => {
    const vista = lineaDeIdea(linea);
    return vista ? [vista] : [];
  });
}

/** Las piezas de la idea, en su orden, como las de «Tu plan». */
export function piezasVistaDeIdea(detalle: DetalleIdea): PiezaVista[] {
  return detalle.piezas.map((pieza) => ({
    id: pieza.id,
    nombre: pieza.nombre,
    oficial: pieza.estructura,
    repeticiones: pieza.repeticiones,
    medidas: pieza.medidas,
    lineas: lineasVista(pieza.lineas),
  }));
}

/** Lo que no va en ninguna pieza (toda la decoración, o lo contado en la foto con varias piezas). */
export function lineasSinPiezaDeIdea(detalle: DetalleIdea): LineaGlobo[] {
  return lineasVista(detalle.lineasSinPieza ?? []);
}

export type ResumenIdea = {
  /** Globos de la idea (lo que no es globo, como una cortina, va aparte). */
  globos: number;
  /** Lo que no es globo: «1 Cortina Metálica Roja». */
  otros: Array<{ producto: string; unidades: number }>;
  /** Los tonos Sempertex de la idea, del producto más usado al menos (como mucho 6). */
  tonos: Array<{ hex: string; producto: string }>;
  /** Productos con alguna cantidad contada a mano en la foto, en orden de aparición. */
  estimados: string[];
  /** Todas las cantidades se contaron en la foto (ninguna la resolvió Python). */
  todoEstimado: boolean;
};

function todasLasLineas(detalle: DetalleIdea): LineaIdea[] {
  return [...detalle.piezas.flatMap((pieza) => pieza.lineas), ...(detalle.lineasSinPieza ?? [])];
}

/** Los números y tonos de la cabecera de la tarjeta. */
export function resumenIdea(detalle: DetalleIdea): ResumenIdea {
  const lineas = todasLasLineas(detalle);
  const esGlobo = esGloboDeIdea;
  const otros = new Map<string, number>();
  for (const linea of lineas) if (!esGlobo(linea)) otros.set(linea.producto, (otros.get(linea.producto) ?? 0) + linea.unidades);
  const porProducto = new Map<string, { hex: string; producto: string; unidades: number }>();
  for (const linea of lineas) {
    if (!esGlobo(linea)) continue;
    const vista = lineaDeIdea(linea);
    if (!vista) continue;
    const previo = porProducto.get(linea.producto);
    if (previo) previo.unidades += linea.unidades;
    else porProducto.set(linea.producto, { hex: vista.hex, producto: linea.producto, unidades: linea.unidades });
  }
  const tonos = [...porProducto.values()].sort((a, b) => b.unidades - a.unidades);
  const unicos = tonos.filter((tono, indice) => tonos.findIndex((otro) => otro.hex === tono.hex) === indice).slice(0, 6);
  return {
    globos: lineas.filter(esGlobo).reduce((suma, linea) => suma + linea.unidades, 0),
    otros: [...otros].map(([producto, unidades]) => ({ producto, unidades })),
    tonos: unicos.map(({ hex, producto }) => ({ hex, producto })),
    estimados: [...new Set(lineas.filter((linea) => linea.estimado).map((linea) => linea.producto))],
    todoEstimado: lineas.length > 0 && lineas.every((linea) => linea.estimado),
  };
}
