import { TOPE_FOTOS_POR_HORA } from "./foto-realista";

/**
 * El tope de fotos con IA por hora y por instancia del servidor, compartido por todas las rutas que pagan una imagen de
 * FLUX desde el taller 3D (`/api/render-3d-imagen` y los renders del estudio de módulos): un solo contador, no uno por
 * ruta. Vive en `globalThis` porque Next puede empaquetar cada ruta con su propia copia de este módulo.
 */
type Ventana = { desde: number; usadas: number };

declare global {
  var __fotosPorHora: Ventana | undefined;
}

const HORA_MS = 3_600_000;

export type TomaDeFoto = { ok: true; usadas: number } | { ok: false; usadas: number; tope: number };

/** Anota una foto más en la hora en curso, o dice que ya no caben. `ahora` se inyecta en las pruebas. */
export function tomarFotoDeLaHora(ahora: number = Date.now(), tope: number = TOPE_FOTOS_POR_HORA): TomaDeFoto {
  let ventana = globalThis.__fotosPorHora;
  if (!ventana || ahora - ventana.desde > HORA_MS) ventana = globalThis.__fotosPorHora = { desde: ahora, usadas: 0 };
  if (ventana.usadas >= tope) return { ok: false, usadas: ventana.usadas, tope };
  ventana.usadas += 1;
  return { ok: true, usadas: ventana.usadas };
}

/** Solo para las pruebas. */
export function reiniciarFotosPorHora(): void {
  globalThis.__fotosPorHora = undefined;
}
