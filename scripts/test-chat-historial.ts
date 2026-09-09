import assert from "node:assert/strict";
import { limitarHistorialChat } from "../src/lib/ia/historial-chat";

const mensajes = [
  { role: "user" as const, content: "uno" },
  { role: "assistant" as const, content: "dos" },
  { role: "user" as const, content: "tres" },
  { role: "assistant" as const, content: "cuatro" },
  { role: "user" as const, content: "cinco" },
];

// Fase 3.10: el límite ahora se mide en tokens estimados (~4 caracteres por
// token), no en caracteres — los umbrales de abajo están en esa unidad.
// "cinco"=2, "cuatro"=2, "tres"=1, "dos"=1, "uno"=1 tokens estimados.
assert.deepEqual(limitarHistorialChat(mensajes, 100), mensajes);
assert.deepEqual(limitarHistorialChat(mensajes, 5), mensajes.slice(2));
assert.deepEqual(limitarHistorialChat(mensajes, 3), mensajes.slice(-1));
assert.deepEqual(limitarHistorialChat([{ role: "user", content: "mensaje muy largo" }], 1), [{ role: "user", content: "mensaje muy largo" }]);

console.log("[PASS] historial de chat acotado sin perder el ultimo mensaje del usuario");
