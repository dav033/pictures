/**
 * La **foto realista** del taller (FLUX por `/api/render-3d-imagen`): lo que el código sabe de su tiempo, coste y límite, en un
 * solo sitio para que la ruta y la interfaz (el diálogo y la tarjeta del panel de la IA) digan lo mismo. No hay más precios que
 * estos: si algo no se sabe, no se muestra.
 */

/** Tope de fotos por hora y por instancia del servidor (la ruta lo aplica). */
export const TOPE_FOTOS_POR_HORA = 30;
/** Coste aproximado de cada foto en fal, en dólares: FLUX.1 Kontext max (0,08) con el lugar del visor; por /edit son 0,05. */
export const COSTE_FOTO_USD = 0.08;
/** Lo que tarda una foto. */
export const TIEMPO_FOTO = "15–40 s";

export const resumenFotoRealista = (): string =>
  `Hecha con FLUX · ${TIEMPO_FOTO} · ≈US$${COSTE_FOTO_USD.toLocaleString("es-CO", { minimumFractionDigits: 2 })} por foto (tope de ${TOPE_FOTOS_POR_HORA} por hora)`;
