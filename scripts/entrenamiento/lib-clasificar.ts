/**
 * Clasificación de un resultado del arnés (`correr-foto.ts`) y escritura de su fila en el LEADERBOARD.md del esqueleto de
 * `inventario.ts`. La clase sale de las métricas del registro (no del texto): lectura (no hubo piezas ni escena), medida (la
 * escena existe y no se pudo medir), compilación (piezas del taller que no se armaron), capacidad faltante (causas de
 * `lib-capacidad`), escena vacía y visor (solo si se dice que la captura falló: «pendiente» no es fallo). Puro: sin disco ni red.
 */
import { puntuacionMedia, type RegistroPasada } from "./lib-agregado";
import { clasificarFallos, HECHOS_SIN_FALLOS, type ClaseFallo, type HechosPasada } from "./lib-fallos";
import { hayCapacidadFaltante } from "./lib-capacidad";

export type MetricasDeResultado = Pick<RegistroPasada, "error" | "piezas" | "puntajes" | "capacidades" | "fallos"> & { captura: RegistroPasada["captura"] };

/** Los hechos de `clasificarFallos` leídos de las métricas de un registro. `capturaFallida` es lo único que no está en el registro. */
export function hechosDeRegistro(r: MetricasDeResultado, capturaFallida = false): HechosPasada {
  const sinPiezas = r.piezas.leidas === 0;
  const capacidades = r.capacidades ?? {};
  const medida = r.puntajes.proporciones;
  return {
    ...HECHOS_SIN_FALLOS,
    errorLectura: r.error !== null && sinPiezas,
    sinDeteccion: r.error === null && !sinPiezas && medida === null,
    // Las piezas omitidas con una causa de capacidad son capacidad que falta; el resto, un fallo de compilación.
    omitidasCompilacion: hayCapacidadFaltante(capacidades) ? 0 : r.piezas.omitidas,
    capacidades,
    escenaVacia: r.error === null && !sinPiezas && r.piezas.globosArmados === 0 && medida === 0,
    erroresAgente: r.fallos.includes("agente") ? 1 : 0,
    capturaFallida,
  };
}

export function clasificarResultado(r: MetricasDeResultado, capturaFallida = false): ClaseFallo[] {
  return clasificarFallos(hechosDeRegistro(r, capturaFallida));
}

export type FilaLeaderboard = { foto: string; puntaje: number | null; clases: readonly ClaseFallo[]; triptico: string | null; iniciadaEn: string };

/** El triptico (antes / después / foto) de una foto dentro de la carpeta de su corrida. Solo la ruta: el capturador no existe todavía. */
export const rutaDeTriptico = (dirCorrida: string, foto: string): string => `${dirCorrida.replace(/\/$/, "")}/${foto.replace(/\.jpg$/i, "")}-triptico.png`;

export const filaDeResultado = (registro: RegistroPasada, dirCorrida: string, capturaFallida = false): FilaLeaderboard => ({
  foto: registro.foto,
  puntaje: puntuacionMedia([registro.puntajes.proporciones, registro.puntajes.colores, registro.puntajes.zonas, registro.puntajes.iou]),
  clases: clasificarResultado(registro, capturaFallida),
  triptico: rutaDeTriptico(dirCorrida, registro.foto),
  iniciadaEn: registro.iniciadaEn,
});

const COLUMNAS = 10;
const celdas = (linea: string): string[] => linea.split("|").slice(1, -1).map((c) => c.trim());
const esFilaDeFoto = (linea: string) => /^\| \d+ \| images \(\d+\)\.jpg \|/.test(linea);

/**
 * Actualiza la fila de la foto del esqueleto (columnas: # | Foto | Id | Hash | Puntaje | Clase de fallo | Corridas | Última corrida |
 * Estado | Triptico): puntaje, clase (la dominante cuenta primero; «ninguno» si no falló), una corrida más, estado «corrida» y el
 * triptico. Una foto que no está se agrega al final. Lo demás del archivo queda como estaba.
 */
export function actualizarLeaderboard(markdown: string, fila: FilaLeaderboard): string {
  const lineas = markdown.split("\n");
  const puntaje = fila.puntaje === null ? "—" : fila.puntaje.toFixed(2);
  const clase = fila.clases.length ? fila.clases.join(", ") : "ninguno";
  const indice = lineas.findIndex((l) => esFilaDeFoto(l) && celdas(l)[1] === fila.foto);
  if (indice >= 0) {
    const c = celdas(lineas[indice]!);
    if (c.length !== COLUMNAS) throw new Error(`La fila de ${fila.foto} tiene ${c.length} columnas y se esperaban ${COLUMNAS}.`);
    const previas = Number(c[6]) || 0;
    lineas[indice] = `| ${c[0]} | ${c[1]} | ${c[2]} | ${c[3]} | ${puntaje} | ${clase} | ${previas + 1} | ${fila.iniciadaEn} | corrida | ${fila.triptico ?? "—"} |`;
    return lineas.join("\n");
  }
  const ultima = lineas.reduce((n, l, i) => (esFilaDeFoto(l) ? i : n), -1);
  const numero = lineas.filter(esFilaDeFoto).length + 1;
  const nueva = `| ${numero} | ${fila.foto} | — | — | ${puntaje} | ${clase} | 1 | ${fila.iniciadaEn} | corrida | ${fila.triptico ?? "—"} |`;
  if (ultima < 0) throw new Error("El leaderboard no tiene la tabla del esqueleto: genera uno con inventario.ts --salida.");
  lineas.splice(ultima + 1, 0, nueva);
  return lineas.join("\n");
}
