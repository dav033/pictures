/**
 * Inventario de las fotos de referencia del dueño (W4): `images (25).jpg` … `images (54).jpg`, solo lectura. Cada foto sale con
 * un id estable (el número del nombre, no el orden del directorio) y el hash SHA-256 de sus bytes, para saber si una foto cambió
 * entre corridas. No copia nada. La carpeta sale de `--fotos <dir>`, de ENTRENAMIENTO_FOTOS o, sin ellas, del valor de `lib-fotos`.
 *
 *   npx tsx scripts/entrenamiento/inventario.ts [--fotos <dir>] [--salida <LEADERBOARD.md>] [--json]
 *
 * Con `--salida` escribe el esqueleto del LEADERBOARD.md solo si el archivo no existe (nunca pisa filas de corridas).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FOTOS_DEL_DUENO, FOTOS_POR_DEFECTO, listarFotos } from "./lib-fotos";

export type FotoInventariada = {
  /** `foto-25`: estable aunque cambie el directorio o se agreguen fotos. */
  id: string;
  nombre: string;
  bytes: number;
  sha256: string;
};

export type Inventario = {
  fotos: FotoInventariada[];
  /** Números del rango `desde`…`hasta` que no están en la carpeta. */
  faltantes: number[];
};

const numeroDe = (nombre: string): number => Number(/\((\d+)\)/.exec(nombre)?.[1]);

export function inventariarFotos(directorio: string): Inventario {
  const fotos = listarFotos(directorio).map((nombre): FotoInventariada => {
    const contenido = readFileSync(path.join(directorio, nombre));
    return { id: `foto-${numeroDe(nombre)}`, nombre, bytes: contenido.byteLength, sha256: createHash("sha256").update(contenido).digest("hex") };
  });
  const presentes = new Set(fotos.map((f) => numeroDe(f.nombre)));
  const faltantes: number[] = [];
  for (let n = FOTOS_DEL_DUENO.desde; n <= FOTOS_DEL_DUENO.hasta; n++) if (!presentes.has(n)) faltantes.push(n);
  return { fotos, faltantes };
}

/** La carpeta de las fotos: el argumento, el entorno o el valor de este equipo. */
export function carpetaDeFotos(argumento: string | undefined, entorno: Readonly<Record<string, string | undefined>> = process.env): string {
  return argumento?.trim() || entorno.ENTRENAMIENTO_FOTOS?.trim() || FOTOS_POR_DEFECTO;
}

/** El esqueleto del LEADERBOARD.md de la bitácora: una fila por foto, sin puntajes hasta que corra una pasada. */
export function esqueletoDeLeaderboard(inventario: Inventario, generadoEn: string): string {
  const filas = inventario.fotos.map((f, i) => `| ${i + 1} | ${f.nombre} | ${f.id} | ${f.sha256.slice(0, 12)} | — | — | — | — | pendiente | — |`);
  return [
    "# Leaderboard del entrenamiento (fotos del dueño)",
    "",
    `Esqueleto generado: ${generadoEn}. ${inventario.fotos.length} fotos${inventario.faltantes.length ? `; faltan los números ${inventario.faltantes.join(", ")}` : ""}.`,
    "Las filas se completan con las corridas del arnés (`scripts/entrenamiento/arnes.ts`); el hash identifica los bytes de la foto.",
    "",
    "| # | Foto | Id | Hash | Puntaje | Clase de fallo | Corridas | Última corrida | Estado | Triptico |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...filas,
    "",
  ].join("\n");
}

/** Escribe el esqueleto si no existe; devuelve si lo escribió. */
export function escribirEsqueleto(ruta: string, inventario: Inventario, generadoEn: string): boolean {
  if (existsSync(ruta)) return false;
  mkdirSync(path.dirname(ruta), { recursive: true });
  writeFileSync(ruta, esqueletoDeLeaderboard(inventario, generadoEn));
  return true;
}

function main(): void {
  const args = process.argv.slice(2);
  const valor = (nombre: string) => { const i = args.indexOf(nombre); return i >= 0 ? args[i + 1] : undefined; };
  const carpeta = carpetaDeFotos(valor("--fotos"));
  const inventario = inventariarFotos(carpeta);
  if (!inventario.fotos.length) throw new Error(`No hay fotos images (${FOTOS_DEL_DUENO.desde})…(${FOTOS_DEL_DUENO.hasta}).jpg en ${carpeta}.`);
  if (args.includes("--json")) console.log(JSON.stringify(inventario, null, 2));
  else for (const f of inventario.fotos) console.log(`${f.id}\t${f.nombre}\t${f.bytes}\t${f.sha256}`);
  const salida = valor("--salida");
  if (salida) console.error(escribirEsqueleto(salida, inventario, new Date().toISOString()) ? `Esqueleto escrito en ${salida}` : `${salida} ya existe: no se toca.`);
  if (inventario.faltantes.length) console.error(`Faltan: ${inventario.faltantes.join(", ")}`);
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }
}
