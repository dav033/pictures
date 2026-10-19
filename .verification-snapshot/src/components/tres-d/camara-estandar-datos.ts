/**
 * Los números de la cámara estándar (`camara-estandar.ts`), aparte de three.js: los lee también quien necesita saber QUÉ
 * cámara se usó sin cargar el motor (la huella del pipeline de renders del estudio de módulos).
 */
export type VistaEstandar = "frente" | "tres-cuartos";

/** Giro alrededor de la vertical y elevación (grados) de cada vista. */
export const ANGULOS_ESTANDAR: Readonly<Record<VistaEstandar, { giro: number; elevacion: number }>> = {
  frente: { giro: 0, elevacion: 12 },
  "tres-cuartos": { giro: 35, elevacion: 15 },
};

/** Cuánto del cuadro ocupa, como mucho, lo dibujado (0,74 de la caja; lo dibujado ocupa ~70 %). */
export const OCUPACION_ESTANDAR = 0.74;
export const FOV_GRADOS = 35;
export const ITERACIONES = 10;
/** La cámara nunca queda más cerca que esto (en radios de la caja): una pieza larga que apunta a la cámara no la atraviesa. */
export const DISTANCIA_MINIMA_RADIOS = 1.6;
