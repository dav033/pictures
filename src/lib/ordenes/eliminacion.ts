import "server-only";

import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { limpiarDerivadosDeFoto } from "./limpiar-derivados";
import { directorioOrdenes } from "./directorio";

export async function eliminarFotoDeOrden(numero: string, indice: number, limpiarDerivado = true): Promise<number> {
  const carpetaOrden = path.join(/*turbopackIgnore: true*/ directorioOrdenes(), numero);
  const archivos = await readdir(/*turbopackIgnore: true*/ carpetaOrden).catch(() => [] as string[]);
  const patron = new RegExp(`^foto-${indice}\\.(jpg|jpeg|png|webp)$`, "i");
  const foto = archivos.find((archivo) => patron.test(archivo));
  if (!foto) throw new Error("La imagen no existe.");

  await Promise.all([
    rm(path.join(carpetaOrden, foto), { force: true }),
    rm(path.join(carpetaOrden, `caption-${indice}.json`), { force: true }),
    rm(path.join(carpetaOrden, `feedback-${indice}.json`), { force: true }),
  ]);
  return limpiarDerivado ? limpiarDerivadosDeFoto(numero, indice) : 0;
}

