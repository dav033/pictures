import type { CapaHoja } from "./hoja-armado-capas";
import { anexosDeFila, marcasDeLinea, type FilaCompacta, type LineaContenido } from "./hoja-armado-compacta";
import type { TramoHoja } from "./hoja-armado-tramos";
import type { CuartetoHoja } from "./hoja-armado-trenza";
import { textoFlores } from "./hoja-armado-anexos";
import { textoNombres, textoSecuencia } from "./hoja-armado-texto";
import type { EstructuraHoja, HojaArmado, LineaLista, PaginaHoja, TrozoHoja } from "./hoja-armado-tipos";

/**
 * Cómo se reparte la hoja en páginas. Cada pieza se parte en elementos (una capa, un tramo, un bloque de cuartetos, una fila
 * de la tabla) con una altura estimada en milímetros a partir de lo que lleva; las estructuras pequeñas comparten página y
 * las grandes pasan a la siguiente cuando no caben. La estimación cuenta lo que ocupa cada elemento, los espacios entre
 * ellos y el pie de página, y se calibró contra el diseño real del navegador (Carta con márgenes de 12 mm: 255 mm útiles;
 * A4: 273 mm). La impresión corta por sí sola lo que no se parte (`break-inside-avoid`) y cada página empieza en hoja nueva.
 */

/**
 * Alto que puede llenar una página (mm): el área útil de Carta (255 mm) menos lo que la estimación se queda corta y un margen
 * de seguridad. Medido en Chrome con Geist (`scripts/ops/medir-hoja-armado.ts`, 2026-10-10): la estimación se queda corta
 * hasta 18 mm en una página (tablas de tramos de una malla); con 226 quedan unos 11 mm de holgura en el peor caso.
 */
export const PAGINA_MM = 226;
/** Título, resumen y avisos de la hoja, con el espacio que los separa de la primera página. */
const ALTO_PORTADA_MM = 34;
const LINEA_MM = 5.3;
const LINEA_CHICA_MM = 4.3;
/** El título de una pieza que sigue de la página anterior, con el espacio que lo separa de lo que sigue. */
const ALTO_CONTINUA_MM = 14;
const ALTO_ENCABEZADO_TABLA_MM = 9;
const ALTO_TITULO_TABLA_MM = 21;
const ALTO_CIERRE_MM = 10;
/** El `gap-5` entre los trozos de una página y el que la separa de «Página n de N». */
const SEPARACION_MM = 5.3;
/** La línea «Página n de N», al pie de cada página. */
const ALTO_PIE_MM = 4;
/** El esquema de una capa mide 38 mm, más su pie de 3 líneas chicas y el espacio entre capas. */
const ALTO_CAPA_MIN_MM = 58;

/** Cuántas líneas ocupa un texto de `caracteres` en una columna de `porLinea` caracteres. */
const lineas = (caracteres: number, porLinea: number) => Math.max(1, Math.ceil(caracteres / porLinea));

/** Las líneas chicas de las marcas (helio, impresos, confeti) en una columna de `porLinea` caracteres; 0 si no hay. */
const lineasDeMarcas = (marcas: readonly string[], porLinea: number) => (marcas.length ? lineas(marcas.join(" · ").length, porLinea) : 0);

/** Una capa: el esquema a la izquierda y, a su lado, el texto: título, giro, orden de color, colores, marcas y bomba. */
const altoDeCapa = (c: CapaHoja): number =>
  Math.max(ALTO_CAPA_MIN_MM, 28 + LINEA_MM * c.colores.length + LINEA_CHICA_MM * (c.filasBomba.length + (c.giroGrados === null ? 0 : 1) + lineas(textoSecuencia(c.secuencia).length, 70) + lineasDeMarcas(c.marcas, 70)) + 6) + 3;

/** Un tramo: una fila de la tabla; manda la más alta entre su título (en una columna de 38 mm), los colores con sus marcas y los tamaños. */
const altoDeTramo = (t: TramoHoja): number =>
  3.5 + Math.max(LINEA_MM * t.colores.length + LINEA_CHICA_MM * lineasDeMarcas(t.marcas, 30), LINEA_CHICA_MM * t.tamanos.length, LINEA_MM * lineas(t.etiqueta.length, 17) + LINEA_CHICA_MM);

/** Un bloque de cuartetos: una fila de la tabla; el orden de color y sus marcas pueden partirse en varias líneas. */
const altoDeCuarteto = (c: CuartetoHoja): number => 3 + LINEA_MM * lineas(textoSecuencia(c.secuencia).length, 38) + LINEA_CHICA_MM * lineasDeMarcas(c.marcas, 45);

/** Una línea de lo que lleva cada copia, con sus marcas: «2 × R-12 Fashion Rojo a 28 cm · de helio · impreso …». */
const caracteresDeLinea = (l: LineaContenido) => 30 + l.nombreColor.length + marcasDeLinea(l).reduce((s, m) => s + m.length + 3, 0);

/**
 * Una fila de la tabla compacta (de anchos fijos, ver `HojaArmadoCompacta`): los nombres en su columna de 50 mm y lo que lleva
 * cada copia (con sus flores o relleno) en la ancha. Caracteres por línea medidos con Geist en A4, el papel más angosto.
 */
const altoDeFila = (f: FilaCompacta): number => {
  const contenido = LINEA_MM * f.contenido.reduce((s, l) => s + lineas(caracteresDeLinea(l), 42), 0) + LINEA_CHICA_MM * anexosDeFila(f).reduce((s, a) => s + lineas(a.length, 55), 0);
  return 3 + Math.max(LINEA_MM * lineas(textoNombres(f.nombres).length, 22), contenido);
};

const altoDeLinea = LINEA_MM + 1;

type Elemento = { alto: number; capa?: CapaHoja; tramo?: TramoHoja; cuarteto?: CuartetoHoja };

const elementosDe = (e: EstructuraHoja): Elemento[] => [
  ...e.capas.map((capa) => ({ alto: altoDeCapa(capa), capa })),
  ...e.tramos.map((tramo) => ({ alto: altoDeTramo(tramo), tramo })),
  ...e.cuartetos.map((cuarteto) => ({ alto: altoDeCuarteto(cuarteto), cuarteto })),
];

const conTabla = (e: EstructuraHoja) => (e.cuartetos.length > 0 || e.tramos.length > 0 ? ALTO_ENCABEZADO_TABLA_MM : 0);

/** Lo que ocupa el resumen de una pieza: el título y cada nota, lo que va aparte, los tubos, los avisos y la bomba. */
function altoDelResumen(e: EstructuraHoja): number {
  let mm = 18 + LINEA_CHICA_MM * (1 + e.filasBomba.length) + (e.unidades > 1 ? LINEA_CHICA_MM : 0);
  if (e.modulo) mm += LINEA_MM + 2;
  if (e.patron) mm += LINEA_MM * lineas(e.patron.descripcion.length + 20, 95) + 2;
  if (e.sentido) mm += LINEA_MM * lineas(e.sentido.length, 90) + 2;
  if (e.nota) mm += LINEA_CHICA_MM * lineas(e.nota.length, 110) + 2;
  if (e.aparte.length) mm += LINEA_MM + LINEA_CHICA_MM * e.aparte.length + 2;
  if (e.tubos.length) mm += LINEA_MM + LINEA_CHICA_MM * e.tubos.length + 2;
  if (e.flores.length) mm += LINEA_MM * lineas(textoFlores(e.flores).length + 60, 90) + 2;
  if (e.relleno) mm += LINEA_MM * lineas(e.relleno.length + 45, 90) + 2;
  if (e.avisos.length) mm += LINEA_CHICA_MM * lineas(e.avisos.join(" ").length, 110) + 2;
  return mm + conTabla(e);
}

const cabeceraDeEstructura = (e: EstructuraHoja, primero: boolean) => (primero ? altoDelResumen(e) : ALTO_CONTINUA_MM + conTabla(e));
const cabeceraDeCompacta = (primero: boolean) => (primero ? ALTO_TITULO_TABLA_MM : ALTO_CONTINUA_MM) + ALTO_ENCABEZADO_TABLA_MM;
const cabeceraDeLista = (primero: boolean) => (primero ? ALTO_TITULO_TABLA_MM : ALTO_CONTINUA_MM);
const altoDeOtras = (nombres: readonly string[]) => LINEA_MM * lineas(nombres.join(", ").length + 50, 100);

/** Lo que ocupa un trozo (mm): su cabecera y todos sus elementos. */
export function altoDeTrozo(t: TrozoHoja): number {
  switch (t.tipo) {
    case "estructura": return cabeceraDeEstructura(t.estructura, t.primero) + t.capas.reduce((s, c) => s + altoDeCapa(c), 0) + t.tramos.reduce((s, x) => s + altoDeTramo(x), 0) + t.cuartetos.reduce((s, c) => s + altoDeCuarteto(c), 0);
    case "compacta": return cabeceraDeCompacta(t.primero) + t.filas.reduce((s, f) => s + altoDeFila(f), 0);
    case "otras": return altoDeOtras(t.nombres);
    case "lista": return cabeceraDeLista(t.primero) + t.lineas.length * altoDeLinea + (t.ultimo ? ALTO_CIERRE_MM : 0);
  }
}

/** Lo que ocupa una página (mm): la portada si es la primera, cada trozo con su espacio y el pie. */
export const altoDePagina = (p: PaginaHoja): number => (p.numero === 1 ? ALTO_PORTADA_MM : 0) + p.trozos.reduce((s, t) => s + altoDeTrozo(t) + SEPARACION_MM, 0) + ALTO_PIE_MM;

class Paginador {
  readonly paginas: TrozoHoja[][] = [[]];
  /** La primera página ya trae el encabezado de la hoja. */
  private usado = ALTO_PORTADA_MM;

  get libre(): number { return PAGINA_MM - ALTO_PIE_MM - this.usado; }
  get vacia(): boolean { return this.paginas[this.paginas.length - 1]!.length === 0; }

  nueva(): void {
    if (this.vacia) return;
    this.paginas.push([]);
    this.usado = 0;
  }

  poner(trozo: TrozoHoja): void {
    this.paginas[this.paginas.length - 1]!.push(trozo);
    this.usado += altoDeTrozo(trozo) + SEPARACION_MM;
  }
}

/** Reparte una lista de elementos en páginas: el primer trozo lleva el resumen y debe caber con al menos un elemento. */
function repartir<T extends { alto: number }>(elementos: readonly T[], cabecera: (primero: boolean) => number, p: Paginador, trozo: (primero: boolean, tomados: T[]) => TrozoHoja): void {
  let i = 0;
  let primero = true;
  while (i < elementos.length) {
    const alto0 = cabecera(primero);
    if (alto0 + elementos[i]!.alto + SEPARACION_MM > p.libre) p.nueva();
    const tomados: T[] = [];
    let alto = alto0;
    while (i < elementos.length && (tomados.length === 0 || alto + elementos[i]!.alto + SEPARACION_MM <= p.libre)) {
      tomados.push(elementos[i]!);
      alto += elementos[i]!.alto;
      i += 1;
    }
    p.poner(trozo(primero, tomados));
    primero = false;
    if (i < elementos.length) p.nueva();
  }
}

function ponerEstructura(e: EstructuraHoja, p: Paginador): void {
  repartir(elementosDe(e), (primero) => cabeceraDeEstructura(e, primero), p, (primero, tomados) => ({
    tipo: "estructura", estructura: e, primero,
    capas: tomados.flatMap((x) => (x.capa ? [x.capa] : [])),
    tramos: tomados.flatMap((x) => (x.tramo ? [x.tramo] : [])),
    cuartetos: tomados.flatMap((x) => (x.cuarteto ? [x.cuarteto] : [])),
  }));
}

function ponerCompactas(filas: readonly FilaCompacta[], p: Paginador): void {
  repartir(filas.map((fila) => ({ alto: altoDeFila(fila), fila })), cabeceraDeCompacta, p, (primero, tomados) => ({ tipo: "compacta", primero, filas: tomados.map((x) => x.fila) }));
}

/**
 * La lista de globos y tubitos va siempre en página nueva, partida cada vez que se llena. La línea de la bomba total va con
 * la última línea de la lista (nunca sola en una página); una lista vacía solo lleva esa línea.
 */
function ponerLista(lineasLista: readonly LineaLista[], p: Paginador): void {
  p.nueva();
  const total = lineasLista.length;
  const elementos: Array<{ alto: number; linea?: LineaLista }> = total
    ? lineasLista.map((linea, i) => ({ alto: altoDeLinea + (i === total - 1 ? ALTO_CIERRE_MM : 0), linea }))
    : [{ alto: ALTO_CIERRE_MM }];
  let hechas = 0;
  repartir(elementos, cabeceraDeLista, p, (primero, tomados) => {
    const propias = tomados.flatMap((x) => (x.linea ? [x.linea] : []));
    hechas += propias.length;
    return { tipo: "lista", primero, ultimo: hechas >= total, lineas: propias };
  });
}

/** Las páginas de la hoja, en orden: las estructuras, la tabla de piezas pequeñas, las piezas que solo se nombran y la lista de compra. */
export function paginasDeHoja(hoja: HojaArmado): PaginaHoja[] {
  const p = new Paginador();
  for (const e of hoja.estructuras) ponerEstructura(e, p);
  if (hoja.compactas.length) ponerCompactas(hoja.compactas, p);
  if (hoja.otrasPiezas.length) {
    const alto = altoDeOtras(hoja.otrasPiezas);
    if (alto + SEPARACION_MM > p.libre) p.nueva();
    p.poner({ tipo: "otras", nombres: hoja.otrasPiezas });
  }
  ponerLista(hoja.lista, p);
  return p.paginas.filter((trozos) => trozos.length > 0).map((trozos, i) => ({ numero: i + 1, trozos }));
}
