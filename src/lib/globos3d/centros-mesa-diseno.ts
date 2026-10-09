import { armarPieza, type Pieza } from "./piezas";
import { formatoPorId } from "./formatos";
import { ErrorHerramienta, fallar, resolverColorFlexible } from "./herramientas-escena-colores";
import { escalarOrganico } from "./herramientas-escena-estructuras";
import { recolorearConPaleta } from "./herramientas-escena-recolor";
import { itemDeBiblioteca } from "./herramientas-escena-biblioteca";
import type { Decoracion } from "./figuras";
import { esDePie } from "./halloween";

/**
 * **El diseño de un centro de mesa**, armado UNA vez y copiado a cada mesa (ver `centros-mesa.ts`). Cinco familias:
 * - `ramo_helio`: globos de helio en cintas amarrados a un peso (de pie sobre la mesa);
 * - `racimo`: seis globos en copa con un trío al centro (el formato se elige por el alto pedido: R-5, R-9, R-12 o R-18);
 * - `columna`: una columna chica de cuartetos R-5 (un color, dos, salvavidas o espiral según cuántos colores);
 * - `flores`: una flor de globos (pétalos R-12, corona y centro R-5) acostada sobre la mesa;
 * - `biblioteca`: la pieza (o la base de un conjunto) de un item de la biblioteca.
 * El alto de cada diseño se puede cambiar después (`reescalarCentro`) y sus colores también (`recolorearCentro`).
 */

export const TIPOS_DISENO = ["ramo_helio", "racimo", "columna", "flores", "biblioteca"] as const;
export type TipoDiseno = (typeof TIPOS_DISENO)[number];

export type PedidoDiseno = { tipo: TipoDiseno; colores?: readonly string[]; alto_cm?: number; biblioteca_id?: string };

/** Alto de partida (cm) de cada familia y el rango que admite al pedir otro. */
export const ALTO_DISENO: Readonly<Record<Exclude<TipoDiseno, "biblioteca" | "flores">, { porDefecto: number; min: number; max: number }>> = {
  ramo_helio: { porDefecto: 70, min: 35, max: 200 },
  racimo: { porDefecto: 26, min: 15, max: 80 },
  columna: { porDefecto: 60, min: 25, max: 200 },
};

const COLORES_POR_DEFECTO = ["blanco", "dorado"] as const;
const FORMATOS_RACIMO = ["R-5", "R-9", "R-12", "R-18"] as const;
const GLOBOS_DEL_RAMO = 5;

/** Lo alto que queda de pie (una decoración «de pie», como el ramo, se arma acostada si no se endereza). */
export function altoDe(pieza: Pieza): number {
  const dePie = pieza.tipo === "decoracion" && esDePie(pieza.decoracion) ? { ...pieza, deFrente: true } : pieza;
  const { min, max } = armarPieza(dePie).caja;
  return max.y - min.y;
}

function acotar(valor: number | undefined, rango: { porDefecto: number; min: number; max: number }, que: string): number {
  if (valor === undefined) return rango.porDefecto;
  if (!Number.isFinite(valor) || valor < rango.min || valor > rango.max) fallar(`${que} = ${valor} cm fuera de rango: va de ${rango.min} a ${rango.max} cm.`);
  return Math.round(valor);
}

const ciclo = <T,>(lista: readonly T[], n: number): T[] => Array.from({ length: n }, (_, i) => lista[i % lista.length]!);

function codigosDe(pedido: PedidoDiseno, formatos: readonly string[], notas: string[]): string[] {
  const nombres = pedido.colores?.length ? pedido.colores : COLORES_POR_DEFECTO;
  return nombres.map((c) => resolverColorFlexible(c, formatos, notas));
}

function ramoHelio(alturaCm: number, codigos: string[]): Pieza {
  const f = formatoPorId("R-12")!;
  const globos = ciclo(codigos, GLOBOS_DEL_RAMO).map((codigo) => ({ formatoId: f.id, infladoCm: f.infladoDecoracionCm + 2, codigo }));
  const decoracion: Decoracion = { tipo: "ramo_helio", propiedades: { globos, alturaCm, cinta: { hex: "#f2f2f2" }, peso: { hex: "#c9a14a" } } };
  return { tipo: "decoracion", decoracion };
}

/**
 * Un racimo en copa (seis globos que abren desde un trío al centro, como el «Racimo dorado» de la biblioteca) del formato cuyo alto
 * armado más se acerca al pedido. Es una decoración (no un módulo suelto) para que la escena pase el esquema de la ruta.
 */
function racimo(altoCm: number, codigos: readonly string[]): Pieza {
  let mejor: Pieza | null = null;
  let distancia = Infinity;
  for (const id of FORMATOS_RACIMO) {
    const infladoCm = formatoPorId(id)!.infladoDecoracionCm;
    const pieza: Pieza = {
      tipo: "decoracion",
      decoracion: { tipo: "flor", propiedades: { petalos: { formatoId: id, infladoCm, codigo: codigos[0]!, cantidad: 6, aperturaGrados: 10, giroGrados: 0 }, centro: { formatoId: id, infladoCm, codigo: codigos[1] ?? codigos[0]!, cantidad: 3 } } },
    };
    const d = Math.abs(altoDe(pieza) - altoCm);
    if (d < distancia) { mejor = pieza; distancia = d; }
  }
  return mejor!;
}

function columna(alturaCm: number, codigos: string[]): Pieza {
  const n = codigos.length;
  const patron = n >= 4 ? "espiral" : n === 3 ? "salvavidas" : n === 2 ? "dos_colores" : "un_color";
  const usados = patron === "espiral" ? ciclo(codigos, 4) : codigos;
  const f = formatoPorId("R-5")!;
  return { tipo: "columna", formatoId: f.id, infladoCm: f.infladoDecoracionCm, alturaCm, patron, colores: usados };
}

function flores(codigos: string[]): Pieza {
  const petalo = codigos[0]!, corona = codigos[1] ?? petalo, centro = codigos[2] ?? corona;
  return {
    tipo: "decoracion",
    decoracion: { tipo: "flor", propiedades: { petalos: { formatoId: "R-12", infladoCm: 22, codigo: petalo, cantidad: 5, aperturaGrados: 4, giroGrados: 0 }, corona: { formatoId: "R-5", infladoCm: 9, codigo: corona, cantidad: 6 }, centro: { formatoId: "R-5", infladoCm: 8, codigo: centro, cantidad: 1 } } },
  };
}

function deBiblioteca(id: string | undefined, notas: string[]): Pieza {
  if (!id) return fallar("Un centro de la biblioteca necesita biblioteca_id (búscalo con buscar_en_biblioteca).");
  const item = itemDeBiblioteca(id) ?? fallar(`No hay ningún item «${id}» en la biblioteca: búscalo con buscar_en_biblioteca y usa el id que da.`);
  const c = item.contenido;
  if (c.tipo === "escena") return fallar(`«${item.nombre}» es una escena entera: un centro de mesa es una sola pieza. Busca una decoración o estructura chica.`);
  if (c.tipo === "conjunto") {
    notas.push(`«${item.nombre}» es un conjunto: tomé solo su pieza principal, sin las decoraciones que lleva encima`);
    return structuredClone(c.conjunto.raiz.pieza);
  }
  return structuredClone(c.pieza);
}

/** Arma el diseño pedido: la pieza que se copia a cada mesa y el nombre con que se ve en la lista. */
export function crearDiseno(pedido: PedidoDiseno, notas: string[]): { pieza: Pieza; nombre: string } {
  switch (pedido.tipo) {
    case "ramo_helio": return { pieza: ramoHelio(acotar(pedido.alto_cm, ALTO_DISENO.ramo_helio, "alto_cm"), codigosDe(pedido, ["R-12"], notas)), nombre: "Centro de mesa · ramo de helio" };
    case "racimo": return { pieza: racimo(acotar(pedido.alto_cm, ALTO_DISENO.racimo, "alto_cm"), codigosDe(pedido, FORMATOS_RACIMO, notas)), nombre: "Centro de mesa · racimo de globos" };
    case "columna": return { pieza: columna(acotar(pedido.alto_cm, ALTO_DISENO.columna, "alto_cm"), codigosDe(pedido, ["R-5"], notas)), nombre: "Centro de mesa · columna chica" };
    case "flores":
      if (pedido.alto_cm !== undefined) notas.push("la flor de globos no cambia de alto (usa ramo_helio, racimo o columna para un centro más alto)");
      return { pieza: flores(codigosDe(pedido, ["R-12", "R-5"], notas)), nombre: "Centro de mesa · flor de globos" };
    case "biblioteca": {
      const pieza = deBiblioteca(pedido.biblioteca_id, notas);
      if (pedido.colores?.length) {
        const r = recolorearConPaleta(pieza, pedido.colores, notas, "uso");
        return { pieza: r.pieza, nombre: "Centro de mesa · de la biblioteca" };
      }
      return { pieza, nombre: "Centro de mesa · de la biblioteca" };
    }
  }
}

/** Los mismos globos y la misma forma con los colores pedidos (en el orden en que aparecen). */
export function recolorearCentro(pieza: Pieza, colores: readonly string[], notas: string[]): Pieza {
  const r = recolorearConPaleta(pieza, colores, notas, "uso");
  if (!r.cambios) fallar("Esos colores no cambian nada del centro (ya los tenía, o la pieza no lleva globos de color).");
  return r.pieza;
}

/**
 * El mismo diseño con otro alto (cm). Cambia el alto de un ramo y de una columna, estira un orgánico y en un racimo elige el
 * formato de globo que más se acerca. Una flor plana o una decoración fija no cambia de alto: devuelve null.
 */
export function reescalarCentro(pieza: Pieza, altoCm: number): Pieza | null {
  if (!Number.isFinite(altoCm) || altoCm <= 0) throw new ErrorHerramienta(`El alto del centro tiene que ser mayor que 0 (me pasaron ${altoCm}).`);
  switch (pieza.tipo) {
    case "columna": return { ...pieza, alturaCm: Math.round(altoCm) };
    case "decoracion": {
      const d = pieza.decoracion;
      if (d.tipo === "ramo_helio") return { ...pieza, decoracion: { ...d, propiedades: { ...d.propiedades, alturaCm: Math.round(altoCm) } } };
      // El racimo (una flor en copa, sin corona y con un trío al centro) elige otro formato de globo; la flor plana no cambia.
      if (d.tipo === "flor" && !d.propiedades.corona && d.propiedades.centro?.cantidad === 3) return racimo(altoCm, [d.propiedades.petalos.codigo, d.propiedades.centro.codigo]);
      return null;
    }
    case "organico": return escalarOrganico(pieza, { altoCm: Math.round(altoCm) });
    default: return null;
  }
}
