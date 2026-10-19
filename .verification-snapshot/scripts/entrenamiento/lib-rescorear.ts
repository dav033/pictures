/**
 * Piezas puras de `rescorear-corrida.ts`: elegir de la caché la detección de una foto y recorrer las fotos de una corrida sin que el fallo de una
 * pare a las demás.
 */
import type { DeteccionGuardada } from "./lib-cache-deteccion";

const mismosIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * La detección de `foto` entre las de la caché. Primero las anotadas con su foto (las guarda así el arnés desde que existe `foto` en la entrada); si
 * ninguna lo está, las viejas que concuerdan con lo que anotó la auditoría (número de globos y fondos): solo vale si hay UNA; si hay varias distintas no se
 * adivina, se pide la que falta.
 */
export function elegirDeteccion(caché: readonly DeteccionGuardada[], foto: string, auditoria: { globos: number; fondos: readonly string[] }): DeteccionGuardada {
  const deLaFoto = caché.filter((d) => d.foto === foto && d.globos.length === auditoria.globos);
  if (deLaFoto.length) return deLaFoto[0]!;
  const sinFoto = caché.filter((d) => d.foto === undefined && d.globos.length === auditoria.globos && mismosIds(d.fondos.map((f) => f.id), auditoria.fondos));
  const distintas = new Set(sinFoto.map((d) => JSON.stringify(d.globos)));
  if (distintas.size === 1) return sinFoto[0]!;
  throw new Error(distintas.size === 0 ? `Sin detección en caché para ${foto} (${auditoria.globos} globos)` : `${distintas.size} detecciones en caché podrían ser de ${foto} (${auditoria.globos} globos): ninguna está anotada con su foto`);
}

export type ResultadoRescorear<T> = { filas: T[]; errores: Array<{ archivo: string; error: string }> };

/** Aplica `rescorear` a cada archivo; el que falle queda en `errores` y no impide los demás. */
export function rescorearTodas<T>(archivos: readonly string[], rescorear: (archivo: string) => T): ResultadoRescorear<T> {
  const resultado: ResultadoRescorear<T> = { filas: [], errores: [] };
  for (const archivo of archivos) {
    try {
      resultado.filas.push(rescorear(archivo));
    } catch (e) {
      resultado.errores.push({ archivo, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return resultado;
}
