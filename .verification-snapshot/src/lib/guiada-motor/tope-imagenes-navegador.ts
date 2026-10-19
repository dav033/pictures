import type { TomaDeFoto } from "@/lib/globos3d/tope-fotos-hora";
import { decidir } from "@/lib/registro/servidor";
import { topeDurable, type ReciboTope } from "@/lib/topes/tope-durable";

/**
 * El tope de imágenes del plan 3D por hora **y por navegador**, encima del tope global que comparte con el Taller
 * (`tope-fotos-hora.ts`): sin él, un solo navegador gasta las 30 del servidor y deja a los demás sin imagen. La clave
 * es `huellaDeNavegador` (la identidad firmada del navegador, no un dato del cuerpo).
 *
 * La ruta que paga una imagen usa las versiones `…Durable`: el contador de cada navegador vive en Neon y vale para todas las
 * instancias (`topes/tope-durable.ts`; en la tabla solo entra una huella, nunca una cookie ni una IP). Las funciones en memoria
 * son el contador de la instancia, lo que responde si la base no está. Viven en `globalThis` porque Next puede empaquetar cada
 * ruta con su propia copia del módulo.
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

function tomarEnVentana(mapa: Map<string, Ventana>, navegador: string, ahora: number, tope: number): TomaDeFoto {
  if (mapa.size >= MAX_NAVEGADORES_EN_MEMORIA) limpiarVencidas(mapa, ahora);
  let ventana = mapa.get(navegador);
  if (!ventana || ahora - ventana.desde > HORA_MS) { ventana = { desde: ahora, usadas: 0 }; mapa.set(navegador, ventana); }
  if (ventana.usadas >= tope) return { ok: false, usadas: ventana.usadas, tope };
  ventana.usadas += 1;
  return { ok: true, usadas: ventana.usadas };
}

/** Anota una imagen más de este navegador en su hora en curso, o dice que ya no caben. `ahora` y `tope` se inyectan en las pruebas. */
export function tomarImagenDeNavegador(navegador: string, ahora: number = Date.now(), tope: number = TOPE_IMAGENES_POR_NAVEGADOR_HORA): TomaDeFoto {
  return tomarEnVentana(ventanas(), navegador, ahora, tope);
}

/**
 * El mismo cupo por hora y por navegador para otra ruta (p. ej. los cambios del plan 3D, `/api/guiada/motor/editar`), con su
 * propio contador por proceso: un navegador que agota su cupo ahí no gasta el de las imágenes, ni al revés.
 */
export function crearTopePorNavegador(tope: number): { tomar: (navegador: string, ahora?: number) => TomaDeFoto } {
  const mapa = new Map<string, Ventana>();
  return { tomar: (navegador, ahora = Date.now()) => tomarEnVentana(mapa, navegador, ahora, tope) };
}

/** Devuelve la imagen que no llegó a pedirse (el tope global la negó): el navegador no paga por un cupo que no usó. */
export function devolverImagenDeNavegador(navegador: string): void {
  const ventana = ventanas().get(navegador);
  if (ventana && ventana.usadas > 0) ventana.usadas -= 1;
}

/** `huellaDeNavegador` es un sha256 en hexadecimal: lo único que se acepta como clave de la base (nada en claro, ni cookie ni IP). */
const esHuella = (navegador: string): boolean => /^[0-9a-f]{64}$/.test(navegador);

/**
 * Un valor que no es una huella no llega nunca a la base: en desarrollo y en las pruebas es un error de quien llama y se lanza; en
 * producción se cuenta solo en la memoria de la instancia (sigue acotado, sin bloquear al cliente) y queda en el registro, sin el valor.
 */
function navegadorSinHuella(navegador: string): void {
  if (process.env.NODE_ENV !== "production") throw new Error("El tope por navegador necesita la huella sha256 del navegador (huellaDeNavegador), no un valor en claro.");
  decidir("regla:tope_navegador_sin_huella", "el tope de imágenes por navegador recibió una clave que no es una huella: cuenta solo en la memoria de la instancia", { largo: navegador.length });
}

const reciboDe = (toma: TomaDeFoto): ReciboTope => (toma.ok && toma.recibo) || { origen: "memoria" };

/** El mismo cupo por navegador, contado en Neon para todas las instancias; si la base no responde, el contador en memoria de esta. */
export async function tomarImagenDeNavegadorDurable(navegador: string, ahora: number = Date.now(), tope: number = TOPE_IMAGENES_POR_NAVEGADOR_HORA): Promise<TomaDeFoto> {
  if (!esHuella(navegador)) {
    navegadorSinHuella(navegador);
    const toma = tomarImagenDeNavegador(navegador, ahora, tope);
    return toma.ok ? { ...toma, recibo: { origen: "memoria" } } : toma;
  }
  const { toma } = await topeDurable().tomar(`imagenes_navegador:${navegador}`, tope, () => tomarImagenDeNavegador(navegador, ahora, tope));
  return toma;
}

/** Devuelve la imagen que no llegó a pedirse al mismo contador (y la misma hora) de donde salió: `toma` es lo que devolvió la toma. */
export async function devolverImagenDeNavegadorDurable(navegador: string, toma: TomaDeFoto): Promise<void> {
  if (!esHuella(navegador)) { devolverImagenDeNavegador(navegador); return; }
  await topeDurable().devolver(`imagenes_navegador:${navegador}`, reciboDe(toma), () => devolverImagenDeNavegador(navegador));
}

/** Solo para las pruebas. */
export function reiniciarImagenesPorNavegador(): void {
  globalThis.__imagenesGuiadaPorNavegador = undefined;
}
