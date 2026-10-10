/**
 * Observadores del cierre de cada llamada a una IA, sea cual sea el transporte (Claude, CLI, Gemini). Un observador recibe
 * el coste y si hubo error; lo usa el arnés de entrenamiento para topar el gasto. Un observador roto no afecta a la llamada.
 */
import type { DescripcionLlamadaIa, ResultadoLlamadaIa } from "./envoltorios";

/** `interrumpida`: el flujo se cortó antes del final (plazo, corte del consumidor): cierra sin error y sin coste conocido. */
export type EventoCierreLlamadaIa = { proveedor: string; proposito: string; modelo: string; costeEstimadoUsd?: number; error: boolean; interrumpida: boolean };
export type ObservadorLlamadasIa = (evento: EventoCierreLlamadaIa) => void;

const observadoresLlamadasIa = new Set<ObservadorLlamadasIa>();

/** Suscribe un observador; devuelve la función que lo quita. Un observador que lanza no afecta a la llamada. */
export function observarLlamadasIa(observador: ObservadorLlamadasIa): () => void {
  observadoresLlamadasIa.add(observador);
  return () => { observadoresLlamadasIa.delete(observador); };
}

export function avisarCierre(descripcion: DescripcionLlamadaIa, resultado: ResultadoLlamadaIa, error: unknown): void {
  const evento: EventoCierreLlamadaIa = {
    proveedor: descripcion.proveedor,
    proposito: descripcion.proposito,
    modelo: resultado.modelo ?? descripcion.modelo ?? "desconocido",
    ...(resultado.costeEstimadoUsd !== undefined ? { costeEstimadoUsd: resultado.costeEstimadoUsd } : {}),
    error: error !== undefined,
    interrumpida: resultado.interrumpida === true,
  };
  for (const observador of observadoresLlamadasIa) {
    try { observador(evento); } catch { /* un observador roto no tumba la llamada */ }
  }
}
