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
import { TIPO_NDJSON, crearSeparadorDeLineas, eventoDeLinea, leerFlujo, lineaNdjson, pedirEscenaIA, responderEnFlujo, type EventoFlujo } from "../../src/lib/globos3d/flujo-escena-ia";

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

  console.log("Servidor del flujo");
  const leerTodo = async (r: Response): Promise<EventoFlujo[]> => { const e: EventoFlujo[] = []; await leerFlujo(r.body!, (x) => e.push(x)); return e; };
  await prueba("el final lleva el estado real (aunque la respuesta HTTP del flujo sea 200) y se avisa al registro", async () => {
    const vistos: number[] = [];
    const r = responderEnFlujo({ procesar: async (avisar) => { avisar({ tipo: "fase", fase: "pensando" }); return Response.json({ error: "cupo" }, { status: 429 }); }, alFallo: () => assert.fail("no falló"), alTerminar: (e) => vistos.push(e) });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-accel-buffering"), "no");
    assert.match(r.headers.get("content-type") ?? "", /x-ndjson/);
    const eventos = await leerTodo(r);
    assert.deepEqual(eventos.map((e) => e.tipo), ["fase", "final"]);
    assert.deepEqual(eventos[1], { tipo: "final", estado: 429, cuerpo: { error: "cupo" } });
    assert.deepEqual(vistos, [429]);
  });
  await prueba("una excepción a mitad del flujo sale como «final» 500 tras lo ya avisado, y se registra", async () => {
    const fallos: unknown[] = [];
    const r = responderEnFlujo({ procesar: async (avisar) => { avisar({ tipo: "paso", ...paso }); throw new Error("se cayó el modelo"); }, alFallo: (e) => fallos.push(e) });
    const eventos = await leerTodo(r);
    assert.deepEqual(eventos.map((e) => e.tipo), ["paso", "final"]);
    assert.equal((eventos[1] as { estado: number }).estado, 500);
    assert.equal(fallos.length, 1);
  });
  await prueba("el latido sale mientras la IA trabaja y el cliente no lo cuenta como paso", async () => {
    const r = responderEnFlujo({ procesar: async () => { await new Promise((ok) => setTimeout(ok, 90)); return Response.json({ respuesta: "x" }); }, alFallo: () => undefined, latidoMs: 20 });
    const eventos = await leerTodo(r);
    assert.ok(eventos.filter((e) => e.tipo === "latido").length >= 2, "al menos dos latidos");
    assert.equal(eventos[eventos.length - 1]!.tipo, "final");
    const vistos: string[] = [];
    const cliente = await pedirEscenaIA({
      cuerpo: {}, cabeceras: {}, signal: senal(), alEvento: (e) => vistos.push(e.tipo),
      buscar: async () => responderEnFlujo({ procesar: async (avisar) => { avisar({ tipo: "fase", fase: "pensando" }); await new Promise((ok) => setTimeout(ok, 50)); return Response.json({ ok: 1 }); }, alFallo: () => undefined, latidoMs: 10 }),
    });
    assert.deepEqual(vistos, ["fase"]);
    assert.deepEqual(cliente, { estado: 200, datos: { ok: 1 } });
  });
  await prueba("si el navegador corta (cancela el cuerpo) el servidor no se rompe, apaga el latido y avisa al registro", async () => {
    let termino = 0;
    let soltar: () => void = () => undefined;
    const r = responderEnFlujo({ procesar: () => new Promise((ok) => { soltar = () => ok(Response.json({ ok: 1 })); }), alFallo: () => assert.fail("no era un fallo"), alTerminar: () => { termino += 1; }, latidoMs: 10 });
    const lector = r.body!.getReader();
    await lector.read();
    await lector.cancel();
    soltar();
    await new Promise((ok) => setTimeout(ok, 40));
    assert.equal(termino, 1);
  });

  console.log("Ruta");
  await prueba("la ruta responde en flujo solo con la cabecera, avisa fases y pasos, y sigue en el registro", () => {
    const ruta = readFileSync(path.resolve(__dirname, "../../src/app/api/escena-ia/route.ts"), "utf8");
    assert.match(ruta, /request\.headers\.get\("accept"\)/);
    assert.match(ruta, /responderEnFlujo\(\{/);
    assert.match(ruta, /procesar: \(avisar\) => procesarPedido\(request, avisar\)/);
    assert.match(ruta, /alTerminar: \(estado\) =>/);
    assert.match(ruta, /uso: \{ pasos, llamadas, costeEstimadoUsd: costeUsd\(modeloIA, usos/);
    assert.match(ruta, /avisar\?\.\(\{ tipo: "paso"/);
    assert.match(ruta, /avisar\?\.\(\{ tipo: "fase", fase: "pensando" \}\)/);
    // W5: el modelo sale del registro (Gemini, o Claude solo en local), con su cliente auditado y el corte del navegador.
    assert.match(ruta, /modeloEscenaIADe\(destinoGenerativo\(\)\.proveedor\)/);
    assert.doesNotMatch(ruta, /resolverProveedor\(|from "@\/lib\/ia\/nucleo\/registro"/, "la ruta no abre SQLite para elegir proveedor");
    const modelo = readFileSync(path.resolve(__dirname, "../../src/lib/globos3d/modelo-escena/crear-modelo.ts"), "utf8");
    assert.match(modelo, /getGeminiClient\("escena_ia"\)/);
    assert.match(modelo, /getClaudeClient\("escena_ia"\)/);
    assert.match(ruta, /decidir\("herramienta:escena_ia"/);
    // El corte del navegador («Detener») sigue llegando al modelo: la ruta lo junta con el del plazo (`corteConPlazo`) y se lo pasa a la sesión.
    assert.match(ruta, /const corte = corteConPlazo\(request\.signal, plazo\);/);
    assert.match(ruta, /signal: corte,/);
    assert.match(readFileSync(path.resolve(__dirname, "../../src/lib/globos3d/plazo-escena-ia.ts"), "utf8"), /AbortSignal\.any\(\[corteDelNavegador,/);
    assert.match(readFileSync(path.resolve(__dirname, "../../src/lib/globos3d/modelo-escena/sesion-gemini.ts"), "utf8"), /abortSignal: signal/);
    assert.match(readFileSync(path.resolve(__dirname, "../../src/lib/globos3d/modelo-escena/sesion-claude.ts"), "utf8"), /cliente\.messages\.create\(cuerpo, \{ signal \}\)/);
    assert.match(ruta, /const MAX_PASOS = 12;/);
  });

  console.log(`\n${pruebas} pruebas OK`);
}
void main();
