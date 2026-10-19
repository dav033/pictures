/**
 * Arnés de entrenamiento (W4): el transporte de Claude (api o cli) que el arnés deduce del entorno y su acuerdo con la app. Puro:
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-entrenamiento-transporte.ts
 */
import assert from "node:assert/strict";
import { transporteDeClaude, verificarTransporteDeLaApp } from "../entrenamiento/lib-transporte";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

prueba("el transporte se normaliza como la config de Claude: sin espacios ni mayúsculas, y lo desconocido es api", () => {
  assert.equal(transporteDeClaude({ IA_CLAUDE_TRANSPORTE: "cli" }), "cli");
  assert.equal(transporteDeClaude({ IA_CLAUDE_TRANSPORTE: " CLI " }), "cli");
  assert.equal(transporteDeClaude({ IA_CLAUDE_TRANSPORTE: "api" }), "api");
  assert.equal(transporteDeClaude({ IA_CLAUDE_TRANSPORTE: "" }), "api");
  assert.equal(transporteDeClaude({ IA_CLAUDE_TRANSPORTE: "ssh" }), "api");
  assert.equal(transporteDeClaude({}), "api");
});

prueba("el arnés no corre si la app habla otro transporte o no tiene el cli", () => {
  assert.doesNotThrow(() => verificarTransporteDeLaApp("api", undefined), "una app solo con API (sin transportes) vale para api");
  assert.doesNotThrow(() => verificarTransporteDeLaApp("api", "api"));
  assert.doesNotThrow(() => verificarTransporteDeLaApp("cli", "cli"));
  assert.throws(() => verificarTransporteDeLaApp("cli", undefined), /no tiene el transporte cli/);
  assert.throws(() => verificarTransporteDeLaApp("cli", "api"), /espera el transporte «cli».*«api»/);
  assert.throws(() => verificarTransporteDeLaApp("api", "cli"), /espera el transporte «api».*«cli»/);
});

console.log(`\n${pruebas} pruebas del transporte de Claude: OK`);
