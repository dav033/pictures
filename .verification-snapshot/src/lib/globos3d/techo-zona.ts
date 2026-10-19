import { formatoPorId } from "./formatos";
import { fallar, resolverColorFlexible } from "./herramientas-escena-colores";
import type { Pieza } from "./piezas";
import type { ElementoTecho, PuntoTecho } from "./techo";
import type { PatronTrenza } from "./trenza";

/**
 * **Decoración de techo para una zona** (la pista de baile, la mesa principal, una esquina o todo el salón): arma la pieza de techo
 * (`techo.ts`) del tamaño de un rectángulo, centrada en él y dentro de él. Cuatro familias:
 * - `festones`: guirnaldas en catenaria entre grandes globos de remate, alrededor del rectángulo (y, con más densidad, también por
 *   dentro). Los tramos miden a lo más `LUZ_MAXIMA_CM`; el globo de la guirnalda y el del remate crecen con la zona;
 * - `red`: cuadrícula de cuartetos pegada al techo que cubre el rectángulo (la densidad es el tamaño del globo: más densa = globo menor);
 * - `helio`: globos de helio contra el techo con su cinta, repartidos en el rectángulo;
 * - `tiras`: tiras colgantes de globos en una cuadrícula.
 * La densidad (`baja`, `media`, `alta`) es cuánto se llena la zona. Las medidas son del rectángulo; dónde cuelga (a qué altura del piso)
 * lo decide la herramienta, que conoce la sala.
 */

export const TIPOS_TECHO_ZONA = ["festones", "red", "helio", "tiras"] as const;
export type TipoTechoZona = (typeof TIPOS_TECHO_ZONA)[number];
export const DENSIDADES = ["baja", "media", "alta"] as const;
export type Densidad = (typeof DENSIDADES)[number];

/** Un rectángulo del techo (cm): su centro y sus medidas. */
export type Zona = { cx: number; cz: number; ancho: number; fondo: number };

export const COLORES_TECHO = ["blanco", "dorado"] as const;
/** Lado mínimo de la zona (cm) para cada tipo. */
export const LADO_MINIMO_CM: Readonly<Record<TipoTechoZona, number>> = { festones: 100, red: 40, helio: 40, tiras: 40 };
/** Lo más largo que cuelga un festón de punto a punto: más se vería tenso o caería hasta el piso. */
const LUZ_MAXIMA_CM = 280;
/** Cuánto cae un festón respecto a su luz: con más densidad, más holgado (más globos por tramo). */
const CAIDA_POR_LUZ: Readonly<Record<Densidad, number>> = { baja: 0.14, media: 0.18, alta: 0.26 };
const MAX_GLOBOS_HELIO = 150;
const MAX_TIRAS = 80;

const r1 = (n: number) => Math.round(n * 10) / 10;
const inflado = (id: string) => formatoPorId(id)!.infladoDecoracionCm;
const ciclo = <T,>(lista: readonly T[], n: number): T[] => Array.from({ length: n }, (_, i) => lista[i % lista.length]!);
const repartido = (desde: number, hasta: number, tramos: number): number[] => Array.from({ length: tramos + 1 }, (_, i) => r1(desde + ((hasta - desde) * i) / tramos));

function patronDe(codigos: readonly string[]): { patron: PatronTrenza; colores: string[] } {
  if (codigos.length >= 3) return { patron: "espiral", colores: ciclo(codigos, 4) };
  return codigos.length === 2 ? { patron: "dos_colores", colores: [...codigos] } : { patron: "un_color", colores: [...codigos] };
}

// ----------------------------------------------------------------------------------------------------------
// Festones
// ----------------------------------------------------------------------------------------------------------

/** Los globos de los festones según lo chica o grande que es la zona: guirnalda y remate. */
function tamanosFestones(lado: number): { guirnalda: string; remate: string } {
  if (lado < 200) return { guirnalda: "R-5", remate: "R-12" };
  return lado < 500 ? { guirnalda: "R-9", remate: "R-24" } : { guirnalda: "R-12", remate: "R-36" };
}

function festones(z: Zona, codigos: (formatos: readonly string[]) => string[], densidad: Densidad, notas: string[]): ElementoTecho[] {
  const lado = Math.min(z.ancho, z.fondo);
  const { guirnalda, remate } = tamanosFestones(lado);
  const d = inflado(guirnalda), dr = inflado(remate);
  const recorte = dr / 2 + d * 0.6;
  // Si no cabe un tramo decente entre dos remates, se renuncia al remate.
  const conRemate = lado - dr >= 2 * recorte + 2.5 * d;
  if (!conRemate) notas.push("la zona es chica para globos de remate: los festones van sin ellos");
  const rRemate = conRemate ? dr / 2 : 0, fin = conRemate ? recorte : 0;
  if (lado - 2 * rRemate < 2.5 * d + 2 * fin) fallar(`La zona (${Math.round(lado)} cm) es muy chica para festones: usa tipo red, helio o tiras.`);
  const colores = codigos([guirnalda, remate]);
  const trenza = { formatoId: guirnalda, infladoCm: d, ...patronDe(colores) };
  const hx = z.ancho / 2 - rRemate, hz = z.fondo / 2 - rRemate;
  const caida = (luz: number) => Math.round(Math.min(90, Math.max(22, luz * CAIDA_POR_LUZ[densidad])));
  const tramos = (longitud: number) => Math.max(1, Math.ceil(longitud / LUZ_MAXIMA_CM));
  const puntoEn = (x: number, zz: number): PuntoTecho => ({ xCm: r1(z.cx + x), zCm: r1(z.cz + zz) });
  const marca = conRemate ? { formatoId: remate, infladoCm: dr, codigo: colores[0]! } : null;

  // El borde: de esquina en esquina (con puntos intermedios); cada lado sin su punto final, que es el inicio del siguiente.
  const tx = tramos(2 * hx), tz = tramos(2 * hz);
  const borde: PuntoTecho[] = [
    ...repartido(-hx, hx, tx).slice(0, -1).map((x) => puntoEn(x, -hz)), ...repartido(-hz, hz, tz).slice(0, -1).map((zz) => puntoEn(hx, zz)),
    ...repartido(hx, -hx, tx).slice(0, -1).map((x) => puntoEn(x, hz)), ...repartido(hz, -hz, tz).slice(0, -1).map((zz) => puntoEn(-hx, zz)),
  ];
  const luzBorde = (2 * hx / tx + 2 * hz / tz) / 2;
  const elementos: ElementoTecho[] = [{ tipo: "festones", puntos: borde, caidaCm: caida(luzBorde), guirnalda: trenza, remate: marca }];
  // El tramo que cierra el borde: del último punto al primero, sin remate propio (ya lo tienen) y recortado para no meterse en ellos.
  const ultimo = borde.at(-1)!, primero = borde[0]!;
  const largo = Math.hypot(primero.xCm - ultimo.xCm, primero.zCm - ultimo.zCm);
  if (largo > 2 * fin + 2.5 * d) {
    const u = { x: (primero.xCm - ultimo.xCm) / largo, z: (primero.zCm - ultimo.zCm) / largo };
    const puntos = [{ xCm: r1(ultimo.xCm + u.x * fin), zCm: r1(ultimo.zCm + u.z * fin) }, { xCm: r1(primero.xCm - u.x * fin), zCm: r1(primero.zCm - u.z * fin) }];
    elementos.push({ tipo: "festones", puntos, caidaCm: caida(largo - 2 * fin), guirnalda: trenza, remate: null });
  }

  // Por dentro (densidad media y alta): guirnaldas rectas con sus remates propios, separadas del borde para no tocarlo.
  const horizontal = z.ancho >= z.fondo;
  const holgura = 2 * recorte + 2 * rRemate;
  const largoLinea = (horizontal ? 2 * hx : 2 * hz) - 2 * holgura;
  const libre = (horizontal ? hz : hx) - holgura;
  if (densidad !== "baja" && libre >= 0 && largoLinea > 2 * fin + 2.5 * d) {
    const dos = densidad === "alta" && libre >= 2 * dr;
    for (const pos of dos ? [-libre / 2, libre / 2] : [0]) {
      const n = tramos(largoLinea);
      const puntos = repartido(-largoLinea / 2, largoLinea / 2, n).map((t) => (horizontal ? puntoEn(t, pos) : puntoEn(pos, t)));
      elementos.push({ tipo: "festones", puntos, caidaCm: caida(largoLinea / n), guirnalda: trenza, remate: marca });
    }
  }
  return elementos;
}

// ----------------------------------------------------------------------------------------------------------
// Red, helio, tiras
// ----------------------------------------------------------------------------------------------------------

const FORMATO_RED: Readonly<Record<Densidad, string>> = { baja: "R-18", media: "R-12", alta: "R-9" };
const SEPARACION_HELIO_CM: Readonly<Record<Densidad, number>> = { baja: 100, media: 65, alta: 45 };
const SEPARACION_TIRAS_CM: Readonly<Record<Densidad, number>> = { baja: 140, media: 90, alta: 60 };

function red(z: Zona, codigos: (formatos: readonly string[]) => string[], densidad: Densidad): ElementoTecho[] {
  const formato = FORMATO_RED[densidad], d = inflado(formato);
  const colores = codigos([formato]);
  // Cada cuarteto sobresale 1,14·d de su centro: la cuadrícula se achica para que el borde quede dentro de la zona.
  const margen = 2.3 * d;
  return [{ tipo: "red", tecnica: "racimos", anchoCm: Math.max(0, z.ancho - margen), fondoCm: Math.max(0, z.fondo - margen), globo: { formatoId: formato, infladoCm: d }, colores, patron: colores.length > 1 ? "damero" : "un_color", centro: { xCm: r1(z.cx), zCm: r1(z.cz) } }];
}

/** Puntos a `sep` cm dentro del rectángulo reducido `margen`; con `alternar`, las filas impares van corridas media separación. */
function cuadricula(z: Zona, sep: number, margen: number, alternar: boolean): PuntoTecho[] {
  const ancho = Math.max(0, z.ancho - 2 * margen), fondo = Math.max(0, z.fondo - 2 * margen);
  const columnas = Math.floor(ancho / sep) + 1, filas = Math.floor(fondo / sep) + 1;
  const salida: PuntoTecho[] = [];
  for (let j = 0; j < filas; j++) {
    // Una columna menos en las corridas: centradas, quedan a media separación de las de arriba y abajo.
    const n = alternar && j % 2 === 1 && columnas > 1 ? columnas - 1 : columnas;
    for (let i = 0; i < n; i++) salida.push({ xCm: r1(z.cx + (i - (n - 1) / 2) * sep), zCm: r1(z.cz + (j - (filas - 1) / 2) * sep) });
  }
  return salida;
}

function helio(z: Zona, codigos: (formatos: readonly string[]) => string[], densidad: Densidad, notas: string[]): ElementoTecho[] {
  const formato = "R-12", d = 28;
  let sep = SEPARACION_HELIO_CM[densidad];
  let puntos = cuadricula(z, sep, d / 2, true);
  while (puntos.length > MAX_GLOBOS_HELIO) { sep = Math.round(sep * 1.15); puntos = cuadricula(z, sep, d / 2, true); }
  if (sep !== SEPARACION_HELIO_CM[densidad]) notas.push(`son demasiados globos de helio para esa zona: los separé a ${sep} cm (máximo ${MAX_GLOBOS_HELIO})`);
  return [{ tipo: "helio", puntos, globo: { formatoId: formato, infladoCm: d }, codigos: codigos([formato]), cintaCm: 50, cintaHex: "#f2f2f2" }];
}

function tiras(z: Zona, codigos: (formatos: readonly string[]) => string[], densidad: Densidad, notas: string[]): ElementoTecho[] {
  let sep = SEPARACION_TIRAS_CM[densidad];
  let puntos = cuadricula(z, sep, 12, false);
  while (puntos.length > MAX_TIRAS) { sep = Math.round(sep * 1.15); puntos = cuadricula(z, sep, 12, false); }
  if (sep !== SEPARACION_TIRAS_CM[densidad]) notas.push(`son demasiadas tiras para esa zona: las separé a ${sep} cm (máximo ${MAX_TIRAS})`);
  const colores = codigos(["R-5", "R-9"]);
  return puntos.map((punto, k): ElementoTecho => ({
    tipo: "tira", punto, hiloCm: 20 + 25 * (k % 2),
    globos: [{ formatoId: "R-5", infladoCm: inflado("R-5"), codigo: colores[k % colores.length]!, cantidad: 2 }, { formatoId: "R-9", infladoCm: inflado("R-9"), codigo: colores[(k + 1) % colores.length]!, cantidad: 1 }, { formatoId: "R-5", infladoCm: inflado("R-5"), codigo: colores[k % colores.length]!, cantidad: 2 }],
  }));
}

/** La pieza de techo de este tipo para la zona, con los colores pedidos (nombres o códigos) resueltos en los formatos que usa. */
export function techoParaZona(p: { tipo: TipoTechoZona; zona: Zona; colores?: readonly string[]; densidad?: Densidad }, notas: string[]): Pieza {
  const nombres = p.colores?.length ? p.colores : COLORES_TECHO;
  const codigos = (formatos: readonly string[]) => nombres.map((c) => resolverColorFlexible(c, formatos, notas));
  const densidad = p.densidad ?? "media";
  if (p.zona.ancho < LADO_MINIMO_CM[p.tipo] || p.zona.fondo < LADO_MINIMO_CM[p.tipo]) fallar(`La zona mide ${Math.round(p.zona.ancho)}×${Math.round(p.zona.fondo)} cm: para ${p.tipo} el lado menor debe ser de al menos ${LADO_MINIMO_CM[p.tipo]} cm.`);
  switch (p.tipo) {
    case "festones": return { tipo: "techo", techo: { elementos: festones(p.zona, codigos, densidad, notas) } };
    case "red": return { tipo: "techo", techo: { elementos: red(p.zona, codigos, densidad) } };
    case "helio": return { tipo: "techo", techo: { elementos: helio(p.zona, codigos, densidad, notas) } };
    case "tiras": return { tipo: "techo", techo: { elementos: tiras(p.zona, codigos, densidad, notas) } };
  }
}
