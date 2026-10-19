/**
 * Los dos números de `imagen-liviana.ts`, aparte de `sharp`: los leen también módulos que corren en el navegador (la huella del
 * pipeline de renders del estudio de módulos) y no pueden cargarlo.
 */
export const CALIDAD_JPEG_IMAGEN_GENERADA = 90;
/** Un JPEG que ya llega por debajo de esto no se vuelve a comprimir (se perdería calidad sin ganar nada). */
export const BYTES_JPEG_YA_LIVIANO = 700_000;
