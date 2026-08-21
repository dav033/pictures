import type { ProveedorId } from "./tipos";

export type Operacion = "chat" | "imagen";

export type EventoTelemetria = {
  cuando: string;
  proveedor: ProveedorId;
  operacion: Operacion;
  ms: number;
  tokensEntrada?: number;
  tokensSalida?: number;
  /** cachedContentTokenCount de Gemini, si el adaptador lo reporta. */
  tokensCacheados?: number;
  resultado: "ok" | "error";
  error?: string;
};

const LIMITE = 50;

// En memoria: se pierde al reiniciar el proceso. Si se necesita telemetría
// durable, el consumidor la persiste aparte (esto es solo un buffer corto
// para diagnóstico en caliente).
declare global {
  var __telemetriaAgenteCore: EventoTelemetria[] | undefined;
}

function buffer(): EventoTelemetria[] {
  if (!globalThis.__telemetriaAgenteCore) globalThis.__telemetriaAgenteCore = [];
  return globalThis.__telemetriaAgenteCore;
}

export function registrarEvento(evento: Omit<EventoTelemetria, "cuando">): void {
  const lista = buffer();
  lista.unshift({ ...evento, cuando: new Date().toISOString() });
  lista.length = Math.min(lista.length, LIMITE);
}

export function ultimosEventos(): EventoTelemetria[] {
  return [...buffer()];
}
