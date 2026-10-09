import type { VistaEstandar } from "@/components/tres-d/camara-estandar-datos";

/**
 * Lo que decide cómo sale la imagen del estudio por el lado de la captura y de FLUX, en un solo sitio para que el visor, el
 * generador y la huella del pipeline (`huella-pipeline.ts`) lean los mismos números: si uno cambia, la clave del caché cambia.
 */

/** Lado (px) de la captura guía: FLUX la toma como imagen base; más grande solo alarga la subida. */
export const LADO_CAPTURA = 768;
/** La cámara estándar desde la que se captura el módulo. */
export const VISTA_CAPTURA: VistaEstandar = "tres-cuartos";
/** Aspecto que se le pide a FLUX (el de la captura, cuadrada). */
export const ASPECTO_RENDER = "1:1";
/** Guía de FLUX.2 `/edit`, la misma de las fotos del taller. */
export const GUIDANCE_RENDER = 3.5;
