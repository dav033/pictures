import type { CajaRelativa, MuestraPixeles } from "@/lib/plan/dominancia-color";

/**
 * Balance de blancos de una foto antes de medir sus colores (2026-10-06).
 *
 * Una fiesta con luz de color tiñe todo: en CASE-002 la luz lila hacía que una plata clara se midiera como el
 * 609 Rosado pastel en la zona iluminada y como el 081 Fashion Gris en la sombra, y que el rosa pastel saliera
 * fuera de su referencia. El cruce contra las 90 referencias Sempertex (`referencia-sempertex.ts`) es correcto,
 * pero compara contra globos fotografiados con luz blanca: la foto tiene que estar en esa luz.
 *
 * **La referencia es lo que el analizador vio blanco** (una cortina, una pared, una mesa): no se adivina el
 * neutro por estadística, que en una foto llena de globos de color fallaría. Si nada se vio blanco, o lo blanco
 * no tiene un tinte medible, la foto se mide como siempre (devuelve la misma muestra).
 *
 * De esas zonas se toma el tercio más claro sin quemar (la parte de la superficie que recibe la luz) y se
 * calculan tres ganancias que la vuelven gris sin cambiar su luminosidad. Se acotan: una corrección muy fuerte
 * delata que lo «blanco» no lo era.
 *
 * Puro: sin proveedor, sin `sharp`, sin variables de entorno.
 */

export type Ganancias = readonly [number, number, number];

/** Tinte mínimo (desvío máximo de una ganancia respecto de 1) para corregir: por debajo, la foto ya es neutra. */
export const TINTE_MINIMO = 0.03;
/** Desvío máximo admitido de una ganancia: más que esto, lo «blanco» de la foto no era blanco. */
export const DESVIO_MAXIMO = 0.25;
/** Fracción más clara de los píxeles de las zonas blancas que se usa (la superficie iluminada). */
const FRACCION_CLARA = 0.3;
/** Un píxel con un canal por encima de esto está quemado y no dice nada del color de la luz. */
const QUEMADO = 250;
/** Luminosidad media mínima (0-255) de la muestra blanca: una zona oscura no sirve de blanco. */
const LUMA_MINIMA = 110;
/** Píxeles mínimos de la muestra blanca. */
const PIXELES_MINIMOS = 50;

const BLANCO = /\b(?:white|off[- ]white|ivory|snow white)\b/i;
/** Palabras que pueden acompañar a un blanco sin dejar de serlo. */
const ACOMPANA_BLANCO = /\b(?:white|off[- ]white|ivory|cream|clear|transparent|silver)\b/i;

type ElementoConColor = {
  approved: boolean;
  category: string;
  source_image_id: string;
  reference_bbox: CajaRelativa;
  appearance: { observed_colors: readonly string[] };
};

/** Las cajas de lo que el analizador vio blanco en una foto: elementos aprobados que no son globos y solo blancos. */
export function cajasBlancas(elementos: readonly ElementoConColor[], imageId: string): CajaRelativa[] {
  return elementos
    .filter((e) => e.approved && e.source_image_id === imageId && e.category !== "balloon_structure")
    .filter((e) => e.appearance.observed_colors.some((c) => BLANCO.test(c)) && e.appearance.observed_colors.every((c) => ACOMPANA_BLANCO.test(c)))
    .map((e) => e.reference_bbox);
}

/** Las ganancias que vuelven gris lo blanco de la foto, o `null` si no hay blanco fiable o no tiene tinte. */
export function gananciasDeBlancos(muestra: MuestraPixeles, cajas: readonly CajaRelativa[]): Ganancias | null {
  const pixeles: Array<[number, number, number]> = [];
  for (const caja of cajas) {
    const x0 = Math.max(0, Math.floor(caja.x * muestra.ancho));
    const x1 = Math.min(muestra.ancho, Math.ceil((caja.x + caja.width) * muestra.ancho));
    const y0 = Math.max(0, Math.floor(caja.y * muestra.alto));
    const y1 = Math.min(muestra.alto, Math.ceil((caja.y + caja.height) * muestra.alto));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = (y * muestra.ancho + x) * 3;
        pixeles.push([muestra.rgb[i]!, muestra.rgb[i + 1]!, muestra.rgb[i + 2]!]);
      }
    }
  }
  const claros = pixeles
    .sort((a, b) => b[0] + b[1] + b[2] - (a[0] + a[1] + a[2]))
    .slice(0, Math.floor(pixeles.length * FRACCION_CLARA))
    .filter((p) => Math.max(...p) < QUEMADO);
  if (claros.length < PIXELES_MINIMOS) return null;
  const media = [0, 1, 2].map((c) => claros.reduce((s, p) => s + p[c]!, 0) / claros.length) as [number, number, number];
  const gris = (media[0] + media[1] + media[2]) / 3;
  if (gris < LUMA_MINIMA || media.some((m) => m <= 0)) return null;
  const ganancias = media.map((m) => gris / m) as [number, number, number];
  const desvio = Math.max(...ganancias.map((g) => Math.abs(g - 1)));
  if (desvio < TINTE_MINIMO || desvio > DESVIO_MAXIMO) return null;
  return ganancias;
}

/** La muestra con las ganancias aplicadas (una copia; la recibida no cambia). */
export function corregirBlancos(muestra: MuestraPixeles, ganancias: Ganancias): MuestraPixeles {
  const rgb = new Uint8Array(muestra.rgb.length);
  for (let i = 0; i < muestra.rgb.length; i += 1) {
    rgb[i] = Math.min(255, Math.max(0, Math.round(muestra.rgb[i]! * ganancias[i % 3]!)));
  }
  return { ancho: muestra.ancho, alto: muestra.alto, rgb };
}

/**
 * La muestra de una foto en luz blanca si lo blanco de la foto tiene un tinte medible; si no, la misma muestra.
 * Devuelve también las ganancias aplicadas (o `null`), para dejarlas en el registro.
 */
export function equilibrarMuestra(
  muestra: MuestraPixeles,
  elementos: readonly ElementoConColor[],
  imageId: string,
): { muestra: MuestraPixeles; ganancias: Ganancias | null } {
  const ganancias = gananciasDeBlancos(muestra, cajasBlancas(elementos, imageId));
  return ganancias ? { muestra: corregirBlancos(muestra, ganancias), ganancias } : { muestra, ganancias: null };
}
