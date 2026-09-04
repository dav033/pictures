import "server-only";

import fs from "node:fs";
import path from "node:path";
import type { LoraSnapshot } from "./snapshot";

/**
 * Junta en una sola carpeta las fotos que el servidor no tiene.
 *
 * `/api/lora/dataset/[archivo]` y `/api/lora/dataset-v005/[archivo]` leen de
 * `data/staging/recaption-v004/original` y de la carpeta de órdenes del disco
 * local; ninguna de las dos existe en la imagen Docker (.dockerignore excluye
 * `data/`), así que en producción las miniaturas dan 404. Ambas rutas piden un
 * nombre plano (`7391-1.jpg`), así que un único directorio les sirve a las dos.
 *
 * Se recomprimen a lo que necesita una galería: a tamaño completo son ~110 MB
 * de fotos de cámara para mostrarlas a 300 px.
 */

const ORIGEN_DATASET = path.join(process.cwd(), "data", "staging", "recaption-v004", "original");
const ORIGEN_WEB = path.join(process.cwd(), "data", "staging", "lora-v006-orders-web-v001", "original");
const ORIGEN_ORDENES = process.env.ORDENES_DECORACION_DIR ?? "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";
const DESTINO = path.join(process.cwd(), "data", "snapshot", "imagenes");
const LADO_MAXIMO = 1400;
const CALIDAD = 82;

export type ResumenImagenes = {
  solicitadas: number;
  preparadas: number;
  omitidas: number;
  sinOrigen: string[];
  bytes: number;
};

export function directorioImagenesSnapshot(): string {
  return DESTINO;
}

/** Los dos consumidores: la galería del admin y las miniaturas por estructura. */
function nombresRequeridos(snapshot: LoraSnapshot): string[] {
  const nombres = new Set<string>();
  for (const registro of snapshot.datasetGallery?.records ?? []) {
    if (registro.imageFile) nombres.add(path.basename(registro.imageFile));
  }
  for (const grupo of snapshot.composicion?.composicion ?? []) {
    for (const elemento of grupo.elementos) {
      for (const archivo of elemento.imagenes ?? []) nombres.add(path.basename(archivo));
    }
  }
  return [...nombres];
}

/** Mismo criterio que resolveOrderImage en la ruta v005: `<orden>-<foto>.<ext>`. */
function rutaEnOrdenes(archivo: string): string | null {
  const match = archivo.match(/^(\d+)-(\d+)\.(jpe?g|png|webp)$/i);
  if (!match) return null;
  const [, orden, indice] = match;
  const carpeta = path.join(ORIGEN_ORDENES, orden);
  try {
    const encontrado = fs
      .readdirSync(carpeta)
      .find((nombre) => new RegExp(`^foto-${indice}\\.(jpe?g|png|webp)$`, "i").test(nombre));
    return encontrado ? path.join(carpeta, encontrado) : null;
  } catch {
    return null;
  }
}

function rutaOrigen(archivo: string): string | null {
  const candidatos = [
    path.join(ORIGEN_DATASET, archivo),
    ...(archivo.startsWith("web-") ? [path.join(ORIGEN_WEB, archivo)] : []),
  ];
  for (const candidato of candidatos) {
    if (fs.existsSync(candidato)) return candidato;
  }
  return rutaEnOrdenes(archivo);
}

/**
 * Idempotente: una imagen ya preparada y más nueva que su origen no se vuelve a
 * comprimir. La primera corrida tarda; las siguientes son casi instantáneas.
 */
export async function prepararImagenesSnapshot(snapshot: LoraSnapshot): Promise<ResumenImagenes> {
  const { default: sharp } = await import("sharp");
  fs.mkdirSync(DESTINO, { recursive: true });

  const nombres = nombresRequeridos(snapshot);
  const resumen: ResumenImagenes = { solicitadas: nombres.length, preparadas: 0, omitidas: 0, sinOrigen: [], bytes: 0 };

  for (const archivo of nombres) {
    const origen = rutaOrigen(archivo);
    if (!origen) {
      resumen.sinOrigen.push(archivo);
      continue;
    }
    const destino = path.join(DESTINO, archivo);
    try {
      if (fs.existsSync(destino) && fs.statSync(destino).mtimeMs >= fs.statSync(origen).mtimeMs) {
        resumen.omitidas += 1;
        resumen.bytes += fs.statSync(destino).size;
        continue;
      }
      const extension = path.extname(archivo).slice(1).toLowerCase();
      const canalizacion = sharp(origen).rotate().resize(LADO_MAXIMO, LADO_MAXIMO, { fit: "inside", withoutEnlargement: true });
      // Se conserva el formato: el nombre del archivo es la clave con la que lo
      // piden las rutas, y cambiar la extensión las rompería.
      const salida =
        extension === "png"
          ? canalizacion.png({ compressionLevel: 9 })
          : extension === "webp"
          ? canalizacion.webp({ quality: CALIDAD })
          : canalizacion.jpeg({ quality: CALIDAD, mozjpeg: true });
      await salida.toFile(destino);
      resumen.preparadas += 1;
      resumen.bytes += fs.statSync(destino).size;
    } catch {
      resumen.sinOrigen.push(archivo);
    }
  }

  return resumen;
}
