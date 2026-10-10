/**
 * Arnés de entrenamiento del asistente del taller (W4): por cada foto de referencia, el camino real del Taller
 * («modelar desde foto» + hasta N vueltas del asistente) y su puntuación. Escribe una corrida en
 * `<corridas>/<fecha>/` y el leaderboard en la bitácora. Las corridas, la caché de la detección y la auditoría viven fuera del repo
 * (ENTRENAMIENTO_CORRIDAS; por defecto %LOCALAPPDATA%/demo-decoracion/entrenamiento/corridas), para que sobrevivan al worktree.
 *
 *   # Dry-run offline (sin llamadas de pago; el modelo se sustituye por respuestas grabadas con coste simulado):
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/entrenamiento/arnes.ts --seco
 *
 *   # Real (Claude Haiku en local, con la llave en .env.local; el tope de la pasada es el coste):
 *   NODE_OPTIONS=--use-system-ca npx tsx --env-file=.env.local --conditions=react-server scripts/entrenamiento/arnes.ts --tope-usd 3 --turnos 2
 *   (con NODE_ENV=development en el entorno; el propio arnés lo exige)
 *   Con IA_CLAUDE_TRANSPORTE=cli (la suscripción de Claude Code, sin llave) el modelo es el alias de la config (`haiku`), no hay
 *   precio por llamada que verificar (cuestan 0) y el único tope que corta es --max-llamadas, exacto: la guarda de procesos
 *   no lanza ningún `claude` pasado el máximo, y al parar la pasada la señal de aborto mata los que corren.
 *
 * Opciones: --seco · --turnos N (vueltas del asistente por foto, 0 a 4; por defecto 2) · --tope-usd X (tope de gasto de la
 * pasada; por defecto 1,00, o ENTRENAMIENTO_TOPE_USD) · --max-llamadas N (tope de llamadas a la IA; por defecto 400) ·
 * --limite N (solo las primeras N fotos) · --fotos <dir> (por defecto C:/Users/davidt/Downloads/iaiaaaaa, o
 * ENTRENAMIENTO_FOTOS) · --leaderboard <ruta> (por defecto, la bitácora: solo en real; el de seco se escribe al lado de la ruta, o en
 * la carpeta de corridas si no se da, como LEADERBOARD-seco.md).
 * Recomendado con un tope de 1 USD: correr por tramos con --limite o --fotos, porque las 30 fotos pueden pasar el tope.
 *
 * Sobre una corrida guardada, sin llamadas de pago: `rescorear-corrida.ts` (vuelve a puntuar), `reclasificar-corrida.ts` (las causas
 * concretas de capacidad_faltante) y `congelar-deteccion.ts` (deja la detección de esa corrida como la verdad de las siguientes: la
 * caché solo se llena con la primera corrida que usa la clave de ahora).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { costeClaudeUsd } from "@/lib/ia/claude/precios";
import { CupoGasto, topeDesde } from "./lib-cupo-gasto";
import { commitDeTrabajo, ejecutarGitEn } from "./lib-commit";
import type { EvidenciaCapacidad } from "./lib-capacidad";
import { ContadorLlamadas } from "./lib-contador";
import { FOTOS_POR_DEFECTO, listarFotos } from "./lib-fotos";
import { construirLeaderboard, rutaDelLeaderboard } from "./lib-leaderboard";
import { instalarGuardaProcesos } from "./lib-procesos-cli";
import { instalarGuardaRed } from "./lib-red";
import { directorioDeCorridas } from "./lib-rutas";
import { desactivarTelemetriaEnBaseDeDatos } from "./lib-telemetria";
import { transporteDeClaude, verificarTransporteDeLaApp } from "./lib-transporte";
import type { ModoPasada, RegistroPasada, TransporteArnes } from "./lib-agregado";

const args = process.argv.slice(2);
const valor = (nombre: string): string | undefined => {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : undefined;
};
const seco = args.includes("--seco");

const RAIZ = directorioDeCorridas();
const REPO = path.resolve(__dirname, "..", "..");
const LEADERBOARD_POR_DEFECTO = "C:/Users/davidt/bitacora/pictures/research/entrenamiento/LEADERBOARD.md";
const MAX_LLAMADAS_POR_DEFECTO = 400;

const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Entorno del arnés: RAG y Gemini/fal fuera, registro de auditoría activo y, en seco, Claude con llave de relleno. */
function prepararEntorno(): TransporteArnes {
  Object.assign(process.env, {
    TALLER_RAG_ENABLED: "false",
    RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED: "false",
    REGISTRO_ACTIVO: "1",
    REGISTRO_DIR: path.join(RAIZ, "registro"),
    // La auditoría va a archivo (<corridas>/registro); por consola solo errores, para que el log del arnés se pueda leer.
    REGISTRO_NIVEL_STDOUT: "error",
  });
  delete process.env.GEMINI_API_KEY;
  delete process.env.FAL_KEY;
  if (seco) {
    // Solo en memoria: la llave es de relleno y la guarda de red no deja salir nada que no sea la respuesta grabada.
    Object.assign(process.env, { NODE_ENV: "development", IA_PROVEEDOR: "claude", ANTHROPIC_API_KEY: "seco-sin-llave" });
    delete process.env.VERCEL;
    delete process.env.IA_CLAUDE_TRANSPORTE;
    return "seco";
  }
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL) {
    throw new Error("El arnés solo corre en local: NODE_ENV=development y sin VERCEL.");
  }
  return transporteDeClaude(process.env);
}

/** Lo que la config de la app dice del modelo, una vez comprobado que habla el mismo transporte que el arnés. */
async function ajustesDelArnes(transporte: TransporteArnes): Promise<{ modelo: string; esfuerzo: string; pensamiento: boolean }> {
  const config = (await import("@/lib/ia/claude/config")).configClaudeLocal();
  if (transporte !== "seco") verificarTransporteDeLaApp(transporte, "transporte" in config ? String(config.transporte) : undefined);
  return { modelo: transporte === "seco" ? "claude-haiku-5-5" : config.modelo, esfuerzo: config.esfuerzo, pensamiento: config.pensamiento };
}

/** Registro mínimo cuando la pasada de una foto lanza algo inesperado: la foto queda anotada, no se pierde. */
function registroDeError(nombre: string, base: Omit<RegistroPasada, "foto" | "error" | "abortada" | "fallos" | "iniciadaEn">, error: unknown): RegistroPasada {
  return { ...base, foto: nombre, iniciadaEn: new Date().toISOString(), fallos: [], abortada: null, error: mensajeDe(error) };
}

async function main(): Promise<void> {
  const turnos = Number(valor("--turnos") ?? 2);
  if (!Number.isInteger(turnos) || turnos < 0 || turnos > 4) throw new Error(`--turnos debe ser un entero de 0 a 4 (recibido: ${valor("--turnos")}).`);
  const tope = topeDesde(valor("--tope-usd"), process.env.ENTRENAMIENTO_TOPE_USD);
  const maxLlamadas = valor("--max-llamadas") === undefined ? MAX_LLAMADAS_POR_DEFECTO : Number(valor("--max-llamadas"));
  if (!Number.isInteger(maxLlamadas) || maxLlamadas < 1) throw new Error("--max-llamadas debe ser un entero positivo.");
  const limite = valor("--limite") === undefined ? undefined : Number(valor("--limite"));
  if (limite !== undefined && (!Number.isInteger(limite) || limite < 1)) throw new Error("--limite debe ser un entero positivo.");
  const dirFotos = valor("--fotos") ?? process.env.ENTRENAMIENTO_FOTOS ?? FOTOS_POR_DEFECTO;
  const rutaLeaderboard = rutaDelLeaderboard({ seco, indicada: valor("--leaderboard"), porDefecto: LEADERBOARD_POR_DEFECTO, raizCorridas: RAIZ });
  const modo: ModoPasada = seco ? "seco" : "real";

  const transporte = prepararEntorno();
  const { modelo, esfuerzo, pensamiento } = await ajustesDelArnes(transporte);
  if (transporte !== "cli" && costeClaudeUsd(modelo, { input_tokens: 0, output_tokens: 0 }) === undefined) {
    throw new Error(`El modelo «${modelo}» no tiene precio cargado: el arnés no corre sin tope verificable.`);
  }
  if (!seco) {
    const { destinoGenerativo } = await import("@/lib/ia/nucleo/cliente-generativo");
    if (destinoGenerativo().proveedor !== "claude") throw new Error("Sin Claude local (IA_PROVEEDOR=claude y la llave o el transporte CLI): el arnés no corre con Gemini.");
  }

  const fotos = listarFotos(dirFotos).slice(0, limite);
  if (!fotos.length) throw new Error(`No hay fotos images (25)…(54).jpg en ${dirFotos}.`);
  const corridaId = new Date().toISOString().replace(/[:.]/g, "-");
  const dirCorrida = path.join(RAIZ, corridaId);
  mkdirSync(dirCorrida, { recursive: true });
  const commit = commitDeTrabajo(ejecutarGitEn(REPO));

  const { pasadaDeFoto } = await import("./lib-pasada");
  await desactivarTelemetriaEnBaseDeDatos();
  const cupo = new CupoGasto(tope);
  const contador = new ContadorLlamadas(cupo, maxLlamadas, transporte);
  const ejecutadas: string[] = [];
  const registros: RegistroPasada[] = [];
  let detenida: string | null = null;
  const red = instalarGuardaRed(transporte, { parado: () => contador.paro });
  const restaurarProcesos = transporte === "cli" ? instalarGuardaProcesos(() => contador.paro, maxLlamadas) : () => undefined;
  contador.activar();
  try {
    for (const nombre of fotos) {
      if (!contador.margen()) { detenida = contador.paro ?? "sin margen de coste o de llamadas"; break; }
      const bytes = new Uint8Array(readFileSync(path.join(dirFotos, nombre)));
      let registro: RegistroPasada;
      let escena: unknown = null;
      let evidencia: EvidenciaCapacidad | undefined;
      try {
        const r = await pasadaDeFoto({ corrida: corridaId, nombre, bytes, turnos, contador, modo, transporte, modelo, esfuerzo, pensamiento, commit, dirCacheDeteccion: path.join(RAIZ, "cache-deteccion") });
        registro = r.registro;
        escena = r.escena;
        evidencia = r.evidencia;
      } catch (error) {
        registro = registroDeError(nombre, { modo, transporte, modelo, esfuerzo, pensamiento, commit, turnos: 0, turnosMax: turnos, llamadas: 0, deteccionCacheada: false, convergio: false, puntajes: { proporciones: null, colores: null, zonas: null, iou: null }, piezas: { leidas: 0, armadas: 0, omitidas: 0, globosFoto: 0, globosArmados: 0 }, captura: "pendiente", costeUsd: 0 }, error);
      }
      writeFileSync(path.join(dirCorrida, `${nombre.replace(/\.jpg$/, "")}.json`), JSON.stringify({ registro, escena, evidencia }, null, 2));
      registros.push(registro);
      ejecutadas.push(nombre);
      const estado = registro.error ? `error: ${registro.error.slice(0, 120)}` : registro.fallos.join(",") || "sin fallos";
      console.log(`${nombre}: vueltas ${registro.turnos}, llamadas ${registro.llamadas}, coste ${registro.costeUsd.toFixed(4)} USD, ${estado}`);
      if (contador.paro) { detenida = contador.paro; break; }
    }
  } catch (error) {
    detenida = `error del arnés: ${mensajeDe(error)}`;
  } finally {
    contador.desactivar();
    red.restaurar();
    restaurarProcesos();
    const resumen = {
      corridaId, modo, transporte, modelo, esfuerzo, pensamiento, commit, turnos, topeUsd: tope, maxLlamadas,
      gastadoUsd: Math.round(cupo.gastado * 1e6) / 1e6, llamadas: contador.llamadas,
      ejecutadas, sinEjecutar: fotos.filter((f) => !ejecutadas.includes(f)), detenida,
    };
    writeFileSync(path.join(dirCorrida, "resumen.json"), JSON.stringify(resumen, null, 2));
    mkdirSync(path.dirname(rutaLeaderboard), { recursive: true });
    writeFileSync(rutaLeaderboard, construirLeaderboard(RAIZ, modo, new Date().toISOString()));
    console.log(`Pasada ${corridaId} (${modo}, ${transporte}): ${ejecutadas.length}/${fotos.length} fotos, ${contador.llamadas} llamadas, gastado ${cupo.gastado.toFixed(4)} de ${tope.toFixed(2)} USD${detenida ? `. Detenida: ${detenida}` : ""}.`);
    console.log(`Leaderboard: ${rutaLeaderboard}`);
  }
}

main().catch((error: unknown) => {
  console.error(mensajeDe(error));
  process.exit(1);
});
