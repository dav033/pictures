import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { ErrorIA } from "@sempertex/agente-core";
import { ErrorCliClaude } from "../errores";
import { leerLineaCli, verificarAislamiento, type ResultadoCli } from "./salida";

/**
 * Un `claude -p` como proceso hijo: escribe la línea de entrada, lee las líneas de salida, verifica el aislamiento al
 * arrancar y devuelve el `result`. Plazo y corte (`signal`) matan el proceso. stderr se guarda recortado y sin nada que
 * parezca una credencial, solo para el mensaje de error; nunca se registra aparte.
 */

type Entorno = Readonly<Record<string, string | undefined>>;

/** Lo que este transporte usa de un proceso hijo (el real lo arma `spawn`; las pruebas, uno falso). */
export type ProcesoHijo = {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  matar(): void;
  /** Resuelve con el código de salida; rechaza si no se pudo lanzar (p. ej. ENOENT). */
  readonly terminado: Promise<number | null>;
};

export type LanzarProceso = (ejecutable: string, argumentos: readonly string[], opciones: { cwd: string; env: Record<string, string> }) => ProcesoHijo;

export const lanzarConSpawn: LanzarProceso = (ejecutable, argumentos, opciones) => {
  // Sin shell: los argumentos (el esquema JSON) llegan tal cual, sin pasar por cmd.exe. El tipo de Next exige NODE_ENV en
  // `ProcessEnv`; el entorno del hijo es un diccionario de texto cualquiera.
  const env = opciones.env as NodeJS.ProcessEnv;
  const hijo = spawn(ejecutable, [...argumentos], { cwd: opciones.cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  return {
    stdin: hijo.stdin,
    stdout: hijo.stdout,
    stderr: hijo.stderr,
    matar: () => { hijo.kill(); },
    terminado: new Promise((resolve, reject) => {
      hijo.once("error", reject);
      hijo.once("close", (codigo) => resolve(codigo));
    }),
  };
};

const MAX_STDERR = 2_000;
/** Tras el `result`, Claude Code cierra al ver stdin cerrado; si no lo hace en este margen, se mata. */
const MARGEN_CIERRE_MS = 15_000;
const SECRETO_EN_NOMBRE = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|_DSN$|DATABASE_URL/i;
const SECRETO_EN_TEXTO = /sk-ant-[\w-]+|(?:bearer|token|key|secret)["'=:\s]+[\w.\-/+]{12,}/gi;

/**
 * El entorno del hijo: el del servidor SIN llaves ni secretos (Gemini, base de datos, fal…), sin ANTHROPIC_* (así usa la
 * sesión de la suscripción y nunca factura a una llave de la API) ni las variables de una sesión de Claude Code que lo
 * haya lanzado; NODE_OPTIONS tampoco (el binario no es Node). Se apagan los CLAUDE.md y la memoria automática.
 * Sin razonamiento (`thinking: disabled`, IA_LOCAL_PENSAMIENTO=off, salida JSON forzada): MAX_THINKING_TOKENS=0, la
 * variable con la que Claude Code lo apaga.
 */
export function entornoHijo(entorno: Entorno, pedido: { maxTokens: number; razonamiento: boolean }): Record<string, string> {
  const limpio: Record<string, string> = {};
  for (const [nombre, valor] of Object.entries(entorno)) {
    if (valor === undefined || nombre === "NODE_OPTIONS" || SECRETO_EN_NOMBRE.test(nombre)) continue;
    if (/^(ANTHROPIC_|CLAUDE)/i.test(nombre) && nombre.toUpperCase() !== "CLAUDE_CONFIG_DIR") continue;
    limpio[nombre] = valor;
  }
  return {
    ...limpio,
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(pedido.maxTokens),
    CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    ...(pedido.razonamiento ? {} : { MAX_THINKING_TOKENS: "0" }),
  };
}

export function resumenStderr(stderr: string): string {
  return stderr.replace(SECRETO_EN_TEXTO, "[oculto]").trim().slice(-300);
}

function errorDeCorte(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("This operation was aborted", "AbortError");
}

export function correrClaudeCli(entrada: {
  lanzar: LanzarProceso;
  ejecutable: string;
  argumentos: readonly string[];
  cwd: string;
  env: Record<string, string>;
  lineaEntrada: string;
  plazoMs: number;
  signal?: AbortSignal;
}): Promise<ResultadoCli> {
  const { signal } = entrada;
  if (signal?.aborted) return Promise.reject(errorDeCorte(signal));
  return new Promise<ResultadoCli>((resolve, reject) => {
    const hijo = entrada.lanzar(entrada.ejecutable, entrada.argumentos, { cwd: entrada.cwd, env: entrada.env });
    let pendiente = "";
    let stderr = "";
    let vioInicio = false;
    let resultado: ResultadoCli | null = null;
    let cerrado = false;
    let margen: ReturnType<typeof setTimeout> | undefined;

    const terminar = (error?: unknown) => {
      if (cerrado) return;
      cerrado = true;
      clearTimeout(plazo);
      clearTimeout(margen);
      signal?.removeEventListener("abort", alCortar);
      if (error !== undefined || !resultado) {
        hijo.matar();
        reject(error ?? new ErrorCliClaude(0, "sin_resultado", "Claude Code terminó sin resultado"));
        return;
      }
      resolve(resultado);
    };
    const alCortar = () => terminar(signal ? errorDeCorte(signal) : undefined);
    const plazo = setTimeout(
      () => terminar(new ErrorIA("timeout", "claude", `Claude Code (CLI) no respondió en ${Math.round(entrada.plazoMs / 1000)} s.`, false)),
      entrada.plazoMs,
    );
    signal?.addEventListener("abort", alCortar, { once: true });

    const procesar = (linea: string) => {
      try {
        const leida = leerLineaCli(linea);
        if (leida?.tipo === "init") {
          verificarAislamiento(leida.herramientas);
          vioInicio = true;
        } else if (leida?.tipo === "resultado") {
          if (!vioInicio) throw new ErrorCliClaude(0, "aislamiento_sin_verificar", "llegó el resultado sin el mensaje de inicio de Claude Code");
          resultado = leida.resultado;
          hijo.stdin.end();
          margen = setTimeout(() => hijo.matar(), MARGEN_CIERRE_MS);
        }
      } catch (error) {
        terminar(error);
      }
    };

    hijo.stdout.setEncoding("utf8");
    hijo.stdout.on("data", (trozo: string) => {
      pendiente += trozo;
      const lineas = pendiente.split("\n");
      pendiente = lineas.pop() ?? "";
      for (const linea of lineas) procesar(linea);
    });
    hijo.stderr.setEncoding("utf8");
    hijo.stderr.on("data", (trozo: string) => { stderr = (stderr + trozo).slice(-MAX_STDERR); });
    // Si el proceso murió antes de leer stdin (EPIPE), el cierre ya dice por qué.
    hijo.stdin.on("error", () => undefined);

    hijo.terminado.then(
      (codigo) => {
        if (pendiente.trim()) procesar(pendiente);
        if (resultado) terminar();
        else terminar(new ErrorCliClaude(0, "sin_resultado", `Claude Code terminó (código ${codigo ?? "?"}) sin resultado. ${resumenStderr(stderr)}`.trim()));
      },
      (error: unknown) => terminar(new ErrorCliClaude(0, "cli_no_arranca", `no se pudo lanzar Claude Code: ${error instanceof Error ? error.message : String(error)}`)),
    );

    hijo.stdin.write(`${entrada.lineaEntrada}\n`);
  });
}
