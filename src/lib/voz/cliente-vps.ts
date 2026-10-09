import { z } from "zod";
import type { ConfigVoz } from "./config";
import { CABECERA_FIRMA, CABECERA_TIMESTAMP, firmarPedido } from "./firma";

/** Tiempo máximo de cada intento. */
export const TIMEOUT_VPS_MS = 20_000;
/** Lo que puede durar todo el pedido, con la espera y el reintento; el reintento se salta si no queda tiempo para él. */
export const PRESUPUESTO_TOTAL_MS = 30_000;
const MINIMO_PARA_REINTENTAR_MS = 8_000;
/** Lo máximo que se espera un `Retry-After` del servicio ocupado antes del único reintento (el VPS pide 5 s). */
export const ESPERA_MAXIMA_REINTENTO_MS = 6_000;
const ESPERA_POR_DEFECTO_MS = 1_000;

export type CodigoErrorVoz = "no_configurada" | "ocupado" | "demasiado_largo" | "servicio" | "tiempo_agotado";

/**
 * Error tipado de la ruta de dictado; la ruta lo traduce a HTTP y a un mensaje en un solo lugar. `estadoVps` es lo que
 * respondió el VPS (401 = secreto o reloj, 415, 503…): queda en la auditoría, nunca en la respuesta al navegador.
 */
export class ErrorVoz extends Error {
  constructor(readonly codigo: CodigoErrorVoz, readonly reintentarEnSeg?: number, readonly estadoVps?: number) {
    super(estadoVps ? `${codigo} (VPS ${estadoVps})` : codigo);
    this.name = "ErrorVoz";
  }
}

const RespuestaSchema = z.object({
  texto: z.string(),
  duracion_s: z.number().finite().nonnegative(),
  ms: z.number().finite().nonnegative(),
});
export type RespuestaVps = z.infer<typeof RespuestaSchema>;

export type DependenciasVps = {
  fetch: typeof fetch;
  ahora: () => number;
  esperar: (ms: number) => Promise<void>;
  /** Tiempo máximo de cada intento (por defecto `TIMEOUT_VPS_MS`). */
  timeoutMs?: number;
};

export const dependenciasVpsReales: DependenciasVps = {
  fetch: (...args) => fetch(...args),
  ahora: () => Date.now(),
  esperar: (ms) => new Promise((resolver) => setTimeout(resolver, ms)),
};

/** Segundos de un `Retry-After` numérico → ms acotados; ausente o ilegible → 1 s. */
export function esperaDeReintento(cabecera: string | null): number {
  const segundos = Number(cabecera);
  if (!cabecera || !Number.isFinite(segundos) || segundos < 0) return ESPERA_POR_DEFECTO_MS;
  return Math.min(Math.round(segundos * 1000), ESPERA_MAXIMA_REINTENTO_MS);
}

type Intento = { status: number; reintentarDespues: string | null; cuerpo: unknown; timestamp: number };

/**
 * Un intento, con su propio plazo (cubre también la lectura de la respuesta). El VPS rechaza una firma que ya aceptó: cada
 * intento se firma con un instante propio, y nunca en el mismo segundo que el anterior (`minimo`), aunque el reloj no avance.
 */
async function intentar(audio: Uint8Array, contentType: string, config: ConfigVoz & { url: string; secreto: string }, deps: DependenciasVps, minimo: number, plazoMs: number): Promise<Intento> {
  const timestamp = Math.max(Math.floor(deps.ahora() / 1000), minimo);
  const cancelador = new AbortController();
  const plazo = setTimeout(() => cancelador.abort(new ErrorVoz("tiempo_agotado")), plazoMs);
  try {
    const respuesta = await deps.fetch(`${config.url}/v1/transcribir`, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        [CABECERA_TIMESTAMP]: String(timestamp),
        [CABECERA_FIRMA]: firmarPedido(config.secreto, timestamp, audio),
      },
      body: Buffer.from(audio),
      signal: cancelador.signal,
      cache: "no-store",
    });
    const cuerpo: unknown = respuesta.ok ? await respuesta.json().catch(() => null) : null;
    return { status: respuesta.status, reintentarDespues: respuesta.headers.get("retry-after"), cuerpo, timestamp };
  } catch (error) {
    if (error instanceof ErrorVoz) throw error;
    throw new ErrorVoz(cancelador.signal.aborted ? "tiempo_agotado" : "servicio");
  } finally {
    clearTimeout(plazo);
  }
}

/** Pasa el audio al servicio del VPS, firmado. Un solo reintento si está ocupado (503) y si queda tiempo. Nunca guarda el audio. */
export async function transcribirEnVps(audio: Uint8Array, contentType: string, config: ConfigVoz, deps: DependenciasVps = dependenciasVpsReales): Promise<RespuestaVps> {
  if (!config.url || !config.secreto) throw new ErrorVoz("no_configurada");
  const configurada = { ...config, url: config.url, secreto: config.secreto };
  const porIntento = deps.timeoutMs ?? TIMEOUT_VPS_MS;
  const inicio = deps.ahora();
  const primero = await intentar(audio, contentType, configurada, deps, 0, porIntento);
  let ultimo = primero;
  if (primero.status === 503) {
    const espera = esperaDeReintento(primero.reintentarDespues);
    const restante = PRESUPUESTO_TOTAL_MS - (deps.ahora() - inicio) - espera;
    if (restante < MINIMO_PARA_REINTENTAR_MS) throw new ErrorVoz("ocupado", Math.ceil(espera / 1000), 503);
    await deps.esperar(espera);
    ultimo = await intentar(audio, contentType, configurada, deps, primero.timestamp + 1, Math.min(porIntento, restante));
    if (ultimo.status === 503) throw new ErrorVoz("ocupado", Math.ceil(esperaDeReintento(ultimo.reintentarDespues) / 1000), 503);
  }
  // Contrato del VPS: 413 y 422 son «audio demasiado grande o demasiado largo».
  if (ultimo.status === 413 || ultimo.status === 422) throw new ErrorVoz("demasiado_largo", undefined, ultimo.status);
  // 401 (firma o reloj), 415, 400, 5xx: un solo código hacia fuera; el estado queda en la auditoría.
  if (ultimo.status < 200 || ultimo.status >= 300) throw new ErrorVoz("servicio", undefined, ultimo.status);
  const datos = RespuestaSchema.safeParse(ultimo.cuerpo);
  if (!datos.success) throw new ErrorVoz("servicio", undefined, ultimo.status);
  return datos.data;
}
