/**
 * Caché en memoria con vencimiento y una sola petición en vuelo por clave. Sirve para lo que se lee mucho y cambia
 * poco (la lista de colores de un catálogo publicado, la allowlist de un modo LoRA): quien llega mientras otro ya
 * está pidiendo lo mismo espera su respuesta en vez de repetirla.
 *
 * - Un fallo nunca se guarda: la siguiente petición vuelve a intentarlo.
 * - Quien pasa una `signal` puede soltar la espera; si ya no queda nadie esperando una petición en vuelo, se cancela.
 *   Una petición que pidió `precalentar` no se cancela: nadie la espera, pero alguien la va a usar.
 * - Pura: sin red ni reloj propio (el `ahora` se inyecta en las pruebas).
 */

export type OpcionesCacheTemporal = {
  /** Cuánto vive un valor guardado, salvo que la llamada diga otro plazo. */
  ttlMs: number;
  /** Cuántas claves se recuerdan; al pasarse se olvida la más antigua. */
  maximo: number;
  ahora?: () => number;
};

type Entrada<T> = {
  valor?: { dato: T };
  vence: number;
  enVuelo?: Promise<T>;
  esperando: number;
  controlador: AbortController;
};

function cancelacion(): DOMException {
  return new DOMException("Cancelado", "AbortError");
}

export type CacheTemporal<T> = {
  /** El valor de `clave`: el guardado si sigue vivo, el de la petición en vuelo o uno nuevo de `producir`. */
  obtener(clave: string, producir: (signal: AbortSignal) => Promise<T>, opciones?: { signal?: AbortSignal; ttlMs?: number }): Promise<T>;
  /** Empieza a pedir `clave` sin esperarla, para que la siguiente `obtener` ya la encuentre. */
  precalentar(clave: string, producir: (signal: AbortSignal) => Promise<T>, opciones?: { ttlMs?: number }): void;
  /** El valor guardado y vivo de `clave`, si lo hay; no pide nada. */
  espiar(clave: string): T | undefined;
  olvidar(): void;
};

export function crearCacheTemporal<T>({ ttlMs, maximo, ahora = Date.now }: OpcionesCacheTemporal): CacheTemporal<T> {
  const entradas = new Map<string, Entrada<T>>();

  function recortar(): void {
    while (entradas.size > maximo) {
      const [primera] = entradas.keys();
      if (primera === undefined) return;
      entradas.delete(primera);
    }
  }

  function iniciar(clave: string, producir: (signal: AbortSignal) => Promise<T>, ttl: number, esperando: number): Entrada<T> {
    const entrada: Entrada<T> = { vence: 0, esperando, controlador: new AbortController() };
    entrada.enVuelo = producir(entrada.controlador.signal).then(
      (dato) => {
        entrada.valor = { dato };
        entrada.vence = ahora() + ttl;
        entrada.enVuelo = undefined;
        return dato;
      },
      (error: unknown) => {
        if (entradas.get(clave) === entrada) entradas.delete(clave);
        throw error;
      },
    );
    // Si nadie espera esta promesa, su rechazo no es un error sin atender.
    entrada.enVuelo.catch(() => undefined);
    entradas.delete(clave);
    entradas.set(clave, entrada);
    recortar();
    return entrada;
  }

  function vivo(clave: string): Entrada<T> | undefined {
    const entrada = entradas.get(clave);
    if (!entrada) return undefined;
    if (entrada.valor && entrada.vence <= ahora()) {
      entradas.delete(clave);
      return undefined;
    }
    return entrada;
  }

  return {
    obtener(clave, producir, opciones = {}) {
      const { signal, ttlMs: ttlLlamada } = opciones;
      if (signal?.aborted) return Promise.reject(cancelacion());
      const existente = vivo(clave);
      if (existente?.valor) return Promise.resolve(existente.valor.dato);
      const entrada = existente ?? iniciar(clave, producir, ttlLlamada ?? ttlMs, 0);
      entrada.esperando += 1;
      const enVuelo = entrada.enVuelo;
      if (!enVuelo) return Promise.reject(new Error("CACHE_TEMPORAL_ESTADO_INVALIDO"));
      return new Promise<T>((resolver, rechazar) => {
        let suelto = false;
        const soltar = () => {
          if (suelto) return;
          suelto = true;
          signal?.removeEventListener("abort", alAbortar);
          entrada.esperando -= 1;
        };
        const alAbortar = () => {
          if (suelto) return;
          soltar();
          if (entrada.esperando <= 0 && entrada.enVuelo) {
            if (entradas.get(clave) === entrada) entradas.delete(clave);
            entrada.controlador.abort();
          }
          rechazar(cancelacion());
        };
        signal?.addEventListener("abort", alAbortar, { once: true });
        enVuelo.then(
          (dato) => { if (!suelto) { soltar(); resolver(dato); } },
          (error: unknown) => { if (!suelto) { soltar(); rechazar(error); } },
        );
      });
    },
    precalentar(clave, producir, opciones = {}) {
      if (vivo(clave)) return;
      iniciar(clave, producir, opciones.ttlMs ?? ttlMs, 1);
    },
    espiar(clave) {
      return vivo(clave)?.valor?.dato;
    },
    olvidar() {
      for (const entrada of entradas.values()) if (entrada.enVuelo) entrada.controlador.abort();
      entradas.clear();
    },
  };
}
