/**
 * W5: el modelo de la IA de escena detrás del registro. Sin red ni coste:
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-modelo-escena.ts
 * - Gemini (producción): la sesión manda EXACTAMENTE la petición que armaba /api/escena-ia antes (misma forma, mismo orden
 *   de claves, el paso forzado con ANY y la lista permitida, razonamiento LOW, el corte), reenvía el turno del modelo tal
 *   cual (firmas incluidas) y el coste es la misma cuenta. El recorrido completo de la ruta con Gemini lo prueba además
 *   test-refinar-foto.ts (Gemini de mentira por fetch).
 * - Claude (solo local): partes → bloques en orden, paso forzado = solo las permitidas con tool_choice any, el turno del
 *   modelo vuelve intacto, tool_result por id, fila de ai_call_log con proveedor anthropic, coste por vuelta y el corte.
 */
import assert from "node:assert/strict";
import { FunctionCallingConfigMode, ThinkingLevel, type Content, type GenerateContentParameters, type Part } from "@google/genai";
import { configurarPersistenciaTelemetria, ultimosEventos } from "@sempertex/agente-core";
import { DECLARACIONES_ESCENA } from "../../src/lib/globos3d/herramientas-escena";
import { MODELAR_DESDE_FOTO } from "../../src/lib/globos3d/herramientas-escena-foto";
import { PREGUNTAR_USUARIO } from "../../src/lib/globos3d/herramientas-escena-extra";
import { crearModeloEscenaGemini, type ClienteGeminiEscena } from "../../src/lib/globos3d/modelo-escena/sesion-gemini";
import { crearModeloEscenaClaude } from "../../src/lib/globos3d/modelo-escena/sesion-claude";
import type { UsoPasoEscena } from "../../src/lib/globos3d/modelo-escena/tipos";
import { crearClienteAnthropic } from "../../src/lib/ia/claude/cliente";
import type { CuerpoMensajes } from "../../src/lib/ia/claude/tipos";
import { registrarClaude, registrarSegunProveedor } from "../../src/lib/ia/nucleo/telemetria-llamadas";

let pruebas = 0;
const prueba = async (nombre: string, fn: () => void | Promise<void>) => { await fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const SISTEMA = "Eres el asistente del taller 3D.";
const HISTORIAL = [{ rol: "usuario" as const, texto: "un arco" }, { rol: "asistente" as const, texto: "Listo, armé el arco." }];
const IMAGEN: Part = { inlineData: { mimeType: "image/jpeg", data: Buffer.from("jpeg-de-prueba").toString("base64") } };
const PARTES: Part[] = [{ text: "como la foto\n\n[Piezas que ya hay: arco]" }, IMAGEN];
const FORZADAS = [MODELAR_DESDE_FOTO, PREGUNTAR_USUARIO];

async function probarGemini() {
  console.log("Gemini (producción)");
  const peticiones: Array<{ params: GenerateContentParameters; contents: string }> = [];
  const turnoModelo: Content = { role: "model", parts: [{ text: "Aplico la foto.", thoughtSignature: "firma-gemini" }, { functionCall: { name: MODELAR_DESDE_FOTO, args: { modo: "sumar" } } }] };
  const respuestas = [
    { candidates: [{ content: turnoModelo }], usageMetadata: { promptTokenCount: 4000, candidatesTokenCount: 200, thoughtsTokenCount: 100 } },
    { candidates: [{ content: { role: "model", parts: [{ text: "pensando…", thought: true }, { text: "Listo, sumé la foto." }] } }], usageMetadata: { promptTokenCount: 4500, candidatesTokenCount: 50, thoughtsTokenCount: 0 } },
  ];
  const cliente: ClienteGeminiEscena = {
    models: {
      async generateContent(params) {
        peticiones.push({ params, contents: JSON.stringify(params.contents) });
        return respuestas[peticiones.length - 1]!;
      },
    },
  };
  const signal = new AbortController().signal;
  const modelo = crearModeloEscenaGemini(cliente, "gemini-3.6-flash");
  const sesion = modelo.iniciar({ sistema: SISTEMA, declaraciones: DECLARACIONES_ESCENA, historial: HISTORIAL, partesUsuario: PARTES, signal });
  const paso1 = await sesion.pedir(FORZADAS);
  sesion.responder([{ nombre: MODELAR_DESDE_FOTO, respuesta: { resultado: "Armé lo leído", verificacion: "piezas 1 → 4" } }]);
  const paso2 = await sesion.pedir();

  // La petición tal como la armaba la ruta antes de W5 (copiada de src/app/api/escena-ia/route.ts en b4433bc9).
  const contents: Content[] = [
    ...HISTORIAL.map((h): Content => ({ role: h.rol === "usuario" ? "user" : "model", parts: [{ text: h.texto }] })),
    { role: "user", parts: PARTES },
  ];
  const antes = (forzar: boolean): GenerateContentParameters => ({
    model: "gemini-3.6-flash",
    contents,
    config: { systemInstruction: SISTEMA, tools: [{ functionDeclarations: [...DECLARACIONES_ESCENA] }], ...(forzar ? { toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: [MODELAR_DESDE_FOTO, PREGUNTAR_USUARIO] } } } : {}), thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, abortSignal: signal },
  });

  await prueba("la primera vuelta (forzada) es la misma petición, clave por clave y en el mismo orden", () => {
    const esperado = antes(true);
    const real = peticiones[0]!;
    assert.equal(real.contents, JSON.stringify(esperado.contents));
    assert.equal(JSON.stringify({ ...real.params, contents: null }), JSON.stringify({ ...esperado, contents: null }));
    assert.equal(real.params.config?.abortSignal, signal, "el corte del navegador llega al modelo");
  });

  await prueba("la segunda vuelta: el turno del modelo tal cual (firma incluida) y la respuesta de la herramienta en un mensaje", () => {
    const esperado = antes(false);
    const contenidos: Content[] = [...contents, turnoModelo, { role: "user", parts: [{ functionResponse: { name: MODELAR_DESDE_FOTO, response: { resultado: "Armé lo leído", verificacion: "piezas 1 → 4" } } }] }];
    assert.equal(peticiones[1]!.contents, JSON.stringify(contenidos));
    assert.equal(JSON.stringify({ ...peticiones[1]!.params, contents: null }), JSON.stringify({ ...esperado, contents: null }));
  });

  await prueba("lo que vuelve: texto visible sin pensamiento, llamadas con sus argumentos, tokens", () => {
    assert.deepEqual(paso1.llamadas, [{ nombre: MODELAR_DESDE_FOTO, args: { modo: "sumar" } }]);
    assert.equal(paso1.texto, "Aplico la foto.");
    assert.deepEqual(paso1.uso, { entrada: 4000, salida: 200, pensamiento: 100, cacheLeidos: 0, cacheEscritos: 0 });
    assert.equal(paso2.texto, "Listo, sumé la foto.");
    assert.deepEqual(paso2.llamadas, []);
  });

  await prueba("el coste es la misma cuenta de antes (US$0,50 entrada, US$3 salida + pensamiento) con el mismo redondeo", () => {
    const usos = [paso1.uso, paso2.uso];
    const tokens = { entrada: 8500, salida: 250, pensamiento: 100 };
    const costeAntes = (lecturaUsd: number) => Math.round((((tokens.entrada * 0.5 + (tokens.salida + tokens.pensamiento) * 3) / 1e6) + lecturaUsd) * 1e5) / 1e5;
    for (const lectura of [0, 0.00123, 0.0004567]) assert.equal(Math.round((modelo.costeUsd(usos) + lectura) * 1e5) / 1e5, costeAntes(lectura));
    assert.equal(modelo.proveedor, "gemini");
    assert.equal(modelo.modelo, "gemini-3.6-flash");
  });
}

async function probarClaude() {
  console.log("Claude (solo local)");
  configurarPersistenciaTelemetria(undefined);
  const cuerpos: Array<CuerpoMensajes & { stream?: boolean }> = [];
  const senales: Array<AbortSignal | null | undefined> = [];
  const contenido1 = [
    { type: "thinking", thinking: "", signature: "firma-claude" },
    { type: "tool_use", id: "toolu_1", name: MODELAR_DESDE_FOTO, input: { modo: "sumar" } },
  ];
  const respuestas = [
    { id: "m1", model: "claude-haiku-5-5", role: "assistant", content: contenido1, stop_reason: "tool_use", usage: { input_tokens: 2_000, output_tokens: 80, cache_creation_input_tokens: 35_000, cache_read_input_tokens: 0 } },
    { id: "m2", model: "claude-haiku-5-5", role: "assistant", content: [{ type: "text", text: "Listo, sumé la foto." }], stop_reason: "end_turn", usage: { input_tokens: 70_000, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 35_000 } },
  ];
  const fetchFalso = (async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    cuerpos.push(JSON.parse(String(init?.body)) as CuerpoMensajes);
    senales.push(init?.signal);
    const cuerpo = respuestas[Math.min(cuerpos.length - 1, respuestas.length - 1)]!;
    return new Response(JSON.stringify(cuerpo), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const registradas: Array<Parameters<typeof registrarClaude>[0]> = [];
  const config = { apiKey: "clave-de-prueba", modelo: "claude-haiku-5-5", esfuerzo: "medium" as const, pensamiento: true, maxTokens: 16_000 };
  const modelo = crearModeloEscenaClaude(crearClienteAnthropic({ apiKey: config.apiKey, fetch: fetchFalso }), config, { registrar: (entrada) => { registradas.push(entrada); } });
  const corte = new AbortController();
  const sesion = modelo.iniciar({ sistema: SISTEMA, declaraciones: DECLARACIONES_ESCENA, historial: HISTORIAL, partesUsuario: PARTES, signal: corte.signal });
  const paso1 = await sesion.pedir(FORZADAS);
  sesion.responder([{ nombre: MODELAR_DESDE_FOTO, id: "toolu_1", respuesta: { resultado: "Armé lo leído", verificacion: "piezas 1 → 4" } }]);
  const paso2 = await sesion.pedir();

  await prueba("primera vuelta: historial + el mensaje con la foto en orden; paso forzado = solo las permitidas con tool_choice any", () => {
    const cuerpo = cuerpos[0]!;
    assert.deepEqual(cuerpo.messages, [
      { role: "user", content: [{ type: "text", text: "un arco" }] },
      { role: "assistant", content: [{ type: "text", text: "Listo, armé el arco." }] },
      { role: "user", content: [{ type: "text", text: "como la foto\n\n[Piezas que ya hay: arco]" }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: IMAGEN.inlineData!.data } }] },
    ]);
    assert.deepEqual(cuerpo.tools!.map((h) => h.name).sort(), [...FORZADAS].sort());
    assert.deepEqual(cuerpo.tool_choice, { type: "any" });
    assert.deepEqual(cuerpo.thinking, { type: "disabled" }, "el paso forzado no deja razonamiento que reenviar con otra lista de herramientas");
    assert.equal(cuerpo.system![0]!.text, SISTEMA);
    assert.deepEqual(cuerpo.output_config, { effort: "medium" });
    assert.equal(senales[0], corte.signal, "el corte del navegador llega al fetch");
  });

  await prueba("segunda vuelta: todas las herramientas, el turno del modelo intacto y el tool_result con su id", () => {
    const cuerpo = cuerpos[1]!;
    assert.equal(cuerpo.tools!.length, DECLARACIONES_ESCENA.length);
    assert.equal(cuerpo.tool_choice, undefined);
    assert.deepEqual(cuerpo.thinking, { type: "adaptive" });
    assert.deepEqual(cuerpo.messages.slice(0, 3), cuerpos[0]!.messages, "solo se agrega al historial");
    assert.deepEqual(cuerpo.messages[3], { role: "assistant", content: contenido1 });
    assert.deepEqual(cuerpo.messages[4], { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: JSON.stringify({ resultado: "Armé lo leído", verificacion: "piezas 1 → 4" }) }] });
  });

  await prueba("lo que vuelve a la ruta: llamadas con id, texto y tokens con la caché", () => {
    assert.deepEqual(paso1.llamadas, [{ id: "toolu_1", nombre: MODELAR_DESDE_FOTO, args: { modo: "sumar" } }]);
    assert.deepEqual(paso1.uso, { entrada: 37_000, salida: 80, pensamiento: 0, cacheLeidos: 0, cacheEscritos: 35_000 });
    assert.equal(paso2.texto, "Listo, sumé la foto.");
  });

  await prueba("cada vuelta deja su fila de telemetría (ok, modelo, uso de Anthropic, motivo en mayúsculas, esfuerzo)", () => {
    assert.equal(registradas.length, 2);
    assert.equal(registradas[0]!.resultado, "ok");
    assert.equal(registradas[0]!.finishReason, "TOOL_USE");
    assert.equal(registradas[0]!.thinkingLevel, "medium");
    assert.equal(registradas[0]!.contexto?.superficie, "/api/escena-ia");
    assert.deepEqual(registradas[1]!.usage, respuestas[1]!.usage);
  });

  await prueba("el coste se cuenta por petición: la segunda (105 000 tokens de prompt) va con la tarifa larga", () => {
    const usos: UsoPasoEscena[] = [paso1.uso, paso2.uso];
    const primera = (2_000 * 0.10 + 35_000 * 0.125 + 80 * 0.50) / 1e6;
    const segunda = (70_000 * 0.50 + 35_000 * 0.05 + 30 * 2.50) / 1e6;
    assert.ok(Math.abs(modelo.costeUsd(usos) - (primera + segunda)) < 1e-15, String(modelo.costeUsd(usos)));
  });

  await prueba("un fallo de la API deja la fila con resultado error y se relanza", async () => {
    const fallido = crearModeloEscenaClaude(crearClienteAnthropic({ apiKey: "x", fetch: (async () => new Response(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "Too many" } }), { status: 429 })) as typeof fetch }), config, { registrar: (entrada) => { registradas.push(entrada); } });
    await assert.rejects(fallido.iniciar({ sistema: SISTEMA, declaraciones: DECLARACIONES_ESCENA, historial: [], partesUsuario: [{ text: "x" }], signal: corte.signal }).pedir(), /429/);
    assert.equal(registradas.at(-1)!.resultado, "error");
  });

  await prueba("registrarClaude escribe la fila de ai_call_log como proveedor anthropic, con la caché en tokens", () => {
    registrarClaude({ flujo: "armador_decoracion", capacidad: "chat_turno", modelo: "claude-haiku-5-5", inicio: Date.now(), resultado: "ok", usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1_000, cache_creation_input_tokens: 10, output_tokens_details: { thinking_tokens: 20 } }, thinkingLevel: "medium", finishReason: "END_TURN" });
    const fila = ultimosEventos()[0]!;
    assert.equal(fila.proveedor, "anthropic");
    assert.equal(fila.modelo, "claude-haiku-5-5");
    assert.equal(fila.tokensEntrada, 1_110);
    assert.equal(fila.tokensCacheados, 1_000);
    assert.equal(fila.tokensSalida, 30);
    assert.equal(fila.tokensPensamiento, 20);
    assert.equal(fila.finishReason, "END_TURN");
    assert.equal(fila.thinkingLevel, "medium");
  });

  await prueba("registrarSegunProveedor: el ChatPort de Claude se anota como anthropic y el de Gemini como gemini", () => {
    const base = { flujo: "analisis_referencia" as const, capacidad: "analisis_referencia_inventario" as const, modelo: "m", inicio: Date.now(), resultado: "ok" as const };
    registrarSegunProveedor("claude", base);
    assert.equal(ultimosEventos()[0]!.proveedor, "anthropic");
    registrarSegunProveedor("gemini", base);
    assert.equal(ultimosEventos()[0]!.proveedor, "gemini");
  });
}

async function main() {
  await probarGemini();
  await probarClaude();
  console.log(`\ntest-modelo-escena: ${pruebas} pruebas ok`);
}

void main().catch((error: unknown) => { console.error(error); process.exit(1); });
