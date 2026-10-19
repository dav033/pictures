import { z } from "zod";

/**
 * La bandera de la «Hoja de armado» del Taller 3D, lo que comparten el servidor (`hoja-armado-bandera.ts`) y el navegador
 * (`useHojaArmadoActiva`). Sin `server-only` a propósito.
 */

export const RUTA_HOJA_ARMADO = "/api/taller/hoja-armado";

/** De dónde salió el valor: la fila de `ajustes_runtime`, la variable de entorno o el valor por defecto (apagada). */
export const FUENTES_HOJA_ARMADO = ["ajuste", "env", "defecto"] as const;

export const LecturaHojaArmadoSchema = z.object({ activa: z.boolean(), fuente: z.enum(FUENTES_HOJA_ARMADO) }).strict();
export type LecturaHojaArmado = z.infer<typeof LecturaHojaArmadoSchema>;
