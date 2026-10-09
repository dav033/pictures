import assert from "node:assert/strict";
import test from "node:test";
import { ErrorIA, type FragmentoChat, type Mensaje, type TurnoChat } from "@sempertex/agente-core";
import { crearChatClaude } from "./chat";
import type { ConfigClaude } from "./config";
import type { CuerpoMensajes } from "./tipos";

/** Sin red: un `fetch` de mentira que guarda cada petición y responde lo que diga el guion. */
type Peticion = { url: string; cuerpo: CuerpoMensajes & { stream?: boolean }; cabeceras: Record<string, string>; signal?: AbortSignal | null };

function fetchFalso(guion: Array<(peticion: Peticion) => Response>): { fetch: typeof fetch; peticiones: Peticion[] } {
  const peticiones: Peticion[] = [];
  const falso = async (entrada: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const peticion: Peticion = { url: String(entrada), cuerpo: JSON.parse(String(init?.body)) as Peticion["cuerpo"], cabeceras: init?.headers as Record<string, string>, signal: init?.signal };
    peticiones.push(peticion);
    const responder = guion[Math.min(peticiones.length - 1, guion.length - 1)]!;
    return responder(peticion);
  };
  return { fetch: falso as typeof fetch, peticiones };
}

const json = (cuerpo: unknown, status = 200) => () => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });

const mensaje = (content: unknown[], stop_reason = "end_turn", usage: Record<string, unknown> = { input_tokens: 100, output_tokens: 20 }) =>
  ({ id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-5-5", content, stop_reason, usage });

const config = (fetch: typeof globalThis.fetch, extra: Partial<ConfigClaude> = {}): ConfigClaude & { fetch: typeof globalThis.fetch } =>
  ({ apiKey: "clave-de-prueba", modelo: "claude-haiku-5-5", esfuerzo: "medium", pensamiento: true, maxTokens: 16_000, fetch, ...extra });

const HERRAMIENTAS = [
  { nombre: "buscar_catalogo_rag", descripcion: "Busca productos.", esquema: { $schema: "http://json-schema.org/draft-07/schema#", type: "object", properties: { consulta: { type: "string" } }, required: ["consulta"] } },
  { nombre: "armar_plan", descripcion: "Arma el plan.", esquema: { type: "object", properties: {} } },
];

const IMAGEN = { base64: Buffer.from("bytes-de-una-foto-de-prueba").toString("base64"), mime: "image/jpeg", id: "INSPIRACION", descripcion: "Foto del cliente." };

test("la petición: modelo, esfuerzo, razonamiento adaptativo, caché en sistema/última herramienta/cola, sin temperatura ni prefill", async () => {
  const { fetch, peticiones } = fetchFalso([json(mensaje([{ type: "text", text: "Hola" }]))]);
  const chat = crearChatClaude(config(fetch));
  await chat.turno({ sistema: "Eres el asistente.", historial: [{ rol: "usuario", texto: "hola" }], herramientas: HERRAMIENTAS, temperatura: 0.2 });
  const { cuerpo, cabeceras, url } = peticiones[0]!;
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(cabeceras["x-api-key"], "clave-de-prueba");
  assert.equal(cabeceras["anthropic-version"], "2023-06-01");
  assert.equal(cuerpo.model, "claude-haiku-5-5");
  assert.equal(cuerpo.max_tokens, 16_000);
  assert.deepEqual(cuerpo.output_config, { effort: "medium" });
  assert.deepEqual(cuerpo.thinking, { type: "adaptive" });
  assert.deepEqual(cuerpo.cache_control, { type: "ephemeral" });
  assert.deepEqual(cuerpo.system, [{ type: "text", text: "Eres el asistente.", cache_control: { type: "ephemeral" } }]);
  assert.equal("temperature" in cuerpo || "top_p" in cuerpo || "top_k" in cuerpo, false, "Haiku 5.5 rechaza muestreo distinto del de fábrica");
  assert.deepEqual(cuerpo.tools!.map((t) => t.name), ["buscar_catalogo_rag", "armar_plan"]);
  assert.equal(cuerpo.tools![0]!.cache_control, undefined);
  assert.deepEqual(cuerpo.tools![1]!.cache_control, { type: "ephemeral" });
  assert.equal("$schema" in cuerpo.tools![0]!.input_schema, false);
  assert.equal(cuerpo.messages.at(-1)!.role, "user", "nunca termina en el asistente");
  assert.equal(chat.id, "claude");
  assert.equal(chat.thinkingLevel, "medium");
});

test("IA_LOCAL_PENSAMIENTO=off apaga el razonamiento; el esfuerzo viaja tal cual", async () => {
  const { fetch, peticiones } = fetchFalso([json(mensaje([{ type: "text", text: "ok" }]))]);
  await crearChatClaude(config(fetch, { esfuerzo: "low", pensamiento: false })).turno({ sistema: "s", historial: [{ rol: "usuario", texto: "x" }], herramientas: [] });
  assert.deepEqual(peticiones[0]!.cuerpo.thinking, { type: "disabled" });
  assert.deepEqual(peticiones[0]!.cuerpo.output_config, { effort: "low" });
  assert.equal(peticiones[0]!.cuerpo.tools, undefined);
});

test("visión: cada imagen va como bloque image con su rótulo [IMAGEN_ID=…] antes del texto, y cuenta sus bytes", async () => {
  const { fetch, peticiones } = fetchFalso([json(mensaje([{ type: "text", text: "Veo globos." }]))]);
  const turno = await crearChatClaude(config(fetch)).turno({ sistema: "s", historial: [{ rol: "usuario", texto: "¿qué ves?", imagenes: [IMAGEN] }], herramientas: [] });
  assert.deepEqual(peticiones[0]!.cuerpo.messages[0]!.content, [
    { type: "text", text: "[IMAGEN_ID=INSPIRACION] Foto del cliente." },
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: IMAGEN.base64 } },
    { type: "text", text: "¿qué ves?" },
  ]);
  assert.equal(turno.bytesImagenEnviados, Buffer.from("bytes-de-una-foto-de-prueba").byteLength);
});

test("respuesta: texto visible, llamadas con id y args, motivo en mayúsculas, tokens con caché y razonamiento", async () => {
  const contenido = [
    { type: "thinking", thinking: "", signature: "firma-1" },
    { type: "text", text: "Busco." },
    { type: "tool_use", id: "toolu_a", name: "buscar_catalogo_rag", input: { consulta: "arco dorado" } },
    { type: "tool_use", id: "toolu_b", name: "armar_plan", input: {} },
  ];
  const usage = { input_tokens: 50, output_tokens: 300, cache_read_input_tokens: 4000, cache_creation_input_tokens: 1000, output_tokens_details: { thinking_tokens: 120 } };
  const { fetch } = fetchFalso([json(mensaje(contenido, "tool_use", usage))]);
  const turno = await crearChatClaude(config(fetch)).turno({ sistema: "s", historial: [{ rol: "usuario", texto: "x" }], herramientas: HERRAMIENTAS });
  assert.equal(turno.texto, "Busco.");
  assert.deepEqual(turno.llamadas.map((l) => [l.id, l.nombre, l.args]), [["toolu_a", "buscar_catalogo_rag", { consulta: "arco dorado" }], ["toolu_b", "armar_plan", {}]]);
  assert.deepEqual(turno.uso, { entrada: 5050, salida: 180, cacheados: 4000, cacheEscritos: 1000, pensamiento: 120 });
  assert.equal(turno.finishReason, "TOOL_USE");
  assert.equal(turno.modelo, "claude-haiku-5-5");
});

test("bucle de herramientas: el turno del modelo vuelve tal cual (razonamiento incluido) y los resultados van juntos como tool_result", async () => {
  const contenido = [
    { type: "thinking", thinking: "", signature: "firma-1" },
    { type: "tool_use", id: "toolu_a", name: "buscar_catalogo_rag", input: { consulta: "arco" } },
    { type: "tool_use", id: "toolu_b", name: "armar_plan", input: {} },
  ];
  const { fetch, peticiones } = fetchFalso([json(mensaje(contenido, "tool_use")), json(mensaje([{ type: "text", text: "Listo." }]))]);
  const chat = crearChatClaude(config(fetch));
  const historial: Mensaje[] = [{ rol: "usuario", texto: "un arco" }];
  const primero = await chat.turno({ sistema: "s", historial, herramientas: HERRAMIENTAS });
  // Lo mismo que hace ejecutar.ts de agente-core.
  historial.push({ rol: "asistente", llamadas: primero.llamadas });
  historial.push({ rol: "herramienta", nombre: "buscar_catalogo_rag", llamadaId: "toolu_a", resultado: { productos: ["SKU-1"] } });
  historial.push({ rol: "herramienta", nombre: "armar_plan", llamadaId: "toolu_b", resultado: { error: "falta el presupuesto" } });
  await chat.turno({ sistema: "s", historial, herramientas: HERRAMIENTAS });
  const mensajes = peticiones[1]!.cuerpo.messages;
  assert.equal(mensajes.length, 3);
  assert.deepEqual(mensajes[1], { role: "assistant", content: contenido }, "el turno del modelo, intacto");
  assert.deepEqual(mensajes[2], { role: "user", content: [
    { type: "tool_result", tool_use_id: "toolu_a", content: JSON.stringify({ productos: ["SKU-1"] }) },
    { type: "tool_result", tool_use_id: "toolu_b", content: JSON.stringify({ error: "falta el presupuesto" }) },
  ] });
  // El primer pedido no cambió: el historial es de solo agregar.
  assert.deepEqual(peticiones[1]!.cuerpo.messages[0], peticiones[0]!.cuerpo.messages[0]);
});

test("un historial de otro proveedor (llamadas sin id, sin meta) se rearma con ids emparejados", async () => {
  const { fetch, peticiones } = fetchFalso([json(mensaje([{ type: "text", text: "ok" }]))]);
  await crearChatClaude(config(fetch)).turno({ sistema: "s", herramientas: HERRAMIENTAS, historial: [
    { rol: "asistente", texto: "¡Hola! ¿Qué celebras?" },
    { rol: "usuario", texto: "un cumpleaños" },
    { rol: "asistente", llamadas: [{ nombre: "armar_plan", args: { evento: "cumple" } }] },
    { rol: "herramienta", nombre: "armar_plan", resultado: { ok: true } },
  ] });
  const mensajes = peticiones[0]!.cuerpo.messages;
  assert.equal(mensajes[0]!.role, "user", "el primero es del usuario");
  const uso = mensajes.flatMap((m) => m.content).find((b) => b.type === "tool_use") as { id: string };
  const resultado = mensajes.flatMap((m) => m.content).find((b) => b.type === "tool_result") as { tool_use_id: string };
  assert.equal(resultado.tool_use_id, uso.id);
  assert.equal(mensajes.at(-1)!.role, "user");
});

/** Cuerpo SSE partido en trozos que cortan eventos a la mitad (como llega por la red). */
function flujoSse(eventos: unknown[], opciones: { trozo?: number; signal?: AbortSignal | null; sinFin?: boolean } = {}): Response {
  const texto = eventos.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  const bytes = new TextEncoder().encode(texto);
  const trozo = opciones.trozo ?? 17;
  const cuerpo = new ReadableStream<Uint8Array>({
    start(controlador) {
      for (let i = 0; i < bytes.length; i += trozo) controlador.enqueue(bytes.slice(i, i + trozo));
      if (!opciones.sinFin) controlador.close();
      opciones.signal?.addEventListener("abort", () => controlador.error(new DOMException("This operation was aborted", "AbortError")));
    },
  });
  return new Response(cuerpo, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const EVENTOS_FLUJO = [
  { type: "message_start", message: mensaje([], null as unknown as string, { input_tokens: 30, output_tokens: 1, cache_read_input_tokens: 2000 }) },
  { type: "ping" },
  { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "firma-flujo" } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Te armo " } },
  { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "el arco." } },
  { type: "content_block_stop", index: 1 },
  { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_f", name: "armar_plan", input: {} } },
  { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "{\"evento\": \"cum" } },
  { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "ple\", \"invitados\": 40}" } },
  { type: "content_block_stop", index: 2 },
  { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 90 } },
  { type: "message_stop" },
];

async function leerTodo(flujo: AsyncIterable<FragmentoChat>): Promise<{ deltas: string[]; fin: TurnoChat | null }> {
  const deltas: string[] = [];
  let fin: TurnoChat | null = null;
  for await (const fragmento of flujo) {
    if (fragmento.tipo === "texto") deltas.push(fragmento.delta);
    else fin = fragmento;
  }
  return { deltas, fin };
}

test("flujo: texto en vivo, tool_use armado desde el JSON parcial, razonamiento con firma y uso acumulado", async () => {
  const { fetch, peticiones } = fetchFalso([() => flujoSse(EVENTOS_FLUJO)]);
  const { deltas, fin } = await leerTodo(crearChatClaude(config(fetch)).turnoStream({ sistema: "s", historial: [{ rol: "usuario", texto: "un arco" }], herramientas: HERRAMIENTAS }));
  assert.equal(peticiones[0]!.cuerpo.stream, true);
  assert.deepEqual(deltas, ["Te armo ", "el arco."]);
  assert.ok(fin);
  assert.equal(fin.texto, "Te armo el arco.");
  assert.deepEqual(fin.llamadas.map((l) => [l.id, l.nombre, l.args]), [["toolu_f", "armar_plan", { evento: "cumple", invitados: 40 }]]);
  const replay = fin.llamadas[0]!.meta?.contenidoClaude as Array<Record<string, unknown>>;
  assert.deepEqual(replay[0], { type: "thinking", thinking: "", signature: "firma-flujo" }, "la firma llega para reenviarla");
  assert.equal(fin.finishReason, "TOOL_USE");
  assert.deepEqual(fin.uso, { entrada: 2030, salida: 90, cacheados: 2000, cacheEscritos: 0, pensamiento: 0 });
});

test("un evento error a mitad del flujo se lanza como ErrorIA; un flujo sin message_stop no se da por bueno", async () => {
  const conError = fetchFalso([() => flujoSse([EVENTOS_FLUJO[0], { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }])]);
  await assert.rejects(leerTodo(crearChatClaude(config(conError.fetch)).turnoStream({ sistema: "s", historial: [{ rol: "usuario", texto: "x" }], herramientas: [] })),
    (error: unknown) => error instanceof ErrorIA && error.proveedor === "claude" && /overloaded_error/.test(error.message));
  const cortado = fetchFalso([() => flujoSse(EVENTOS_FLUJO.slice(0, 8))]);
  await assert.rejects(leerTodo(crearChatClaude(config(cortado.fetch)).turnoStream({ sistema: "s", historial: [{ rol: "usuario", texto: "x" }], herramientas: [] })), /flujo_incompleto/);
});

test("el tope de tokens a mitad de una llamada: no sale una herramienta con argumentos cortados; el motivo es MAX_TOKENS", async () => {
  const cortado = [
    ...EVENTOS_FLUJO.slice(0, 10),
    { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "{\"evento\": \"cum" } },
    { type: "content_block_stop", index: 2 },
    { type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 16_000 } },
    { type: "message_stop" },
  ];
  const { fetch } = fetchFalso([() => flujoSse(cortado)]);
  const { fin } = await leerTodo(crearChatClaude(config(fetch)).turnoStream({ sistema: "s", historial: [{ rol: "usuario", texto: "x" }], herramientas: HERRAMIENTAS }));
  assert.equal(fin?.finishReason, "MAX_TOKENS");
  assert.deepEqual(fin?.llamadas, []);
  assert.equal(fin?.texto, "Te armo el arco.");
});

test("una respuesta 200 con forma inesperada no se reintenta (ya se cobró)", async () => {
  const { fetch, peticiones } = fetchFalso([json({ id: "msg_1", content: "no es una lista" })]);
  await assert.rejects(crearChatClaude(config(fetch)).turno({ sistema: "s", historial: [{ rol: "usuario", texto: "x" }], herramientas: [] }),
    (error: unknown) => error instanceof ErrorIA && !error.reintentable && /inesperada/.test(error.message));
  assert.equal(peticiones.length, 1);
});

test("corte: la señal llega al fetch y cortar a mitad del flujo relanza el AbortError, no un fallo del proveedor", async () => {
  const controlador = new AbortController();
  const { fetch, peticiones } = fetchFalso([(peticion) => flujoSse(EVENTOS_FLUJO.slice(0, 7), { sinFin: true, signal: peticion.signal })]);
  const flujo = crearChatClaude(config(fetch)).turnoStream({ sistema: "s", historial: [{ rol: "usuario", texto: "x" }], herramientas: [], signal: controlador.signal });
  const deltas: string[] = [];
  await assert.rejects(async () => {
    for await (const fragmento of flujo) {
      if (fragmento.tipo === "texto") {
        deltas.push(fragmento.delta);
        controlador.abort();
      }
    }
  }, (error: unknown) => error instanceof Error && error.name === "AbortError" && !(error instanceof ErrorIA));
  assert.equal(peticiones[0]!.signal, controlador.signal);
  assert.deepEqual(deltas, ["Te armo "]);
});

test("con la señal ya cortada no sale ninguna petición", async () => {
  const { fetch, peticiones } = fetchFalso([json(mensaje([{ type: "text", text: "no" }]))]);
  const controlador = new AbortController();
  controlador.abort();
  await assert.rejects(crearChatClaude(config(fetch)).turno({ sistema: "s", historial: [{ rol: "usuario", texto: "x" }], herramientas: [], signal: controlador.signal }));
  assert.equal(peticiones.length, 0);
});

test("errores: 429 se reintenta; 401 es sin_llave sin reintento; 400 no se reintenta; 400 por la imagen lleva el prefijo de adjunto", async () => {
  const cuota = fetchFalso([json({ type: "error", error: { type: "rate_limit_error", message: "Too many" } }, 429), json(mensaje([{ type: "text", text: "ya" }]))]);
  assert.equal((await crearChatClaude(config(cuota.fetch)).turno({ sistema: "s", historial: [{ rol: "usuario", texto: "x" }], herramientas: [] })).texto, "ya");
  assert.equal(cuota.peticiones.length, 2);

  const llave = fetchFalso([json({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, 401)]);
  await assert.rejects(crearChatClaude(config(llave.fetch)).turno({ sistema: "s", historial: [{ rol: "usuario", texto: "x" }], herramientas: [] }),
    (error: unknown) => error instanceof ErrorIA && error.causa === "sin_llave" && !error.reintentable && !error.message.includes("clave-de-prueba"));
  assert.equal(llave.peticiones.length, 1);

  const invalida = fetchFalso([json({ type: "error", error: { type: "invalid_request_error", message: "tools.0.name: bad" } }, 400)]);
  await assert.rejects(crearChatClaude(config(invalida.fetch)).turno({ sistema: "s", historial: [{ rol: "usuario", texto: "x" }], herramientas: [] }),
    (error: unknown) => error instanceof ErrorIA && !error.reintentable && !error.message.startsWith("AI_IMAGE_REJECTED"));
  assert.equal(invalida.peticiones.length, 1);

  const imagen = fetchFalso([json({ type: "error", error: { type: "invalid_request_error", message: "messages.0.content.1.image.source.base64: invalid image" } }, 400)]);
  await assert.rejects(crearChatClaude(config(imagen.fetch)).turno({ sistema: "s", historial: [{ rol: "usuario", texto: "x", imagenes: [IMAGEN] }], herramientas: [] }),
    (error: unknown) => error instanceof ErrorIA && error.message.startsWith("AI_IMAGE_REJECTED") && !error.reintentable);
});

test("refusal: no se reintenta ni se lanza; el turno llega vacío con su motivo (como SAFETY en Gemini)", async () => {
  const { fetch, peticiones } = fetchFalso([json(mensaje([], "refusal"))]);
  const turno = await crearChatClaude(config(fetch)).turno({ sistema: "s", historial: [{ rol: "usuario", texto: "x" }], herramientas: [] });
  assert.equal(turno.finishReason, "REFUSAL");
  assert.equal(turno.texto, "");
  assert.equal(peticiones.length, 1);
});
