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
