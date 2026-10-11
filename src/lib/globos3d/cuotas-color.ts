import type { PaletaConOrigen } from "./colores-lectura";
import { conNotaSiFalla } from "./decoracion-segura";
import { colorDeCadaGlobo, type ColorOrganico, type OpcionesOrganico } from "./organico";
import { editar, opcionesDe, type Organico } from "./organico-ajustes";

/**
 * **Una sola fuente para el reparto de colores de una pieza leída**: lo que dice la lectura (`colores[].peso`, medido con los globos detectados) es lo que
 * lleva lo armado. La paleta que compila `colores-lectura.ts` suma al reparto de la pieza el de cada escalón de tamaño, el color dominante de cada tramo (que
 * pesa cinco veces el resto) y los globos fijos de los grandes: cada uno cuenta aparte y se apilan (el dorado leído al 36 % salía al 59 %: los tramos dorados
 * se sumaban al reparto de toda la guirnalda y los colores que la detección no contó en un escalón perdían su parte).
 *
 * Aquí, sin tocar el empaque ni el sitio de ningún globo, se arma la pieza, se cuenta cuánto es de cada color leído y se corrige el peso de las entradas de
 * los colores que se apartan hasta que cada color quede cerca de su parte: primero las del reparto de la pieza y de los escalones (el trecho dominado por un
 * color sigue dominado por él) y, si con eso no alcanza, también las de los tramos. Los fijos cuentan en su color (su código no cambia). Un color que un formato
 * no fabrica no se puede llevar más allá de lo que da: se toma la mejor vuelta. Determinista, y lo que ya cuadra (a menos de 4 puntos) no se toca.
 */

/** Solo se corrige si algún color se aparta más que esto (fracción del total): lo que ya cuadra queda como salió. */
const DESVIO_QUE_SE_CORRIGE = 0.04;
/** Se deja de corregir cuando el peor color queda a esto de su parte. */
const DESVIO_ACEPTADO = 0.015;
const VUELTAS_MAXIMAS = 8;
const FACTOR_MINIMO = 0.4;
const FACTOR_MAXIMO = 2.5;
/** Un color que no salió en nada se corrige como si tuviera esta parte (si no, el cociente se dispara). */
const PARTE_MINIMA = 0.01;

/** La paleta con lo que se midió de lo armado con ella: la parte (0 a 1) de cada grupo de color leído. */
type Medida = { colores: ColorOrganico[]; partes: number[] };

/** La parte de cada grupo de color leído en lo armado con esta paleta. */
function medir(opciones: OpcionesOrganico, colores: ColorOrganico[], origen: readonly number[], grupos: number): Medida {
  const porGlobo = colorDeCadaGlobo({ ...opciones, colores });
  const cuenta = Array.from({ length: grupos }, () => 0);
  let total = 0;
  for (const k of porGlobo) if (k !== null && origen[k] !== undefined) { cuenta[origen[k]!]!++; total++; }
  return { colores, partes: cuenta.map((n) => (total ? n / total : 0)) };
}

/** Cuánto se aparta el peor color de su parte. */
const desvioDe = (partes: readonly number[], meta: readonly number[]) => Math.max(0, ...meta.map((o, g) => (o > 0 ? Math.abs(partes[g]! - o) : 0)));

/** La parte leída de cada color repartida entre los que sí salen en lo armado (los `fuera` no se persiguen: su parte pasa a los demás). */
const metaSin = (objetivo: readonly number[], fuera: ReadonlySet<number>) => {
  const suma = objetivo.reduce((s, o, g) => s + (fuera.has(g) ? 0 : o), 0) || 1;
  return objetivo.map((o, g) => (fuera.has(g) ? 0 : o / suma));
};

/**
 * Los mismos colores con el peso de cada entrada multiplicado por el factor de su grupo, sin cambiar la suma de las que se mueven (enteros, al menos 1). Con
 * `soloBase` las entradas de un tramo (`franjas`) no se tocan: el color dominante de un trecho sigue dominándolo, y lo que sobra o falta se corrige en el resto.
 */
function reponderar(colores: readonly ColorOrganico[], origen: readonly number[], factor: readonly number[], soloBase: boolean): ColorOrganico[] {
  const mueve = (c: ColorOrganico) => !soloBase || !c.franjas?.length;
  const antes = colores.reduce((s, c) => s + (mueve(c) ? c.peso : 0), 0);
  const crudos = colores.map((c, k) => (mueve(c) ? c.peso * factor[origen[k]!]! : c.peso));
  const escala = antes / (crudos.reduce((s, x, k) => s + (mueve(colores[k]!) ? x : 0), 0) || 1);
  return colores.map((c, k) => (mueve(c) ? { ...c, peso: Math.max(1, Math.round(crudos[k]! * escala)) } : c));
}

/**
 * La paleta corregida, o la misma si ya cuadraba. `antes` y `despues` son lo que se midió (la parte de cada grupo de color leído) y `meta` la parte que se
 * persigue: la leída, repartida entre los colores que salen en lo armado (uno al que se le subió el peso y sigue sin salir en nada —sus entradas son de
 * formatos que la pieza no lleva— no se persigue: su parte pasa a los demás, y con él en la cuenta ninguna vuelta mejoraba al peor color).
 */
function calibrarCuotas(opciones: OpcionesOrganico, { paleta, origen, objetivo }: PaletaConOrigen): { colores: ColorOrganico[]; antes: number[]; despues: number[]; meta: number[] } {
  const fuera = new Set<number>();
  let meta = metaSin(objetivo, fuera);
  const antes = medir(opciones, paleta, origen, objetivo.length);
  if (desvioDe(antes.partes, meta) <= DESVIO_QUE_SE_CORRIGE) return { colores: paleta, antes: antes.partes, despues: antes.partes, meta };
  let mejor = antes;
  // Primero solo el resto de la paleta (los tramos conservan su color dominante); si no alcanza, también los tramos.
  for (const soloBase of [true, false]) {
    let actual = mejor;
    for (let vuelta = 0; vuelta < VUELTAS_MAXIMAS && desvioDe(mejor.partes, meta) > DESVIO_ACEPTADO; vuelta++) {
      const factor = meta.map((o, g) => (o > 0 ? Math.min(FACTOR_MAXIMO, Math.max(FACTOR_MINIMO, o / Math.max(PARTE_MINIMA, actual.partes[g]!))) : 1));
      const siguiente = medir(opciones, reponderar(actual.colores, origen, factor, soloBase), origen, objetivo.length);
      const sinSalir = meta.flatMap((o, g) => (o > 0 && factor[g]! > 1 && actual.partes[g] === 0 && siguiente.partes[g] === 0 ? [g] : []));
      if (sinSalir.length) { for (const g of sinSalir) fuera.add(g); meta = metaSin(objetivo, fuera); }
      actual = siguiente;
      if (desvioDe(actual.partes, meta) < desvioDe(mejor.partes, meta)) mejor = actual;
    }
  }
  return { colores: mejor.colores, antes: antes.partes, despues: mejor.partes, meta };
}

const pct = (n: number) => `${Math.round(n * 100)} %`;

/**
 * La pieza orgánica leída con su reparto de colores ajustado al de la lectura (`calibrarCuotas`) y, si hubo ajuste, la nota que lo dice (`nombre`: cómo se
 * llama cada grupo de color leído). Solo cambia la paleta: `editar` rehace la pieza por su trazo con los mismos parámetros y el mismo empaque.
 */
export function conLasCuotasDeLaLectura(pieza: Organico, paleta: PaletaConOrigen, nombre: (grupo: number) => string): { pieza: Organico; nota: string | null } {
  const r = calibrarCuotas(opcionesDe(pieza), paleta);
  if (r.colores === paleta.paleta) return { pieza, nota: null };
  const detalle = r.meta.flatMap((o, g) => (o > 0 ? [`${nombre(g)} ${pct(r.antes[g]!)} → ${pct(r.despues[g]!)} (leído ${pct(o)})`] : [])).join(", ");
  return { pieza: editar(pieza, (t) => ({ ...t, colores: r.colores }), (o) => ({ ...o, colores: r.colores })), nota: `Los colores de lo armado se ajustaron al reparto de la lectura: ${detalle}.` };
}

/**
 * `conLasCuotasDeLaLectura` que no tira la pieza si falla: el ajuste de colores es un retoque de una pieza ya armada, así que si lanza, la pieza queda como salió y
 * se dice (una nota y un «no se armó» del ajuste, como el follaje o el rótulo), en vez de mandar la guirnalda entera a `omitidas`. `ajustar` es lo que se intenta
 * (para probar el fallo).
 */
export function ajustarColoresSiPuede(que: string, pieza: Organico, paleta: PaletaConOrigen, nombre: (grupo: number) => string, notas: string[], omitidas: string[], ajustar: typeof conLasCuotasDeLaLectura = conLasCuotasDeLaLectura): { pieza: Organico; nota: string | null } {
  return conNotaSiFalla(que, notas, omitidas, () => ajustar(pieza, paleta, nombre), { pieza, nota: null });
}
