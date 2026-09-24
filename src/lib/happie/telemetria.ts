import { randomUUID } from "node:crypto";
import { registrarLlamadaIA, type FlujoIA } from "@sempertex/agente-core";
import type { RegistrarTelemetriaRecomendacion } from "@sempertex/happie-package-ia";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type IdsHappie = { requestId: string; correlationId: string };

/** `x-correlation-id` llega del cliente externo: solo se adopta si es un UUID
 * (lo exige el boundary Python y evita propagar valores arbitrarios). */
export function correlacionValida(recibido: string | null | undefined, respaldo: string): string {
  return recibido && UUID.test(recibido) ? recibido : respaldo;
}

export function idsDeSolicitud(request: Request): IdsHappie {
  const requestId = randomUUID();
  return { requestId, correlationId: correlacionValida(request.headers.get("x-correlation-id"), requestId) };
}

export function telemetriaRecomendacion(
  request: Request,
  flujo: Extract<FlujoIA, "happie_paquetes" | "happie_conversacion">,
  { requestId, correlationId }: IdsHappie = idsDeSolicitud(request),
): RegistrarTelemetriaRecomendacion {
  return (evento) => registrarLlamadaIA({
    proveedor: "gemini",
    flujo,
    capacidad: "happie_recomendacion",
    modelo: evento.modelo,
    superficie: flujo === "happie_conversacion" ? "/api/happie/webhook/chat" : "/api/happie/*",
    requestId,
    correlationId,
    intento: 1,
    ms: evento.ms,
    resultado: evento.resultado,
    tokensEntrada: evento.tokensEntrada,
    tokensSalida: evento.tokensSalida,
    tokensPensamiento: evento.tokensPensamiento,
    tokensCacheados: evento.tokensCacheados,
    tokensPromptHerramientas: evento.tokensPromptHerramientas,
    thinkingLevel: "minimal",
  });
}
