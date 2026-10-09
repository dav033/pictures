/**
 * Los topes de una escena que comparten las herramientas de la IA y el esquema de la API. Aparte de `herramientas-escena.ts` para que
 * las herramientas que viven fuera de él (mesas y sillas, mobiliario, salón…) los lean sin importarlo en círculo.
 */

/** Máximo de piezas (nodos) de una escena (las de la biblioteca traen varias; un grupo de sillas es UNA sola pieza). */
export const MAX_NODOS = 150;

/** Medidas máximas de la sala (cm): un salón de eventos de hasta 30 × 30 m y 10 m de alto. */
export const SALA_MAXIMA_CM = { ancho: 3000, fondo: 3000, alto: 1000 } as const;
