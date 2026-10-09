import type { TomaDeFoto } from "@/lib/globos3d/tope-fotos-hora";

/**
 * El tope de imágenes del plan 3D por hora **y por navegador**, encima del tope global por instancia que comparte con el
 * Taller (`tope-fotos-hora.ts`): sin él, un solo navegador gasta las 30 del servidor y deja a los demás sin imagen. La clave
 * es `huellaDeNavegador` (la identidad firmada del navegador, no un dato del cuerpo). Vive en `globalThis` porque Next puede
 * empaquetar cada ruta con su propia copia del módulo; la memoria es solo del proceso, como el tope global.
 */
export const TOPE_IMAGENES_POR_NAVEGADOR_HORA = 6;

type Ventana = { desde: number; usadas: number };

declare global {
  var __imagenesGuiadaPorNavegador: Map<string, Ventana> | undefined;
}

const HORA_MS = 3_600_000;
const MAX_NAVEGADORES_EN_MEMORIA = 5_000;

const ventanas = (): Map<string, Ventana> => (globalThis.__imagenesGuiadaPorNavegador ??= new Map());

function limpiarVencidas(mapa: Map<string, Ventana>, ahora: number): void {
  for (const [clave, v] of mapa) if (ahora - v.desde > HORA_MS) mapa.delete(clave);
}

/** Anota una imagen más de este navegador en su hora en curso, o dice que ya no caben. `ahora` y `tope` se inyectan en las pruebas. */
export function tomarImagenDeNavegador(navegador: string, ahora: number = Date.now(), tope: number = TOPE_IMAGENES_POR_NAVEGADOR_HORA): TomaDeFoto {
  const mapa = ventanas();
  if (mapa.size >= MAX_NAVEGADORES_EN_MEMORIA) limpiarVencidas(mapa, ahora);
  let ventana = mapa.get(navegador);
  if (!ventana || ahora - ventana.desde > HORA_MS) { ventana = { desde: ahora, usadas: 0 }; mapa.set(navegador, ventana); }
  if (ventana.usadas >= tope) return { ok: false, usadas: ventana.usadas, tope };
  ventana.usadas += 1;
  return { ok: true, usadas: ventana.usadas };
}

/** Devuelve la imagen que no llegó a pedirse (el tope global la negó): el navegador no paga por un cupo que no usó. */
export function devolverImagenDeNavegador(navegador: string): void {
  const ventana = ventanas().get(navegador);
  if (ventana && ventana.usadas > 0) ventana.usadas -= 1;
}

/** Solo para las pruebas. */
export function reiniciarImagenesPorNavegador(): void {
  globalThis.__imagenesGuiadaPorNavegador = undefined;
}
