/**
 * Caché de la detección de globos por foto. La verdad de la foto (los globos y fondos que ve el detector) es estable, así
 * que en una corrida real se paga una sola vez por foto; las siguientes la leen del disco. Solo existe en modo real: el seco
 * no la lee ni la escribe (sus detecciones son grabadas y nunca pueden hacer de verdad), y la clave incluye el modo, el
 * transporte, el modelo, su esfuerzo y razonamiento, el lado al que se reduce la foto y la versión del detector, para que una
 * detección hecha con otra cosa no se use como verdad. Solo
 * se guarda una detección sin tramos fallidos ni revisión de racimos fallida: una respuesta rota no debe quedar como verdad.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Deteccion } from "@/lib/globos3d/detectar-globos-ia";
import type { ModoPasada, TransporteArnes } from "./lib-agregado";

const RAIZ_DEL_REPO = path.resolve(__dirname, "..", "..");
/** Lo que decide qué detecta el detector: su pedido, el mosaico, la revisión de racimos, el catálogo de fondos y colores, cómo se arma la petición a Claude y cómo se normaliza la foto antes de leerla. */
export const FUENTES_DEL_DETECTOR = [
  "src/lib/globos3d/detectar-globos-ia.ts", "src/lib/globos3d/mosaico-deteccion.ts", "src/lib/globos3d/racimos-detectados.ts",
  "src/lib/globos3d/fondos-escenografia.ts", "src/lib/globos3d/medir-colores.ts",
  "src/lib/ia/claude/como-gemini.ts", "src/lib/ia/claude/cuerpo.ts", "src/lib/ia/claude/esquemas.ts", "src/lib/ia/claude/herramientas.ts", "src/lib/ia/claude/respuesta.ts",
  "src/lib/ia/claude/cli/peticion.ts", "src/lib/ia/claude/cli/salida.ts",
  "src/lib/taller/normalizar-foto.ts",
];

const huellasDeFuentes = new Map<string, string>();

function huellaDeFuentes(raiz: string): string {
  const conocida = huellasDeFuentes.get(raiz);
  if (conocida !== undefined) return conocida;
  const huella = createHash("sha256");
  for (const archivo of FUENTES_DEL_DETECTOR) huella.update(archivo).update(readFileSync(path.join(raiz, archivo)));
  const calculada = huella.digest("hex");
  huellasDeFuentes.set(raiz, calculada);
  return calculada;
}

/** Huella del código del detector: cambia si cambia cualquiera de sus fuentes. */
export function versionDetector(raiz: string = RAIZ_DEL_REPO): string {
  return huellaDeFuentes(raiz).slice(0, 16);
}

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

export function claveDeteccion(entrada: EntradaClaveDeteccion, version: string = versionDetector()): string {
  const { bytes, modo, transporte, modelo, esfuerzo, pensamiento, ladoLectura } = entrada;
  return createHash("sha256").update(bytes).update(`|${modo}|${transporte}|${modelo}|${esfuerzo}|${pensamiento}|${ladoLectura}|${version}`).digest("hex").slice(0, 32);
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

export function guardarDeteccionCacheada(directorio: string, clave: string, deteccion: Deteccion, modo: ModoPasada): void {
  if (modo !== "real" || deteccion.fallidos > 0 || deteccion.racimos.fallo !== undefined) return;
  mkdirSync(directorio, { recursive: true });
  writeFileSync(path.join(directorio, `${clave}.json`), JSON.stringify(deteccion));
}
