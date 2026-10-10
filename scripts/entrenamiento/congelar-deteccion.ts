/**
 * Congela la verdad de una corrida: copia a la caché de la detección, con la clave de ahora (`claveDeteccion`), la detección que usó cada
 * foto de esa corrida, para que las corridas que siguen se midan contra los mismos globos y no contra una detección nueva (el cambio de un
 * puntaje por foto mezclaría lo que cambió el código con el ruido de volver a detectar). Copia, no mueve: las entradas de antes no se tocan.
 * La detección de cada foto se reconoce por la foto que anotó el arnés en la caché y por los globos y fondos que anotó la auditoría de la pasada.
 *
 *   npx tsx --conditions=react-server scripts/entrenamiento/congelar-deteccion.ts <carpeta-de-la-corrida> [--fotos <dir>] [--destino <dir>]
 *
 * `--fotos`: las fotos de referencia (por defecto ENTRENAMIENTO_FOTOS o las del dueño). `--destino`: otra caché (por defecto, la de las corridas).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { LADO_MAXIMO_LECTURA } from "@/lib/taller/escena-desde-foto";
import type { ModoPasada, TransporteArnes } from "./lib-agregado";
import { deteccionAnotada, eventosDeConversacion, idConversacionDePasada } from "./lib-auditoria";
import { claveDeteccion, guardarDeteccionCacheada, type DeteccionGuardada } from "./lib-cache-deteccion";
import { FOTOS_POR_DEFECTO } from "./lib-fotos";
import { elegirDeteccion, rescorearTodas } from "./lib-rescorear";
import { directorioDeCorridas } from "./lib-rutas";

type Resumen = { modo: ModoPasada; transporte: TransporteArnes; modelo: string; esfuerzo: string; pensamiento: boolean };

const valor = (nombre: string): string | undefined => {
  const i = process.argv.indexOf(nombre);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

function leerResumen(carpeta: string): Resumen {
  const resumen = JSON.parse(readFileSync(path.join(carpeta, "resumen.json"), "utf8")) as Partial<Resumen>;
  const { modo, transporte, modelo, esfuerzo, pensamiento } = resumen;
  if (modo !== "real" || !transporte || !modelo || !esfuerzo || pensamiento === undefined) throw new Error("El resumen de la corrida no es de una corrida real con su modelo, esfuerzo y razonamiento: no se sabe con qué clave guardarla.");
  return { modo, transporte, modelo, esfuerzo, pensamiento };
}

function main(): void {
  const carpeta = process.argv[2];
  if (!carpeta) throw new Error("Falta la carpeta de la corrida (nombre dentro de las corridas o ruta).");
  const raiz = directorioDeCorridas();
  const corrida = path.basename(carpeta);
  const dirFotos = valor("--fotos") ?? process.env.ENTRENAMIENTO_FOTOS ?? FOTOS_POR_DEFECTO;
  const destino = valor("--destino") ?? path.join(raiz, "cache-deteccion");
  const resumen = leerResumen(path.join(raiz, corrida));
  const dirCache = path.join(raiz, "cache-deteccion");
  const cache = readdirSync(dirCache).map((f) => JSON.parse(readFileSync(path.join(dirCache, f), "utf8")) as DeteccionGuardada);
  const archivos = readdirSync(path.join(raiz, corrida)).filter((f) => /^images \(\d+\)\.json$/.test(f));
  const { filas, errores } = rescorearTodas(archivos, (archivo) => {
    const { registro } = JSON.parse(readFileSync(path.join(raiz, corrida, archivo), "utf8")) as { registro: { foto: string } };
    const anotada = deteccionAnotada(eventosDeConversacion(path.join(raiz, "registro"), idConversacionDePasada(corrida, registro.foto)).eventos);
    if (!anotada) throw new Error(`La auditoría de ${registro.foto} no anota su detección`);
    const deteccion = elegirDeteccion(cache, registro.foto, anotada);
    const clave = claveDeteccion({ bytes: new Uint8Array(readFileSync(path.join(dirFotos, registro.foto))), ...resumen, ladoLectura: LADO_MAXIMO_LECTURA });
    guardarDeteccionCacheada(destino, clave, deteccion, resumen.modo, registro.foto);
    return `${registro.foto} -> ${clave} (${deteccion.globos.length} globos)`;
  });
  for (const f of filas) console.log(f);
  for (const e of errores) console.error(`${e.archivo}: ${e.error}`);
  console.log(`\n${corrida}: ${filas.length} detecciones congeladas en ${destino}; ${errores.length} sin congelar.`);
  if (errores.length) process.exitCode = 1;
}

main();
