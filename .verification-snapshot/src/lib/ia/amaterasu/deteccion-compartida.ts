import "server-only";

/**
 * Caché y llamadas compartidas de las lecturas de la foto que corren después
 * del análisis de Amaterasu (patrón de color, ADR-0028 §11; armado del bouquet,
 * ADR-0030). Cada lectura es una llamada de visión con la foto entera: se paga
 * una vez por petición idéntica (misma foto, mismos elementos), las que están
 * en vuelo se comparten y se cancelan solo cuando ya nadie las espera. Vive en
 * el proceso de Next: un despliegue la vacía. Solo guarda respuestas válidas;
 * un fallo se vuelve a intentar en la próxima petición.
 */

type LecturaEnVuelo<T> = { promesa: Promise<readonly T[]>; controlador: AbortController; esperando: number };

export type CacheLectura<T> = {
  resultados: Map<string, readonly T[]>;
  enVuelo: Map<string, LecturaEnVuelo<T>>;
  maximo: number;
};

/** Fotos distintas que se recuerdan, como `MAX_CACHE` del análisis. */
const MAX_LECTURAS_EN_CACHE = 40;
/** Con menos tiempo que esto antes del vencimiento de la ruta no vale la pena llamar. */
const DEADLINE_MINIMO_MS = 3_000;
/** Holgura para serializar y responder después de la lectura. */
const HOLGURA_RESPUESTA_MS = 2_000;

export function crearCacheLectura<T>(maximo = MAX_LECTURAS_EN_CACHE): CacheLectura<T> {
  return { resultados: new Map(), enVuelo: new Map(), maximo };
}

/** El deadline de la llamada: su techo, acotado por lo que le queda a la ruta; `undefined` si no alcanza. */
export function deadlineLectura(vencimiento: number | undefined, techoMs: number): number | undefined {
  if (vencimiento === undefined) return techoMs;
  const restante = vencimiento - Date.now() - HOLGURA_RESPUESTA_MS;
  return restante < DEADLINE_MINIMO_MS ? undefined : Math.min(techoMs, restante);
}

function guardar<T>(cache: CacheLectura<T>, clave: string, items: readonly T[]): void {
  cache.resultados.delete(clave);
  if (cache.resultados.size >= cache.maximo) cache.resultados.delete(cache.resultados.keys().next().value!);
  cache.resultados.set(clave, items);
}

function motivoAborto(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("CLIENT_CANCELLED");
}

/**
 * Espera la lectura compartida. Si esta petición se cancela, deja de
 * esperarla; la llamada solo se cancela cuando ya nadie la espera.
 */
function esperar<T>(cache: CacheLectura<T>, clave: string, entrada: LecturaEnVuelo<T>, signal: AbortSignal | undefined): Promise<readonly T[]> {
  if (signal?.aborted) {
    if (entrada.esperando === 0) {
      if (cache.enVuelo.get(clave) === entrada) cache.enVuelo.delete(clave);
      entrada.controlador.abort(motivoAborto(signal));
    }
    return Promise.reject(motivoAborto(signal));
  }
  entrada.esperando += 1;
  return new Promise((resolve, reject) => {
    let listo = false;
    const alCancelar = () => {
      if (listo) return;
      listo = true;
      entrada.esperando -= 1;
      if (entrada.esperando === 0) {
        if (cache.enVuelo.get(clave) === entrada) cache.enVuelo.delete(clave);
        entrada.controlador.abort(motivoAborto(signal!));
      }
      reject(motivoAborto(signal!));
    };
    signal?.addEventListener("abort", alCancelar, { once: true });
    entrada.promesa.then(
      (items) => {
        if (listo) return;
        listo = true;
        entrada.esperando -= 1;
        signal?.removeEventListener("abort", alCancelar);
        resolve(items);
      },
      (error: unknown) => {
        if (listo) return;
        listo = true;
        entrada.esperando -= 1;
        signal?.removeEventListener("abort", alCancelar);
        reject(error);
      },
    );
  });
}

export type OpcionesLectura<T> = {
  cache: CacheLectura<T>;
  /** La petición entera a Python: la foto y lo que se le pregunta de ella. */
  clave: string;
  sinCache?: boolean;
  signal?: AbortSignal;
  vencimiento?: number;
  techoMs: number;
  /** La llamada a Python con su deadline y la señal que la cancela. */
  llamar: (deadlineMs: number, signal: AbortSignal) => Promise<readonly T[]>;
  /** Se llama una vez por petición que se queda sin lectura, con el motivo. */
  alOmitir: (motivo: { motivo: "sin_tiempo" } | { error: unknown }) => void;
};

/** La lectura de una foto: guardada, compartida o nueva. Nunca rechaza: sin lectura devuelve `[]`. */
export async function leerCompartido<T>(opciones: OpcionesLectura<T>): Promise<T[]> {
  const { cache, clave } = opciones;
  const guardada = opciones.sinCache ? undefined : cache.resultados.get(clave);
  if (guardada) {
    guardar(cache, clave, guardada);
    return [...guardada];
  }
  let entrada = cache.enVuelo.get(clave);
  if (!entrada) {
    const deadlineMs = deadlineLectura(opciones.vencimiento, opciones.techoMs);
    if (deadlineMs === undefined) {
      opciones.alOmitir({ motivo: "sin_tiempo" });
      return [];
    }
    const controlador = new AbortController();
    const nueva: LecturaEnVuelo<T> = {
      controlador,
      esperando: 0,
      promesa: opciones.llamar(deadlineMs, controlador.signal)
        .then((items) => {
          guardar(cache, clave, items);
          return items;
        })
        .finally(() => {
          if (cache.enVuelo.get(clave) === nueva) cache.enVuelo.delete(clave);
        }),
    };
    // Cada petición que espera maneja (y registra) el fallo; esto solo evita un
    // rechazo sin manejar cuando todas se cancelaron antes de que terminara.
    nueva.promesa.catch(() => undefined);
    cache.enVuelo.set(clave, nueva);
    entrada = nueva;
  }
  try {
    return [...await esperar(cache, clave, entrada, opciones.signal)];
  } catch (error) {
    opciones.alOmitir({ error });
    return [];
  }
}
