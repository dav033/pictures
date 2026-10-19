/**
 * Espera del análisis de la foto de referencia antes de enviar un turno del
 * chat (iteración 4). ReferenceAnalysisController avisa cada cambio con
 * `onEstado`; la página espera solo mientras el análisis está en curso y sale
 * en cuanto termina, falla o se agota el límite (un análisis que no responde
 * no deja el turno "pensando" para siempre). Sin React ni DOM para probarla
 * sin navegador.
 */
export type EstadoAnalisisReferencia = "idle" | "analyzing" | "ready" | "error";

/** "listo": hay plano de la foto; "fallo"/"limite": el turno sale sin él; "sin_analisis": no había nada que esperar. */
export type ResultadoEsperaAnalisis = "listo" | "fallo" | "limite" | "sin_analisis";

type Reloj = {
  programar: (fn: () => void, ms: number) => number;
  cancelar: (id: number) => void;
};

const RELOJ_NAVEGADOR: Reloj = {
  programar: (fn, ms) => window.setTimeout(fn, ms),
  cancelar: (id) => window.clearTimeout(id),
};

function resultadoDe(estado: Exclude<EstadoAnalisisReferencia, "analyzing">): ResultadoEsperaAnalisis {
  return estado === "ready" ? "listo" : estado === "error" ? "fallo" : "sin_analisis";
}

/**
 * Tiempo mínimo que el cliente ve el escaneo de su foto. Las fotos de la
 * galería y las ya analizadas responden desde caché al instante, y sin este
 * mínimo la propuesta parece no haber mirado la foto. Solo retrasa un análisis
 * correcto: un fallo se muestra en cuanto llega.
 */
export const DURACION_MINIMA_ANALISIS_MS = 5_000;

export function restanteDuracionMinima(inicioMs: number, ahoraMs: number, minimoMs: number = DURACION_MINIMA_ANALISIS_MS): number {
  return Math.max(0, minimoMs - Math.max(0, ahoraMs - inicioMs));
}

/** Resuelve cuando pasó el mínimo desde `inicioMs`; rechaza con el motivo del `signal` si se cancela antes. */
export function esperarDuracionMinima(
  inicioMs: number,
  signal: AbortSignal,
  { ahora = () => performance.now(), reloj = RELOJ_NAVEGADOR, minimoMs = DURACION_MINIMA_ANALISIS_MS }: { ahora?: () => number; reloj?: Reloj; minimoMs?: number } = {},
): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  const restante = restanteDuracionMinima(inicioMs, ahora(), minimoMs);
  if (restante === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const alCancelar = () => {
      reloj.cancelar(temporizador);
      reject(signal.reason);
    };
    const temporizador = reloj.programar(() => {
      signal.removeEventListener("abort", alCancelar);
      resolve();
    }, restante);
    signal.addEventListener("abort", alCancelar, { once: true });
  });
}

export type EsperaAnalisis = {
  readonly estado: EstadoAnalisisReferencia;
  notificar: (estado: EstadoAnalisisReferencia) => void;
  esperar: (limiteMs: number) => Promise<ResultadoEsperaAnalisis>;
};

export function crearEsperaAnalisis(reloj: Reloj = RELOJ_NAVEGADOR): EsperaAnalisis {
  let estado: EstadoAnalisisReferencia = "idle";
  const pendientes = new Set<(resultado: ResultadoEsperaAnalisis) => void>();
  return {
    get estado() {
      return estado;
    },
    notificar(nuevo) {
      estado = nuevo;
      if (nuevo === "analyzing") return;
      const resultado = resultadoDe(nuevo);
      for (const resolver of [...pendientes]) resolver(resultado);
    },
    esperar(limiteMs) {
      if (estado !== "analyzing") return Promise.resolve(resultadoDe(estado));
      return new Promise((resolve) => {
        const terminar = (resultado: ResultadoEsperaAnalisis) => {
          pendientes.delete(terminar);
          reloj.cancelar(temporizador);
          resolve(resultado);
        };
        const temporizador = reloj.programar(() => terminar("limite"), limiteMs);
        pendientes.add(terminar);
      });
    },
  };
}
