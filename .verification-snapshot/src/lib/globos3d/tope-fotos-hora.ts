import { topeDurable, type ResultadoTope } from "@/lib/topes/tope-durable";
import { TOPE_FOTOS_POR_HORA } from "./foto-realista";

/**
 * El tope de fotos con IA por hora, compartido por todas las rutas que pagan una imagen de FLUX desde el taller 3D
 * (`/api/render-3d-imagen` y los renders del estudio de módulos): un solo contador, no uno por ruta.
 *
 * Las rutas usan `tomarFotoDeLaHoraDurable`: el contador vive en Neon y vale para todas las instancias a la vez
 * (`topes/tope-durable.ts`). `tomarFotoDeLaHora` es el contador en memoria de la instancia: lo que responde cuando la base
 * no está (el mismo tope de antes, por instancia). Vive en `globalThis` porque Next puede empaquetar cada ruta con su propia
 * copia de este módulo.
 */
type Ventana = { desde: number; usadas: number };

declare global {
  var __fotosPorHora: Ventana | undefined;
}

const HORA_MS = 3_600_000;

export type TomaDeFoto = ResultadoTope;

export const CLAVE_FOTOS_POR_HORA = "fotos_hora";

/** Anota una foto más en la hora en curso, o dice que ya no caben. `ahora` se inyecta en las pruebas. */
export function tomarFotoDeLaHora(ahora: number = Date.now(), tope: number = TOPE_FOTOS_POR_HORA): TomaDeFoto {
  let ventana = globalThis.__fotosPorHora;
  if (!ventana || ahora - ventana.desde > HORA_MS) ventana = globalThis.__fotosPorHora = { desde: ahora, usadas: 0 };
  if (ventana.usadas >= tope) return { ok: false, usadas: ventana.usadas, tope };
  ventana.usadas += 1;
  return { ok: true, usadas: ventana.usadas };
}

/** El mismo tope, contado en Neon para todas las instancias; si la base no responde, el contador en memoria de esta. */
export async function tomarFotoDeLaHoraDurable(ahora: number = Date.now(), tope: number = TOPE_FOTOS_POR_HORA): Promise<TomaDeFoto> {
  const { toma } = await topeDurable().tomar(CLAVE_FOTOS_POR_HORA, tope, () => tomarFotoDeLaHora(ahora, tope));
  return toma;
}

/** Solo para las pruebas. */
export function reiniciarFotosPorHora(): void {
  globalThis.__fotosPorHora = undefined;
}
