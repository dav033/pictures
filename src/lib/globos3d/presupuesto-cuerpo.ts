import { fallar } from "./herramientas-escena-colores";
import type { OpcionesOrganico } from "./organico";
import { GROSOR_CUERPO_CM } from "./trazo-organico";

/**
 * Cuánto cuerpo de globos se arma de una vez, medido por la geometría de la pieza sin armarla (`cuerpoDeOrganico`: el largo de sus
 * tramos y el diámetro parejo de su mismo volumen). Es UNA medida para toda pieza orgánica, sea cual sea su forma de guardarse: un
 * arco por medidas se mide por las opciones con que se arma (`opcionesArcoOrganico`), que son las mismas que tiene cuando pasa a
 * orgánico (más R-24, tamaños, racimos), y el trazo por las que saca de sus puntos. Así el mismo cuerpo mide lo mismo antes y
 * después de cambiar de forma, y nada lo engorda saltándose el tope.
 *
 * El tiempo de armado crece más rápido que el volumen. Con 8 M cm³ caben las piezas más grandes que ya se armaban antes del rango ancho
 * (el marco de 500 × 320 cm a 100 cm, 7,8 M; el arco de 500 × 320 a 120 cm, 6,5 M), y lo más pesado que se deja armar tarda 8–10 s.
 * Medido en el equipo del taller (15,7 GB de RAM, 2026-10-10; varía hasta un 50 % con la carga): el arco de 500 × 320 a 120 cm, 4,7 s,
 * y a 133 cm (su tope, 7,9 M), 9 s; el marco a 100 cm (su tope), 9–10 s; una guirnalda de 8 m a 115 cm (su tope), 8 s; una columna de
 * 3,2 m a 160 cm, 7 s; un trazo fino de 20 m (el largo máximo), 2 s. Antes, el arco a 160 cm tardaba 15 s.
 *
 * Un cuerpo fino y muy largo lleva miles de globos chicos aunque su volumen quepa (un trazo de 100 m tardaba 57 s): el largo (la suma
 * de sus tramos) también tiene tope. Lo más largo que arman las herramientas es el aro de 3 m (dos anillos, unos 1570 cm).
 *
 * Con el rango ancho de grosor (`GROSOR_CUERPO_CM`, 12–160 cm), estos topes valen para las rutas en que la IA de escena pide un cuerpo:
 * crear (agregar_pieza), cambiar una pieza que ya existe (cambiar_pieza), el trazo y `ajustar_tamanos` (que engruesa para que quepan
 * más globos: se acota al tope y se dice, `presupuesto-ajustes.ts`). La guiada arma con los rangos del cliente
 * (`RANGO_GROSOR_GUIADA_CM`), que con sus medidas más grandes caben en los topes (lo comprueba test-rango-grosor-cuerpo). Dos
 * excepciones, a propósito:
 * - la lectura de una foto (`compilar-lectura.ts`) arma lo que mide la foto, acotado a 20–140 cm (25–140 en columnas y montones) y sin
 *   estos topes: es una medida, no un pedido, y rechazarla perdería la pieza;
 * - el aro orgánico conserva 20–70 cm, al crearlo y al cambiarlo: su cuerpo es un anillo de R-12 sobre un relleno, y uno más grueso ya
 *   no es un aro.
 */
export const PRESUPUESTO_CUERPO_CM3 = 8_000_000;
export const LARGO_MAXIMO_CUERPO_CM = 2000;

/** Un cuerpo de globos reducido a lo que cuesta armarlo: lo largo que es y el diámetro (parejo) que tendría con su mismo volumen. */
export type Cuerpo = { largoCm: number; grosorCm: number };

type Punto = { x: number; y: number; z?: number };

/** El volumen (cm³) de un cuerpo de ese largo y de ese diámetro. */
export const volumenDeCuerpoCm3 = (largoCm: number, grosorCm: number): number => largoCm * Math.PI * (grosorCm / 2) ** 2;

/** El largo (cm) de un cuerpo cuyo eje pasa por esos puntos. */
export function largoDeRecorrido(puntos: readonly Punto[]): number {
  return puntos.slice(1).reduce((suma, q, i) => suma + Math.hypot(q.x - puntos[i]!.x, q.y - puntos[i]!.y, (q.z ?? 0) - (puntos[i]!.z ?? 0)), 0);
}

/** Varios tramos (largo y grosor medio de cada uno) como un solo cuerpo: el largo de todos y el diámetro parejo de igual volumen. */
export function cuerpoDeTramos(tramos: readonly Cuerpo[]): Cuerpo {
  const largoCm = tramos.reduce((suma, t) => suma + t.largoCm, 0);
  const volumen = tramos.reduce((suma, t) => suma + volumenDeCuerpoCm3(t.largoCm, t.grosorCm), 0);
  return { largoCm, grosorCm: largoCm > 0 ? 2 * Math.sqrt(volumen / (Math.PI * largoCm)) : 0 };
}

/**
 * El cuerpo de una pieza orgánica sin armarla: el largo de sus tramos (más un diámetro, que es lo que las puntas asoman del eje) y el
 * radio medio de cada uno.
 */
export function cuerpoDeOrganico(o: Pick<OpcionesOrganico, "tramos">): Cuerpo {
  const cuerpo = cuerpoDeTramos(o.tramos.map((t) => ({
    largoCm: largoDeRecorrido(t.recorrido),
    grosorCm: t.grosor.length ? (2 * t.grosor.reduce((suma, g) => suma + g.radioCm, 0)) / t.grosor.length : 0,
  })));
  return { ...cuerpo, largoCm: cuerpo.largoCm + cuerpo.grosorCm };
}

const cabe = (c: Cuerpo) => c.largoCm <= LARGO_MAXIMO_CUERPO_CM && volumenDeCuerpoCm3(c.largoCm, c.grosorCm) <= PRESUPUESTO_CUERPO_CM3;

/** El cuerpo de una pieza según el grosor (cm) con que se pida: la pieza se vuelve a sacar con ese grosor (su largo puede cambiar con él). */
export type MedidaPorGrosor = (grosorCm: number) => Cuerpo;

/** La medida por grosor de una pieza nueva, por los tramos con que se arma con cada grosor. */
export const medirTramos = (tramosDe: (grosorCm: number) => Pick<OpcionesOrganico, "tramos">["tramos"]): MedidaPorGrosor => (g) => cuerpoDeOrganico({ tramos: tramosDe(g) });

/** El mayor grosor entero (desde el mínimo del rango hasta `hastaCm`) con que el cuerpo cabe, buscado con la pieza misma; 0 si ni con el mínimo cabe. */
export function grosorQueCabe(medir: MedidaPorGrosor, hastaCm: number): number {
  let siCabe = GROSOR_CUERPO_CM.min - 1, noCabe = Math.floor(hastaCm);
  if (cabe(medir(noCabe))) return noCabe;
  while (noCabe - siCabe > 1) {
    const medio = Math.floor((siCabe + noCabe) / 2);
    if (cabe(medir(medio))) siCabe = medio; else noCabe = medio;
  }
  return siCabe < GROSOR_CUERPO_CM.min ? 0 : siCabe;
}

const demasiadoLargo = (c: Cuerpo) =>
  `Ese cuerpo (${Math.round(c.largoCm)} cm de largo) es demasiado largo para armarlo de una vez: hasta ${LARGO_MAXIMO_CUERPO_CM} cm. Pártelo en varias piezas o acórtalo.`;
function demasiadoGrueso(c: Cuerpo, medir: MedidaPorGrosor, grosorPedidoCm: number): string {
  const queCabe = grosorQueCabe(medir, grosorPedidoCm);
  const salida = queCabe ? `con esas medidas el grosor máximo es ${queCabe} cm (o baja el largo)` : `ni con ${GROSOR_CUERPO_CM.min} cm de grosor cabe: baja el largo`;
  return `Ese cuerpo (${Math.round(c.largoCm)} cm de largo a ${Math.round(grosorPedidoCm)} cm de grosor) es demasiado grueso o largo para armarlo de una vez: ${salida}.`;
}

/** Rechaza una pieza orgánica que no cabe en los topes de armado: demasiado larga, o con el grosor que sí cabe. */
export function comprobarCuerpo(medir: MedidaPorGrosor, grosorPedidoCm: number): void {
  const cuerpo = medir(grosorPedidoCm);
  if (cuerpo.largoCm > LARGO_MAXIMO_CUERPO_CM) fallar(demasiadoLargo(cuerpo));
  if (!cabe(cuerpo)) fallar(demasiadoGrueso(cuerpo, medir, grosorPedidoCm));
}

/** Rechaza un recorrido más largo que el tope antes de sacar nada de él (uno de miles de metros agota la memoria al muestrearlo). */
export function comprobarLargo(largoCm: number): void {
  if (largoCm > LARGO_MAXIMO_CUERPO_CM) fallar(demasiadoLargo({ largoCm, grosorCm: 0 }));
}

/**
 * Como `comprobarCuerpo` para un cambio, sobre el cuerpo que de verdad queda (`despues`); `sugerir` solo busca el grosor que cabría.
 * Lo que ya pasaba de un tope no se rechaza si el cambio no lo empeora (ni más largo ni más pesado).
 */
export function comprobarCambioDeCuerpo(antes: Cuerpo, despues: Cuerpo, sugerir: MedidaPorGrosor, grosorPedidoCm: number): void {
  if (despues.largoCm > LARGO_MAXIMO_CUERPO_CM && despues.largoCm > antes.largoCm) fallar(demasiadoLargo(despues));
  const volumen = (c: Cuerpo) => volumenDeCuerpoCm3(c.largoCm, c.grosorCm);
  if (volumen(despues) > PRESUPUESTO_CUERPO_CM3 && volumen(despues) > volumen(antes)) fallar(demasiadoGrueso(despues, sugerir, grosorPedidoCm));
}
