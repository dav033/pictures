/**
 * Núcleo del arnés de entrenamiento (W4) para UNA foto: `modelar_desde_foto` + N vueltas del asistente de escena
 * (`pasadaDeFoto`, el camino real del Taller) + la puntuación de `scripts/exp/lib-proporciones.ts` y `lib-zonas.ts`
 * (por `lib-puntuacion.ts`), y un resultado JSON. Nunca edita una escena a mano: la escena del resultado es la que dejó el asistente.
 * El proveedor es el que configure el entorno; con `--seco` (alias `--simulado`) es el transporte de respuestas grabadas, sin red
 * y con coste simulado. El tope de gasto (`--tope-usd`) y el de llamadas (`--max-llamadas`) cortan la pasada.
 * La captura del visor sin cabeza no existe todavía: `captura` queda «pendiente» y se dice en el resultado.
 *
 *   npx tsx --conditions=react-server scripts/entrenamiento/correr-foto.ts <foto.jpg> --seco [--turnos 2] [--tope-usd 1] [--max-llamadas 400] [--salida resultado.json]
 *
 * La línea de comandos solo corre en seco; las corridas reales pasan por `arnes.ts` (que prepara el entorno, el tope y el leaderboard) o llaman a `correrFoto` con el entorno ya preparado.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Escena } from "@/lib/globos3d/escena";
import type { ModoPasada, RegistroPasada, TransporteArnes } from "./lib-agregado";
import type { EvidenciaCapacidad } from "./lib-capacidad";
import { ContadorLlamadas } from "./lib-contador";
import { CupoGasto, TOPE_GASTO_POR_DEFECTO_USD } from "./lib-cupo-gasto";
import { instalarGuardaRed } from "./lib-red";

export type EntradaCorrerFoto = {
  nombre: string;
  bytes: Uint8Array;
  /** Vueltas del asistente (0 a 4). */
  turnos: number;
  topeUsd: number;
  maxLlamadas: number;
  /** Seco: respuestas grabadas, sin red; real: el proveedor del entorno. */
  seco: boolean;
  /** Identificador de la corrida (su carpeta): con el nombre de la foto, la conversación de auditoría. */
  corrida: string;
  modelo: string;
  esfuerzo: string;
  pensamiento: boolean;
  commit: string;
  /** Donde se cachea la detección (solo en real; el seco no escribe nada). */
  dirCacheDeteccion: string;
  /** Solo real: el transporte con que habla el entorno. */
  transporte?: Exclude<TransporteArnes, "seco">;
};

export type ResultadoCorrerFoto = {
  registro: RegistroPasada;
  escena: Escena | null;
  evidencia?: EvidenciaCapacidad;
  gastadoUsd: number;
  llamadas: number;
  topeAlcanzado: boolean;
  /** La captura del visor sin cabeza no está hecha: siempre `pendiente` (TODO: capturador, necesita el servidor de desarrollo). */
  captura: "pendiente";
};

/** Entorno del modo seco: la llave es de relleno y la guarda de red solo sirve la respuesta grabada. Solo en memoria. */
const CLAVES_ENTORNO_SECO = ["NODE_ENV", "IA_PROVEEDOR", "ANTHROPIC_API_KEY", "TALLER_RAG_ENABLED", "RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED", "VERCEL", "IA_CLAUDE_TRANSPORTE", "GEMINI_API_KEY", "FAL_KEY"] as const;

/** Lo que `prepararEntornoSeco` cambia, para devolverlo tal cual estaba (también las claves que no existían). */
function guardarEntorno(entorno: NodeJS.ProcessEnv): () => void {
  const antes = CLAVES_ENTORNO_SECO.map((clave) => [clave, entorno[clave]] as const);
  return () => { for (const [clave, valor] of antes) { if (valor === undefined) delete entorno[clave]; else Object.assign(entorno, { [clave]: valor }); } };
}

export function prepararEntornoSeco(entorno: NodeJS.ProcessEnv = process.env): void {
  Object.assign(entorno, { NODE_ENV: "development", IA_PROVEEDOR: "claude", ANTHROPIC_API_KEY: "seco-sin-llave", TALLER_RAG_ENABLED: "false", RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED: "false" });
  delete entorno.VERCEL;
  delete entorno.IA_CLAUDE_TRANSPORTE;
  delete entorno.GEMINI_API_KEY;
  delete entorno.FAL_KEY;
}

export function validarEntrada(e: EntradaCorrerFoto): void {
  if (!Number.isInteger(e.turnos) || e.turnos < 0 || e.turnos > 4) throw new Error(`turnos debe ser un entero de 0 a 4 (recibido: ${e.turnos}).`);
  if (!e.bytes.byteLength) throw new Error(`La foto ${e.nombre} está vacía.`);
}

export async function correrFoto(entrada: EntradaCorrerFoto): Promise<ResultadoCorrerFoto> {
  validarEntrada(entrada);
  const restaurarEntorno = entrada.seco ? guardarEntorno(process.env) : null;
  const guardaSeca = entrada.seco ? instalarGuardaRed("seco") : null;
  if (entrada.seco) prepararEntornoSeco();
  const transporte: TransporteArnes = entrada.seco ? "seco" : entrada.transporte ?? "api";
  const modo: ModoPasada = entrada.seco ? "seco" : "real";
  const contador = new ContadorLlamadas(new CupoGasto(entrada.topeUsd), entrada.maxLlamadas, transporte);
  try {
    const { pasadaDeFoto } = await import("./lib-pasada");
    contador.activar();
    const r = await pasadaDeFoto({
      corrida: entrada.corrida, nombre: entrada.nombre, bytes: entrada.bytes, turnos: entrada.turnos, contador, modo, transporte,
      modelo: entrada.modelo, esfuerzo: entrada.esfuerzo, pensamiento: entrada.pensamiento, commit: entrada.commit, dirCacheDeteccion: entrada.dirCacheDeteccion,
    });
    return {
      registro: r.registro, escena: r.escena, ...(r.evidencia ? { evidencia: r.evidencia } : {}),
      gastadoUsd: Math.round(contador.gastado * 1e6) / 1e6, llamadas: contador.llamadas, topeAlcanzado: r.topeAlcanzado, captura: "pendiente",
    };
  } finally {
    contador.desactivar();
    guardaSeca?.restaurar();
    restaurarEntorno?.();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const valor = (nombre: string) => { const i = args.indexOf(nombre); return i >= 0 ? args[i + 1] : undefined; };
  const foto = args.find((a) => !a.startsWith("--") && a !== valor("--turnos") && a !== valor("--tope-usd") && a !== valor("--max-llamadas") && a !== valor("--salida"));
  if (!foto) throw new Error("Uso: correr-foto.ts <foto.jpg> [--seco] [--turnos N] [--tope-usd X] [--max-llamadas N] [--salida resultado.json]");
  const seco = args.includes("--seco") || args.includes("--simulado");
  if (!seco) throw new Error("Sin --seco usa scripts/entrenamiento/arnes.ts: correr-foto.ts por línea de comandos solo corre en seco.");
  const cache = mkdtempSync(path.join(tmpdir(), "correr-foto-"));
  try {
    const resultado = await correrFoto({
      nombre: path.basename(foto), bytes: new Uint8Array(readFileSync(foto)), seco,
      turnos: Number(valor("--turnos") ?? 2), topeUsd: Number(valor("--tope-usd") ?? TOPE_GASTO_POR_DEFECTO_USD), maxLlamadas: Number(valor("--max-llamadas") ?? 400),
      corrida: new Date().toISOString().replace(/[:.]/g, "-"), modelo: "claude-haiku-5-5", esfuerzo: "medium", pensamiento: true,
      commit: "correr-foto", dirCacheDeteccion: cache,
    });
    const json = JSON.stringify(resultado, null, 2);
    const salida = valor("--salida");
    if (salida) writeFileSync(salida, json); else console.log(json);
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
}
