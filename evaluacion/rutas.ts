/**
 * Rutas de las herramientas de evaluación, sin rutas absolutas de ninguna máquina.
 *
 * - `REPO`: la raíz del repositorio (esta carpeta es `<repo>/evaluacion`).
 * - `DATOS`: dónde viven las fotos de referencia y lo que generan las corridas (planes, imágenes FLUX, análisis y
 *   cachés del juez). **Fuera del repositorio**: las fotos son de clientes o de terceros y los resultados pesan cientos
 *   de MB. Por defecto, la carpeta hermana del repositorio `../informes-calidad`; se cambia con `EVAL_DATOS`.
 *
 * Los scripts se ejecutan con `npx tsx` desde la raíz del repositorio (ver `evaluacion/README` en SEGUIMIENTO.md §7).
 */
import { resolve } from "node:path";

const normalizar = (ruta: string) => ruta.replace(/\\/g, "/");

export const REPO = normalizar(resolve(__dirname, ".."));
export const DATOS = normalizar(resolve(process.env.EVAL_DATOS ?? resolve(REPO, "..", "informes-calidad")));
