import type { Escena } from "./escena";
import { construirCuerpoRefinar, type FotoAdjuntaIA } from "./cuerpo-escena-ia";
import { MAX_RONDAS_REFINAR, type ResultadoRonda } from "./refinado-ronda";
import type { Encuadre } from "./encuadre-foto";

/**
 * El bucle de refinado del navegador (REQ-001 paso 9): después de armar la escena desde una foto, hasta
 * `MAX_RONDAS_REFINAR` rondas de «captura la escena → compárala con la foto → corrige». Sin React ni red propia: la captura y el
 * pedido se inyectan (las pruebas no tocan ni el visor ni la IA). Cada ronda entrega su escena anterior para el deshacer;
 * el usuario detiene el bucle con la señal (`signal`) y se detiene también cuando el servidor dice que ya no hace falta
 * otra ronda, cuando una ronda falla o cuando no llegó la lectura de la foto.
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

export type MotivoFinRefinado = "sin_diferencias" | "sin_cambios" | "ultima_ronda" | "detenido" | "error" | "sin_lectura";

export type EntradaRefinado = {
  escena: Escena;
  /** La foto que se adjuntó (la misma que se leyó). */
  foto: FotoAdjuntaIA;
  /** Lo que devolvió el servidor al armar la escena: la lectura (opaca para el navegador) y el encuadre de la foto. */
  lectura: unknown;
  encuadre: Encuadre | null;
};

export type DependenciasRefinado = {
  capturar: (escena: Escena, encuadre: Encuadre) => Promise<FotoAdjuntaIA>;
  /** Manda el cuerpo a `/api/escena-ia`; devuelve la respuesta de la ronda o el error en palabras para el usuario. */
  pedir: (cuerpo: Record<string, unknown>, signal: AbortSignal) => Promise<{ ok: true; datos: RespuestaRonda } | { ok: false; error: string }>;
  /** Antes de cada ronda (la barra muestra «Comparando con la foto… ronda 1/2»). */
  alProgreso?: (p: { ronda: number; total: number }) => void;
  /** Al terminar cada ronda con cambios en la escena (el taller la aplica y guarda el deshacer). */
  alRonda?: (r: RondaHecha) => void;
  signal: AbortSignal;
  maxRondas?: number;
};

export type ResultadoRefinado = { rondas: RondaHecha[]; escena: Escena; motivo: MotivoFinRefinado; error?: string };

/** Corre las rondas. Nunca lanza: lo que sale mal queda en `motivo` (y `error`) con lo hecho hasta ahí. */
export async function refinarConFoto(entrada: EntradaRefinado, deps: DependenciasRefinado): Promise<ResultadoRefinado> {
  const total = Math.min(deps.maxRondas ?? MAX_RONDAS_REFINAR, MAX_RONDAS_REFINAR);
  const rondas: RondaHecha[] = [];
  let actual = entrada.escena;
  if (!entrada.encuadre || !entrada.lectura) return { rondas, escena: actual, motivo: "sin_lectura" };
  for (let ronda = 1; ronda <= total; ronda++) {
    if (deps.signal.aborted) return { rondas, escena: actual, motivo: "detenido" };
    deps.alProgreso?.({ ronda, total });
    let captura: FotoAdjuntaIA;
    try {
      captura = await deps.capturar(actual, entrada.encuadre);
    } catch (e) {
      return { rondas, escena: actual, motivo: "error", error: e instanceof Error ? e.message : "No se pudo capturar la escena." };
    }
    if (deps.signal.aborted) return { rondas, escena: actual, motivo: "detenido" };
    const r = await deps.pedir(construirCuerpoRefinar({ escena: actual, ronda, foto: entrada.foto, captura, lectura: entrada.lectura }), deps.signal);
    // Una ronda que llega después de detener no se aplica.
    if (deps.signal.aborted) return { rondas, escena: actual, motivo: "detenido" };
    if (!r.ok) return { rondas, escena: actual, motivo: "error", error: r.error };
    const cambios = r.datos.acciones.filter((a) => !a.consulta);
    if (cambios.length > 0) {
      const hecha: RondaHecha = { ronda, antes: actual, escena: r.datos.escena, respuesta: r.datos.respuesta, cambios, resultado: r.datos.refinar };
      rondas.push(hecha);
      actual = r.datos.escena;
      deps.alRonda?.(hecha);
    }
    if (r.datos.refinar.terminar) return { rondas, escena: actual, motivo: r.datos.refinar.motivo === "continua" ? "ultima_ronda" : r.datos.refinar.motivo };
  }
  return { rondas, escena: actual, motivo: "ultima_ronda" };
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
    case "sin_lectura": return "";
  }
}

const esRespuestaRonda = (v: unknown): v is RespuestaRonda =>
  typeof v === "object" && v !== null && "escena" in v && typeof (v as { respuesta?: unknown }).respuesta === "string" && Array.isArray((v as { acciones?: unknown }).acciones)
  && typeof (v as { refinar?: unknown }).refinar === "object" && (v as { refinar?: unknown }).refinar !== null;

/** El pedido real de una ronda: `fetch` a `/api/escena-ia` con las cabeceras de la conversación (`origen` solo fuera del navegador, como la evaluación). */
export async function pedirRondaHttp(cuerpo: Record<string, unknown>, signal: AbortSignal, cabeceras: Record<string, string>, origen = ""): Promise<{ ok: true; datos: RespuestaRonda } | { ok: false; error: string }> {
  try {
    const r = await fetch(`${origen}/api/escena-ia`, { method: "POST", headers: { "Content-Type": "application/json", ...cabeceras }, body: JSON.stringify(cuerpo), signal });
    const datos: unknown = await r.json().catch(() => null);
    if (r.ok && esRespuestaRonda(datos)) return { ok: true, datos };
    // Una ronda a medias (la IA se cortó) vuelve con la escena pero sin decisión: no se sigue.
    if (r.ok && typeof datos === "object" && datos !== null && "escena" in datos) return { ok: false, error: "La IA se cortó a mitad de la comparación." };
    return { ok: false, error: typeof datos === "object" && datos !== null && "error" in datos && typeof datos.error === "string" ? datos.error : "No pude comparar con la foto ahora." };
  } catch (e) {
    return { ok: false, error: e instanceof DOMException && e.name === "AbortError" ? "Detenido." : "No pude comparar con la foto: revisa la conexión." };
  }
}
