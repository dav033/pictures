/**
 * El flujo de avance de /api/escena-ia (D-021), sin red ni modelo:
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-flujo-escena-ia.ts
 * - las líneas NDJSON se decodifican aunque un trozo de red las corte a la mitad;
 * - el cliente cae al JSON de siempre si el servidor no responde con flujo;
 * - un flujo cortado sin «final» es un error; «Detener» (AbortSignal) corta el pedido;
 * - el contrato de la ruta: la cabecera, el flujo, los pasos y el registro (getGeminiClient/decidir) siguen en su sitio.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { TIPO_NDJSON, crearSeparadorDeLineas, eventoDeLinea, lineaNdjson, pedirEscenaIA, type EventoFlujo } from "../../src/lib/globos3d/flujo-escena-ia";

let pruebas = 0;
const prueba = async (nombre: string, fn: () => void | Promise<void>) => { await fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const flujoDe = (trozos: string[]): ReadableStream<Uint8Array> => {
  const c = new TextEncoder();
  return new ReadableStream({ start(control) { for (const t of trozos) control.enqueue(c.encode(t)); control.close(); } });
};
const respuestaFlujo = (trozos: string[]) => new Response(flujoDe(trozos), { headers: { "Content-Type": `${TIPO_NDJSON}; charset=utf-8` } });
const paso = { n: 1, herramienta: "ver_escena", resumen: "Miré la escena", consulta: true, ok: true };
const senal = () => new AbortController().signal;

async function main() {
  console.log("Líneas");
  await prueba("ida y vuelta de cada evento; lo desconocido o roto se ignora", () => {
    const eventos: EventoFlujo[] = [{ tipo: "fase", fase: "pensando" }, { tipo: "paso", ...paso }, { tipo: "final", estado: 200, cuerpo: { respuesta: "ok" } }];
    for (const e of eventos) assert.deepEqual(eventoDeLinea(lineaNdjson(e)), e);
    for (const mala of ["", "no es json", "[1]", '{"tipo":"otro"}', '{"tipo":"paso","n":"1"}', '{"tipo":"fase","fase":"x"}']) assert.equal(eventoDeLinea(mala), null);
  });
  await prueba("un trozo de red que corta una línea a la mitad no la rompe", () => {
    const vistas: string[] = [];
    const s = crearSeparadorDeLineas((l) => vistas.push(l));
    s.meter('{"a":1}\n{"b"'); s.meter(':2}\n{"c":3}'); s.cerrar();
    assert.deepEqual(vistas, ['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  console.log("Cliente");
  await prueba("con flujo: avisa los pasos en vivo y devuelve el final", async () => {
    const vistos: string[] = [];
    const cuerpo = lineaNdjson({ tipo: "fase", fase: "pensando" }) + lineaNdjson({ tipo: "paso", ...paso });
    const final = lineaNdjson({ tipo: "final", estado: 200, cuerpo: { respuesta: "Listo", acciones: [] } });
    const buscar: typeof fetch = async (_url, init) => {
      assert.match(String((init?.headers as Record<string, string>).Accept), /application\/x-ndjson/);
      return respuestaFlujo([cuerpo.slice(0, 20), cuerpo.slice(20), final.slice(0, 9), final.slice(9)]);
    };
    const r = await pedirEscenaIA({ cuerpo: { mensaje: "hola" }, cabeceras: { "x-conversacion-id": "c1" }, signal: senal(), alEvento: (e) => vistos.push(e.tipo), buscar });
    assert.deepEqual(vistos, ["fase", "paso"]);
    assert.deepEqual(r, { estado: 200, datos: { respuesta: "Listo", acciones: [] } });
  });
  await prueba("sin flujo (JSON de siempre): mismo resultado, incluidos los errores con su estado", async () => {
    const ok = await pedirEscenaIA({ cuerpo: {}, cabeceras: {}, signal: senal(), buscar: async () => Response.json({ respuesta: "x" }) });
    assert.deepEqual(ok, { estado: 200, datos: { respuesta: "x" } });
    const mal = await pedirEscenaIA({ cuerpo: {}, cabeceras: {}, signal: senal(), buscar: async () => Response.json({ error: "cupo" }, { status: 429 }) });
    assert.deepEqual(mal, { estado: 429, datos: { error: "cupo" } });
  });
  await prueba("un flujo que se corta sin «final» es un error 502", async () => {
    const r = await pedirEscenaIA({ cuerpo: {}, cabeceras: {}, signal: senal(), buscar: async () => respuestaFlujo([lineaNdjson({ tipo: "paso", ...paso })]) });
    assert.equal(r.estado, 502);
  });
  await prueba("Detener: el AbortSignal corta el pedido y lanza AbortError", async () => {
    const control = new AbortController();
    const buscar: typeof fetch = (_url, init) => new Promise((_, rechazar) => {
      init?.signal?.addEventListener("abort", () => rechazar(new DOMException("Aborted", "AbortError")));
    });
    const espera = pedirEscenaIA({ cuerpo: {}, cabeceras: {}, signal: control.signal, buscar });
    control.abort();
    await assert.rejects(espera, (e: unknown) => e instanceof DOMException && e.name === "AbortError");
  });

  console.log("Ruta");
  await prueba("la ruta responde en flujo solo con la cabecera, avisa fases y pasos, y sigue en el registro", () => {
    const ruta = readFileSync(path.resolve(__dirname, "../../src/app/api/escena-ia/route.ts"), "utf8");
    assert.match(ruta, /request\.headers\.get\("accept"\)/);
    assert.match(ruta, /procesarPedido\(request, escribir\)/);
    assert.match(ruta, /avisar\?\.\(\{ tipo: "paso"/);
    assert.match(ruta, /avisar\?\.\(\{ tipo: "fase", fase: "pensando" \}\)/);
    assert.match(ruta, /getGeminiClient\("escena_ia"\)/);
    assert.match(ruta, /decidir\("herramienta:escena_ia"/);
    assert.match(ruta, /abortSignal: request\.signal/);
    assert.match(ruta, /const MAX_PASOS = 12;/);
  });

  console.log(`\n${pruebas} pruebas OK`);
}
void main();
