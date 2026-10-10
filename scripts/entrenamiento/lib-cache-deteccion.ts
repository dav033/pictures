/**
 * Caché de la detección de globos por foto. La verdad de la foto (los globos y fondos que ve el detector) tiene que ser la
 * misma en todas las corridas, o el cambio de puntaje de una foto mezcla el efecto del código con el ruido de volver a detectar.
 * Por eso la clave es determinista: la huella de los bytes de la foto más la configuración del detector (modo, transporte,
 * modelo, esfuerzo y razonamiento, lado al que se reduce la foto y `VERSION_DEL_DETECTOR`), en JSON canónico. No entra nada que
 * cambie sin que cambie lo que se detecta: ni la hora, ni la corrida, ni el commit, ni el código del repo (antes se hasheaban
 * las fuentes del detector, con sus saltos de línea: cualquier commit que tocara una de ellas, aunque no cambiara el pedido al
 * modelo, dejaba la caché entera sin uso). Solo existe en modo real: el seco no la lee ni la escribe (sus detecciones son
 * grabadas y nunca pueden hacer de verdad). Solo se guarda una detección sin tramos fallidos ni revisión de racimos fallida:
 * una respuesta rota no debe quedar como verdad.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Deteccion } from "@/lib/globos3d/detectar-globos-ia";
import type { ModoPasada, TransporteArnes } from "./lib-agregado";

/**
 * Se sube a mano cuando cambia a propósito lo que el detector pide o cómo une lo que responde (el pedido, el mosaico, la
 * revisión de racimos, el catálogo de fondos que se le muestra): las detecciones guardadas dejan de ser la verdad y se vuelve a
 * detectar. Un cambio que no altera la detección no la sube, para que las corridas sigan comparándose con la misma verdad.
 */
export const VERSION_DEL_DETECTOR = "1";

/** Todo lo que, además de la foto, decide qué detecta el modelo. */
export type EntradaClaveDeteccion = {
  bytes: Uint8Array;
  modo: ModoPasada;
  transporte: TransporteArnes;
  modelo: string;
  /** El esfuerzo y el razonamiento efectivos de la config de la app (no los crudos del entorno). */
  esfuerzo: string;
  pensamiento: boolean;
  /** El lado máximo al que el Taller reduce la foto antes de leerla (`LADO_MAXIMO_LECTURA`). */
  ladoLectura: number;
};

/** JSON con las claves en orden alfabético: el mismo contenido da siempre el mismo texto, sea cual sea el orden en que se armó el objeto. */
const canonico = (valor: Record<string, string | number | boolean>): string =>
  JSON.stringify(Object.fromEntries(Object.entries(valor).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));

export function claveDeteccion(entrada: EntradaClaveDeteccion, version: string = VERSION_DEL_DETECTOR): string {
  const { bytes, ...configuracion } = entrada;
  const foto = createHash("sha256").update(bytes).digest("hex");
  return createHash("sha256").update(canonico({ ...configuracion, foto, version })).digest("hex").slice(0, 32);
}

export function leerDeteccionCacheada(directorio: string, clave: string, modo: ModoPasada): Deteccion | null {
  if (modo !== "real") return null;
  const archivo = path.join(directorio, `${clave}.json`);
  if (!existsSync(archivo)) return null;
  try {
    return JSON.parse(readFileSync(archivo, "utf8")) as Deteccion;
  } catch {
    return null;
  }
}

/** Una detección guardada: la de `detectarGlobos` y, desde que se anota, la foto de la que salió (para volver a puntuar sin adivinar a cuál pertenece). */
export type DeteccionGuardada = Deteccion & { foto?: string };

export function guardarDeteccionCacheada(directorio: string, clave: string, deteccion: Deteccion, modo: ModoPasada, foto?: string): void {
  if (modo !== "real" || deteccion.fallidos > 0 || deteccion.racimos.fallo !== undefined) return;
  mkdirSync(directorio, { recursive: true });
  const guardada: DeteccionGuardada = foto ? { ...deteccion, foto } : deteccion;
  writeFileSync(path.join(directorio, `${clave}.json`), JSON.stringify(guardada));
}
