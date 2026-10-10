import type { ContenidoItem, ProductosDeItem } from "./biblioteca";
import { formatoPorId } from "./formatos";
import type { Caja } from "./escena";
import type { Pieza } from "./piezas";
import { nombreOcasion } from "../taller/taxonomia-celebraciones";

/**
 * **La receta de una idea del catálogo** (la tarjeta de la ficha): cuántos globos de cada color y tamaño, de qué piezas
 * está hecha, sus medidas (la caja de todo lo puesto: globos, tubos y escenografía de la pieza) y su técnica, con las
 * ocasiones de la ficha.
 * Pura: lo que se necesita se pasa ya armado (los productos de la ficha, los globos de la escena armada, la clasificación).
 */

export type FilaTamano = { formatoId: string; formato: string; cantidad: number };
export type FilaColor = { codigo: string; color: string; total: number; porTamano: Record<string, number> };
export type RecetaIdea = {
  total: number;
  /** Del tamaño más grande al más chico. */
  tamanos: FilaTamano[];
  /** Del color con más globos al de menos; `porTamano` lleva lo que va en cada tamaño. */
  colores: FilaColor[];
  piezas: Array<{ nombre: string; cantidad: number }>;
  tecnicas: string[];
  medidas: { altoCm: number; anchoCm: number; fondoCm: number } | null;
  ocasiones: string[];
};

export type EntradaReceta = {
  piezas: readonly Pieza[];
  productos: ProductosDeItem;
  /** Las cajas de las piezas puestas en la escena armada (las copias con `copias > 0`): de ahí salen las medidas. */
  cajas: readonly Caja[];
  /** Ids de ocasión, como en la ficha (`item.ocasiones`). */
  ocasiones: readonly string[];
};

const NOMBRE_PIEZA: Readonly<Record<Pieza["tipo"], string>> = {
  columna: "Columna", arco: "Arco", pared_malla: "Pared de malla", pared_trenzas: "Pared de trenzas", organico: "Orgánica",
  decoracion: "Decoración", guirnalda: "Guirnalda", escenografia: "Escenografía", globo: "Globo suelto", forma: "Forma",
  letras: "Letras", metalizado: "Metalizado", mural: "Mural", techo: "Techo de globos", arbol_globos: "Árbol de globos",
  arco_organico: "Arco orgánico", modulo: "Módulo",
};

/** La técnica que dice cada pieza (las que son lo mismo se dicen una vez). */
const TECNICA_PIEZA: Readonly<Partial<Record<Pieza["tipo"], string>>> = {
  organico: "Orgánica (mezcla de tamaños)", arco_organico: "Orgánica (mezcla de tamaños)", guirnalda: "Guirnalda",
  columna: "Armazón recto", arco: "Armazón en arco", pared_malla: "Malla de globos", pared_trenzas: "Trenzas de globos",
  mural: "Mural", techo: "Techo de globos", arbol_globos: "Árbol de globos", modulo: "Módulo prearmado",
  letras: "Letras o números", forma: "Forma", metalizado: "Metalizado (foil)",
};

/** Las piezas de un item del catálogo, sean de una escena, de una estructura con decoraciones o una sola. */
export function piezasDeContenido(contenido: ContenidoItem): Pieza[] {
  if (contenido.tipo === "pieza") return [contenido.pieza];
  if (contenido.tipo === "conjunto") return [contenido.conjunto.raiz.pieza, ...contenido.conjunto.hijos.map((h) => h.pieza)];
  return contenido.escena.nodos.map((n) => n.pieza);
}

/** La caja que abarca todas las cajas (cm), o null si no hay ninguna. */
export function unirCajas(cajas: readonly Caja[]): Caja | null {
  if (cajas.length === 0) return null;
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const c of cajas) for (const k of ["x", "y", "z"] as const) {
    min[k] = Math.min(min[k], c.min[k]);
    max[k] = Math.max(max[k], c.max[k]);
  }
  return { min, max };
}

export function recetaDeIdea(entrada: EntradaReceta): RecetaIdea {
  const { productos } = entrada;
  const tamanoDe = new Map<string, FilaTamano>();
  const colorDe = new Map<string, FilaColor>();
  for (const g of productos.globos) {
    const t = tamanoDe.get(g.formatoId) ?? { formatoId: g.formatoId, formato: g.formato, cantidad: 0 };
    t.cantidad += g.cantidad;
    tamanoDe.set(g.formatoId, t);
    const c = colorDe.get(g.codigo) ?? { codigo: g.codigo, color: g.color, total: 0, porTamano: {} };
    c.total += g.cantidad;
    c.porTamano[g.formatoId] = (c.porTamano[g.formatoId] ?? 0) + g.cantidad;
    colorDe.set(g.codigo, c);
  }
  const diametro = (id: string) => formatoPorId(id)?.diametroMaxCm ?? 0;
  const tamanos = [...tamanoDe.values()].sort((a, b) => diametro(b.formatoId) - diametro(a.formatoId) || a.formatoId.localeCompare(b.formatoId));
  const colores = [...colorDe.values()].sort((a, b) => b.total - a.total || a.codigo.localeCompare(b.codigo));

  const piezas: Array<{ nombre: string; cantidad: number }> = [];
  for (const p of entrada.piezas) {
    const nombre = NOMBRE_PIEZA[p.tipo];
    const previa = piezas.find((x) => x.nombre === nombre);
    if (previa) previa.cantidad += 1;
    else piezas.push({ nombre, cantidad: 1 });
  }

  const tecnicas = [...new Set(entrada.piezas.map((p) => TECNICA_PIEZA[p.tipo]).filter((t): t is string => Boolean(t)))];
  if (entrada.piezas.some((p) => p.helio)) tecnicas.push("Helio");
  if (productos.tienda.some((t) => t.seccion === "impresos")) tecnicas.push("Impresos");
  if (productos.tienda.some((t) => t.seccion === "metalizados") && !tecnicas.includes("Metalizado (foil)")) tecnicas.push("Metalizado (foil)");

  const caja = unirCajas(entrada.cajas);
  const medidas = caja ? {
    altoCm: Math.round(caja.max.y - caja.min.y),
    anchoCm: Math.round(caja.max.x - caja.min.x),
    fondoCm: Math.round(caja.max.z - caja.min.z),
  } : null;

  return {
    total: productos.totalGlobos,
    tamanos,
    colores,
    piezas,
    tecnicas,
    medidas,
    ocasiones: entrada.ocasiones.map((id) => nombreOcasion(id)),
  };
}
