import assert from "node:assert/strict";
import { sugerenciaEscenaDelTurno } from "../src/lib/ia/sugerencia-escena-chat";

/**
 * /api/chat scene suggestion at creativity 4-5: a venue photo attached to the
 * turn is the venue and its light, so the server must not suggest another
 * place or time (the generation already reads it that way). Deterministic.
 * Run: npx tsx --conditions=react-server scripts/test-sugerencia-escena-chat.ts
 */

const firstDraw = () => 0;
const messages = [
  { role: "user" as const, content: "Quiero decorar el cumpleaños de mi hija" },
  { role: "assistant" as const, content: "¡Claro! ¿Dónde será la fiesta en el jardín o en el salón?" },
  { role: "user" as const, content: "Te adjunto la foto de mi espacio" },
];

for (const nivel of [4, 5] as const) {
  assert.deepEqual(
    sugerenciaEscenaDelTurno({ nivel, mensajes: messages, brief: {}, fotoEspacio: false, aleatorio: firstDraw }),
    { lugar: "jardín", momento: "día" },
    `level ${nivel} without a venue photo suggests the open venue and time`,
  );
  assert.equal(
    sugerenciaEscenaDelTurno({ nivel, mensajes: messages, brief: {}, fotoEspacio: true, aleatorio: firstDraw }),
    undefined,
    `level ${nivel} with a venue photo suggests no scene`,
  );
}
console.log("[PASS] chat: a venue photo suppresses the scene suggestion at levels 4-5");

// Only customer messages count: the assistant's question naming places is not the customer's venue.
assert.equal(sugerenciaEscenaDelTurno({ nivel: 4, mensajes: messages, fotoEspacio: false, aleatorio: firstDraw })?.lugar, "jardín");
// What the customer said still wins without a photo: a named venue leaves only the time open.
assert.deepEqual(
  sugerenciaEscenaDelTurno({ nivel: 5, mensajes: [{ role: "user", content: "Es en la terraza del edificio" }], brief: {}, fotoEspacio: false, aleatorio: firstDraw }),
  { momento: "día" },
);
// Levels that do not suggest a scene stay silent regardless of the photo.
assert.equal(sugerenciaEscenaDelTurno({ nivel: 2, mensajes: messages, fotoEspacio: false, aleatorio: firstDraw }), undefined);
console.log("[PASS] chat: customer text and level rules are unchanged");
