/** Máximo de piezas de una escena (las de la biblioteca traen varias). Aparte de herramientas-escena.ts para que las herramientas que arman varias piezas lo lean sin importarse en círculo. */
export const MAX_NODOS = 150;

/** Medidas máximas de la sala (cm): un salón de eventos de hasta 30 × 30 m y 10 m de alto. */
export const SALA_MAXIMA_CM = { ancho: 3000, fondo: 3000, alto: 1000 } as const;
