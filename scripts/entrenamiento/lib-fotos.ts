/** Las fotos de referencia del dueño (solo lectura): `images (25).jpg` … `images (54).jpg`. Nunca se copian al repo. */
import { readdirSync } from "node:fs";

export const FOTOS_DEL_DUENO = { desde: 25, hasta: 54 } as const;

/** Los nombres que caen en el rango, en orden numérico; ignora lo demás del directorio. */
export function nombresDeFotos(entradas: readonly string[]): string[] {
  const rango = /^images \((\d+)\)\.jpg$/;
  return entradas
    .map((nombre) => ({ nombre, n: Number(rango.exec(nombre)?.[1]) }))
    .filter(({ n }) => n >= FOTOS_DEL_DUENO.desde && n <= FOTOS_DEL_DUENO.hasta)
    .sort((a, b) => a.n - b.n)
    .map(({ nombre }) => nombre);
}

export function listarFotos(directorio: string): string[] {
  return nombresDeFotos(readdirSync(directorio));
}
