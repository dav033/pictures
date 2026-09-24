import assert from "node:assert/strict";
import test from "node:test";
import { ThinkingLevel } from "@google/genai";
import type { ImagenAdjunta, Mensaje } from "@sempertex/agente-core";
import { ErrorIA } from "@/lib/ia/tipos";
import type { FragmentoChat, PeticionChat } from "@/lib/ia/tipos";
import { crearChatGeminiPython } from "./chat-python";

const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const CORRELATION_ID = "00000000-0000-4000-8000-000000000002";

process.env.PYTHON_BACKEND_URL = "http://python.test";
process.env.INTERNAL_HMAC_SECRET = "local-only-secret-0123456789abcdef";

type Llamada = { url: string; body: Record<string, unknown>; headers: Headers };

const FIN = {
  type: "end",
  text: "Hola",
  tool_calls: [],
  usage_metadata: { promptTokenCount: 10, candidatesTokenCount: 3 },
  model: "gemini-3.6-flash",
  finish_reason: "STOP",
  block_reason: null,
};

function ndjson(eventos: unknown[], onCancel?: () => void): Response {
  const encoder = new TextEncoder();
  let indice = 0;
  const cuerpo = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (indice >= eventos.length) {
        controller.close();
        return;
      }
      // One line split across two chunks, to exercise the line buffering.
      const linea = `${JSON.stringify(eventos[indice++])}\n`;
      const mitad = Math.floor(linea.length / 2);
      controller.enqueue(encoder.encode(linea.slice(0, mitad)));
      controller.enqueue(encoder.encode(linea.slice(mitad)));
    },
    cancel() {
      onCancel?.();
    },
  });
  return new Response(cuerpo, { headers: { "content-type": "application/x-ndjson" } });
}

function conFetch(respuestas: Array<() => Response>): { llamadas: Llamada[]; restaurar: () => void } {
  const original = globalThis.fetch;
  const llamadas: Llamada[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    llamadas.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown>, headers: new Headers(init?.headers) });
    const siguiente = respuestas[Math.min(llamadas.length - 1, respuestas.length - 1)];
    return siguiente();
  }) as typeof fetch;
  return { llamadas, restaurar: () => { globalThis.fetch = original; } };
}

function peticion(historial: Mensaje[]): PeticionChat {
  return {
    sistema: "Eres un asesor.",
    historial,
    herramientas: [{ nombre: "buscar_catalogo_rag", descripcion: "Busca.", esquema: { type: "object" } }],
  };
}

async function recoger(stream: AsyncIterable<FragmentoChat>): Promise<FragmentoChat[]> {
  const fragmentos: FragmentoChat[] = [];
  for await (const fragmento of stream) fragmentos.push(fragmento);
  return fragmentos;
}

function puerto() {
  return crearChatGeminiPython({ requestId: REQUEST_ID, correlationId: CORRELATION_ID, thinkingLevel: ThinkingLevel.LOW });
}

test("turnoStream emite los deltas y un fin con el uso y el finishReason de Python", async () => {
  const { llamadas, restaurar } = conFetch([() => ndjson([{ type: "text", delta: "Ho" }, { type: "text", delta: "la" }, FIN])]);
  try {
    const fragmentos = await recoger(puerto().turnoStream(peticion([{ rol: "usuario", texto: "hola" }])));

    assert.deepEqual(fragmentos.slice(0, 2), [{ tipo: "texto", delta: "Ho" }, { tipo: "texto", delta: "la" }]);
    const fin = fragmentos[2];
    assert.equal(fin?.tipo, "fin");
    if (fin?.tipo !== "fin") return;
    assert.equal(fin.texto, "Hola");
    assert.equal(fin.finishReason, "STOP");
    assert.deepEqual(fin.uso, { entrada: 10, salida: 3, cacheados: 0, pensamiento: 0, promptHerramientas: 0 });

    const cuerpo = llamadas[0]!.body;
    assert.equal(new URL(llamadas[0]!.url).pathname, "/internal/v1/ia/chat-turn-stream");
    assert.equal(cuerpo.schema_version, "chat-turn-stream.v1");
    assert.equal(cuerpo.thinking_level, "low");
    assert.equal(cuerpo.model, "gemini-3.6-flash");
    assert.deepEqual(cuerpo.tools, [{ name: "buscar_catalogo_rag", description: "Busca.", parameters_json_schema: { type: "object" } }]);
    assert.equal(llamadas[0]!.headers.get("idempotency-key"), null);
  } finally {
    restaurar();
  }
});

test("la firma de una llamada vuelve en la vuelta siguiente, y una imagen ya enviada no se reenvía", async () => {
  const imagen: ImagenAdjunta = { id: "ESPACIO_BASE", mime: "image/png", base64: "aGVsbG8=", descripcion: "Foto real." };
  const conLlamada = {
    ...FIN,
    text: "",
    tool_calls: [{ id: "call_1", name: "buscar_catalogo_rag", args: { q: "dorado" }, thought_signature: "c2lnbmF0dXJh" }],
  };
  const { llamadas, restaurar } = conFetch([() => ndjson([conLlamada]), () => ndjson([FIN])]);
  try {
    const chat = puerto();
    const historial: Mensaje[] = [{ rol: "usuario", texto: "hola", imagenes: [imagen] }];
    const primera = await recoger(chat.turnoStream(peticion(historial)));
    const fin = primera.at(-1);
    assert.equal(fin?.tipo, "fin");
    if (fin?.tipo !== "fin") return;
    assert.deepEqual(fin.llamadas, [{ id: "call_1", nombre: "buscar_catalogo_rag", args: { q: "dorado" }, meta: { thoughtSignature: "c2lnbmF0dXJh" } }]);
    assert.equal(fin.bytesImagenEnviados, 5);

    // What agente-core's loop does between turns.
    historial.push({ rol: "asistente", llamadas: fin.llamadas });
    historial.push({ rol: "herramienta", nombre: "buscar_catalogo_rag", llamadaId: "call_1", resultado: { ok: true } });
    await recoger(chat.turnoStream(peticion(historial)));

    const [primerTurno, segundoTurno] = llamadas.map((llamada) => llamada.body.contents as Array<{ role: string; parts: Array<Record<string, unknown>> }>);
    assert.ok(primerTurno![0]!.parts.some((parte) => "inlineData" in parte));
    assert.ok(!segundoTurno![0]!.parts.some((parte) => "inlineData" in parte), "la imagen no se reenvía en la segunda vuelta");
    assert.deepEqual(segundoTurno![1], {
      role: "model",
      parts: [{ functionCall: { name: "buscar_catalogo_rag", args: { q: "dorado" }, id: "call_1" }, thoughtSignature: "c2lnbmF0dXJh" }],
    });
    assert.deepEqual(segundoTurno![2], { role: "user", parts: [{ functionResponse: { name: "buscar_catalogo_rag", response: { ok: true }, id: "call_1" } }] });
  } finally {
    restaurar();
  }
});

test("un error al abrir (429) se reintenta, como en el camino directo", async () => {
  const cuota = { type: "error", code: "chat_turn_provider_error", provider_status: 429, provider_message: "429 RESOURCE_EXHAUSTED", phase: "open" };
  const { llamadas, restaurar } = conFetch([() => ndjson([cuota]), () => ndjson([{ type: "text", delta: "ok" }, FIN])]);
  try {
    const fragmentos = await recoger(puerto().turnoStream(peticion([{ rol: "usuario", texto: "hola" }])));
    assert.equal(llamadas.length, 2);
    assert.equal(fragmentos.at(-1)?.tipo, "fin");
  } finally {
    restaurar();
  }
});

test("un 400 al abrir con imágenes es imagen rechazada y no se reintenta", async () => {
  const rechazo = { type: "error", code: "chat_turn_provider_error", provider_status: 400, provider_message: "400 INVALID_ARGUMENT. Unable to process input image.", phase: "open" };
  const { llamadas, restaurar } = conFetch([() => ndjson([rechazo])]);
  try {
    const historial: Mensaje[] = [{ rol: "usuario", texto: "hola", imagenes: [{ id: "ESPACIO_BASE", mime: "image/png", base64: "aGVsbG8=" }] }];
    await assert.rejects(
      () => recoger(puerto().turnoStream(peticion(historial))),
      (error: unknown) => error instanceof ErrorIA && error.message.startsWith("AI_IMAGE_REJECTED") && !error.reintentable,
    );
    assert.equal(llamadas.length, 1);
  } finally {
    restaurar();
  }
});

test("un error después del primer delta no se reintenta: repetiría texto ya mostrado", async () => {
  const caida = { type: "error", code: "chat_turn_provider_error", provider_status: 503, provider_message: "503 UNAVAILABLE", phase: "stream" };
  const { llamadas, restaurar } = conFetch([() => ndjson([{ type: "text", delta: "Hola" }, caida])]);
  try {
    const vistos: FragmentoChat[] = [];
    await assert.rejects(async () => {
      for await (const fragmento of puerto().turnoStream(peticion([{ rol: "usuario", texto: "hola" }]))) vistos.push(fragmento);
    }, (error: unknown) => error instanceof ErrorIA && error.causa === "desconocido");
    assert.deepEqual(vistos, [{ tipo: "texto", delta: "Hola" }]);
    assert.equal(llamadas.length, 1);
  } finally {
    restaurar();
  }
});

test("un stream que termina sin evento final es un error, no un turno vacío", async () => {
  const { restaurar } = conFetch([() => ndjson([{ type: "text", delta: "a medias" }])]);
  try {
    await assert.rejects(() => recoger(puerto().turnoStream(peticion([{ rol: "usuario", texto: "hola" }]))), ErrorIA);
  } finally {
    restaurar();
  }
});

test("Python sin GEMINI_API_KEY es sin_llave y no se reintenta", async () => {
  const { llamadas, restaurar } = conFetch([() => Response.json({ detail: { code: "chat_turn_unavailable" } }, { status: 503 })]);
  try {
    await assert.rejects(
      () => recoger(puerto().turnoStream(peticion([{ rol: "usuario", texto: "hola" }]))),
      (error: unknown) => error instanceof ErrorIA && error.causa === "sin_llave" && !error.reintentable,
    );
    assert.equal(llamadas.length, 1);
  } finally {
    restaurar();
  }
});

test("cortar el stream antes del final cancela el cuerpo de la respuesta (Python ve la desconexión)", async () => {
  let cancelado = false;
  const { restaurar } = conFetch([() => ndjson([{ type: "text", delta: "uno" }, { type: "text", delta: "dos" }, FIN], () => { cancelado = true; })]);
  try {
    for await (const fragmento of puerto().turnoStream(peticion([{ rol: "usuario", texto: "hola" }]))) {
      assert.equal(fragmento.tipo, "texto");
      break;
    }
    assert.equal(cancelado, true);
  } finally {
    restaurar();
  }
});

test("turno() arma el mismo TurnoChat que el fin del stream", async () => {
  const { restaurar } = conFetch([() => ndjson([{ type: "text", delta: "Hola" }, FIN])]);
  try {
    const turno = await puerto().turno(peticion([{ rol: "usuario", texto: "hola" }]));
    assert.equal(turno.texto, "Hola");
    assert.equal("tipo" in turno, false);
  } finally {
    restaurar();
  }
});
