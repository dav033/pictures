/**
 * Reintento genérico con backoff exponencial + jitter. `ErrorIA.reintentable`
 * se calcula en cada adaptador (ver `gemini/chat.ts`) — este helper es lo que
 * conecta esa señal a un reintento real.
 */
export type OpcionesReintento = {
  /** Intentos totales incluyendo el primero. */
  intentos?: number;
  /** Delay base en ms antes del backoff exponencial. */
  baseMs?: number;
  /** Decide si vale la pena reintentar ESTE error. Default: siempre. */
  esReintentable?: (error: unknown) => boolean;
  signal?: AbortSignal;
};

function asegurarActivo(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error("CLIENT_CANCELLED");
}

export async function conReintento<T>(fn: () => Promise<T>, opciones: OpcionesReintento = {}): Promise<T> {
  const intentos = opciones.intentos ?? 3;
  const baseMs = opciones.baseMs ?? 300;
  const esReintentable = opciones.esReintentable ?? (() => true);

  let ultimoError: unknown;
  for (let intento = 0; intento < intentos; intento++) {
    asegurarActivo(opciones.signal);
    try {
      return await fn();
    } catch (error) {
      ultimoError = error;
      if (intento === intentos - 1 || !esReintentable(error)) throw error;
      const espera = baseMs * 2 ** intento + Math.random() * baseMs;
      await new Promise<void>((resolve, reject) => {
        let terminado = false;
        const timer = setTimeout(() => {
          terminado = true;
          opciones.signal?.removeEventListener("abort", abortar);
          resolve();
        }, espera);
        const abortar = () => {
          if (terminado) return;
          terminado = true;
          clearTimeout(timer);
          opciones.signal?.removeEventListener("abort", abortar);
          reject(opciones.signal?.reason ?? new Error("CLIENT_CANCELLED"));
        };
        opciones.signal?.addEventListener("abort", abortar, { once: true });
        if (opciones.signal?.aborted) abortar();
      });
    }
  }
  throw ultimoError;
}
