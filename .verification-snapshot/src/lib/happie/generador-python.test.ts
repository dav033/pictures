import assert from "node:assert/strict";
import test from "node:test";
import {
  recomendarPaquetes,
  type GenerarEstructurado,
  type HappiaPackage,
  type SolicitudGeneracionEstructurada,
  type TelemetriaRecomendacion,
} from "@sempertex/happie-package-ia";
import { generadorHappiePython } from "./generador-python";
import { correlacionValida } from "./telemetria";

const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const CORRELATION_ID = "00000000-0000-4000-8000-000000000002";
const SECRET = "s".repeat(32);

function paquete(id: string, isActive = true): HappiaPackage {
  return {
    id,
    event_type_id: "boda",
    name: `Paquete ${id}`,
    base_guests: 80,
    standard_duration_minutes: 300,
    conditions: null,
    restrictions: null,
    is_active: isActive,
    is_featured: false,
    package_items: [
      { id: `${id}-1`, total: 1_000_000, is_active: true, package_id: id, charge_type: "fijo", description: "Banquete", suggested_start_time: null, provider_name: null, category_name: "Comida" },
      { id: `${id}-2`, total: 500_000, is_active: false, package_id: id, charge_type: "fijo", description: "Inactivo", suggested_start_time: null, provider_name: null, category_name: "Bebida" },
    ],
  };
}

test("el recomendador usa el generador inyectado y conserva su propio filtro de ids", async () => {
  const solicitudes: SolicitudGeneracionEstructurada[] = [];
  const eventos: TelemetriaRecomendacion[] = [];
  const generar: GenerarEstructurado = async (solicitud) => {
    solicitudes.push(solicitud);
    return {
      texto: JSON.stringify({
        recomendaciones: [{ packageId: "p1", razon: "encaja" }, { packageId: "inventado", razon: "no existe" }],
        resumen: "Una opción",
      }),
      uso: { promptTokenCount: 120, candidatesTokenCount: 20 },
    };
  };

  const resultado = await recomendarPaquetes({
    descripcionEvento: "boda para 80",
    paquetes: [paquete("p1"), paquete("p2", false)],
    registrarTelemetria: (evento) => eventos.push(evento),
    generar,
    // Sin llave: el generador inyectado no la necesita.
    apiKey: "",
  });

  assert.deepEqual(resultado.recomendaciones.map((r) => r.paquete.id), ["p1"]);
  assert.equal(resultado.resumen, "Una opción");
  const [solicitud] = solicitudes;
  assert.equal(solicitud!.partes[0], "Descripción del cliente: boda para 80");
  const catalogo = JSON.parse(solicitud!.partes[1]!.replace("Paquetes disponibles (JSON): ", "")) as { id: string; precio_total: number }[];
  assert.deepEqual(catalogo.map((p) => [p.id, p.precio_total]), [["p1", 1_000_000]]);
  assert.match(solicitud!.instruccionSistema, /nunca inventes un id/);
  assert.equal(eventos[0]?.resultado, "ok");
  assert.equal(eventos[0]?.tokensEntrada, 120);
});

test("un abort se reporta por su causa aunque el generador lo envuelva en otro error", async () => {
  for (const [razon, esperado] of [
    [new DOMException("límite", "TimeoutError"), "timeout"],
    [new DOMException("cliente se fue", "AbortError"), "cancelado"],
  ] as const) {
    const controlador = new AbortController();
    const eventos: TelemetriaRecomendacion[] = [];
    const generar: GenerarEstructurado = (solicitud) => new Promise((_resolver, rechazar) => {
      solicitud.signal.addEventListener("abort", () => rechazar(new Error("PYTHON_REQUEST_CANCELLED")), { once: true });
      controlador.abort(razon);
    });
    await assert.rejects(
      () => recomendarPaquetes({ descripcionEvento: "boda", paquetes: [paquete("p1")], signal: controlador.signal, registrarTelemetria: (e) => eventos.push(e), generar }),
      (error: unknown) => error === razon,
    );
    assert.equal(eventos[0]?.resultado, esperado);
  }
});

test("generadorHappiePython manda las partes y el schema adaptado a Google, y mapea el uso", async () => {
  const entornoOriginal = { url: process.env.PYTHON_BACKEND_URL, secreto: process.env.INTERNAL_HMAC_SECRET };
  const fetchOriginal = globalThis.fetch;
  let cuerpo: Record<string, unknown> | undefined;
  process.env.PYTHON_BACKEND_URL = "http://python.test";
  process.env.INTERNAL_HMAC_SECRET = SECRET;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    cuerpo = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      schema_version: "operational.v1",
      request_id: REQUEST_ID,
      correlation_id: CORRELATION_ID,
      payload: { text: "{\"acuse\":\"ok\"}", model: "gemini-3.6-flash", usage: { prompt_token_count: 50, thoughts_token_count: 0 } },
    });
  }) as typeof fetch;
  try {
    const generar = generadorHappiePython("conversation_extract", { requestId: REQUEST_ID, correlationId: CORRELATION_ID });
    const resultado = await generar({
      modelo: "gemini-3.6-flash",
      instruccionSistema: "Eres el extractor.",
      partes: ["somos 50 personas"],
      jsonSchema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        additionalProperties: false,
        properties: {
          acuse: { type: "string" },
          invitados: { anyOf: [{ type: "integer", exclusiveMinimum: 0 }, { type: "null" }] },
        },
      },
      signal: new AbortController().signal,
    });
    assert.equal(resultado.texto, "{\"acuse\":\"ok\"}");
    assert.deepEqual(resultado.uso, { promptTokenCount: 50, candidatesTokenCount: undefined, thoughtsTokenCount: 0, cachedContentTokenCount: undefined, toolUsePromptTokenCount: undefined });
    assert.equal(cuerpo?.purpose, "conversation_extract");
    assert.deepEqual(cuerpo?.parts, ["somos 50 personas"]);
    // Sin $schema, additionalProperties ni exclusiveMinimum: el SDK Python los rechaza.
    assert.deepEqual(cuerpo?.response_json_schema, {
      type: "object",
      properties: { acuse: { type: "string" }, invitados: { anyOf: [{ type: "integer" }, { type: "null" }] } },
    });
  } finally {
    globalThis.fetch = fetchOriginal;
    if (entornoOriginal.url === undefined) delete process.env.PYTHON_BACKEND_URL; else process.env.PYTHON_BACKEND_URL = entornoOriginal.url;
    if (entornoOriginal.secreto === undefined) delete process.env.INTERNAL_HMAC_SECRET; else process.env.INTERNAL_HMAC_SECRET = entornoOriginal.secreto;
  }
});

test("correlacionValida solo adopta un UUID recibido del cliente externo", () => {
  assert.equal(correlacionValida(CORRELATION_ID, REQUEST_ID), CORRELATION_ID);
  assert.equal(correlacionValida("pedido-123", REQUEST_ID), REQUEST_ID);
  assert.equal(correlacionValida(null, REQUEST_ID), REQUEST_ID);
});
