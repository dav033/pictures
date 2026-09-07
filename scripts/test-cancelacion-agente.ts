import assert from "node:assert/strict";
import { ejecutarConversacionStream, type ChatPort, type FragmentoChat } from "@sempertex/agente-core";

const fragmentoFinal: FragmentoChat = {
  tipo: "fin",
  texto: "ok",
  llamadas: [],
  uso: { entrada: 1, salida: 1 },
  modelo: "fake",
};

function chatLento(): ChatPort {
  return {
    id: "gemini",
    modelo: "fake",
    async turno() {
      return { texto: "ok", llamadas: [], uso: { entrada: 1, salida: 1 }, modelo: "fake" };
    },
    async *turnoStream() {
      await new Promise((resolve) => setTimeout(resolve, 25));
      yield fragmentoFinal;
    },
  };
}

async function debeCancelarAntesDeProveedor(): Promise<void> {
  const controller = new AbortController();
  controller.abort(new Error("CLIENT_CANCELLED"));
  const generator = ejecutarConversacionStream({
    chat: chatLento(),
    sistema: "test",
    historial: [{ rol: "usuario", texto: "hola" }],
    herramientas: [],
    registro: {},
    signal: controller.signal,
  });
  await assert.rejects(() => generator.next(), /CLIENT_CANCELLED/);
}

async function debeCancelarMientrasEsperaProveedor(): Promise<void> {
  const controller = new AbortController();
  const generator = ejecutarConversacionStream({
    chat: chatLento(),
    sistema: "test",
    historial: [{ rol: "usuario", texto: "hola" }],
    herramientas: [],
    registro: {},
    signal: controller.signal,
  });
  const siguiente = generator.next();
  setTimeout(() => controller.abort(new Error("CLIENT_CANCELLED")), 5);
  await assert.rejects(() => siguiente, /CLIENT_CANCELLED/);
}

async function main(): Promise<void> {
  await debeCancelarAntesDeProveedor();
  await debeCancelarMientrasEsperaProveedor();
  console.log("Agent cancellation: OK");
}

void main();
