import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  InternalRequestSignatureV1Schema,
  verificarRequestInterna,
  sha256Body,
} from "../../src/lib/ia/contracts/operational-v1";
import {
  PYTHON_CATALOG_RECOMMENDATIONS_PATH,
  PYTHON_CATALOG_RECOMMENDATIONS_SCOPE,
  PythonAdapterError,
  llamarPythonCatalogRecommendations,
  llamarPythonCatalogSearch,
  llamarPythonCatalogSelection,
  llamarPythonChatTurnStream,
  llamarPythonEcho,
  llamarPythonEmbedding,
  llamarPythonImageGenerate,
  llamarPythonIntentParse,
  llamarPythonHappieGenerate,
  llamarPythonLoraGenerate,
  llamarPythonPatronReferencia,
  llamarPythonPlanResolution,
  llamarPythonReferenceTurn,
  llamarPythonRerank,
} from "../../src/lib/ia/nucleo/python-adapter";
import type { PlanDecoracion } from "../../src/lib/plan/tipos";
import { POST } from "../../src/app/api/internal/ai/echo/route";

const SECRET = "local-only-secret-0123456789abcdef";
const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const CORRELATION_ID = "00000000-0000-4000-8000-000000000002";
// Ya no hay selector de linaje: Python es el único backend de dominio
// (ADR-0023 paso 5). Lo que el adaptador sigue leyendo del entorno es su
// destino y su secreto de firma.
const BASE_ENV = {
  PYTHON_BACKEND_URL: "http://python.test",
  INTERNAL_HMAC_SECRET: SECRET,
};

type CapturedCall = { input: RequestInfo | URL; init: RequestInit | undefined };

function successResponse(payload: Record<string, unknown> = { message: "python" }): Response {
  return Response.json({
    schema_version: "operational.v1",
    request_id: REQUEST_ID,
    correlation_id: CORRELATION_ID,
    payload,
  });
}

function adapterInput(fetchImpl: typeof fetch, overrides: Partial<Parameters<typeof llamarPythonEcho>[0]> = {}) {
  return {
    payload: { message: "hello" },
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    bodySha256: sha256Body('{"message":"hello"}'),
    deadlineMs: 1_000,
    env: BASE_ENV,
    fetchImpl,
    ...overrides,
  };
}

function validCatalogSelectionPayload(overrides: {
  subtotal_cop?: number;
  total_cop?: number;
} = {}): Record<string, unknown> {
  return {
    operation_schema_version: "catalog-selection-result.v1",
    status: "ok",
    catalog_snapshot_id: "products_catalog:test",
    validados: [{
      product_id: "prod-1",
      variant_id: "variant-1",
      sku: "SKU-1",
      product_title: "Globos rojos",
      title: "Globo rojo R12",
      unit_price_cop: 1500,
      quantity: 2,
      subtotal_cop: overrides.subtotal_cop ?? 3000,
      image_url: "https://cdn.example/p-1.jpg",
      handle: "globos-rojos",
      product_type: "Globo",
      category: "globo_latex",
      colors: ["rojo"],
      description: null,
      units_per_package: 10,
      size_code: "R12",
      shape: "redondo",
      diameter_inches: 12,
    }],
    rechazados: [],
    total_cop: overrides.total_cop ?? 3000,
  };
}

function validPlanResolutionPayload(): Record<string, unknown> {
  const readFixture = (name: string): Record<string, unknown> => JSON.parse(
    readFileSync(path.join(process.cwd(), "contracts", "domain", "v1", "fixtures", name), "utf8"),
  ) as Record<string, unknown>;
  const resolved = readFixture("plan-resuelto-ok.json");
  const estimate = readFixture("material-estimate-ok.json");
  const quote = readFixture("quote-ok.json");
  const resolvedTotals = resolved.totales as Record<string, unknown>;
  const resolvedWithOfficialWaste = {
    ...resolved,
    totales: { ...resolvedTotals, merma_porcentaje: 8 },
  };
  const quoteWithOfficialWaste = {
    ...quote,
    waste_percentage: 8,
    plan_hash: resolved.plan_hash,
  };
  return {
    operation_schema_version: "plan-resolution-result.v1",
    catalog_snapshot_id: "products_catalog:test",
    plan_resuelto: resolvedWithOfficialWaste,
    material_estimate: estimate,
    quote: quoteWithOfficialWaste,
  };
}

async function withEnvironment<T>(
  values: Record<string, string | undefined>,
  action: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await action();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function testEnabledHeadersAndNonce(): Promise<void> {
  const calls: CapturedCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    return successResponse();
  };
  await llamarPythonEcho(adapterInput(fetchImpl));
  await llamarPythonEcho(adapterInput(fetchImpl));
  assert.equal(calls.length, 2);
  const first = calls[0];
  assert.ok(first.init?.body && typeof first.init.body === "string");
  const body = first.init.body;
  const headers = new Headers(first.init.headers);
  const signature = InternalRequestSignatureV1Schema.parse({
    schema_version: headers.get("x-internal-schema-version"),
    timestamp: Number(headers.get("x-internal-timestamp")),
    nonce: headers.get("x-internal-nonce"),
    signature: headers.get("x-internal-signature"),
    scopes: headers.get("x-internal-scopes")?.split(",") ?? [],
  });
  assert.equal(headers.get("x-request-id"), REQUEST_ID);
  assert.equal(headers.get("x-correlation-id"), CORRELATION_ID);
  assert.equal(headers.get("x-internal-schema-version"), "operational.v1");
  assert.equal(headers.get("x-internal-scopes"), "ai.echo");
  assert.equal(verificarRequestInterna({
    secret: SECRET,
    signature,
    method: "POST",
    path: new URL(String(first.input)).pathname,
    bodySha256: sha256Body(body),
    requiredScopes: ["ai.echo"],
  }), true);
  assert.equal(JSON.parse(body).context.body_sha256, sha256Body('{"message":"hello"}'));
  const firstNonce = headers.get("x-internal-nonce");
  const secondNonce = new Headers(calls[1].init?.headers).get("x-internal-nonce");
  assert.notEqual(firstNonce, secondNonce);

  const replayFetch: typeof fetch = async () => Response.json(
    {
      schema_version: "operational.v1",
      request_id: "00000000-0000-4000-8000-000000000003",
      correlation_id: "00000000-0000-4000-8000-000000000004",
      payload: { message: "replayed" },
    },
    { headers: { "x-idempotency-result": "replay" } },
  );
  const replayed = await llamarPythonEcho(adapterInput(replayFetch));
  assert.equal(replayed.replayed, true);
}

async function testStableFailures(): Promise<void> {
  const timeoutFetch: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });
  await assert.rejects(
    () => llamarPythonEcho(adapterInput(timeoutFetch, { deadlineMs: 10 })),
    (error: unknown) => error instanceof PythonAdapterError && error.code === "PYTHON_BACKEND_TIMEOUT",
  );

  const authFetch: typeof fetch = async () => Response.json(
    { detail: { code: "invalid_signature" } },
    { status: 401 },
  );
  await assert.rejects(
    () => llamarPythonEcho(adapterInput(authFetch)),
    (error: unknown) => error instanceof PythonAdapterError && error.code === "PYTHON_AUTH_FAILED",
  );

  const replayFetch: typeof fetch = async () => Response.json(
    { detail: { code: "nonce_replay" } },
    { status: 401 },
  );
  await assert.rejects(
    () => llamarPythonEcho(adapterInput(replayFetch, { idempotencyKey: "same-request" })),
    (error: unknown) => error instanceof PythonAdapterError && error.code === "PYTHON_REPLAY",
  );

  const timeoutResponse: typeof fetch = async () => Response.json(
    { detail: { code: "deadline_exceeded" } },
    { status: 408 },
  );
  await assert.rejects(
    () => llamarPythonEcho(adapterInput(timeoutResponse)),
    (error: unknown) => error instanceof PythonAdapterError && error.code === "PYTHON_BACKEND_TIMEOUT",
  );

  const conflictFetch: typeof fetch = async () => Response.json(
    { code: "idempotency_conflict" },
    { status: 409 },
  );
  await assert.rejects(
    () => llamarPythonEcho(adapterInput(conflictFetch, { idempotencyKey: "same-request" })),
    (error: unknown) => error instanceof PythonAdapterError && error.code === "PYTHON_IDEMPOTENCY_CONFLICT",
  );

  let networkCalls = 0;
  const unavailableFetch: typeof fetch = async () => {
    networkCalls += 1;
    throw new Error("ECONNREFUSED");
  };
  await assert.rejects(
    () => llamarPythonEcho(adapterInput(unavailableFetch)),
    (error: unknown) => error instanceof PythonAdapterError && error.code === "PYTHON_UNAVAILABLE",
  );
  assert.equal(networkCalls, 1);

  const embeddingAttempts = [
    { attempt: 1, result: "error" as const, elapsed_ms: 4 },
    { attempt: 2, result: "error" as const, elapsed_ms: 8 },
    { attempt: 3, result: "error" as const, elapsed_ms: 12 },
  ];
  const embeddingFailureFetch: typeof fetch = async () => Response.json(
    { detail: { code: "embedding_provider_unavailable", attempts: embeddingAttempts } },
    { status: 503 },
  );
  await assert.rejects(
    () => llamarPythonEmbedding({
      text: "ramo",
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      env: BASE_ENV,
      fetchImpl: embeddingFailureFetch,
    }),
    (error: unknown) => {
      if (!(error instanceof PythonAdapterError) || error.code !== "PYTHON_UNAVAILABLE") {
        return false;
      }
      assert.deepEqual(error.attempts, embeddingAttempts);
      return true;
    },
  );
}

async function testRerankEnvelopeAndPermutation(): Promise<void> {
  const calls: CapturedCall[] = [];
  const candidates = [
    { id: "prod-1", text: "arreglo de girasoles" },
    { id: "prod-2", text: "ramo de rosas rojas" },
  ];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    return successResponse({
      order: ["prod-2", "prod-1"],
      scores: { "prod-1": 0.1, "prod-2": 0.9 },
    });
  };
  const result = await llamarPythonRerank({
    query: "rosas rojas",
    candidates,
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    env: BASE_ENV,
    fetchImpl,
  });
  assert.deepEqual(result.order, ["prod-2", "prod-1"]);
  assert.equal(calls.length, 1);
  const body = JSON.parse(String(calls[0].init?.body)) as {
    context: { body_sha256: string; scopes: string[] };
    query?: string;
    candidates?: typeof candidates;
    payload?: unknown;
  };
  const operationBody = { query: "rosas rojas", candidates };
  assert.equal(body.query, operationBody.query);
  assert.deepEqual(body.candidates, operationBody.candidates);
  assert.equal(body.payload, undefined);
  assert.equal(body.context.scopes[0], "ai.rerank");
  assert.equal(body.context.body_sha256, sha256Body(JSON.stringify(operationBody)));
  assert.equal(new URL(String(calls[0].input)).pathname, "/internal/v1/rerank");

  const invalidResponseFetch: typeof fetch = async () => Response.json(
    {
      schema_version: "operational.v1",
      request_id: REQUEST_ID,
      correlation_id: CORRELATION_ID,
      payload: {
        order: ["prod-1", "prod-1"],
        scores: { "prod-1": 0.5 },
      },
    },
  );
  await assert.rejects(
    () => llamarPythonRerank({
      query: "rosas",
      candidates,
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      env: BASE_ENV,
      fetchImpl: invalidResponseFetch,
    }),
    (error: unknown) => error instanceof PythonAdapterError && error.code === "PYTHON_INVALID_RESPONSE",
  );
}

async function testEmbeddingEnvelope(): Promise<void> {
  const calls: CapturedCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    return successResponse({
      values: Array.from({ length: 768 }, (_, index) => index / 768),
      model: "gemini-embedding-2",
      dimensions: 768,
      task_type: "RETRIEVAL_QUERY",
      attempts: [{ attempt: 1, result: "ok", elapsed_ms: 2 }],
    });
  };
  const result = await llamarPythonEmbedding({
    text: "ramo de rosas",
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    idempotencyKey: "embedding-key",
    env: BASE_ENV,
    fetchImpl,
  });
  assert.equal(result.values.length, 768);
  assert.equal(calls.length, 1);
  const body = JSON.parse(String(calls[0].init?.body)) as {
    context: { body_sha256: string; scopes: string[] };
    text: string;
    task_type: string;
  };
  const operationBody = { text: "ramo de rosas", task_type: "RETRIEVAL_QUERY" };
  assert.deepEqual({ text: body.text, task_type: body.task_type }, operationBody);
  assert.equal(body.context.scopes[0], "ai.embedding");
  assert.equal(new Headers(calls[0].init?.headers).get("idempotency-key"), "embedding-key");
  assert.equal(body.context.body_sha256, sha256Body(JSON.stringify(operationBody)));
  assert.equal(new URL(String(calls[0].input)).pathname, "/internal/v1/embed");

  const mismatchedModelFetch: typeof fetch = async () => Response.json({
    schema_version: "operational.v1",
    request_id: REQUEST_ID,
    correlation_id: CORRELATION_ID,
    payload: {
      values: Array.from({ length: 768 }, (_, index) => index / 768),
      model: "different-model",
      dimensions: 768,
      task_type: "RETRIEVAL_QUERY",
      attempts: [{ attempt: 1, result: "ok", elapsed_ms: 2 }],
    },
  });
  await assert.rejects(
    () => llamarPythonEmbedding({
      text: "ramo",
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      env: BASE_ENV,
      fetchImpl: mismatchedModelFetch,
    }),
    (error: unknown) => error instanceof PythonAdapterError && error.code === "PYTHON_INVALID_RESPONSE",
  );
}

async function testIntentParseEnvelope(): Promise<void> {
  const calls: CapturedCall[] = [];
  const schema = { type: "object", properties: { semantic_query: { type: "string" } } };
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    return successResponse({
      text: JSON.stringify({ semantic_query: "ramo de rosas" }),
      model: "gemini-3.6-flash",
      usage: { prompt_token_count: 12, candidates_token_count: 4 },
    });
  };
  const result = await llamarPythonIntentParse({
    message: "algo con rosas rojas",
    systemInstruction: "Interpretas mensajes de clientes.",
    responseJsonSchema: schema,
    model: "gemini-3.6-flash",
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    env: BASE_ENV,
    fetchImpl,
  });
  assert.equal(result.model, "gemini-3.6-flash");
  assert.deepEqual(JSON.parse(result.text), { semantic_query: "ramo de rosas" });
  assert.deepEqual(result.usage, { prompt_token_count: 12, candidates_token_count: 4 });
  assert.equal(calls.length, 1);
  const body = JSON.parse(String(calls[0].init?.body)) as {
    context: { body_sha256: string; scopes: string[] };
    schema_version: string;
    message: string;
    system_instruction: string;
    response_json_schema: unknown;
    model: string;
  };
  const operationBody = {
    schema_version: "intent-parse.v1",
    message: "algo con rosas rojas",
    system_instruction: "Interpretas mensajes de clientes.",
    response_json_schema: schema,
    model: "gemini-3.6-flash",
  };
  assert.deepEqual(
    { schema_version: body.schema_version, message: body.message, system_instruction: body.system_instruction, response_json_schema: body.response_json_schema, model: body.model },
    operationBody,
  );
  assert.equal(body.context.scopes[0], "ia.intent_parse");
  assert.equal(body.context.body_sha256, sha256Body(JSON.stringify(operationBody)));
  assert.equal(new URL(String(calls[0].input)).pathname, "/internal/v1/ia/intent-parse");

  const emptyTextFetch: typeof fetch = async () => Response.json({
    schema_version: "operational.v1",
    request_id: REQUEST_ID,
    correlation_id: CORRELATION_ID,
    payload: { text: "", model: "gemini-3.6-flash", usage: null },
  });
  await assert.rejects(
    () => llamarPythonIntentParse({
      message: "algo",
      systemInstruction: "sistema",
      responseJsonSchema: schema,
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      env: BASE_ENV,
      fetchImpl: emptyTextFetch,
    }),
    (error: unknown) => error instanceof PythonAdapterError && error.code === "PYTHON_INVALID_RESPONSE",
  );
}

async function testHappieGenerateEnvelope(): Promise<void> {
  const calls: CapturedCall[] = [];
  const schema = { type: "object", properties: { resumen: { type: "string" } } };
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    return successResponse({
      text: JSON.stringify({ recomendaciones: [], resumen: "ninguno" }),
      model: "gemini-3.6-flash",
      usage: { prompt_token_count: 900, candidates_token_count: 30, tool_use_prompt_token_count: 0 },
    });
  };
  // A Happia catalog is larger than the 64KB cap the other text operations share.
  const catalogo = `Paquetes disponibles (JSON): ${"x".repeat(100 * 1024)}`;
  const result = await llamarPythonHappieGenerate({
    purpose: "package_recommend",
    parts: ["Descripción del cliente: boda", catalogo],
    systemInstruction: "Recomiendas paquetes.",
    responseJsonSchema: schema,
    model: "gemini-3.6-flash",
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    deadlineMs: 25_000,
    env: BASE_ENV,
    fetchImpl,
  });
  assert.equal(result.usage?.tool_use_prompt_token_count, 0);
  assert.equal(JSON.parse(result.text).resumen, "ninguno");
  const body = JSON.parse(String(calls[0].init?.body)) as {
    context: { scopes: string[]; deadline_ms: number };
    schema_version: string;
    purpose: string;
    parts: string[];
    system_instruction: string;
  };
  assert.equal(body.schema_version, "happie-generate.v1");
  assert.equal(body.purpose, "package_recommend");
  assert.deepEqual(body.parts, ["Descripción del cliente: boda", catalogo]);
  assert.equal(body.system_instruction, "Recomiendas paquetes.");
  assert.equal(body.context.scopes[0], "ia.happie_generate");
  assert.equal(body.context.deadline_ms, 25_000);
  assert.equal(new URL(String(calls[0].input)).pathname, "/internal/v1/ia/happie-generate");

  const unexpectedField: typeof fetch = async () => successResponse({ text: "{}", model: "m", usage: null, extra: true });
  await assert.rejects(
    () => llamarPythonHappieGenerate({
      purpose: "conversation_extract",
      parts: ["hola"],
      systemInstruction: "sistema",
      responseJsonSchema: schema,
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      env: BASE_ENV,
      fetchImpl: unexpectedField,
    }),
    (error: unknown) => error instanceof PythonAdapterError && error.code === "PYTHON_INVALID_RESPONSE",
  );
}

async function testReferenceTurnEnvelope(): Promise<void> {
  const calls: CapturedCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    return successResponse({
      text: "",
      tool_calls: [{ name: "return_reference_inventory", args: { images: [] } }],
      model: "gemini-3.6-flash",
      usage: { prompt_token_count: 900, candidates_token_count: 40 },
      finish_reason: "STOP",
      block_reason: null,
    });
  };
  const result = await llamarPythonReferenceTurn({
    systemInstruction: "Eres un analista forense de decoracion de eventos.",
    message: "Inventaria estas referencias.",
    images: [{ id: "REF_01", mime: "image/png", base64: "aGVsbG8=", descripcion: "foto del cliente" }],
    tools: [{ name: "return_reference_inventory", description: "Return inventory.", parametersJsonSchema: { type: "object" } }],
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    env: BASE_ENV,
    fetchImpl,
  });
  assert.equal(result.model, "gemini-3.6-flash");
  assert.deepEqual(result.toolCalls, [{ name: "return_reference_inventory", args: { images: [] } }]);
  assert.equal(result.finishReason, "STOP");
  assert.equal(result.blockReason, null);
  assert.equal(calls.length, 1);
  const body = JSON.parse(String(calls[0].init?.body)) as {
    context: { body_sha256: string; scopes: string[] };
    schema_version: string;
    images: Array<{ id: string; mime: string; base64: string; descripcion: string }>;
    tools: Array<{ name: string; description: string; parameters_json_schema: unknown }>;
  };
  assert.equal(body.schema_version, "reference-turn.v1");
  assert.deepEqual(body.images, [{ id: "REF_01", mime: "image/png", base64: "aGVsbG8=", descripcion: "foto del cliente" }]);
  assert.deepEqual(body.tools, [{ name: "return_reference_inventory", description: "Return inventory.", parameters_json_schema: { type: "object" } }]);
  assert.equal(body.context.scopes[0], "ia.reference_turn");
  assert.equal(new URL(String(calls[0].input)).pathname, "/internal/v1/ia/reference-turn");

  const invalidResponseFetch: typeof fetch = async () => Response.json({
    schema_version: "operational.v1",
    request_id: REQUEST_ID,
    correlation_id: CORRELATION_ID,
    payload: { text: "", tool_calls: "not-an-array", model: "gemini-3.6-flash", usage: null, finish_reason: null, block_reason: null },
  });
  await assert.rejects(
    () => llamarPythonReferenceTurn({
      systemInstruction: "sistema",
      message: "algo",
      images: [{ id: "REF_01", mime: "image/png", base64: "aGVsbG8=" }],
      tools: [],
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      env: BASE_ENV,
      fetchImpl: invalidResponseFetch,
    }),
    (error: unknown) => error instanceof PythonAdapterError && error.code === "PYTHON_INVALID_RESPONSE",
  );
}

async function testPatronReferenciaEnvelope(): Promise<void> {
  const calls: CapturedCall[] = [];
  const pistas = [
    { element_id: "REF_01_E01", modo: "bloques", colores: ["dorado", "blanco"], pesos: [70, 30], confianza: 0.7 },
    { element_id: "REF_01_E02", modo: "ninguno", colores: [], confianza: 0.2 },
  ];
  const payload = (overrides: Record<string, unknown> = {}) => ({
    operation_schema_version: "patron-referencia-result.v1",
    pistas,
    modelo: "gemini-3.6-flash",
    prompt_version: "patron-referencia.v1:abc",
    usage: { prompt_token_count: 1200, candidates_token_count: 80, tool_use_prompt_token_count: 0 },
    ...overrides,
  });
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    return successResponse(payload());
  };
  // A real photo is far above the 64KB default cap: the call uses the image cap.
  const dataBase64 = "A".repeat(200_000);
  const input = {
    imagen: { mimeType: "image/jpeg" as const, dataBase64 },
    elementos: [
      { elementId: "REF_01_E01", tipo: "columna", bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.6 }, coloresObservados: ["gold", "white"] },
      { elementId: "REF_01_E02", tipo: "desconocido", coloresObservados: [] },
    ],
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    env: BASE_ENV,
  };
  const result = await llamarPythonPatronReferencia({ ...input, fetchImpl });
  assert.deepEqual(result.pistas, pistas);
  assert.equal(result.modelo, "gemini-3.6-flash");
  assert.equal(result.promptVersion, "patron-referencia.v1:abc");
  assert.equal(result.usage?.prompt_token_count, 1200);
  assert.equal(calls.length, 1);
  assert.equal(new URL(String(calls[0].input)).pathname, "/internal/v1/ia/patron-referencia");
  const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown> & { context: { body_sha256: string; scopes: string[] } };
  const operationBody = {
    schema_version: "patron-referencia.v1",
    imagen: { mime_type: "image/jpeg", data_base64: dataBase64 },
    elementos: [
      { element_id: "REF_01_E01", tipo: "columna", bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.6 }, colores_observados: ["gold", "white"] },
      { element_id: "REF_01_E02", tipo: "desconocido", colores_observados: [] },
    ],
  };
  assert.deepEqual({ schema_version: body.schema_version, imagen: body.imagen, elementos: body.elementos }, operationBody);
  assert.deepEqual(body.context.scopes, ["ia.patron_referencia"]);
  assert.equal(body.context.body_sha256, sha256Body(JSON.stringify(operationBody)));

  // The answer must be about the elements that were asked, once each.
  const invalidos: Array<Record<string, unknown>> = [
    payload({ pistas: [{ ...pistas[0], element_id: "REF_09_E01" }] }),
    payload({ pistas: [pistas[0], pistas[0]] }),
    payload({ pistas: [{ ...pistas[0], colores: [] }] }),
    payload({ pistas: [{ ...pistas[0], pesos: [70] }] }),
    payload({ pistas: [{ ...pistas[0], modo: "arcoiris" }] }),
    payload({ pistas: [{ ...pistas[0], confianza: 1.5 }] }),
    payload({ operation_schema_version: "otra.v1" }),
    payload({ extra: true }),
  ];
  for (const invalido of invalidos) {
    await assert.rejects(
      () => llamarPythonPatronReferencia({ ...input, fetchImpl: async () => successResponse(invalido) }),
      (error: unknown) => error instanceof PythonAdapterError && error.code === "PYTHON_INVALID_RESPONSE",
      JSON.stringify(invalido).slice(0, 200),
    );
  }
  await assert.rejects(
    () => llamarPythonPatronReferencia({
      ...input,
      fetchImpl: async () => Response.json({ detail: { code: "patron_referencia_empty_response", provider_detail: "finish_reason=SAFETY" } }, { status: 502 }),
    }),
    (error: unknown) => error instanceof PythonAdapterError
      && error.domainCode === "patron_referencia_empty_response"
      && error.providerDetail === "finish_reason=SAFETY",
  );
}

async function testImageGenerateEnvelope(): Promise<void> {
  const calls: CapturedCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    return successResponse({
      image_base64: "aW1hZ2VkYXRh",
      model: "gemini-3.1-flash-image",
      interaction_id: "int_123",
      usage: { total_input_tokens: 500, total_output_tokens: 1200 },
    });
  };
  const result = await llamarPythonImageGenerate({
    input: [
      { type: "text", text: "Un arco de globos dorados." },
      { type: "image", data: "aGVsbG8=", mimeType: "image/jpeg" },
    ],
    aspectRatio: "3:2",
    imageSize: "2K",
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    env: BASE_ENV,
    fetchImpl,
  });
  assert.equal(result.imageBase64, "aW1hZ2VkYXRh");
  assert.equal(result.model, "gemini-3.1-flash-image");
  assert.equal(result.interactionId, "int_123");
  assert.equal(calls.length, 1);
  const body = JSON.parse(String(calls[0].init?.body)) as {
    context: { body_sha256: string; scopes: string[] };
    schema_version: string;
    store: boolean;
    aspect_ratio: string;
    image_size: string;
    input: Array<{ type: string; text?: string; data?: string; mime_type?: string }>;
  };
  assert.equal(body.schema_version, "image-generate.v1");
  assert.equal(body.store, true);
  assert.equal(body.aspect_ratio, "3:2");
  assert.equal(body.image_size, "2K");
  assert.deepEqual(body.input, [
    { type: "text", text: "Un arco de globos dorados." },
    { type: "image", data: "aGVsbG8=", mime_type: "image/jpeg" },
  ]);
  assert.equal(body.context.scopes[0], "ia.image_generate");
  assert.equal(new URL(String(calls[0].input)).pathname, "/internal/v1/ia/image-generate");

  const previousIdFetch: typeof fetch = async (_input, init) => {
    const parsed = JSON.parse(String(init?.body)) as { previous_interaction_id?: string };
    assert.equal(parsed.previous_interaction_id, "int_previous");
    return successResponse({ image_base64: "b3RyYQ==", model: "gemini-3.1-flash-image", interaction_id: "int_456", usage: null });
  };
  await llamarPythonImageGenerate({
    input: [{ type: "text", text: "otra vez" }],
    previousInteractionId: "int_previous",
    aspectRatio: "1:1",
    imageSize: "1K",
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    env: BASE_ENV,
    fetchImpl: previousIdFetch,
  });

  const invalidResponseFetch: typeof fetch = async () => Response.json({
    schema_version: "operational.v1",
    request_id: REQUEST_ID,
    correlation_id: CORRELATION_ID,
    payload: { image_base64: "", model: "gemini-3.1-flash-image", interaction_id: null, usage: null },
  });
  await assert.rejects(
    () => llamarPythonImageGenerate({
      input: [{ type: "text", text: "algo" }],
      aspectRatio: "1:1",
      imageSize: "1K",
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      env: BASE_ENV,
      fetchImpl: invalidResponseFetch,
    }),
    (error: unknown) => error instanceof PythonAdapterError && error.code === "PYTHON_INVALID_RESPONSE",
  );
}

async function testLoraGenerateEnvelope(): Promise<void> {
  const calls: CapturedCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    return successResponse({
      image_base64: "aW1hZ2VkYXRh",
      mime: "image/png",
      provider_request_id: "req_123",
      endpoint: "flux-2/lora/edit",
    });
  };
  const result = await llamarPythonLoraGenerate({
    mode: "edit",
    prompt: "eventdecor_style_v3, arco de globos dorados",
    loras: [{ path: "loras/eventdecor-style-v3.safetensors", scale: 1 }],
    guidanceScale: 3.5,
    numInferenceSteps: 28,
    imageWidth: 1536,
    imageHeight: 1024,
    seed: 42,
    imageDataUrls: ["data:image/jpeg;base64,aGVsbG8="],
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    env: BASE_ENV,
    fetchImpl,
  });
  assert.equal(result.imageBase64, "aW1hZ2VkYXRh");
  assert.equal(result.mime, "image/png");
  assert.equal(result.providerRequestId, "req_123");
  assert.equal(result.endpoint, "flux-2/lora/edit");
  assert.equal(calls.length, 1);
  assert.equal(new URL(String(calls[0].input)).pathname, "/internal/v1/ia/lora-generate");
  const body = JSON.parse(String(calls[0].init?.body)) as {
    context: { scopes: string[] };
    schema_version: string;
    mode: string;
    prompt: string;
    loras: Array<{ path: string; scale: number }>;
    guidance_scale: number;
    num_inference_steps: number;
    image_width: number;
    image_height: number;
    seed: number;
    image_data_urls: string[];
  };
  assert.equal(body.schema_version, "lora-generate.v1");
  assert.equal(body.mode, "edit");
  assert.deepEqual(body.loras, [{ path: "loras/eventdecor-style-v3.safetensors", scale: 1 }]);
  assert.equal(body.guidance_scale, 3.5);
  assert.equal(body.num_inference_steps, 28);
  assert.equal(body.image_width, 1536);
  assert.equal(body.image_height, 1024);
  assert.equal(body.seed, 42);
  assert.deepEqual(body.image_data_urls, ["data:image/jpeg;base64,aGVsbG8="]);
  assert.equal(body.context.scopes[0], "ia.lora_generate");

  const invalidResponseFetch: typeof fetch = async () => successResponse({
    image_base64: "",
    mime: "image/png",
    provider_request_id: "req_1",
    endpoint: "flux-2/lora",
  });
  await assert.rejects(
    () => llamarPythonLoraGenerate({
      mode: "text",
      prompt: "eventdecor_style_v3, algo",
      loras: [{ path: "loras/x.safetensors", scale: 1 }],
      guidanceScale: 3.5,
      numInferenceSteps: 28,
      imageWidth: 1024,
      imageHeight: 1024,
      imageDataUrls: [],
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      env: BASE_ENV,
      fetchImpl: invalidResponseFetch,
    }),
    (error: unknown) => error instanceof PythonAdapterError && error.code === "PYTHON_INVALID_RESPONSE",
  );

  const accountRejectedFetch: typeof fetch = async () => Response.json(
    { detail: { code: "lora_account_saldo_agotado", provider_status: 402, provider_detail: "insufficient balance" } },
    { status: 503 },
  );
  await assert.rejects(
    () => llamarPythonLoraGenerate({
      mode: "text",
      prompt: "eventdecor_style_v3, algo",
      loras: [{ path: "loras/x.safetensors", scale: 1 }],
      guidanceScale: 3.5,
      numInferenceSteps: 28,
      imageWidth: 1024,
      imageHeight: 1024,
      imageDataUrls: [],
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      env: BASE_ENV,
      fetchImpl: accountRejectedFetch,
    }),
    (error: unknown) => {
      if (!(error instanceof PythonAdapterError)) return false;
      assert.equal(error.domainCode, "lora_account_saldo_agotado");
      assert.equal(error.providerStatus, 402);
      assert.equal(error.providerDetail, "insufficient balance");
      return true;
    },
  );
}

async function testChatTurnStreamEnvelope(): Promise<void> {
  const input = (fetchImpl: typeof fetch) => ({
    systemInstruction: "Eres un asesor.",
    contents: [{ role: "user", parts: [{ text: "hola" }] }],
    tools: [],
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    env: BASE_ENV,
    fetchImpl,
  });
  const ndjson = (body: string, contentType = "application/x-ndjson") => new Response(body, { headers: { "content-type": contentType } });
  const collect = async (fetchImpl: typeof fetch) => {
    const events: unknown[] = [];
    for await (const event of llamarPythonChatTurnStream(input(fetchImpl))) events.push(event);
    return events;
  };
  const end = { type: "end", text: "hola", tool_calls: [], usage_metadata: {}, model: "m", finish_reason: null, block_reason: null };

  const calls: CapturedCall[] = [];
  const events = await collect(async (url, init) => {
    calls.push({ input: url, init });
    return ndjson(`${JSON.stringify({ type: "text", delta: "ho" })}\n\n${JSON.stringify(end)}\n${JSON.stringify({ type: "text", delta: "después del fin" })}\n`);
  });
  assert.deepEqual(events, [{ type: "text", delta: "ho" }, end], "stops at the terminal event, ignores blank lines");
  assert.equal(new URL(String(calls[0].input)).pathname, "/internal/v1/ia/chat-turn-stream");
  const body = JSON.parse(String(calls[0].init?.body)) as { context: { scopes: string[]; idempotency_key?: string }; schema_version: string };
  assert.equal(body.schema_version, "chat-turn-stream.v1");
  assert.deepEqual(body.context.scopes, ["ia.chat_turn_stream"]);
  assert.equal(body.context.idempotency_key, undefined);

  const invalid = (error: unknown) => error instanceof PythonAdapterError && error.code === "PYTHON_INVALID_RESPONSE";
  await assert.rejects(() => collect(async () => ndjson(JSON.stringify(end), "application/json")), invalid, "wrong content type");
  await assert.rejects(() => collect(async () => ndjson("{no es json\n")), invalid, "malformed line");
  await assert.rejects(() => collect(async () => ndjson(`${JSON.stringify({ type: "text", delta: "a medias" })}\n`)), invalid, "no terminal event");
  await assert.rejects(() => collect(async () => ndjson(`${JSON.stringify({ type: "otro" })}\n`)), invalid, "unknown event");
  await assert.rejects(
    () => collect(async () => Response.json({ detail: { code: "chat_turn_unavailable" } }, { status: 503 })),
    (error: unknown) => error instanceof PythonAdapterError && error.domainCode === "chat_turn_unavailable",
    "pre-stream HTTP error keeps its domain code",
  );
}

async function testCatalogSearchEnvelope(): Promise<void> {
  const calls: CapturedCall[] = [];
  const filters = { available: true, categories: ["globo_latex"] };
  const allowlist = [{ product_id: "prod-1", variant_ids: ["variant-1"] }];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    return successResponse({
      operation_schema_version: "catalog-search-result.v1",
      status: "NO_MATCH",
      sku_status: "not_sku",
      candidates: [],
      whitelist: [],
      catalog_snapshot_id: "products_catalog:requested",
      latency_parse_ms: 1,
      latency_retrieval_ms: 2,
    });
  };
  const result = await llamarPythonCatalogSearch({
    message: "globos rojos",
    filters,
    allowlist,
    limit: 5,
    catalogSnapshotId: "products_catalog:requested",
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    env: BASE_ENV,
    fetchImpl,
  });

  assert.equal(result.status, "NO_MATCH");
  assert.equal(result.catalog_snapshot_id, "products_catalog:requested");
  assert.equal(calls.length, 1);
  assert.equal(new URL(String(calls[0].input)).pathname, "/internal/v1/catalog/search");
  const body = JSON.parse(String(calls[0].init?.body)) as {
    context: { body_sha256: string; scopes: string[] };
    schema_version: string;
    message: string;
    filters: typeof filters;
    allowlist: typeof allowlist;
    limit: number;
    catalog_snapshot_id: string;
  };
  const operationBody = {
    schema_version: "catalog-search.v1" as const,
    message: "globos rojos",
    filters,
    allowlist,
    limit: 5,
    catalog_snapshot_id: "products_catalog:requested",
  };
  assert.deepEqual({
    schema_version: body.schema_version,
    message: body.message,
    filters: body.filters,
    allowlist: body.allowlist,
    limit: body.limit,
    catalog_snapshot_id: body.catalog_snapshot_id,
  }, operationBody);
  assert.equal(body.context.scopes[0], "catalog.search");
  assert.equal(body.context.body_sha256, sha256Body(JSON.stringify(operationBody)));
}

async function testCatalogSelectionEnvelope(): Promise<void> {
  const calls: CapturedCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    return successResponse(validCatalogSelectionPayload());
  };
  const result = await llamarPythonCatalogSelection({
    items: [{ product_id: "prod-1", variant_id: "variant-1", quantity: 2 }],
    allowlist: [{ product_id: "prod-1", variant_ids: ["variant-1"] }],
    catalogSnapshotId: "products_catalog:test",
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    env: BASE_ENV,
    fetchImpl,
  });
  assert.equal(result.total_cop, 3000);
  assert.equal(result.catalog_snapshot_id, "products_catalog:test");
  assert.equal(calls.length, 1);
  assert.equal(new URL(String(calls[0].input)).pathname, "/internal/v1/catalog/selection");
  const body = JSON.parse(String(calls[0].init?.body)) as {
    context: { body_sha256: string; scopes: string[] };
    schema_version: string;
    request_id: string;
    catalog_snapshot_id: string;
    items: Array<{ product_id: string; variant_id: string; quantity: number }>;
    allowlist: Array<{ product_id: string; variant_ids: string[] }>;
  };
  const operationBody = {
    schema_version: "catalog-selection.v1" as const,
    request_id: REQUEST_ID,
    catalog_snapshot_id: "products_catalog:test",
    items: [{ product_id: "prod-1", variant_id: "variant-1", quantity: 2 }],
    allowlist: [{ product_id: "prod-1", variant_ids: ["variant-1"] }],
  };
  assert.deepEqual({
    schema_version: body.schema_version,
    request_id: body.request_id,
    catalog_snapshot_id: body.catalog_snapshot_id,
    items: body.items,
    allowlist: body.allowlist,
  }, operationBody);
  assert.equal(body.context.scopes[0], "catalog.selection");
  assert.equal(body.context.body_sha256, sha256Body(JSON.stringify(operationBody)));

  // Python owns subtotal/total/status (AGENTS.md: a boundary gate never
  // re-derives a business formula). What Next still checks is identity: a
  // validated line must be a pair it asked for, inside the signed allowlist.
  const outsideAllowlistFetch: typeof fetch = async () => successResponse(validCatalogSelectionPayload());
  await assert.rejects(
    () => llamarPythonCatalogSelection({
      items: [{ product_id: "prod-1", variant_id: "variant-1", quantity: 2 }],
      allowlist: [{ product_id: "prod-1", variant_ids: ["variant-2"] }],
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      env: BASE_ENV,
      fetchImpl: outsideAllowlistFetch,
    }),
    (error: unknown) => error instanceof PythonAdapterError && error.code === "PYTHON_INVALID_RESPONSE",
  );
}

async function testPlanResolutionEnvelope(): Promise<void> {
  const calls: CapturedCall[] = [];
  const plan = JSON.parse(
    readFileSync(
      path.join(process.cwd(), "contracts", "domain", "v1", "fixtures", "plan-resuelto-ok.json"),
      "utf8",
    ),
  ).plan as PlanDecoracion;
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    return successResponse(validPlanResolutionPayload());
  };
  const result = await llamarPythonPlanResolution({
    plan,
    allowlist: [{ product_id: "prod-rojo", variant_ids: ["var-rojo-12"] }],
    catalogSnapshotId: "products_catalog:test",
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    env: BASE_ENV,
    fetchImpl,
  });

  assert.equal(result.catalog_snapshot_id, "products_catalog:test");
  assert.equal(result.quote.currency, "COP");
  assert.equal(calls.length, 1);
  assert.equal(new URL(String(calls[0].input)).pathname, "/internal/v1/plan/resolve");
  const body = JSON.parse(String(calls[0].init?.body)) as {
    context: { body_sha256: string; scopes: string[] };
    schema_version: string;
    plan: PlanDecoracion;
    allowlist: Array<{ product_id: string; variant_ids: string[] }>;
    catalog_snapshot_id: string;
  };
  const operationBody = {
    schema_version: "plan-resolution.v1" as const,
    plan,
    allowlist: [{ product_id: "prod-rojo", variant_ids: ["var-rojo-12"] }],
    catalog_snapshot_id: "products_catalog:test",
  };
  assert.deepEqual({
    schema_version: body.schema_version,
    plan: body.plan,
    allowlist: body.allowlist,
    catalog_snapshot_id: body.catalog_snapshot_id,
  }, operationBody);
  assert.equal(body.context.scopes[0], "plan.resolve");
  assert.equal(body.context.body_sha256, sha256Body(JSON.stringify(operationBody)));
  // ADR-0028 §7: callers that do not complete patterns send the same bytes as before.
  assert.equal("completar_patrones" in body, false);
  assert.equal("pistas_patron" in body, false);

  const pista = { referencia_element_id: "REF_01_E01", modo: "espiral" as const, colores: ["blanco", "negro"], globos_por_racimo: 4, confianza: 0.8 };
  await llamarPythonPlanResolution({
    plan,
    allowlist: [{ product_id: "prod-rojo", variant_ids: ["var-rojo-12"] }],
    catalogSnapshotId: "products_catalog:test",
    completarPatrones: true,
    pistasPatron: [pista],
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    env: BASE_ENV,
    fetchImpl,
  });
  const conPatrones = JSON.parse(String(calls[1].init?.body)) as Record<string, unknown> & { context: { body_sha256: string } };
  assert.equal(conPatrones.completar_patrones, true);
  assert.deepEqual(conPatrones.pistas_patron, [pista]);
  assert.equal(conPatrones.context.body_sha256, sha256Body(JSON.stringify({ ...operationBody, completar_patrones: true, pistas_patron: [pista] })));

  const invalidFetch: typeof fetch = async () => successResponse({
    ...validPlanResolutionPayload(),
    quote: { ...(validPlanResolutionPayload().quote as Record<string, unknown>), total_cop: 1 },
  });
  await assert.rejects(
    () => llamarPythonPlanResolution({
      plan,
      allowlist: [{ product_id: "prod-rojo", variant_ids: ["var-rojo-12"] }],
      catalogSnapshotId: "products_catalog:test",
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      env: BASE_ENV,
      fetchImpl: invalidFetch,
    }),
    (error: unknown) => error instanceof PythonAdapterError && error.code === "PYTHON_INVALID_RESPONSE",
  );
}

async function testPlanResolutionDomainError(): Promise<void> {
  const plan = JSON.parse(
    readFileSync(path.join(process.cwd(), "contracts", "domain", "v1", "fixtures", "plan-resuelto-ok.json"), "utf8"),
  ).plan as PlanDecoracion;
  await assert.rejects(
    () => llamarPythonPlanResolution({
      plan,
      allowlist: [{ product_id: "prod-azul", variant_ids: ["var-rojo-12"] }],
      catalogSnapshotId: "products_catalog:test",
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      env: BASE_ENV,
      fetchImpl: async () => Response.json({ detail: { code: "allowlist_product_mismatch" } }, { status: 422 }),
    }),
    (error: unknown) => error instanceof PythonAdapterError
      && error.code === "PYTHON_INVALID_REQUEST"
      && error.status === 422
      && error.domainCode === "allowlist_product_mismatch",
  );
}

function recommendationsFixture(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), "contracts", "domain", "v1", "fixtures", "catalog-recommendations-result.json"), "utf8"),
  ) as Record<string, unknown>;
}

async function testCatalogRecommendationsEnvelope(): Promise<void> {
  const fixture = recommendationsFixture();
  const snapshot = String(fixture.catalog_snapshot_id);
  const calls: CapturedCall[] = [];
  const result = await llamarPythonCatalogRecommendations({
    referenceVariantId: "var-rojo-12",
    catalogSnapshotId: snapshot,
    limit: 100,
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    env: BASE_ENV,
    fetchImpl: async (input, init) => {
      calls.push({ input, init });
      return successResponse(fixture);
    },
  });
  assert.equal(result.catalog_snapshot_id, snapshot);
  assert.equal(result.candidates.length, 2);
  assert.equal(calls.length, 1);
  assert.equal(new URL(String(calls[0].input)).pathname, PYTHON_CATALOG_RECOMMENDATIONS_PATH);
  const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown> & { context: { body_sha256: string; scopes: string[] } };
  const operationBody = {
    schema_version: "catalog-recommendations.v1" as const,
    catalog_snapshot_id: snapshot,
    reference_variant_id: "var-rojo-12",
    limit: 100,
  };
  assert.equal("lora_variant_ids" in body, false, "sin LoRA no se envía lora_variant_ids");
  assert.deepEqual({
    schema_version: body.schema_version,
    catalog_snapshot_id: body.catalog_snapshot_id,
    reference_variant_id: body.reference_variant_id,
    limit: body.limit,
  }, operationBody);
  assert.deepEqual(body.context.scopes, [PYTHON_CATALOG_RECOMMENDATIONS_SCOPE]);
  assert.equal(body.context.body_sha256, sha256Body(JSON.stringify(operationBody)));

  const loraCalls: CapturedCall[] = [];
  const allVariantIds = ["var-rojo-12-x50", "var-azul-12", "var-azul-12-x50"];
  await llamarPythonCatalogRecommendations({
    referenceVariantId: "var-rojo-12",
    catalogSnapshotId: snapshot,
    loraVariantIds: allVariantIds,
    limit: 3,
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    env: BASE_ENV,
    fetchImpl: async (input, init) => {
      loraCalls.push({ input, init });
      return successResponse(fixture);
    },
  });
  assert.deepEqual((JSON.parse(String(loraCalls[0].init?.body)) as { lora_variant_ids: string[] }).lora_variant_ids, allVariantIds);

  const candidates = fixture.candidates as Array<Record<string, unknown> & { variants: Array<Record<string, unknown>> }>;
  const invalidCases: Array<{ name: string; payload: Record<string, unknown>; lora?: string[]; limit?: number }> = [
    { name: "snapshot distinto", payload: { ...fixture, catalog_snapshot_id: "products_catalog:other" } },
    { name: "eco de referencia distinto", payload: { ...fixture, reference: { ...(fixture.reference as Record<string, unknown>), variant_id: "var-otra" } } },
    {
      name: "referencia dentro de los candidatos",
      payload: { ...fixture, candidates: [{ ...candidates[0], variants: [{ ...candidates[0].variants[0], variant_id: "var-rojo-12" }] }, candidates[1]] },
    },
    { name: "variante fuera del set LoRA", payload: fixture, lora: ["var-rojo-12-x50", "var-azul-12"] },
    {
      name: "variante duplicada",
      payload: { ...fixture, candidates: [candidates[0], { ...candidates[1], variants: [candidates[1].variants[0], { ...candidates[1].variants[1], variant_id: "var-rojo-12-x50" }] }] },
    },
    { name: "producto duplicado", payload: { ...fixture, candidates: [candidates[1], { ...candidates[1], variants: [{ ...candidates[1].variants[0], variant_id: "var-azul-otra" }] }] } },
    { name: "total mayor que limit", payload: fixture, limit: 2 },
    { name: "variante no disponible", payload: { ...fixture, candidates: [{ ...candidates[0], variants: [{ ...candidates[0].variants[0], available: false }] }] } },
  ];
  for (const invalid of invalidCases) {
    await assert.rejects(
      () => llamarPythonCatalogRecommendations({
        referenceVariantId: "var-rojo-12",
        catalogSnapshotId: snapshot,
        ...(invalid.lora ? { loraVariantIds: invalid.lora } : {}),
        limit: invalid.limit ?? 100,
        requestId: REQUEST_ID,
        correlationId: CORRELATION_ID,
        env: BASE_ENV,
        fetchImpl: async () => successResponse(invalid.payload),
      }),
      (error: unknown) => error instanceof PythonAdapterError && error.code === "PYTHON_INVALID_RESPONSE" && error.status === 502,
      invalid.name,
    );
  }

  await assert.rejects(
    () => llamarPythonCatalogRecommendations({
      referenceVariantId: "var-rojo-12",
      catalogSnapshotId: snapshot,
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      env: BASE_ENV,
      fetchImpl: async () => Response.json({ detail: { code: "reference_variant_not_found" } }, { status: 422 }),
    }),
    (error: unknown) => error instanceof PythonAdapterError
      && error.code === "PYTHON_INVALID_REQUEST"
      && error.domainCode === "reference_variant_not_found",
  );
}

async function testRouteAndMissingConfig(): Promise<void> {
  const originalFetch = globalThis.fetch;
  try {
    let routeCalls = 0;
    const routeFetch: typeof fetch = async () => {
      routeCalls += 1;
      return successResponse({ message: "python-route" });
    };
    globalThis.fetch = routeFetch;
    const response = await withEnvironment(BASE_ENV, () => POST(new Request("http://next.test/api/internal/ai/echo", {
      method: "POST",
      headers: {
        "x-request-id": REQUEST_ID,
        "x-correlation-id": CORRELATION_ID,
        "idempotency-key": "route-key",
      },
      body: JSON.stringify({ message: "route" }),
    })));
    assert.equal(response.status, 200);
    const responseBody = await response.json();
    assert.equal(responseBody.backend, "python");
    assert.equal(responseBody.request_id, REQUEST_ID);
    assert.equal(responseBody.correlation_id, CORRELATION_ID);
    assert.equal(routeCalls, 1);

    globalThis.fetch = async () => Response.json(
      { detail: { code: "invalid_signature" } },
      { status: 401 },
    );
    const authFailure = await withEnvironment(BASE_ENV, () => POST(new Request("http://next.test/api/internal/ai/echo", {
      method: "POST",
      body: JSON.stringify({ message: "no-fallback" }),
    })));
    assert.equal(authFailure.status, 401);
    assert.equal((await authFailure.json()).code, "PYTHON_AUTH_FAILED");

    const missing = await withEnvironment({
      PYTHON_BACKEND_URL: undefined,
      INTERNAL_HMAC_SECRET: undefined,
    }, () => POST(new Request("http://next.test/api/internal/ai/echo", {
      method: "POST",
      body: JSON.stringify({ message: "missing" }),
    })));
    assert.equal(missing.status, 503);
    assert.equal((await missing.json()).code, "PYTHON_BACKEND_NOT_CONFIGURED");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function main(): Promise<void> {
  await testEnabledHeadersAndNonce();
  await testStableFailures();
  await testRerankEnvelopeAndPermutation();
  await testEmbeddingEnvelope();
  await testIntentParseEnvelope();
  await testHappieGenerateEnvelope();
  await testReferenceTurnEnvelope();
  await testPatronReferenciaEnvelope();
  await testImageGenerateEnvelope();
  await testLoraGenerateEnvelope();
  await testChatTurnStreamEnvelope();
  await testCatalogSearchEnvelope();
  await testCatalogSelectionEnvelope();
  await testPlanResolutionEnvelope();
  await testPlanResolutionDomainError();
  await testCatalogRecommendationsEnvelope();
  await testRouteAndMissingConfig();
  console.log("Python adapter: OK");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
