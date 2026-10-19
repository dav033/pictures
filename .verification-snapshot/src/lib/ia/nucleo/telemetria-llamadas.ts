import "server-only";
import { randomUUID } from "node:crypto";
import {
  configurarPersistenciaTelemetria,
  crearPersistenciaPostgres,
  registrarLlamadaIA,
  type EventoLlamadaIA,
  type PersistenciaTelemetria,
} from "@sempertex/agente-core";
import { getRagPool } from "@/lib/rag/db";
import { transporteClaudeActivo } from "@/lib/ia/claude/config";
import { usoDeAnthropic } from "@/lib/ia/claude/respuesta";
import type { UsoAnthropic } from "@/lib/ia/claude/tipos";
import type { ProveedorId } from "./tipos";

/**
 * `ai_call_log.proveedor` admite la empresa (`anthropic`), no el id del registro (`claude`). agente-core ya lo traduce,
 * pero el bucle de `ejecutar.ts` corre desde su `dist` compilado: en la copia principal (servidor de :3010) un `dist`
 * sin reconstruir mandaría `claude` y el CHECK perdería la fila en silencio. Traducirlo también aquí, justo antes del
 * INSERT, hace que funcione con o sin reconstruir el paquete.
 * Con Claude por Claude Code (`IA_CLAUDE_TRANSPORTE=cli`, solo local) toda fila de Anthropic es de la suscripción: su
 * modelo va como `cli:<modelo>` (ninguna fila de `ai_model_pricing` lo cotiza: coste 0) y sin coste. En producción
 * Claude no está activo y las filas quedan como siempre.
 */
export const PREFIJO_MODELO_CLI = "cli:";

export function conProveedorDeEmpresa(base: PersistenciaTelemetria, entorno: Readonly<Record<string, string | undefined>> = process.env): PersistenciaTelemetria {
  return {
    guardar: (evento) => {
      if (evento.proveedor !== "claude" && evento.proveedor !== "anthropic") return base.guardar(evento);
      const anthropic = { ...evento, proveedor: "anthropic" as const };
      if (transporteClaudeActivo(entorno) !== "cli") return base.guardar(anthropic);
      const modelo = anthropic.modelo.startsWith(PREFIJO_MODELO_CLI) ? anthropic.modelo : `${PREFIJO_MODELO_CLI}${anthropic.modelo}`;
      return base.guardar({ ...anthropic, modelo, pricingId: undefined, costeEstimado: undefined, moneda: undefined });
    },
  };
}

// Se configura sin abrir conexión. Cada escritura ocurre fuera de ruta crítica;
// agente-core absorbe tanto errores síncronos como rechazos de PostgreSQL.
configurarPersistenciaTelemetria(
  conProveedorDeEmpresa(crearPersistenciaPostgres((sql, parametros) => getRagPool().query(sql, [...parametros]))),
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

type EntradaTelemetria = {
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
  finishReason?: string;
  configHash?: string;
};

export function registrarGemini(input: EntradaTelemetria): void {
  registrarLlamada("gemini", input);
}

/**
 * Una llamada cuyo proveedor decidió el registro (el `id` de un ChatPort, o `destinoGenerativo().proveedor`): `claude`
 * queda como `anthropic`. `usage` va con los campos de Gemini, que también llenan el ChatPort y `comoClienteGemini`.
 * El mismo mapeo que `proveedorTelemetria` de agente-core, hecho aquí también para que no dependa de reconstruir su
 * `dist` en la copia principal (el servidor de :3010 carga ese paquete ya compilado).
 */
export function registrarSegunProveedor(proveedor: ProveedorId, input: EntradaTelemetria): void {
  registrarLlamada(proveedor === "claude" ? "anthropic" : proveedor, input);
}

/**
 * El equivalente de `registrarGemini` para una llamada directa a Claude (la escena 3D): misma fila de `ai_call_log`
 * con proveedor `anthropic`. `entrada` = todo el prompt (sin caché + leído + escrito) y `cacheados` = lo leído de la
 * caché, como en Gemini; el precio (con lectura y escritura de caché) va en `ai_model_pricing` (migración 033) y el
 * estimado por llamada queda en el registro de la conversación (`respuesta_ia.costeEstimadoUsd`).
 */
export function registrarClaude(input: Omit<EntradaTelemetria, "usage"> & { usage?: UsoAnthropic }): void {
  const { usage, ...resto } = input;
  const uso = usage ? usoDeAnthropic(usage) : undefined;
  registrarLlamada("anthropic", {
    ...resto,
    ...(uso ? { usage: { promptTokenCount: uso.entrada, candidatesTokenCount: uso.salida, thoughtsTokenCount: uso.pensamiento, cachedContentTokenCount: uso.cacheados } } : {}),
  });
}

function registrarLlamada(proveedor: "gemini" | "fal" | "anthropic", input: EntradaTelemetria): void {
  const ids = idsTelemetria(input.contexto);
  registrarLlamadaIA({
    proveedor,
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
    finishReason: input.finishReason,
    configHash: input.configHash,
  });
}

