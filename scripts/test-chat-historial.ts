import assert from "node:assert/strict";
import { limitarHistorialChat } from "../src/lib/ia/historial-chat";

const mensajes = [
  { role: "user" as const, content: "uno" },
  { role: "assistant" as const, content: "dos" },
  { role: "user" as const, content: "tres" },
  { role: "assistant" as const, content: "cuatro" },
  { role: "user" as const, content: "cinco" },
];

assert.deepEqual(limitarHistorialChat(mensajes, 100), mensajes);
assert.deepEqual(limitarHistorialChat(mensajes, 15), mensajes.slice(2));
assert.deepEqual(limitarHistorialChat(mensajes, 11), mensajes.slice(-1));
assert.deepEqual(limitarHistorialChat([{ role: "user", content: "mensaje muy largo" }], 1), [{ role: "user", content: "mensaje muy largo" }]);

console.log("[PASS] historial de chat acotado sin perder el ultimo mensaje del usuario");
