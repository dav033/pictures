/**
 * W5: Claude es el proveedor SOLO en local, y eso lo hace cumplir el código (no la costumbre). Sin red ni coste:
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-proveedor-claude-local.ts
 * - en local con IA_PROVEEDOR=claude y la llave, el registro lo ofrece y lo resuelve (chat, lectura de foto, escena);
 * - en producción (NODE_ENV=production, también `next start` local) y en Vercel NO existe: ni el override del cuerpo,
 *   ni la cookie, ni el ajuste global, ni pedirlo a mano (`chatDe("claude")`, `modeloEscenaIADe("claude")`) lo alcanzan;
 * - los caminos por Python (solo Gemini) se saltan con Claude.
 */
import assert from "node:assert/strict";
import { ErrorIA } from "@sempertex/agente-core";
import { chatDe, chatLecturaFotoDe, proveedoresDisponibles, resolverProveedor, usaPython } from "../../src/lib/ia/nucleo/registro";
import { getClaudeClient } from "../../src/lib/claude";
import { modeloEscenaIADe } from "../../src/lib/globos3d/modelo-escena/crear-modelo";
import { MODELO_CHAT } from "../../src/lib/gemini";
import { clienteGenerativoDe, destinoGenerativo } from "../../src/lib/ia/nucleo/cliente-generativo";
import { proveedoresEnSalud } from "../../src/lib/ia/nucleo/salud-proveedores";
import { conProveedorDeEmpresa } from "../../src/lib/ia/nucleo/telemetria-llamadas";

let pruebas = 0;
const prueba = async (nombre: string, fn: () => void | Promise<void>) => { await fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const VARIABLES = ["NODE_ENV", "VERCEL", "IA_PROVEEDOR", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "IA_LOCAL_ESFUERZO"] as const;
const original = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]));

/** Deja el entorno exactamente como se pide (las variables que no se nombran quedan sin definir). */
function entorno(valores: Partial<Record<(typeof VARIABLES)[number], string | undefined>>): void {
  for (const variable of VARIABLES) Reflect.deleteProperty(process.env, variable);
  // process.env convierte todo a texto: un `undefined` asignado quedaría como "undefined".
  Object.assign(process.env, Object.fromEntries(Object.entries(valores).filter(([, valor]) => valor !== undefined)));
}

const LOCAL = { NODE_ENV: "development", IA_PROVEEDOR: "claude", ANTHROPIC_API_KEY: "sk-ant-prueba-no-real", GEMINI_API_KEY: "clave-gemini-de-prueba" };
const esSinLlaveClaude = (error: unknown) => error instanceof ErrorIA && error.proveedor === "claude" && error.causa === "sin_llave" && !error.reintentable;

async function main() {
  console.log("Local");
  await prueba("con IA_PROVEEDOR=claude y la llave, el registro ofrece Claude y lo elige por defecto", () => {
    entorno(LOCAL);
    assert.deepEqual(proveedoresDisponibles(), ["gemini", "claude"]);
    assert.equal(resolverProveedor({}), "claude");
  });
  await prueba("en local con Claude, una cookie o un override «gemini» (la UI arranca con él) no devuelven la IA a Gemini", () => {
    entorno(LOCAL);
    assert.equal(resolverProveedor({ override: "gemini", cookie: "gemini" }), "claude");
  });
  await prueba("chat, lectura de foto y escena salen de Claude (Haiku 5.5, esfuerzo medium por defecto)", async () => {
    entorno({ ...LOCAL, IA_LOCAL_ESFUERZO: "high" });
    const chat = await chatDe("claude", "chat_guiado");
    assert.equal(chat.id, "claude");
    assert.equal(chat.modelo, "claude-haiku-5-5");
    assert.equal(chat.thinkingLevel, "high");
    assert.equal((await chatLecturaFotoDe("claude")).id, "claude");
    const escena = modeloEscenaIADe("claude");
    assert.equal(escena?.proveedor, "claude");
    assert.equal(escena?.modelo, "claude-haiku-5-5");
    entorno(LOCAL);
    assert.equal((await chatDe("claude")).thinkingLevel, "medium");
  });
  await prueba("solo con la llave de Claude (sin Gemini) también resuelve; sin IA_PROVEEDOR=claude, no aparece", () => {
    entorno({ NODE_ENV: "development", IA_PROVEEDOR: "claude", ANTHROPIC_API_KEY: "sk-ant-prueba-no-real" });
    assert.equal(resolverProveedor({}), "claude");
    entorno({ ...LOCAL, IA_PROVEEDOR: "gemini" });
    assert.deepEqual(proveedoresDisponibles(), ["gemini"]);
    assert.equal(resolverProveedor({ override: "claude", cookie: "claude" }), "gemini");
  });

  const contextos = [
    ["NODE_ENV=production (VPS en Docker, sin VERCEL; next start)", { ...LOCAL, NODE_ENV: "production" }],
    ["Vercel", { ...LOCAL, VERCEL: "1" }],
    ["Vercel en preview (NODE_ENV=production)", { ...LOCAL, VERCEL: "1", NODE_ENV: "production" }],
    ["sin NODE_ENV (un script que no lo puso)", { ...LOCAL, NODE_ENV: undefined }],
    ["NODE_ENV=test", { ...LOCAL, NODE_ENV: "test" }],
  ] as const;
  for (const [nombre, valores] of contextos) {
    console.log(nombre);
    await prueba(`${nombre}: Claude no está disponible y nada lo elige (override del cuerpo, cookie)`, () => {
      entorno(valores);
      assert.deepEqual(proveedoresDisponibles(), ["gemini"]);
      assert.equal(resolverProveedor({}), "gemini");
      assert.equal(resolverProveedor({ override: "claude", cookie: "claude" }), "gemini");
    });
    await prueba(`${nombre}: pedirlo a mano tampoco (chatDe, lectura de foto, escena, cliente directo)`, async () => {
      entorno(valores);
      await assert.rejects(chatDe("claude"), esSinLlaveClaude);
      await assert.rejects(chatLecturaFotoDe("claude"), esSinLlaveClaude);
      assert.equal(modeloEscenaIADe("claude"), null);
      assert.equal(getClaudeClient("escena_ia"), null);
    });
    await prueba(`${nombre}: sin llave de Gemini no cae en Claude: falla como siempre (sin llave)`, () => {
      entorno({ ...valores, GEMINI_API_KEY: undefined });
      assert.throws(() => resolverProveedor({ override: "claude" }), (error: unknown) => error instanceof ErrorIA && error.causa === "sin_llave");
    });
  }

  console.log("Llamadores de una sola pasada, salud y telemetría");
  await prueba("clienteGenerativoDe: Claude en local con IA_PROVEEDOR=claude; Gemini en producción y en Vercel aunque esté todo lo demás", () => {
    entorno(LOCAL);
    assert.deepEqual(destinoGenerativo(), { proveedor: "claude", modelo: "claude-haiku-5-5", esfuerzo: "medium" });
    assert.equal(clienteGenerativoDe("parser_intencion")?.proveedor, "claude");
    for (const valores of [{ ...LOCAL, NODE_ENV: "production" }, { ...LOCAL, VERCEL: "1" }, { ...LOCAL, IA_PROVEEDOR: "gemini" }, { ...LOCAL, NODE_ENV: undefined }]) {
      entorno(valores);
      assert.deepEqual(destinoGenerativo(), { proveedor: "gemini", modelo: MODELO_CHAT });
      assert.equal(clienteGenerativoDe("parser_intencion")?.proveedor, "gemini");
    }
  });
  await prueba("/api/ia/salud: en producción la lista de proveedores es la de antes; en local muestra Claude como el que está en uso", () => {
    entorno({ ...LOCAL, NODE_ENV: "production" });
    assert.deepEqual(proveedoresEnSalud(proveedoresDisponibles()), [{ id: "gemini", disponible: true, modelo: { chat: MODELO_CHAT } }]);
    entorno(LOCAL);
    const claude = proveedoresEnSalud(proveedoresDisponibles()).at(-1);
    assert.deepEqual({ ...claude, sigueEnGemini: undefined }, { id: "claude", disponible: true, soloLocal: true, modelo: { chat: "claude-haiku-5-5", esfuerzo: "medium" }, sigueEnGemini: undefined });
    assert.ok(claude?.sigueEnGemini?.some((s) => /embeddings/.test(s)) && claude.sigueEnGemini.some((s) => /Happie/.test(s)), "no se presenta como «todo es Claude»");
  });
  await prueba("telemetría durable: un evento «claude» llega al INSERT como «anthropic» aunque el dist de agente-core no lo traduzca", async () => {
    const guardados: string[] = [];
    const persistencia = conProveedorDeEmpresa({ guardar: async (evento) => { guardados.push(evento.proveedor); } });
    const base = { flujo: "armador_decoracion" as const, capacidad: "chat_turno" as const, modelo: "m", ms: 1, resultado: "ok" as const, cuando: new Date(0).toISOString() };
    await persistencia.guardar({ ...base, proveedor: "claude" });
    await persistencia.guardar({ ...base, proveedor: "gemini" });
    assert.deepEqual(guardados, ["anthropic", "gemini"]);
  });

  console.log("Python");
  await prueba("los caminos por Python (solo Gemini) se saltan con Claude", () => {
    assert.equal(usaPython("gemini", true), true);
    assert.equal(usaPython("gemini", false), false);
    assert.equal(usaPython("claude", true), false);
  });

  console.log(`\ntest-proveedor-claude-local: ${pruebas} pruebas ok`);
}

void main()
  .catch((error: unknown) => { console.error(error); process.exitCode = 1; })
  .finally(() => {
    for (const [variable, valor] of Object.entries(original)) {
      if (valor === undefined) Reflect.deleteProperty(process.env, variable);
      else Object.assign(process.env, { [variable]: valor });
    }
  });
