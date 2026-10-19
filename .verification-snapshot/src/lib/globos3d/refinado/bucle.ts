import type { Escena } from "../escena";
import { construirCuerpoRefinar, type FotoAdjuntaIA } from "../cuerpo-escena-ia";
import { MAX_RONDAS_REFINAR, type ResultadoRonda } from "./ronda";
import type { Encuadre } from "../encuadre-foto";
import { MENSAJE_RECHAZO, type MotivoRechazo, type Veredicto } from "./motivos";

/**
 * El bucle de refinado del navegador (REQ-001 paso 9): después de armar la escena desde una foto, hasta
 * `MAX_RONDAS_REFINAR` rondas de «captura la escena → compárala con la foto → corrige». Sin React ni red propia: la captura y el
 * pedido se inyectan (las pruebas no tocan ni el visor ni la IA). Cada ronda entrega su escena anterior para el deshacer;
 * el usuario detiene el bucle con la señal (`signal`) y se detiene también cuando el servidor dice que ya no hace falta
 * otra ronda, cuando una ronda falla o cuando no llegó la lectura de la foto. Una ronda con cambios solo se aplica si pasa el
 * criterio de aceptación (`evaluar`, ver `evaluador.ts`; la decisión la toma el servidor): si no mejora la escena, se descarta sin
 * tocar la escena ni el deshacer y el bucle termina con `rechazada`. El pedido real va en
 * `components/tres-d/refinado-http.ts`.
 */

export type AccionRefinado = { herramienta: string; resumen: string; consulta: boolean };

/** Lo que devuelve una ronda de `/api/escena-ia` con `refinar`. */
export type RespuestaRonda = { escena: Escena; respuesta: string; acciones: AccionRefinado[]; refinar: ResultadoRonda; uso?: { costeEstimadoUsd?: number } };

export type RondaHecha = {
  ronda: number;
  /** La escena de antes de la ronda (para deshacerla). */
  antes: Escena;
  escena: Escena;
  respuesta: string;
  cambios: AccionRefinado[];
  resultado: ResultadoRonda;
};

export type MotivoFinRefinado = "sin_diferencias" | "sin_cambios" | "ultima_ronda" | "detenido" | "error" | "sin_lectura" | "rechazada";

export type EntradaRefinado = {
  escena: Escena;
  /** La foto que se adjuntó (la misma que se leyó). */
  foto: FotoAdjuntaIA;
  /** Lo que devolvió el servidor al armar la escena: la lectura (opaca para el navegador) y el encuadre de la foto. */
  lectura: unknown;
  encuadre: Encuadre | null;
};

/** Lo que necesita el criterio de aceptación para juzgar una ronda con cambios (ver `evaluador.ts`). */
export type ContextoEvaluacion = {
  ronda: number;
  antes: Escena;
  despues: Escena;
  /** La captura de la escena de antes, ya tomada para pedir la ronda. */
  capturaAntes: FotoAdjuntaIA;
  foto: FotoAdjuntaIA;
  /** La lectura de la foto tal como la devolvió el servidor (opaca para el navegador; el servidor la valida y decide con ella). */
  lectura: unknown;
  encuadre: Encuadre;
  signal: AbortSignal;
};

export type DependenciasRefinado = {
  capturar: (escena: Escena, encuadre: Encuadre) => Promise<FotoAdjuntaIA>;
  /** Manda el cuerpo a `/api/escena-ia`; devuelve la respuesta de la ronda o el error en palabras para el usuario. */
  pedir: (cuerpo: Record<string, unknown>, signal: AbortSignal) => Promise<{ ok: true; datos: RespuestaRonda } | { ok: false; error: string }>;
  /** Antes de cada ronda (la barra muestra «Comparando con la foto… ronda 1/2»). */
  alProgreso?: (p: { ronda: number; total: number; fase?: "comparando" | "revisando" }) => void;
  /**
   * El criterio de aceptación (P-016): decide si la ronda mejoró la escena (el servidor lo decide y lo registra). Sin él se aceptan todas las rondas (la
   * evaluación sin cabeza y las pruebas); en el taller siempre va. Una ronda rechazada no se aplica: la escena
   * anterior sigue y el deshacer no recibe nada.
   */
  evaluar?: (contexto: ContextoEvaluacion) => Promise<Veredicto>;
  /** Al terminar cada ronda con cambios en la escena (el taller la aplica y guarda el deshacer). */
  alRonda?: (r: RondaHecha) => void;
  signal: AbortSignal;
  maxRondas?: number;
};

/** El veredicto del servidor sobre una ronda, con la ronda a la que corresponde (rechazada o no). */
export type EvaluacionRonda = { ronda: number; veredicto: Veredicto };

export type ResultadoRefinado = {
  rondas: RondaHecha[];
  escena: Escena;
  motivo: MotivoFinRefinado;
  error?: string;
  /** Por qué se descartó la ronda cuando `motivo` es `rechazada`; `resumenDeRefinado` lo convierte en una frase. */
  rechazo?: MotivoRechazo;
  /** Los veredictos de cada ronda evaluada, con el parecido medido y lo que costó (lo leen las evaluaciones pagadas). */
  evaluaciones: EvaluacionRonda[];
  /** Todo lo que costó la comparación (estimado): las rondas (también las que no cambiaron nada o se rechazaron) y su revisión. */
  costeUsd: number;
};

/** Corre las rondas. Nunca lanza: lo que sale mal queda en `motivo` (y `error`) con lo hecho hasta ahí. */
export async function refinarConFoto(entrada: EntradaRefinado, deps: DependenciasRefinado): Promise<ResultadoRefinado> {
  const total = Math.min(deps.maxRondas ?? MAX_RONDAS_REFINAR, MAX_RONDAS_REFINAR);
  const rondas: RondaHecha[] = [];
  const evaluaciones: EvaluacionRonda[] = [];
  let actual = entrada.escena;
  let costeUsd = 0;
  const fin = (motivo: MotivoFinRefinado, extra: { error?: string; rechazo?: MotivoRechazo } = {}): ResultadoRefinado => ({ rondas, escena: actual, motivo, evaluaciones, costeUsd, ...extra });
  if (!entrada.encuadre || !entrada.lectura) return fin("sin_lectura");
  for (let ronda = 1; ronda <= total; ronda++) {
    if (deps.signal.aborted) return fin("detenido");
    deps.alProgreso?.({ ronda, total });
    let captura: FotoAdjuntaIA;
    try {
      captura = await deps.capturar(actual, entrada.encuadre);
    } catch (e) {
      return fin("error", { error: e instanceof Error ? e.message : "No se pudo capturar la escena." });
    }
    if (deps.signal.aborted) return fin("detenido");
    const r = await deps.pedir(construirCuerpoRefinar({ escena: actual, ronda, foto: entrada.foto, captura, lectura: entrada.lectura }), deps.signal);
    // Lo que ya se pagó cuenta aunque se detenga: una ronda que llega después de detener no se aplica, pero costó.
    if (r.ok) costeUsd += r.datos.uso?.costeEstimadoUsd ?? 0;
    if (deps.signal.aborted) return fin("detenido");
    if (!r.ok) return fin("error", { error: r.error });
    const cambios = r.datos.acciones.filter((a) => !a.consulta);
    if (cambios.length > 0 && deps.evaluar) {
      deps.alProgreso?.({ ronda, total, fase: "revisando" });
      const veredicto = await deps.evaluar({ ronda, antes: actual, despues: r.datos.escena, capturaAntes: captura, foto: entrada.foto, lectura: entrada.lectura, encuadre: entrada.encuadre, signal: deps.signal });
      costeUsd += veredicto.costeEstimadoUsd;
      if (deps.signal.aborted) return fin("detenido");
      evaluaciones.push({ ronda, veredicto });
      if (!veredicto.aceptada) return fin("rechazada", { rechazo: veredicto.motivo ?? "sin_comparacion" });
    }
    if (cambios.length > 0) {
      const hecha: RondaHecha = { ronda, antes: actual, escena: r.datos.escena, respuesta: r.datos.respuesta, cambios, resultado: r.datos.refinar };
      rondas.push(hecha);
      actual = r.datos.escena;
      deps.alRonda?.(hecha);
    }
    if (r.datos.refinar.terminar) return fin(r.datos.refinar.motivo === "continua" ? "ultima_ronda" : r.datos.refinar.motivo);
  }
  return fin("ultima_ronda");
}

/** Una línea para el usuario de cómo terminó el refinado. */
export function resumenDeRefinado(r: ResultadoRefinado): string {
  const hechas = r.rondas.length;
  switch (r.motivo) {
    case "sin_diferencias": return hechas ? `Comparé con la foto y corregí ${hechas} ronda${hechas > 1 ? "s" : ""}: ya se ve igual.` : "Comparé la escena con la foto: ya se ve igual, no cambié nada.";
    case "sin_cambios": return hechas ? `Comparé con la foto y corregí ${hechas} ronda${hechas > 1 ? "s" : ""}; lo que queda no pude arreglarlo con las herramientas.` : "Comparé con la foto pero no encontré cómo acercarla más.";
    case "ultima_ronda": return `Comparé con la foto y corregí en ${hechas} ronda${hechas === 1 ? "" : "s"} (el máximo). Puedes pedir más ajustes.`;
    case "detenido": return hechas ? `Detuve la comparación con la foto tras ${hechas} ronda${hechas > 1 ? "s" : ""}.` : "Detuve la comparación con la foto.";
    case "error": return `${hechas ? `Corregí ${hechas} ronda${hechas > 1 ? "s" : ""}, pero ` : ""}no pude seguir comparando con la foto${r.error ? `: ${r.error}` : "."}`;
    case "rechazada": return MENSAJE_RECHAZO[r.rechazo ?? "no_mejora"];
    case "sin_lectura": return "";
  }
}
