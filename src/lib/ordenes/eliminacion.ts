import "server-only";

import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { limpiarDerivadosDeFoto, limpiarDerivadosDeOrden } from "./limpiar-derivados";

const RUTA_ORDENES = "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";

export async function eliminarFotoDeOrden(numero: string, indice: number, limpiarDerivado = true): Promise<number> {
  const carpetaOrden = path.join(RUTA_ORDENES, numero);
  const archivos = await readdir(carpetaOrden).catch(() => [] as string[]);
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

export async function eliminarOrden(numero: string): Promise<number> {
  await rm(path.join(RUTA_ORDENES, numero), { recursive: true, force: true });
  return limpiarDerivadosDeOrden(numero);
}


