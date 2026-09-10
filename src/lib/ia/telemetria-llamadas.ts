import "server-only";
import { randomUUID } from "node:crypto";
import {
  configurarPersistenciaTelemetria,
  crearPersistenciaPostgres,
  registrarLlamadaIA,
  type EventoLlamadaIA,
} from "@sempertex/agente-core";
import { getRagPool } from "@/lib/rag/db";

// Se configura sin abrir conexión. Cada escritura ocurre fuera de ruta crítica;
// agente-core absorbe tanto errores síncronos como rechazos de PostgreSQL.
configurarPersistenciaTelemetria(
  crearPersistenciaPostgres((sql, parametros) => getRagPool().query(sql, [...parametros])),
);

type UsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
  toolUsePromptTokenCount?: number;
};

export type ContextoTelemetriaIA = {
  requestId?: string;
  correlationId?: string;
  superficie?: string;
  intento?: number;
};

export function idsTelemetria(contexto: ContextoTelemetriaIA = {}): Required<Pick<ContextoTelemetriaIA, "requestId" | "correlationId">> {
  const requestId = contexto.requestId ?? randomUUID();
  return { requestId, correlationId: contexto.correlationId ?? requestId };
}

export function resultadoTelemetria(error: unknown): EventoLlamadaIA["resultado"] {
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return error.name === "TimeoutError" ? "timeout" : "cancelado";
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "PYTHON_BACKEND_TIMEOUT") return "timeout";
    if (code === "PYTHON_REQUEST_CANCELLED") return "cancelado";
  }
  return "error";
}

export function registrarGemini(input: {
  flujo: EventoLlamadaIA["flujo"];
  capacidad: EventoLlamadaIA["capacidad"];
  modelo: string;
  inicio: number;
  ms?: number;
  resultado: EventoLlamadaIA["resultado"];
  contexto?: ContextoTelemetriaIA;
  usage?: UsageMetadata;
  bytesImagenEntrada?: number;
  thinkingLevel?: string;
  promptVersion?: string;
}): void {
  const ids = idsTelemetria(input.contexto);
  registrarLlamadaIA({
    proveedor: "gemini",
    flujo: input.flujo,
    capacidad: input.capacidad,
    modelo: input.modelo,
    superficie: input.contexto?.superficie ?? "interno",
    requestId: ids.requestId,
    correlationId: ids.correlationId,
    intento: input.contexto?.intento ?? 1,
    ms: Math.max(0, input.ms ?? Date.now() - input.inicio),
    resultado: input.resultado,
    tokensEntrada: input.usage?.promptTokenCount,
    tokensSalida: input.usage?.candidatesTokenCount,
    tokensPensamiento: input.usage?.thoughtsTokenCount,
    tokensCacheados: input.usage?.cachedContentTokenCount,
    tokensPromptHerramientas: input.usage?.toolUsePromptTokenCount,
    bytesImagenEntrada: input.bytesImagenEntrada,
    thinkingLevel: input.thinkingLevel,
    promptVersion: input.promptVersion,
  });
}

export function bytesBase64(base64: string): number {
  const limpio = base64.replace(/\s/g, "");
  if (!limpio) return 0;
  const padding = limpio.endsWith("==") ? 2 : limpio.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(limpio.length * 3 / 4) - padding);
}
