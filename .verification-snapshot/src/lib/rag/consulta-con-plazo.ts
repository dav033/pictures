import type { Pool, PoolClient, QueryConfig } from "pg";

/**
 * **Lecturas del catálogo con plazo, para el camino de un turno de chat** (D-038): el pool del RAG solo corta una consulta a los 30 s
 * (`statement_timeout`), y un turno de la vista guiada no puede esperar eso (60 s de plazo y 75 de `maxDuration`: pasado el tope la
 * función muere sin evento `fin`). Esta lectura toma su propia conexión (`connect`, acotada), pide la consulta con `query_timeout` y
 * deja de esperar en cuanto vence el plazo o se aborta la señal del turno; una conexión interrumpida se destruye en vez de volver al
 * pool con una consulta a medias (mismo patrón que `src/lib/happie/webhook-control.ts`). Solo lectura: quien llama decide qué hacer
 * con el fallo (`PlazoDeLecturaError`) y nunca debe quedarse esperando.
 */
export class PlazoDeLecturaError extends Error {
  constructor(readonly fase: "conexion" | "consulta", readonly causa: "plazo" | "cancelada") {
    super(causa === "plazo" ? `la lectura del catálogo no respondió a tiempo (${fase})` : `la lectura del catálogo se canceló (${fase})`);
    this.name = "PlazoDeLecturaError";
  }
}

export type OpcionesDePlazo = {
  /** La señal del turno: al abortarse, la lectura deja de esperar (`cancelada`). */
  signal?: AbortSignal;
  /** Un plazo común a varias lecturas (se vence solo): al abortarse, la lectura deja de esperar (`plazo`). */
  presupuesto?: AbortSignal;
  /** Cuánto se espera una conexión del pool. */
  conexionMs: number;
  /** Cuánto se espera la consulta (`query_timeout` de pg y la espera de aquí). */
  consultaMs: number;
};

/** La misma forma que `ConsultaSql` de `motor/crosswalk-consulta.ts`, sin importarlo (el RAG no depende del motor). */
export type ConsultaConPlazo = { query: (texto: string, parametros?: readonly unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };

async function esperar<T>(promesa: Promise<T>, limite: AbortSignal, turno: AbortSignal | undefined, fase: PlazoDeLecturaError["fase"]): Promise<T> {
  let abortar: () => void = () => undefined;
  const vencida = () => new PlazoDeLecturaError(fase, turno?.aborted ? "cancelada" : "plazo");
  try {
    return await Promise.race([promesa, new Promise<never>((_, rechazar) => {
      if (limite.aborted) return rechazar(vencida());
      abortar = () => rechazar(vencida());
      limite.addEventListener("abort", abortar, { once: true });
    })]);
  } finally {
    limite.removeEventListener("abort", abortar);
  }
}

const conPlazo = (ms: number, ...otras: Array<AbortSignal | undefined>): AbortSignal => AbortSignal.any([...otras.flatMap((otra) => (otra ? [otra] : [])), AbortSignal.timeout(ms)]);

export function consultaConPlazo(pool: Pick<Pool, "connect">, { signal, presupuesto, conexionMs, consultaMs }: OpcionesDePlazo): ConsultaConPlazo {
  return {
    async query(texto, parametros) {
      if (signal?.aborted) throw new PlazoDeLecturaError("conexion", "cancelada");
      if (presupuesto?.aborted) throw new PlazoDeLecturaError("conexion", "plazo");
      let cliente: PoolClient | undefined;
      let abandonada = false;
      // Una conexión que llega tarde nunca ejecuta nada: se devuelve al pool.
      const conectando = pool.connect().then((conectado) => { if (abandonada) conectado.release(); else cliente = conectado; });
      try {
        await esperar(conectando, conPlazo(conexionMs, signal, presupuesto), signal, "conexion");
      } finally {
        abandonada = true;
      }
      // Interrumpida (plazo, señal o el `query_timeout` de pg), la conexión se destruye: el servidor no sigue con una consulta que nadie espera.
      let destruir = false;
      try {
        const consulta = cliente!.query({ text: texto, values: [...(parametros ?? [])], query_timeout: consultaMs } as QueryConfig);
        const resultado = await esperar(consulta, conPlazo(consultaMs, signal, presupuesto), signal, "consulta");
        return { rows: resultado.rows as Array<Record<string, unknown>> };
      } catch (error) {
        destruir = error instanceof PlazoDeLecturaError || (error instanceof Error && /timeout/i.test(error.message));
        throw error;
      } finally {
        cliente!.release(destruir);
      }
    },
  };
}
