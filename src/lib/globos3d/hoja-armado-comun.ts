import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import type { FilaBomba } from "./bomba-segundos";
import { esGloboDeHelio } from "./helio-cinta";
import { impresoDe, partesPropias, textoUbicacion, type ImpresoHoja, type LugarDeImpresos } from "./hoja-armado-impresos";
import type { CentroLocal } from "./hoja-armado-local";

/** Lo que comparten los modos de la hoja de armado: el globo tal como se imprime, sus cuentas por color y tamaño. */

export type GloboHoja = {
  formatoId: string;
  codigo: string;
  nombreColor: string;
  hex: string;
  infladoCm: number;
  parte?: string;
  helio: boolean;
  /** Lo impreso o pegado sobre el globo (un Infinity de la tienda, unos ojos). */
  impreso?: ImpresoHoja;
  /** Un cristal relleno de confeti (el de las guirnaldas orgánicas). */
  confeti: boolean;
  /** Altura del centro en el espacio de la pieza (cm). */
  alturaCm: number;
  /** Posición a lo largo de la pieza (cm desde su extremo menor). */
  posicionCm: number;
};

type RasgosDeGlobo = Pick<GloboHoja, "formatoId" | "codigo" | "infladoCm" | "helio" | "impreso" | "confeti">;

/** Lo que distingue a un globo en la hoja: formato, color, tamaño, helio, lo impreso y el confeti de dentro. */
export const claveDeGlobo = (g: RasgosDeGlobo): string => [g.formatoId, g.codigo, g.infladoCm, g.helio ? "h" : "", g.impreso?.clave ?? "", g.confeti ? "c" : ""].join("|");

/**
 * Lo que tienen de especial los globos de una capa, un tramo o un cuarteto: cuántos son de helio, impresos (y dónde van, según
 * `lugar`) o con confeti. `globos` va en el orden del grupo; sin `numero` propio, el número de un globo es su lugar en la lista.
 */
export function marcasDe(globos: readonly (Pick<GloboHoja, "helio" | "impreso" | "confeti" | "parte"> & { numero?: number })[], lugar: LugarDeImpresos): string[] {
  const marcas: string[] = [];
  const helio = globos.filter((g) => g.helio).length;
  if (helio) marcas.push(`${helio} de helio (no pasan por la bomba)`);
  const impresos = new Map<string, { texto: string; numeros: number[]; partes: Array<string | undefined> }>();
  globos.forEach((g, i) => {
    if (!g.impreso) return;
    const previo = impresos.get(g.impreso.clave);
    if (previo) { previo.numeros.push(g.numero ?? i + 1); previo.partes.push(g.parte); }
    else impresos.set(g.impreso.clave, { texto: g.impreso.texto, numeros: [g.numero ?? i + 1], partes: [g.parte] });
  });
  for (const [clave, { texto, numeros, partes }] of impresos) {
    const otras = globos.filter((g) => g.impreso?.clave !== clave).map((g) => g.parte);
    marcas.push(`${numeros.length} con ${texto} (${textoUbicacion(lugar, numeros, globos.length, partesPropias(partes, otras))})`);
  }
  const confeti = globos.filter((g) => g.confeti).length;
  if (confeti) marcas.push(`${confeti} con confeti dentro`);
  return marcas;
}

export type LineaColorCapa = { formatoId: string; codigo: string; nombreColor: string; hex: string; cantidad: number };
/** Globos de un formato a un tamaño inflado (`infladoCm`) o, si son de muchos tamaños, a todos los de `infladoCm` a `hastaCm`. */
export type LineaTamano = { formatoId: string; infladoCm: number; hastaCm: number; cantidad: number };

/** Más tamaños distintos que esto en un formato: se da un rango, no una línea por tamaño. */
export const MAX_TAMANOS_POR_FORMATO = 3;
/** Globos de una pieza que no están en ninguna capa (el remate de una columna, los acentos de un cono). */
export type LineaAparte = LineaColorCapa & { infladoCm: number; etiqueta: string; /** Lo impreso sobre estos globos (un remate impreso), si lo llevan. */ impreso?: string };

/** Un tramo de color: `veces` globos seguidos del mismo código; `desde` es el número del primero (1 = el primero de la lista). */
export type TramoColor = { formatoId: string; codigo: string; nombreColor: string; hex: string; veces: number; desde: number };

/** Suma de los segundos de las filas sin redondear: así los totales de capas, tramos y escena cuadran exactos. */
export const sumaSinRedondear = (filas: readonly FilaBomba[]): number => filas.reduce((s, f) => s + f.segundosSinRedondear, 0);

export function nombreYHex(codigo: string): { nombreColor: string; hex: string } {
  const referencia = referenciaPorCodigo(codigo);
  return { nombreColor: referencia?.nombreCompleto ?? codigo, hex: referencia?.hexGlobo ?? "#cccccc" };
}

export function globoHoja(c: CentroLocal, posicionCm = 0): GloboHoja {
  const { codigo, formatoId, infladoCm, parte } = c.globo;
  return {
    formatoId, codigo, ...nombreYHex(codigo), infladoCm, parte,
    helio: esGloboDeHelio(c.globo), impreso: impresoDe(c.globo.estampado), confeti: c.globo.confeti === true,
    alturaCm: c.y, posicionCm,
  };
}

/**
 * Agrupa por un valor en orden: cada grupo empieza en su primer elemento y entra en él lo que está a menos de `tolerancia`
 * de ESE primero (no del anterior: así una cadena de globos no se va arrastrando hacia arriba).
 */
export function agruparDesdePrimero<T>(items: readonly T[], valor: (t: T) => number, tolerancia: number): T[][] {
  const orden = [...items].sort((a, b) => valor(a) - valor(b));
  const grupos: T[][] = [];
  for (const it of orden) {
    const grupo = grupos[grupos.length - 1];
    if (grupo && valor(it) - valor(grupo[0]!) <= tolerancia) grupo.push(it);
    else grupos.push([it]);
  }
  return grupos;
}

/** Cuántos globos de cada color (del más numeroso al menos). */
export function colorear(globos: readonly Pick<GloboHoja, "formatoId" | "codigo" | "nombreColor" | "hex">[]): LineaColorCapa[] {
  const cuenta = new Map<string, LineaColorCapa>();
  for (const g of globos) {
    const clave = `${g.formatoId}|${g.codigo}`;
    const previo = cuenta.get(clave);
    if (previo) previo.cantidad += 1;
    else cuenta.set(clave, { formatoId: g.formatoId, codigo: g.codigo, nombreColor: g.nombreColor, hex: g.hex, cantidad: 1 });
  }
  return [...cuenta.values()].sort((a, b) => b.cantidad - a.cantidad);
}

/**
 * Cuántos globos de cada formato y tamaño inflado, al cm (del formato y tamaño menores al mayor). Con más de
 * `MAX_TAMANOS_POR_FORMATO` tamaños en un formato (el racimo orgánico los mezcla), se da un solo rango para ese formato.
 */
export function tamanosDe(globos: readonly Pick<GloboHoja, "formatoId" | "infladoCm">[]): LineaTamano[] {
  const porFormato = new Map<string, Map<number, number>>();
  for (const g of globos) {
    const cuenta = porFormato.get(g.formatoId) ?? new Map<number, number>();
    const cm = Math.round(g.infladoCm);
    cuenta.set(cm, (cuenta.get(cm) ?? 0) + 1);
    porFormato.set(g.formatoId, cuenta);
  }
  return [...porFormato.entries()].sort((a, b) => a[0].localeCompare(b[0])).flatMap(([formatoId, cuenta]): LineaTamano[] => {
    const tamanos = [...cuenta.entries()].sort((a, b) => a[0] - b[0]);
    if (tamanos.length <= MAX_TAMANOS_POR_FORMATO) return tamanos.map(([cm, cantidad]) => ({ formatoId, infladoCm: cm, hastaCm: cm, cantidad }));
    return [{ formatoId, infladoCm: tamanos[0]![0], hastaCm: tamanos[tamanos.length - 1]![0], cantidad: tamanos.reduce((s, [, n]) => s + n, 0) }];
  });
}

/** Los globos que no están en ninguna capa, contados por parte, formato, color y tamaño. */
export function aparteDe(centros: readonly CentroLocal[]): LineaAparte[] {
  const cuenta = new Map<string, LineaAparte>();
  for (const c of centros) {
    const { formatoId, codigo, infladoCm, parte } = c.globo;
    const etiqueta = parte ?? "suelto";
    const impreso = impresoDe(c.globo.estampado);
    const clave = `${etiqueta}|${formatoId}|${codigo}|${infladoCm}|${impreso?.clave ?? ""}`;
    const previo = cuenta.get(clave);
    if (previo) previo.cantidad += 1;
    else cuenta.set(clave, { formatoId, codigo, ...nombreYHex(codigo), infladoCm, etiqueta, cantidad: 1, ...(impreso ? { impreso: impreso.texto } : {}) });
  }
  return [...cuenta.values()].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta) || b.cantidad - a.cantidad);
}

/** La secuencia de color de una lista de globos: los tramos seguidos del mismo código, con el número del primero de cada uno. */
export function secuenciaDeColor(globos: readonly Pick<GloboHoja, "formatoId" | "codigo" | "nombreColor" | "hex">[]): TramoColor[] {
  const tramos: TramoColor[] = [];
  globos.forEach((g, i) => {
    const previo = tramos[tramos.length - 1];
    if (previo && previo.codigo === g.codigo && previo.formatoId === g.formatoId) previo.veces += 1;
    else tramos.push({ formatoId: g.formatoId, codigo: g.codigo, nombreColor: g.nombreColor, hex: g.hex, veces: 1, desde: i + 1 });
  });
  return tramos;
}

/** Negro o blanco, lo que se lea mejor sobre el color del globo. */
export function textoSobre(hex: string): "#000000" | "#ffffff" {
  const canal = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
  const luminancia = 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
  return luminancia > 0.5 ? "#000000" : "#ffffff";
}

/**
 * Los globos de una pieza por capa (`nivel`, de la 0 en adelante) y los que no tienen capa. Cada capa conserva el orden en
 * que la pieza arma sus globos, que es el orden alrededor del anillo.
 */
export function agruparPorNivel(centros: readonly CentroLocal[]): { niveles: CentroLocal[][]; aparte: CentroLocal[] } {
  const porNivel = new Map<number, CentroLocal[]>();
  const aparte: CentroLocal[] = [];
  for (const c of centros) {
    const nivel = c.globo.nivel;
    if (nivel === undefined) { aparte.push(c); continue; }
    const grupo = porNivel.get(nivel);
    if (grupo) grupo.push(c);
    else porNivel.set(nivel, [c]);
  }
  return { niveles: [...porNivel.entries()].sort((a, b) => a[0] - b[0]).map(([, grupo]) => grupo), aparte };
}

/** Los centros de una pieza por su `nivel`, dejando fuera los globos de `parte` indicada (el remate, que va aparte). */
export const sinParte = (centros: readonly CentroLocal[], parte: string): { dentro: CentroLocal[]; fuera: CentroLocal[] } => ({
  dentro: centros.filter((c) => c.globo.parte !== parte),
  fuera: centros.filter((c) => c.globo.parte === parte),
});
