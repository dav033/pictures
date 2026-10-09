/**
 * Cada llamada a Gemini por `getGeminiClient` deja `llamada_ia` + `respuesta_ia` (2026-10-09). Antes solo la PRIMERA petición de cada
 * proceso quedaba registrada: el envoltorio marcaba «ya envuelto» sobre el cliente real (a través del proxy) y, como `getGeminiClient`
 * cachea el cliente, desde la 2.ª llamada devolvía el cliente sin envolver. Así, la conversación 3d-20261009-103125-92b58a tenía registro
 * del turno 1 y de los turnos 2 a 7 solo las decisiones, aunque la IA había hecho 14-17 llamadas por turno. Sin red: fetch simulado.
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-cliente-gemini-auditado.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.REGISTRO_ACTIVO = "1";
process.env.REGISTRO_DIR = mkdtempSync(path.join(tmpdir(), "reg-gemini-"));
process.env.GEMINI_API_KEY = "clave-falsa-de-prueba";
process.env.REGISTRO_AUDITORIA_STDOUT = "0";
process.env.REGISTRO_NIVEL_STDOUT = "error";

let pedidos = 0;
const original = globalThis.fetch;
globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
  if (!url.includes("generativelanguage")) return original(entrada, init);
  pedidos += 1;
  const cuerpo = { candidates: [{ content: { role: "model", parts: [{ text: `respuesta ${pedidos}` }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 } };
  return new Response(JSON.stringify(cuerpo), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

async function main() {
  const { getGeminiClient } = await import("../../src/lib/gemini");
  const { conContexto } = await import("../../src/lib/registro/contexto");
  const { esperarRegistros } = await import("../../src/lib/registro/escritor");
  const { envolverClienteGemini } = await import("../../src/lib/registro/envoltorios");

  const CONVERSACION = "3d-prueba-cliente-auditado";
  const N = 5;
  await conContexto({ conversacion: CONVERSACION }, async () => {
    for (let i = 0; i < N; i++) {
      // Como la ruta de escena: se pide el cliente en CADA petición.
      const cliente = getGeminiClient("escena_ia");
      assert.ok(cliente, "hay cliente");
      await cliente.models.generateContent({ model: "gemini-prueba", contents: [{ role: "user", parts: [{ text: `pedido ${i}` }] }] });
    }
  });
  await esperarRegistros();

  const dia = readdirSync(path.join(process.env.REGISTRO_DIR!, "conversaciones"))[0]!;
  const lineas = readFileSync(path.join(process.env.REGISTRO_DIR!, "conversaciones", dia, `${CONVERSACION}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { tipo: string; datos: { proposito?: string; texto?: string } });
  const cuenta = (tipo: string) => lineas.filter((l) => l.tipo === tipo).length;
  assert.equal(pedidos, N);
  assert.equal(cuenta("llamada_ia"), N, "cada petición deja su llamada_ia (antes solo la primera)");
  assert.equal(cuenta("respuesta_ia"), N, "y su respuesta_ia");
  assert.ok(lineas.filter((l) => l.tipo === "llamada_ia").every((l) => l.datos.proposito === "escena_ia"));
  assert.equal(lineas.filter((l) => l.tipo === "respuesta_ia").at(-1)?.datos.texto, `respuesta ${N}`);
  console.log(`  ✓ ${N} peticiones seguidas con el cliente cacheado: ${cuenta("llamada_ia")} llamada_ia y ${cuenta("respuesta_ia")} respuesta_ia`);

  // Envolver un cliente ya envuelto no duplica la auditoría (la marca sigue valiendo, pero en el proxy).
  const crudo = { models: { generateContent: async () => ({ candidates: [] }) } };
  const una = envolverClienteGemini(crudo, { proposito: "x" });
  assert.equal(envolverClienteGemini(una, { proposito: "x" }), una, "no se envuelve dos veces");
  assert.equal(Object.getOwnPropertySymbols(crudo).length, 0, "el cliente real no queda marcado");
  console.log("  ✓ no se envuelve dos veces y el cliente real no queda marcado");
  console.log("\n2 pruebas ok");
}
main().catch((error) => { console.error(error); process.exit(1); });
