import assert from "node:assert/strict";
import {
  InternalRequestSignatureV1Schema,
  verificarRequestInterna,
  sha256Body,
} from "../src/lib/ia/contracts/operational-v1";
import {
  PythonAdapterError,
  llamarPythonEcho,
  seleccionarBackendPython,
} from "../src/lib/ia/python-adapter";
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
  await testRouteEnabledAndMissingConfig();
  console.log("Python adapter: OK");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
