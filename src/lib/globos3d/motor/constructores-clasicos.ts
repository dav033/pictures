import { resolverColorFlexible } from "../herramientas-escena-colores";
import { formatoPorId } from "../formatos";
import { PASO_POR_DIAMETRO, type PatronColumna } from "../columnas";
import type { PatronMalla } from "../paredes";
import type { Decoracion } from "../figuras";
import type { Pieza } from "../piezas";
import type { ElementoTecho } from "../techo";
import type { PiezaEspec } from "./espec-cliente-v1";
import { enCm, UNIDADES_POR_DEFECTO } from "./medidas-espec";
import type { Construida, EntradaOrganica } from "./constructores-organicos";

/**
 * Las piezas de cuartetos (arco, columna, guirnalda), la pared de malla, el techo de racimos, el ramo y el racimo de
 * pared. Los colores del cliente se llevan al código que se fabrica en el formato de la pieza (el más parecido si el
 * suyo no viene, con aviso).
 */
export type EntradaClasica = EntradaOrganica;

const RANGOS = {
  columna: { alto: [60, 500] },
  arco: { ancho: [100, 500], alto: [100, 350] },
  guirnalda: { ancho: [100, 800] },
  pared: { ancho: [100, 600], alto: [100, 300] },
  techo: { ancho: [60, 600], fondo: [60, 600] },
  ramo: { alto: [60, 300] },
} as const;

const FORMATO_TRENZA = "R-12";
const FORMATO_PARED = "LOL-12";

function inflado(formatoId: string): number {
  const formato = formatoPorId(formatoId);
  if (!formato) throw new Error(`Formato desconocido: ${formatoId}`);
  return formato.infladoDecoracionCm;
}

type ColorConPeso = { codigo: string; peso: number };

/** Los colores de la pieza en códigos que se fabrican en esos formatos (si dos caen en el mismo, sus pesos se suman). */
function enFormato(espec: PiezaEspec, formatos: readonly string[], notas: string[]): ColorConPeso[] {
  const suma = new Map<string, number>();
  for (const c of espec.colores) {
    const codigo = resolverColorFlexible(c.codigo, formatos, notas);
    suma.set(codigo, (suma.get(codigo) ?? 0) + c.peso);
  }
  return [...suma].map(([codigo, peso]) => ({ codigo, peso }));
}

const TOLERANCIA_PAREJOS = 0.1;
const RANURAS_DE_BANDAS = 8;

const sonParejos = (colores: readonly ColorConPeso[]) => Math.max(...colores.map((c) => c.peso)) - Math.min(...colores.map((c) => c.peso)) <= TOLERANCIA_PAREJOS;

/** Cuotas enteras que suman `total` (al menos 1 por color) por el método del mayor resto. */
function cuotas(pesos: readonly number[], total: number): number[] {
  const base = pesos.map((p) => Math.max(1, Math.floor(p * total)));
  let resto = total - base.reduce((s, c) => s + c, 0);
  const orden = pesos.map((p, i) => ({ i, fraccion: p * total - Math.floor(p * total) })).sort((a, b) => b.fraccion - a.fraccion || a.i - b.i);
  for (let k = 0; resto > 0; k = (k + 1) % orden.length, resto--) base[orden[k]!.i]! += 1;
  return base;
}

/**
 * El patrón de trenza que da los colores y sus pesos: uno solo, dos o cuatro parejos (los patrones de siempre) y, con
 * otras proporciones, bandas de dos cuartetos que repiten el color según su cuota («salvavidas»: 75 % y 25 % es
 * A, A, A, B). Así el peso que pidió el cliente se nota y se cobra. Si se sabe cuántos niveles tiene la pieza, las bandas son las
 * que caben (dos niveles cada una): con menos bandas que colores los últimos no se verían nunca.
 */
export function patronDeTrenza(colores: readonly ColorConPeso[], niveles?: number): { patron: PatronColumna; colores: string[] } {
  const codigos = colores.map((c) => c.codigo);
  if (codigos.length <= 1) return { patron: "un_color", colores: codigos };
  if (sonParejos(colores) && codigos.length === 2) return { patron: "dos_colores", colores: codigos };
  if (sonParejos(colores) && codigos.length === 4) return { patron: "espiral", colores: codigos };
  if (sonParejos(colores)) return { patron: "salvavidas", colores: codigos };
  const total = Math.max(codigos.length, niveles ? Math.min(RANURAS_DE_BANDAS, Math.ceil(niveles / 2)) : RANURAS_DE_BANDAS);
  const restantes = cuotas(colores.map((c) => c.peso), total);
  const secuencia: string[] = [];
  while (secuencia.length < total) {
    const i = restantes.indexOf(Math.max(...restantes));
    secuencia.push(codigos[i]!);
    restantes[i]! -= 1;
  }
  return { patron: "salvavidas", colores: secuencia };
}

function patronDeMalla(codigos: readonly string[]): { patron: PatronMalla; colores: string[] } {
  if (codigos.length <= 1) return { patron: "un_color", colores: [...codigos] };
  if (codigos.length === 2) return { patron: "damero", colores: [...codigos] };
  const cuatro = Array.from({ length: 4 }, (_, i) => codigos[i % codigos.length]!);
  return { patron: "rombos", colores: cuatro };
}

/** Los armados que reparten sus colores a partes iguales lo dicen cuando el cliente pidió otra proporción. */
function avisarPesosParejos(espec: PiezaEspec, colores: readonly ColorConPeso[], avisos: string[]): void {
  if (colores.length > 1 && !sonParejos(colores)) avisos.push(`Los colores de «${espec.nombre}» van a partes iguales: este armado no reparte por peso.`);
}

export function construirArco({ espec, medidas, avisos, notas }: EntradaClasica): Construida {
  const { patron, colores } = patronDeTrenza(enFormato(espec, [FORMATO_TRENZA], notas));
  return {
    apoyo: "piso",
    pieza: {
      tipo: "arco", formatoId: FORMATO_TRENZA, infladoCm: inflado(FORMATO_TRENZA), forma: "redondo",
      anchoCm: enCm(medidas.anchoM, undefined, RANGOS.arco.ancho, "El ancho", avisos), altoCm: enCm(medidas.altoM, undefined, RANGOS.arco.alto, "El alto", avisos),
      patron, colores,
    },
  };
}

/**
 * El alto de una columna: el de sus medidas o, si trae la lista de capas, el que da exactamente esos niveles de cuartetos
 * (el plan de Python deja 11 capas en «2 m»). Si el alto pedido se aparta de las capas en más de dos niveles, alguien cambió el alto
 * y las capas quedaron viejas: manda el alto, para que la edición no se pierda.
 */
function alturaDeColumna(espec: PiezaEspec, medidas: EntradaClasica["medidas"], avisos: string[]): number {
  const pasoCm = inflado(FORMATO_TRENZA) * PASO_POR_DIAMETRO;
  if (!espec.capas) return enCm(medidas.altoM, undefined, RANGOS.columna.alto, "El alto", avisos);
  const porCapasCm = espec.capas * pasoCm;
  const pedidoM = espec.medidas.altoM;
  if (pedidoM !== undefined && Math.abs(Math.round(pedidoM * 100) - Math.round(porCapasCm)) > 2 * Math.round(pasoCm)) {
    avisos.push(`Las ${espec.capas} capas de «${espec.nombre}» no cuadran con su alto de ${pedidoM} m: manda el alto.`);
    return enCm(medidas.altoM, undefined, RANGOS.columna.alto, "El alto", avisos);
  }
  return enCm(porCapasCm / 100, undefined, RANGOS.columna.alto, "El alto", avisos);
}

/** Cuántos niveles de cuartetos caben en `largoCm` (la misma cuenta de la trenza). */
const nivelesEn = (largoCm: number, formatoId: string): number => Math.max(1, Math.round(largoCm / (inflado(formatoId) * PASO_POR_DIAMETRO)));

export function construirColumna({ espec, medidas, avisos, notas }: EntradaClasica): Construida {
  const alturaCm = alturaDeColumna(espec, medidas, avisos);
  const { patron, colores } = patronDeTrenza(enFormato(espec, [FORMATO_TRENZA], notas), nivelesEn(alturaCm, FORMATO_TRENZA));
  const pieza: Pieza = { tipo: "columna", formatoId: FORMATO_TRENZA, infladoCm: inflado(FORMATO_TRENZA), alturaCm, patron, colores };
  return { pieza, apoyo: "piso" };
}

export function construirGuirnalda({ espec, medidas, avisos, notas }: EntradaClasica): Construida {
  const anchoCm = enCm(medidas.largoM ?? medidas.anchoM, undefined, RANGOS.guirnalda.ancho, "El largo", avisos);
  const { patron, colores } = patronDeTrenza(enFormato(espec, [FORMATO_TRENZA], notas), nivelesEn(anchoCm, FORMATO_TRENZA));
  return {
    apoyo: "pared",
    pieza: {
      tipo: "guirnalda",
      guirnalda: { formatoId: FORMATO_TRENZA, infladoCm: inflado(FORMATO_TRENZA), patron, colores, anchoCm, caidaCm: 30, recorrido: null },
    },
  };
}

export function construirPared({ espec, medidas, avisos, notas }: EntradaClasica): Construida {
  const delFormato = enFormato(espec, [FORMATO_PARED], notas);
  avisarPesosParejos(espec, delFormato, avisos);
  const { patron, colores } = patronDeMalla(delFormato.map((c) => c.codigo));
  const union = resolverColorFlexible(espec.colores[0]!.codigo, ["R-5"], notas);
  return {
    apoyo: "pared",
    pieza: {
      tipo: "pared_malla", formatoId: FORMATO_PARED, infladoCm: inflado(FORMATO_PARED),
      anchoCm: enCm(medidas.anchoM, undefined, RANGOS.pared.ancho, "El ancho", avisos), altoCm: enCm(medidas.altoM, undefined, RANGOS.pared.alto, "El alto", avisos),
      patron, colores, union: { infladoCm: inflado("R-5"), codigo: union },
    },
  };
}

export function construirTecho({ espec, medidas, avisos, notas }: EntradaClasica): Construida {
  const delFormato = enFormato(espec, [FORMATO_TRENZA], notas);
  avisarPesosParejos(espec, delFormato, avisos);
  const colores = delFormato.map((c) => c.codigo);
  const red: ElementoTecho = {
    tipo: "red", tecnica: "racimos", globo: { formatoId: FORMATO_TRENZA, infladoCm: inflado(FORMATO_TRENZA) }, colores,
    anchoCm: enCm(medidas.anchoM, undefined, RANGOS.techo.ancho, "El ancho", avisos), fondoCm: enCm(medidas.altoM, undefined, RANGOS.techo.fondo, "El fondo", avisos),
    patron: colores.length === 1 ? "un_color" : colores.length === 2 ? "damero" : "alternado",
  };
  return { pieza: { tipo: "techo", techo: { elementos: [red] } }, apoyo: "techo" };
}

/** El bouquet: un ramo de helio (globos en espiral atados a un peso), con los colores de la pieza en ciclo. */
export function construirRamo({ espec, medidas, avisos, notas }: EntradaClasica): Construida {
  const delFormato = enFormato(espec, [FORMATO_TRENZA], notas);
  avisarPesosParejos(espec, delFormato, avisos);
  const colores = delFormato.map((c) => c.codigo);
  const unidades = espec.unidades ?? UNIDADES_POR_DEFECTO.bouquet ?? 7;
  const decoracion: Decoracion = {
    tipo: "ramo_helio",
    propiedades: {
      globos: Array.from({ length: unidades }, (_, i) => ({ formatoId: FORMATO_TRENZA, infladoCm: 28, codigo: colores[i % colores.length]! })),
      alturaCm: enCm(medidas.altoM, undefined, RANGOS.ramo.alto, "El alto", avisos),
      cinta: { hex: "#f3efe6" }, peso: { hex: "#8a8076" },
    },
  };
  return { pieza: { tipo: "decoracion", decoracion }, apoyo: "piso" };
}

export function construirRacimoPared({ espec, avisos, notas }: EntradaClasica): Construida {
  const delFormato = enFormato(espec, [FORMATO_TRENZA], notas);
  avisarPesosParejos(espec, delFormato, avisos);
  const codigos = delFormato.map((c) => c.codigo);
  const decoracion: Decoracion = {
    tipo: "racimo",
    propiedades: { forma: "bola", globo: { formatoId: FORMATO_TRENZA, infladoCm: inflado(FORMATO_TRENZA) }, codigos, cantidad: espec.unidades ?? UNIDADES_POR_DEFECTO.racimo_pared ?? 9, semilla: 3 },
  };
  return { pieza: { tipo: "decoracion", decoracion }, apoyo: "pared" };
}
