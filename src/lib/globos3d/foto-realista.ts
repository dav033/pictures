/**
 * La **foto realista** del taller (FLUX por `/api/render-3d-imagen`): lo que el código sabe de su tiempo, coste y límite, en un
 * solo sitio para que la ruta y la interfaz (el diálogo y la tarjeta del panel de la IA) digan lo mismo. No hay más precios que
 * estos: si algo no se sabe, no se muestra.
 */

/** Tope de fotos por hora y por instancia del servidor (la ruta lo aplica). */
export const TOPE_FOTOS_POR_HORA = 30;
/** Coste aproximado de cada foto en fal (FLUX base por /edit), en dólares. */
export const COSTE_FOTO_USD = 0.05;
/** Lo que tarda una foto. */
export const TIEMPO_FOTO = "20–40 s";

export const resumenFotoRealista = (): string =>
  `Hecha con FLUX · ${TIEMPO_FOTO} · ≈US$${COSTE_FOTO_USD.toLocaleString("es-CO", { minimumFractionDigits: 2 })} por foto (tope de ${TOPE_FOTOS_POR_HORA} por hora)`;
