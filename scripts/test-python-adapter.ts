import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  InternalRequestSignatureV1Schema,
  verificarRequestInterna,
  sha256Body,
} from "../src/lib/ia/contracts/operational-v1";
import {
  PYTHON_CATALOG_RECOMMENDATIONS_PATH,
  PYTHON_CATALOG_RECOMMENDATIONS_SCOPE,
  PythonAdapterError,
  llamarPythonCatalogRecommendations,
  llamarPythonCatalogSearch,
  llamarPythonCatalogSelection,
  llamarPythonEcho,
  llamarPythonEmbedding,
  llamarPythonPlanResolution,
  llamarPythonRerank,
  seleccionarBackendPython,
} from "../src/lib/ia/python-adapter";
import type { PlanDecoracion } from "../src/lib/plan/tipos";
import { POST } from "../src/app/api/internal/ai/echo/route";

const SECRET = "local-only-secret-0123456789abcdef";
const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const CORRELATION_ID = "00000000-0000-4000-8000-000000000002";
const BASE_ENV = {
  PYTHON_BACKEND_ENABLED: "true",
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

async function testEndpointSelection(): Promise<void> {
  assert.equal(seleccionarBackendPython({}).backend, "next");
  assert.equal(seleccionarBackendPython({ PYTHON_BACKEND_ENABLED: "true" }).backend, "python");
  assert.equal(seleccionarBackendPython({
    ...BASE_ENV,
    PYTHON_BACKEND_KILL_SWITCH: "true",
  }).backend, "next");

  const defaultResponse = await withEnvironment({
    PYTHON_BACKEND_ENABLED: undefined,
    PYTHON_BACKEND_KILL_SWITCH: undefined,
    PYTHON_BACKEND_URL: undefined,
    INTERNAL_HMAC_SECRET: undefined,
  }, () => POST(new Request("http://next.test/api/internal/ai/echo", {
    method: "POST",
    body: JSON.stringify({ message: "next" }),
  })));
  assert.equal(defaultResponse.status, 200);
  assert.equal((await defaultResponse.json()).backend, "next");

  const killResponse = await withEnvironment({
    ...BASE_ENV,
    PYTHON_BACKEND_KILL_SWITCH: "true",
  }, () => POST(new Request("http://next.test/api/internal/ai/echo", {
    method: "POST",
    body: JSON.stringify({ message: "kill" }),
  })));
  assert.equal(killResponse.status, 200);
  assert.equal((await killResponse.json()).backend, "next");
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

  const invalidSubtotalFetch: typeof fetch = async () => successResponse(
    validCatalogSelectionPayload({ subtotal_cop: 2999 }),
  );
  await assert.rejects(
    () => llamarPythonCatalogSelection({
      items: [{ product_id: "prod-1", variant_id: "variant-1", quantity: 2 }],
      allowlist: [{ product_id: "prod-1", variant_ids: ["variant-1"] }],
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      env: BASE_ENV,
      fetchImpl: invalidSubtotalFetch,
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

async function testRouteEnabledAndMissingConfig(): Promise<void> {
  const originalFetch = globalThis.fetch;
  try {
    let routeCalls = 0;
    const routeFetch: typeof fetch = async () => {
      routeCalls += 1;
      return successResponse({ message: "python-route" });
    };
    globalThis.fetch = routeFetch;
    const response = await withEnvironment({
      ...BASE_ENV,
      PYTHON_BACKEND_KILL_SWITCH: undefined,
    }, () => POST(new Request("http://next.test/api/internal/ai/echo", {
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
    const authFailure = await withEnvironment({
      ...BASE_ENV,
      PYTHON_BACKEND_KILL_SWITCH: undefined,
    }, () => POST(new Request("http://next.test/api/internal/ai/echo", {
      method: "POST",
      body: JSON.stringify({ message: "no-fallback" }),
    })));
    assert.equal(authFailure.status, 401);
    assert.equal((await authFailure.json()).code, "PYTHON_AUTH_FAILED");

    const missing = await withEnvironment({
      PYTHON_BACKEND_ENABLED: "true",
      PYTHON_BACKEND_URL: undefined,
      INTERNAL_HMAC_SECRET: undefined,
      PYTHON_BACKEND_KILL_SWITCH: undefined,
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
  await testEndpointSelection();
  await testEnabledHeadersAndNonce();
  await testStableFailures();
  await testRerankEnvelopeAndPermutation();
  await testEmbeddingEnvelope();
  await testCatalogSearchEnvelope();
  await testCatalogSelectionEnvelope();
  await testPlanResolutionEnvelope();
  await testPlanResolutionDomainError();
  await testCatalogRecommendationsEnvelope();
  await testRouteEnabledAndMissingConfig();
  console.log("Python adapter: OK");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
