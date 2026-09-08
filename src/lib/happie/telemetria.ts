import { randomUUID } from "node:crypto";
import { registrarLlamadaIA, type FlujoIA } from "@sempertex/agente-core";
import type { RegistrarTelemetriaRecomendacion } from "@sempertex/happie-package-ia";

export function telemetriaRecomendacion(request: Request, flujo: Extract<FlujoIA, "happie_paquetes" | "happie_conversacion">): RegistrarTelemetriaRecomendacion {
  const requestId = randomUUID();
  const recibido = request.headers.get("x-correlation-id");
  const correlationId = recibido && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(recibido)
    ? recibido
    : requestId;
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
