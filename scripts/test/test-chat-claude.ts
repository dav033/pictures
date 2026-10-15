/**
 * W5 (T21): el ChatPort de Claude entregado por el registro (`chatDe("claude")`, ya envuelto con `envolverChatPort`),
 * sin red ni coste: `fetch` simulado para api.anthropic.com; cualquier otra salida hace fallar.
 *   npx tsx --conditions=react-server scripts/test/test-chat-claude.ts
 * - turno: la petición (modelo, esfuerzo de IA_LOCAL_ESFUERZO, herramientas, imágenes como bloques) y la respuesta
 *   neutral (texto, llamadas con id, tokens);
 * - bucle de herramientas: las llamadas y sus resultados vuelven como tool_use / tool_result;
 * - turnoStream: texto en vivo y llamada armada desde el JSON parcial;
 * - el coste con los precios de Haiku llega a la auditoría (observarLlamadasIa) y un fallo queda como error;
 * - fuera de local no hay ChatPort de Claude.
 */
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ErrorIA, type FragmentoChat, type Mensaje, type TurnoChat } from "@sempertex/agente-core";
import { costeDeTurnoClaudeUsd } from "../../src/lib/ia/claude/precios";
import type { CuerpoMensajes } from "../../src/lib/ia/claude/tipos";

Object.assign(process.env, { NODE_ENV: "development", IA_PROVEEDOR: "claude", ANTHROPIC_API_KEY: "sk-ant-prueba-no-real", GEMINI_API_KEY: "clave-gemini-de-prueba" });
for (const variable of ["VERCEL", "IA_LOCAL_ESFUERZO", "IA_LOCAL_PENSAMIENTO", "ANTHROPIC_CHAT_MODEL", "IA_CLAUDE_TRANSPORTE"]) Reflect.deleteProperty(process.env, variable);

type Peticion = { url: string; cuerpo: CuerpoMensajes & { stream?: boolean } };
const peticiones: Peticion[] = [];
const fuera: string[] = [];
let guion: Array<() => Response> = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (entrada: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
  if (!url.startsWith("https://api.anthropic.com/")) {
    fuera.push(url);
    throw new Error(`no debía salir de Claude: ${url}`);
  }
  peticiones.push({ url, cuerpo: JSON.parse(String(init?.body)) as Peticion["cuerpo"] });
  const responder = guion[Math.min(peticiones.length - 1, guion.length - 1)];
  if (!responder) throw new Error("sin respuesta en el guion");
  return responder();
}) as typeof fetch;

const json = (cuerpo: unknown, status = 200) => () => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
const mensaje = (content: unknown[], stop_reason = "end_turn", usage: Record<string, unknown> = { input_tokens: 1000, output_tokens: 200 }) =>
  ({ id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-5-5", content, stop_reason, usage });

function flujoSse(eventos: unknown[]): () => Response {
  const texto = eventos.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return () => new Response(new TextEncoder().encode(texto), { status: 200, headers: { "content-type": "text/event-stream" } });
}

const HERRAMIENTAS = [
  { nombre: "buscar_catalogo_rag", descripcion: "Busca productos.", esquema: { type: "object", properties: { consulta: { type: "string" } }, required: ["consulta"] } },
  { nombre: "armar_plan", descripcion: "Arma el plan.", esquema: { type: "object", properties: {} } },
];
const IMAGEN = { base64: Buffer.from("bytes-de-una-foto").toString("base64"), mime: "image/jpeg", id: "INSPIRACION", descripcion: "Foto del cliente." };

let pruebas = 0;
const prueba = async (nombre: string, fn: () => Promise<void>) => {
  peticiones.length = 0;
  fuera.length = 0;
  await fn();
  assert.deepEqual(fuera, [], "nada salió a otro host");
  pruebas += 1;
  console.log(`  ✓ ${nombre}`);
};

async function main() {
  const { chatDe } = await import("../../src/lib/ia/nucleo/registro");
  const { observarLlamadasIa } = await import("../../src/lib/registro/observadores-llamadas");
  const cierres: Array<{ proveedor: string; proposito: string; modelo: string; costeEstimadoUsd?: number; error: boolean }> = [];
  observarLlamadasIa((evento) => cierres.push(evento));

  await prueba("turno: Haiku 5.5, esfuerzo medium, herramientas, imagen como bloque y respuesta neutral con llamadas e id", async () => {
    guion = [json(mensaje([{ type: "text", text: "Busco." }, { type: "tool_use", id: "toolu_a", name: "buscar_catalogo_rag", input: { consulta: "arco" } }], "tool_use", { input_tokens: 500, output_tokens: 300, cache_read_input_tokens: 4000, cache_creation_input_tokens: 1000, output_tokens_details: { thinking_tokens: 120 } }))];
    const chat = await chatDe("claude", "chat_guiado");
    const turno = await chat.turno({ sistema: "Eres el asistente.", historial: [{ rol: "usuario", texto: "¿qué ves?", imagenes: [IMAGEN] }], herramientas: HERRAMIENTAS, temperatura: 0.2 });
    const { cuerpo, url } = peticiones[0]!;
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    assert.equal(cuerpo.model, "claude-haiku-5-5");
    assert.deepEqual(cuerpo.output_config, { effort: "medium" });
    assert.deepEqual(cuerpo.thinking, { type: "adaptive" });
    assert.equal("temperature" in cuerpo, false);
    assert.deepEqual(cuerpo.tools!.map((t) => t.name), ["buscar_catalogo_rag", "armar_plan"]);
    assert.deepEqual(cuerpo.messages[0]!.content.map((b) => b.type), ["text", "image", "text"]);
    assert.equal(turno.texto, "Busco.");
    assert.deepEqual(turno.llamadas.map((l) => [l.id, l.nombre, l.args]), [["toolu_a", "buscar_catalogo_rag", { consulta: "arco" }]]);
    assert.deepEqual(turno.uso, { entrada: 5500, salida: 180, cacheados: 4000, cacheEscritos: 1000, pensamiento: 120 });
    assert.equal(turno.bytesImagenEnviados, Buffer.from("bytes-de-una-foto").byteLength);
  });

  await prueba("IA_LOCAL_ESFUERZO=high llega al cuerpo y al ChatPort", async () => {
    process.env.IA_LOCAL_ESFUERZO = "high";
    try {
      guion = [json(mensaje([{ type: "text", text: "ok" }]))];
      const chat = await chatDe("claude");
      assert.equal(chat.thinkingLevel, "high");
      await chat.turno({ sistema: "s", historial: [{ rol: "usuario", texto: "x" }], herramientas: [] });
      assert.deepEqual(peticiones[0]!.cuerpo.output_config, { effort: "high" });
    } finally {
      Reflect.deleteProperty(process.env, "IA_LOCAL_ESFUERZO");
    }
  });

  await prueba("bucle de herramientas: el turno del modelo vuelve intacto y el resultado va como tool_result", async () => {
    const contenido = [{ type: "tool_use", id: "toolu_a", name: "armar_plan", input: {} }];
    guion = [json(mensaje(contenido, "tool_use")), json(mensaje([{ type: "text", text: "Listo." }]))];
    const chat = await chatDe("claude", "chat_guiado");
    const historial: Mensaje[] = [{ rol: "usuario", texto: "un plan" }];
    const primero = await chat.turno({ sistema: "s", historial, herramientas: HERRAMIENTAS });
    historial.push({ rol: "asistente", llamadas: primero.llamadas });
    historial.push({ rol: "herramienta", nombre: "armar_plan", llamadaId: "toolu_a", resultado: { ok: true } });
    const segundo = await chat.turno({ sistema: "s", historial, herramientas: HERRAMIENTAS });
    assert.equal(segundo.texto, "Listo.");
    const mensajes = peticiones[1]!.cuerpo.messages;
    assert.deepEqual(mensajes[1], { role: "assistant", content: contenido });
    assert.deepEqual(mensajes[2], { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_a", content: JSON.stringify({ ok: true }) }] });
  });

  await prueba("turnoStream: texto en vivo, llamada armada desde el JSON parcial y fin con el uso", async () => {
    guion = [flujoSse([
      { type: "message_start", message: mensaje([], null as unknown as string, { input_tokens: 30, output_tokens: 1 }) },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Te armo " } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "el arco." } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_f", name: "armar_plan", input: {} } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{\"evento\": \"cum" } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "ple\"}" } },
      { type: "content_block_stop", index: 1 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 90 } },
      { type: "message_stop" },
    ])];
    const chat = await chatDe("claude", "chat_guiado");
    const deltas: string[] = [];
    let fin: TurnoChat | null = null;
    for await (const fragmento of chat.turnoStream({ sistema: "s", historial: [{ rol: "usuario", texto: "un arco" }], herramientas: HERRAMIENTAS }) as AsyncIterable<FragmentoChat>) {
      if (fragmento.tipo === "texto") deltas.push(fragmento.delta);
      else fin = fragmento;
    }
    assert.equal(peticiones[0]!.cuerpo.stream, true);
    assert.deepEqual(deltas, ["Te armo ", "el arco."]);
    assert.deepEqual(fin?.llamadas.map((l) => [l.id, l.nombre, l.args]), [["toolu_f", "armar_plan", { evento: "cumple" }]]);
    assert.equal(fin?.finishReason, "TOOL_USE");
    assert.equal(fin?.uso.salida, 90);
  });

  await prueba("telemetría de coste: la auditoría recibe el precio de Haiku (entrada 0,10 / salida 0,50 por millón)", async () => {
    cierres.length = 0;
    guion = [json(mensaje([{ type: "text", text: "ok" }], "end_turn", { input_tokens: 10_000, output_tokens: 2_000 }))];
    const chat = await chatDe("claude", "chat_guiado");
    await chat.turno({ sistema: "s", historial: [{ rol: "usuario", texto: "x" }], herramientas: [] });
    const cierre = cierres.at(-1);
    assert.equal(cierre?.proveedor, "claude");
    assert.equal(cierre?.proposito, "chat_guiado");
    assert.equal(cierre?.error, false);
    assert.ok(cierre?.costeEstimadoUsd !== undefined && Math.abs(cierre.costeEstimadoUsd - (10_000 * 0.1 + 2_000 * 0.5) / 1e6) < 1e-9, `coste ${cierre?.costeEstimadoUsd}`);
  });

  await prueba("coste con caché: lo cacheado y lo escrito en caché no se cobran como entrada (Haiku: 0,10 / 0,125 / 0,01 / 0,50)", async () => {
    cierres.length = 0;
    guion = [json(mensaje([{ type: "text", text: "ok" }], "end_turn", { input_tokens: 2_000, output_tokens: 500, cache_read_input_tokens: 8_000, cache_creation_input_tokens: 1_000 }))];
    const chat = await chatDe("claude", "chat_guiado");
    await chat.turno({ sistema: "s", historial: [{ rol: "usuario", texto: "x" }], herramientas: [] });
    const esperado = (2_000 * 0.1 + 1_000 * 0.125 + 8_000 * 0.01 + 500 * 0.5) / 1e6;
    const coste = cierres.at(-1)?.costeEstimadoUsd;
    assert.ok(coste !== undefined && Math.abs(coste - esperado) < 1e-12, `coste ${coste}, esperado ${esperado}`);
  });

  await prueba("coste con razonamiento: los tokens de pensamiento se cobran como salida", () => {
    const turno = { modelo: "claude-haiku-5-5", uso: { entrada: 11_000, salida: 500, cacheados: 8_000, cacheEscritos: 1_000, pensamiento: 300 } } as unknown as TurnoChat;
    const esperado = (2_000 * 0.1 + 1_000 * 0.125 + 8_000 * 0.01 + (500 + 300) * 0.5) / 1e6;
    const coste = costeDeTurnoClaudeUsd(turno);
    assert.ok(coste !== undefined && Math.abs(coste - esperado) < 1e-12, `coste ${coste}, esperado ${esperado}`);
    return Promise.resolve();
  });

  await prueba("transporte cli: la suscripción no factura por llamada, el coste de la auditoría es 0", async () => {
    cierres.length = 0;
    const carpeta = mkdtempSync(path.join(tmpdir(), "claude-falso-"));
    const rutaPath = process.env.PATH;
    try {
      const resultado = JSON.stringify({ type: "result", subtype: "success", result: "ok", usage: { input_tokens: 10_000, output_tokens: 2_000 } });
      const init = JSON.stringify({ type: "system", subtype: "init", tools: [] });
      writeFileSync(path.join(carpeta, "claude"), `#!/bin/sh\nhead -n 1 >/dev/null\necho '${init}'\necho '${resultado}'\n`);
      chmodSync(path.join(carpeta, "claude"), 0o755);
      Object.assign(process.env, { IA_CLAUDE_TRANSPORTE: "cli", PATH: `${carpeta}${path.delimiter}${rutaPath ?? ""}` });
      const chat = await chatDe("claude", "chat_guiado");
      const turno = await chat.turno({ sistema: "s", historial: [{ rol: "usuario", texto: "x" }], herramientas: [] });
      assert.equal(turno.texto, "ok");
      assert.equal(peticiones.length, 0, "el transporte cli no usa fetch");
      assert.equal(cierres.at(-1)?.costeEstimadoUsd, 0);
    } finally {
      Reflect.deleteProperty(process.env, "IA_CLAUDE_TRANSPORTE");
      if (rutaPath === undefined) Reflect.deleteProperty(process.env, "PATH"); else Object.assign(process.env, { PATH: rutaPath });
      rmSync(carpeta, { recursive: true, force: true });
    }
  });

  await prueba("un 400 del proveedor llega como ErrorIA sin reintento y la auditoría lo cierra con error", async () => {
    cierres.length = 0;
    guion = [json({ type: "error", error: { type: "invalid_request_error", message: "tools.0.name: bad" } }, 400)];
    const chat = await chatDe("claude", "chat_guiado");
    await assert.rejects(chat.turno({ sistema: "s", historial: [{ rol: "usuario", texto: "x" }], herramientas: [] }), (e: unknown) => e instanceof ErrorIA && !e.reintentable);
    assert.equal(peticiones.length, 1);
    assert.equal(cierres.at(-1)?.error, true);
  });

  await prueba("fuera de local no hay ChatPort de Claude y no sale ninguna petición", async () => {
    for (const cambio of [{ NODE_ENV: "production" }, { VERCEL: "1" }]) {
      const antes = Object.fromEntries(Object.keys(cambio).map((k) => [k, process.env[k]]));
      Object.assign(process.env, cambio);
      try {
        await assert.rejects(chatDe("claude"), (e: unknown) => e instanceof ErrorIA && e.causa === "sin_llave" && !e.reintentable);
      } finally {
        for (const [k, v] of Object.entries(antes)) { if (v === undefined) Reflect.deleteProperty(process.env, k); else Object.assign(process.env, { [k]: v }); }
      }
    }
    assert.equal(peticiones.length, 0);
  });

  console.log(`\ntest-chat-claude: ${pruebas} pruebas ok`);
}

void main()
  .catch((error: unknown) => { console.error(error); process.exitCode = 1; })
  .finally(() => { globalThis.fetch = fetchOriginal; });
