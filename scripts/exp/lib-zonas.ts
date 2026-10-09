/**
 * **Pendiente, afinado y zonas de color de la masa de globos** (REQ-001), lo que `lib-proporciones.ts` no ve: ese mide cuánto
 * se aparta la forma; esta mide si el tramo de arriba SUBE o BAJA a lo largo (pendiente), si se ADELGAZA hacia un extremo
 * (afinado) y si los colores van POR TRAMOS como en la foto (blanco a la izquierda, arena en el medio, vino en la columna) o
 * están mezclados por todas partes. Todo en unidades de alto de la foto y puro, sin red.
 *
 * El tramo de arriba son las franjas verticales cuya capa de arriba (los globos que se tocan desde el borde de arriba) es
 * delgada frente al alto de la masa: donde la capa de arriba baja hasta el piso es la columna. Las franjas son las de la foto
 * y se miden igual en lo armado.
 */
import type { Caja, Disco } from "./lib-proporciones";

const FRANJAS_TRAMO = 10;
/** Una franja del tramo de arriba tiene al menos estos globos (en la foto y en lo armado). */
const MINIMO_POR_FRANJA = 2;
/** La capa de arriba de una franja del tramo es más delgada que esta fracción del alto de la masa (si no, es columna). */
const FRACCION_TRAMO = 0.5;
/** Dos globos se tocan en la capa de arriba si el hueco entre ellos es menor que esto (alto de la foto). */
const HUECO_CAPA = 0.05;
/** Con menos franjas que estas no hay tramo que medir. */
const MINIMO_FRANJAS_TRAMO = 4;
/** Lo que se tolera de error en la deriva (cuánto sube, baja o se adelgaza el tramo de punta a punta, alto de la foto). */
export const TOLERANCIA_TRAMO = 0.1;

/** La capa de arriba de unos discos: de borde a borde de los globos que se encadenan desde el que sube más. */
export function capaDeArriba(discos: readonly Disco[]): { y0: number; y1: number } | null {
  if (!discos.length) return null;
  const ordenados = [...discos].sort((a, b) => a.y - a.r - (b.y - b.r));
  const y0 = ordenados[0]!.y - ordenados[0]!.r;
  let y1 = ordenados[0]!.y + ordenados[0]!.r;
  for (const d of ordenados.slice(1)) {
    if (d.y - d.r > y1 + HUECO_CAPA) break;
    y1 = Math.max(y1, d.y + d.r);
  }
  return { y0, y1 };
}

/** Pendiente de la recta de mínimos cuadrados de `y` sobre `x` (0 con menos de dos puntos distintos). */
function pendienteDe(puntos: ReadonlyArray<{ x: number; y: number }>): number {
  const n = puntos.length;
  if (n < 2) return 0;
  const mx = puntos.reduce((s, p) => s + p.x, 0) / n, my = puntos.reduce((s, p) => s + p.y, 0) / n;
  const varianza = puntos.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  return varianza > 1e-12 ? puntos.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / varianza : 0;
}

type FranjaDeCapa = { x: number; y0: number; y1: number };

function franjasDeCapa(discos: readonly Disco[], caja: Caja): Array<FranjaDeCapa | null> {
  const ancho = (caja.x1 - caja.x0) / FRANJAS_TRAMO;
  return Array.from({ length: FRANJAS_TRAMO }, (_, k) => {
    const desde = caja.x0 + k * ancho;
    const dentro = discos.filter((d) => d.x >= desde && d.x < desde + ancho);
    const capa = dentro.length >= MINIMO_POR_FRANJA ? capaDeArriba(dentro) : null;
    return capa ? { x: desde + ancho / 2, ...capa } : null;
  });
}

export type MedidaDeTramo = {
  /** Cuánto sube (negativo) o baja (positivo) el centro de la capa de arriba de punta a punta del tramo (alto de la foto), en la foto y en lo armado. */
  derivaFoto: number; derivaArmado: number;
  /** Cuánto cambia el grosor de la capa de arriba de punta a punta del tramo (positivo: más gruesa hacia la derecha). */
  afinadoFoto: number; afinadoArmado: number;
  /** El error medio de las dos derivas (alto de la foto): 0 = el mismo tramo. */
  error: number;
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** El tramo de arriba (pendiente y afinado) de lo armado contra la foto, o `null` si la foto no tiene un tramo medible. */
export function medirTramo(foto: readonly Disco[], armado: readonly Disco[], caja: Caja): MedidaDeTramo | null {
  const altoMasa = caja.y1 - caja.y0;
  const deFoto = franjasDeCapa(foto, caja), deArmado = franjasDeCapa(armado, caja);
  // El tramo es la tirada más larga de franjas seguidas con capa delgada (una franja suelta al otro lado de la columna no cuenta).
  const tiradas: Array<Array<{ f: FranjaDeCapa; g: FranjaDeCapa | null }>> = [[]];
  deFoto.forEach((f, i) => {
    if (f && f.y1 - f.y0 < FRACCION_TRAMO * altoMasa) tiradas[tiradas.length - 1]!.push({ f, g: deArmado[i] ?? null });
    else if (tiradas[tiradas.length - 1]!.length) tiradas.push([]);
  });
  const par = tiradas.reduce((m, t) => (t.length > m.length ? t : m), []);
  if (par.length < MINIMO_FRANJAS_TRAMO) return null;
  const largo = par[par.length - 1]!.f.x - par[0]!.f.x;
  const deriva = (lista: readonly FranjaDeCapa[]) => pendienteDe(lista.map((c) => ({ x: c.x, y: (c.y0 + c.y1) / 2 }))) * largo;
  const afinado = (lista: readonly FranjaDeCapa[]) => pendienteDe(lista.map((c) => ({ x: c.x, y: c.y1 - c.y0 }))) * largo;
  // Si el armado deja casi vacío el tramo, no tiene pendiente que comparar y se mide como plano.
  const armados = par.flatMap(({ g }) => (g ? [g] : []));
  const hayTramo = armados.length >= MINIMO_FRANJAS_TRAMO;
  const derivaFoto = deriva(par.map((p) => p.f)), afinadoFoto = afinado(par.map((p) => p.f));
  const derivaArmado = hayTramo ? deriva(armados) : 0, afinadoArmado = hayTramo ? afinado(armados) : 0;
  return { derivaFoto: r3(derivaFoto), derivaArmado: r3(derivaArmado), afinadoFoto: r3(afinadoFoto), afinadoArmado: r3(afinadoArmado), error: r3((Math.abs(derivaArmado - derivaFoto) + Math.abs(afinadoArmado - afinadoFoto)) / 2) };
}

// ----------------------------------------------------------------------------------------------------------
// Zonas de color
// ----------------------------------------------------------------------------------------------------------

const CELDAS_ZONA = 5;
/** Una celda cuenta con al menos estos globos de color conocido en la foto. */
const MINIMO_POR_CELDA = 2;

/** La familia de color con que se comparan las zonas: solo los matices que el ojo confunde (beige / nude, azul / azul marino) van juntos; rosa, fucsia, rojo y vino son familias distintas. */
export const FAMILIA_DE_COLOR: Readonly<Record<string, string>> = {
  blanco: "blanco", beige: "arena", nude: "arena", cafe: "arena", rosa: "rosa", fucsia: "fucsia", rojo: "rojo", vino: "vino", naranja: "naranja",
  plateado: "plata", gris: "plata", dorado: "dorado", amarillo: "dorado", verde: "verde", azul: "azul", "azul marino": "azul", morado: "morado", lila: "morado", negro: "negro",
};

function celdasDeColor(discos: readonly Disco[], caja: Caja): Array<Map<string, number>> {
  const celdas = Array.from({ length: CELDAS_ZONA * CELDAS_ZONA }, () => new Map<string, number>());
  const ancho = (caja.x1 - caja.x0) / CELDAS_ZONA, alto = (caja.y1 - caja.y0) / CELDAS_ZONA;
  for (const d of discos) {
    const familia = d.color ? FAMILIA_DE_COLOR[d.color] : undefined;
    if (!familia) continue;
    const cx = Math.min(CELDAS_ZONA - 1, Math.max(0, Math.floor((d.x - caja.x0) / ancho))), cy = Math.min(CELDAS_ZONA - 1, Math.max(0, Math.floor((d.y - caja.y0) / alto)));
    const celda = celdas[cy * CELDAS_ZONA + cx]!;
    celda.set(familia, (celda.get(familia) ?? 0) + 1);
  }
  return celdas;
}

const totalDe = (m: ReadonlyMap<string, number>) => [...m.values()].reduce((s, n) => s + n, 0);

/**
 * Cuánto se aparta la distribución de colores por zonas de lo armado de la de la foto: de 0 (cada zona con los mismos colores) a 1
 * (zonas de colores distintos). Es la distancia de variación total entre los repartos de cada celda de una malla sobre la caja
 * de la foto, ponderada por los globos de color conocido de la foto en la celda. Una celda de la foto que el armado deja sin
 * color vale 1. `null` si la foto no trae colores.
 */
export function errorDeZonasDeColor(foto: readonly Disco[], armado: readonly Disco[], caja: Caja): number | null {
  const a = celdasDeColor(foto, caja), b = celdasDeColor(armado, caja);
  let suma = 0, peso = 0;
  a.forEach((celdaFoto, i) => {
    const nFoto = totalDe(celdaFoto);
    if (nFoto < MINIMO_POR_CELDA) return;
    const nArmado = totalDe(b[i]!);
    const familias = new Set([...celdaFoto.keys(), ...b[i]!.keys()]);
    const distancia = nArmado ? [...familias].reduce((s, f) => s + Math.abs((celdaFoto.get(f) ?? 0) / nFoto - (b[i]!.get(f) ?? 0) / nArmado), 0) / 2 : 1;
    suma += distancia * nFoto;
    peso += nFoto;
  });
  return peso ? r3(suma / peso) : null;
}
