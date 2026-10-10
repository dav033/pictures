import type { PiezaEspec } from "./espec-cliente-v1";

/**
 * **Lo que el motor 3D puede y no puede representar hoy.** Una sola tabla: la usan `v1.ts` (para no armar lo que no
 * existe y avisar) y el informe de las 28 ideas. Cuando una pieza es `fallback`, quien llama decide: este plan se
 * resuelve con el motor de Python y se registra el motivo. Nada se inventa en silencio.
 *
 * - `representable`: un constructor la arma tal cual.
 * - `aproximada`: se arma con un constructor cercano; la diferencia se dice al cliente.
 * - `declarada`: la lista del catálogo manda y no se dibuja (`PiezaEspec.declarada`).
 * - `fallback`: ningún constructor la arma.
 */
export type EstadoRepresentacion = "representable" | "aproximada" | "declarada" | "fallback";
export type Representacion = { estado: EstadoRepresentacion; motivo?: string };

/** Los patrones de trenza clásica llevan hasta cuatro colores; con más se arman en bandas (`salvavidas`). */
export const MAX_COLORES_TRENZA = 4;

const SIN_CONSTRUCTOR: Readonly<Record<string, string>> = {
  figura: "No hay un constructor genérico de figuras: solo existen las digitalizadas una a una.",
  centro_mesa: "El constructor de centros de mesa todavía no está en el motor.",
  pared_organica: "No hay un constructor de pared orgánica con racimos irregulares.",
  pared_no_densa: "No hay un constructor de pared ligera que deje ver el fondo.",
};

/** Los avisos que la escena dice de una pieza: el texto exacto, para que la matriz los compare sin adivinar. */
export const avisoAproximada = (nombre: string, motivo: string): string => `«${nombre}»: ${motivo}`;
export const avisoDeclarada = (nombre: string): string => `«${nombre}» se cuenta de la lista del catálogo y no se dibuja.`;
export const avisoTrenzaOrganica = (nombre: string, colores: number): string =>
  `«${nombre}»: la trenza clásica no alcanza para sus ${colores} colores en ese tamaño; se armó orgánica, con globos de varios tamaños, para que lleve todos.`;

/** La pared de malla lleva hasta cuatro colores (rombos). */
const MAX_COLORES_PARED = 4;

const LIGERAS = new Set(["arco_no_denso", "columna_no_densa"]);
const CLASICAS_DE_TRENZA = new Set(["arco", "columna", "guirnalda"]);

export function representacionDe(pieza: PiezaEspec): Representacion {
  if (pieza.declarada) return { estado: "declarada", motivo: pieza.declarada.motivo };
  const sinConstructor = SIN_CONSTRUCTOR[pieza.oficial];
  if (sinConstructor) return { estado: "fallback", motivo: sinConstructor };
  if (pieza.oficial === "aro_circular" && pieza.forma === "parcial") return { estado: "fallback", motivo: "El aro parcial (media luna, diagonal) no existe: el motor solo arma el aro entero." };
  if (LIGERAS.has(pieza.oficial)) return { estado: "aproximada", motivo: "No hay variante ligera de cuartetos: se arma orgánica con menos globos." };
  if (pieza.oficial === "bouquet") return { estado: "aproximada", motivo: "El bouquet se arma como un ramo de helio sin variantes de base ni de peso." };
  if (CLASICAS_DE_TRENZA.has(pieza.oficial) && pieza.tamanos === "clasica" && pieza.colores.length > MAX_COLORES_TRENZA) {
    return { estado: "aproximada", motivo: `La trenza clásica lleva hasta ${MAX_COLORES_TRENZA} colores: los ${pieza.colores.length} van en bandas de dos cuartetos y, si el tamaño no alcanza para tantas bandas, se arma orgánica.` };
  }
  if (pieza.oficial === "pared_densa" && pieza.colores.length > MAX_COLORES_PARED) {
    return { estado: "aproximada", motivo: `La pared de malla lleva hasta ${MAX_COLORES_PARED} colores: se usan los ${MAX_COLORES_PARED} primeros.` };
  }
  return { estado: "representable" };
}
