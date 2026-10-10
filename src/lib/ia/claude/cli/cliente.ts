import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ErrorIA } from "@sempertex/agente-core";
import type { ClienteAnthropic } from "../cliente";
import { entornoLocal } from "../config";
import type { CuerpoMensajes, RespuestaAnthropic } from "../tipos";
import { cupoCompartido, type Cupo } from "./cupo";
import { resolverEjecutableClaude } from "./ejecutable";
import { argumentosCli, peticionCli } from "./peticion";
import { correrClaudeCli, entornoHijo, lanzarConSpawn, type LanzarProceso } from "./proceso";
import { eventosDeRespuesta, respuestaDeResultado } from "./salida";

/**
 * Transporte de Claude por el Claude Code instalado en el equipo (`IA_CLAUDE_TRANSPORTE=cli`, pedido del dueño: «no tengo
 * la API key»): misma forma que el transporte HTTP (`messages.create` / `messages.stream`), así el bucle de herramientas,
 * el historial y la auditoría son los mismos. Usa la sesión de la suscripción, nunca una llave (ANTHROPIC_* no llega al
 * hijo). SOLO local: además del candado del registro, cada llamada vuelve a exigir NODE_ENV=development y sin VERCEL
 * antes de lanzar nada. Cada llamada corre en una carpeta temporal vacía que se borra al terminar.
 * `stream` no es flujo real: Claude Code entrega el turno entero y se reemiten sus eventos de una vez.
 */

type Entorno = Readonly<Record<string, string | undefined>>;

/** Una lectura de foto con esfuerzo medium tarda decenas de segundos; esto solo corta un proceso colgado. */
export const PLAZO_CLI_MS = 300_000;

export type OpcionesClienteCli = {
  /** Ruta del binario; por defecto `resolverEjecutableClaude`. */
  ejecutable?: string;
  lanzar?: LanzarProceso;
  entorno?: Entorno;
  plazoMs?: number;
  cupo?: Cupo;
};

async function ejecutar(cuerpo: CuerpoMensajes, opciones: OpcionesClienteCli, signal: AbortSignal | undefined): Promise<RespuestaAnthropic> {
  const entorno = opciones.entorno ?? process.env;
  if (!entornoLocal(entorno)) {
    throw new ErrorIA("sin_llave", "claude", "El transporte de Claude por Claude Code (CLI) solo corre en local (NODE_ENV=development, sin VERCEL).", false);
  }
  const ejecutable = opciones.ejecutable ?? resolverEjecutableClaude(entorno);
  const peticion = peticionCli(cuerpo);
  const plazoMs = opciones.plazoMs ?? PLAZO_CLI_MS;
  const liberar = await (opciones.cupo ?? cupoCompartido()).tomar(signal, plazoMs);
  let carpeta: string | undefined;
  try {
    carpeta = await mkdtemp(path.join(tmpdir(), "claude-cli-"));
    const rutaSistema = path.join(carpeta, "sistema.md");
    await writeFile(rutaSistema, peticion.sistema, "utf8");
    const resultado = await correrClaudeCli({
      lanzar: opciones.lanzar ?? lanzarConSpawn,
      ejecutable,
      argumentos: argumentosCli(cuerpo, rutaSistema, peticion.esquema),
      cwd: carpeta,
      env: entornoHijo(entorno, { maxTokens: cuerpo.max_tokens, razonamiento: cuerpo.thinking.type !== "disabled" }),
      lineaEntrada: peticion.lineaEntrada,
      plazoMs,
      signal,
    });
    return respuestaDeResultado(resultado, { modelo: cuerpo.model, conEsquema: peticion.esquema !== null, permitidas: peticion.permitidas });
  } finally {
    liberar();
    if (carpeta) await rm(carpeta, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  }
}

export function crearClienteClaudeCli(opciones: OpcionesClienteCli = {}): ClienteAnthropic {
  return {
    messages: {
      create: (cuerpo, llamada) => ejecutar(cuerpo, opciones, llamada?.signal),
      async stream(cuerpo, llamada) {
        return eventosDeRespuesta(await ejecutar(cuerpo, opciones, llamada?.signal));
      },
    },
  };
}
