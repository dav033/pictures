import { z } from "zod";
import type { ConfigVoz } from "./config";
import { CABECERA_FIRMA, CABECERA_TIMESTAMP, firmarPedido } from "./firma";

export const TIMEOUT_VPS_MS = 20_000;
/** Lo máximo que se espera un `Retry-After` del servicio ocupado antes del único reintento (el VPS pide 5 s). */
export const ESPERA_MAXIMA_REINTENTO_MS = 6_000;
const ESPERA_POR_DEFECTO_MS = 1_000;

export type CodigoErrorVoz = "no_configurada" | "ocupado" | "demasiado_largo" | "servicio" | "tiempo_agotado";

/** Error tipado de la ruta de dictado; la ruta lo traduce a HTTP y a un mensaje en un solo lugar. */
export class ErrorVoz extends Error {
  constructor(readonly codigo: CodigoErrorVoz, readonly reintentarEnSeg?: number) {
    super(codigo);
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
  /** Espera `ms`; rechaza si la señal se cancela. */
  esperar: (ms: number, senal: AbortSignal) => Promise<void>;
  timeoutMs?: number;
};

export const dependenciasVpsReales: DependenciasVps = {
  fetch: (...args) => fetch(...args),
  ahora: () => Date.now(),
  esperar: (ms, senal) => new Promise((resolver, rechazar) => {
    if (senal.aborted) { rechazar(senal.reason); return; }
    const reloj = setTimeout(() => { senal.removeEventListener("abort", alCancelar); resolver(); }, ms);
    const alCancelar = () => { clearTimeout(reloj); rechazar(senal.reason); };
    senal.addEventListener("abort", alCancelar, { once: true });
  }),
};

/** Segundos de un `Retry-After` numérico → ms acotados; ausente o ilegible → 1 s. */
export function esperaDeReintento(cabecera: string | null): number {
  const segundos = Number(cabecera);
  if (!cabecera || !Number.isFinite(segundos) || segundos < 0) return ESPERA_POR_DEFECTO_MS;
  return Math.min(Math.round(segundos * 1000), ESPERA_MAXIMA_REINTENTO_MS);
}

/**
 * El VPS rechaza una firma que ya aceptó: cada intento se firma con un instante propio, y nunca en el mismo segundo que el
 * anterior (`minimo`), aunque el reloj no haya avanzado.
 */
async function enviarUnaVez(audio: Uint8Array, contentType: string, config: ConfigVoz & { url: string; secreto: string }, deps: DependenciasVps, senal: AbortSignal, minimo: number): Promise<{ respuesta: Response; timestamp: number }> {
  const timestamp = Math.max(Math.floor(deps.ahora() / 1000), minimo);
  const respuesta = await deps.fetch(`${config.url}/v1/transcribir`, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      [CABECERA_TIMESTAMP]: String(timestamp),
      [CABECERA_FIRMA]: firmarPedido(config.secreto, timestamp, audio),
    },
    body: Buffer.from(audio),
    signal: senal,
    cache: "no-store",
  });
  return { respuesta, timestamp };
}

/** Pasa el audio al servicio del VPS, firmado. Un solo reintento si está ocupado (503). Nunca guarda el audio. */
export async function transcribirEnVps(audio: Uint8Array, contentType: string, config: ConfigVoz, deps: DependenciasVps = dependenciasVpsReales): Promise<RespuestaVps> {
  if (!config.url || !config.secreto) throw new ErrorVoz("no_configurada");
  const configurada = { ...config, url: config.url, secreto: config.secreto };
  const cancelador = new AbortController();
  const plazo = setTimeout(() => cancelador.abort(new ErrorVoz("tiempo_agotado")), deps.timeoutMs ?? TIMEOUT_VPS_MS);
  try {
    const primero = await enviarUnaVez(audio, contentType, configurada, deps, cancelador.signal, 0);
    let respuesta = primero.respuesta;
    if (respuesta.status === 503) {
      const espera = esperaDeReintento(respuesta.headers.get("retry-after"));
      await deps.esperar(espera, cancelador.signal);
      respuesta = (await enviarUnaVez(audio, contentType, configurada, deps, cancelador.signal, primero.timestamp + 1)).respuesta;
      if (respuesta.status === 503) throw new ErrorVoz("ocupado", Math.ceil(esperaDeReintento(respuesta.headers.get("retry-after")) / 1000));
    }
    // Contrato del VPS: 413 y 422 son «audio demasiado grande o demasiado largo».
    if (respuesta.status === 413 || respuesta.status === 422) throw new ErrorVoz("demasiado_largo");
    // 401 del VPS (firma o reloj) y cualquier otro fallo: un solo código, sin filtrar detalles del servicio.
    if (!respuesta.ok) throw new ErrorVoz("servicio");
    const datos = RespuestaSchema.safeParse(await respuesta.json());
    if (!datos.success) throw new ErrorVoz("servicio");
    return datos.data;
  } catch (error) {
    if (error instanceof ErrorVoz) throw error;
    if (cancelador.signal.aborted) throw new ErrorVoz("tiempo_agotado");
    throw new ErrorVoz("servicio");
  } finally {
    clearTimeout(plazo);
  }
}
