import {
  DEADLINE_DEFAULT_MS,
  DEADLINE_MAX_MS,
  InternalRequestSignatureV1Schema,
  OperationalContextV1Schema,
  crearDeadlineSignal,
  firmarRequestInterna,
  seleccionarBackendMigracion,
  sha256Body,
} from "@/lib/ia/contracts/operational-v1";
import type { BackendSelectionV1 } from "@/lib/ia/contracts/operational-v1";
import { z } from "zod";

export const PYTHON_ECHO_PATH = "/internal/v1/echo";
export const PYTHON_ECHO_SCOPE = "ai.echo";
export const PYTHON_RERANK_PATH = "/internal/v1/rerank";
export const PYTHON_RERANK_SCOPE = "ai.rerank";
export const PYTHON_MAX_BODY_BYTES = 64 * 1024;

type AdapterEnvironment = Record<string, string | undefined>;
type JsonObject = Record<string, unknown>;

export type PythonAdapterErrorCode =
  | "PYTHON_BACKEND_NOT_SELECTED"
  | "PYTHON_BACKEND_NOT_CONFIGURED"
  | "PYTHON_BACKEND_INVALID_URL"
  | "PYTHON_BACKEND_TIMEOUT"
  | "PYTHON_REQUEST_CANCELLED"
  | "PYTHON_AUTH_FAILED"
  | "PYTHON_AUTH_UNAVAILABLE"
  | "PYTHON_SCOPE_DENIED"
  | "PYTHON_REPLAY"
  | "PYTHON_IDEMPOTENCY_CONFLICT"
  | "PYTHON_IDEMPOTENCY_IN_FLIGHT"
  | "PYTHON_INVALID_REQUEST"
  | "PYTHON_PAYLOAD_TOO_LARGE"
  | "PYTHON_INVALID_RESPONSE"
  | "PYTHON_UNAVAILABLE";

const ERROR_MESSAGES: Record<PythonAdapterErrorCode, string> = {
  PYTHON_BACKEND_NOT_SELECTED: "La ruta Python no está seleccionada.",
  PYTHON_BACKEND_NOT_CONFIGURED: "El backend Python no está configurado.",
  PYTHON_BACKEND_INVALID_URL: "La URL del backend Python no es válida.",
  PYTHON_BACKEND_TIMEOUT: "El backend Python agotó su deadline.",
  PYTHON_REQUEST_CANCELLED: "La solicitud al backend Python fue cancelada.",
  PYTHON_AUTH_FAILED: "El backend Python rechazó la autenticación.",
  PYTHON_AUTH_UNAVAILABLE: "La autenticación del backend Python no está disponible.",
  PYTHON_SCOPE_DENIED: "El backend Python rechazó el scope solicitado.",
  PYTHON_REPLAY: "El backend Python rechazó el replay de la solicitud.",
  PYTHON_IDEMPOTENCY_CONFLICT: "La clave de idempotencia ya fue usada con otro cuerpo.",
  PYTHON_IDEMPOTENCY_IN_FLIGHT: "Ya existe una solicitud en curso con esa clave de idempotencia.",
  PYTHON_INVALID_REQUEST: "El backend Python rechazó la solicitud.",
  PYTHON_PAYLOAD_TOO_LARGE: "La solicitud supera el tamaño máximo permitido.",
  PYTHON_INVALID_RESPONSE: "El backend Python devolvió una respuesta inválida.",
  PYTHON_UNAVAILABLE: "No se pudo contactar al backend Python.",
};

const RETRYABLE_CODES = new Set<PythonAdapterErrorCode>([
  "PYTHON_BACKEND_TIMEOUT",
  "PYTHON_AUTH_UNAVAILABLE",
  "PYTHON_IDEMPOTENCY_IN_FLIGHT",
  "PYTHON_UNAVAILABLE",
]);

const responseSchema = z.object({
  schema_version: z.literal("operational.v1"),
  request_id: z.string().uuid(),
  correlation_id: z.string().uuid(),
  payload: z.record(z.string(), z.unknown()),
}).strict();

export class PythonAdapterError extends Error {
  readonly code: PythonAdapterErrorCode;
  readonly status: number;
  readonly requestId: string;
  readonly correlationId: string;
  readonly retryable: boolean;

  constructor(input: {
    code: PythonAdapterErrorCode;
    status: number;
    requestId: string;
    correlationId: string;
  }) {
    super(ERROR_MESSAGES[input.code]);
    this.name = "PythonAdapterError";
    this.code = input.code;
    this.status = input.status;
    this.requestId = input.requestId;
    this.correlationId = input.correlationId;
    this.retryable = RETRYABLE_CODES.has(input.code);
  }
}

export function isPythonAdapterError(error: unknown): error is PythonAdapterError {
  return error instanceof PythonAdapterError;
}

export function seleccionarBackendPython(
  env: AdapterEnvironment = process.env,
): BackendSelectionV1 {
  return seleccionarBackendMigracion(env);
}

export interface PythonOperationInput {
  payload: JsonObject;
  /** Optional operation fields for endpoints whose body is not { payload }. */
  operationBody?: JsonObject;
  requestId: string;
  correlationId: string;
  bodySha256?: string;
  deadlineMs?: number;
  idempotencyKey?: string;
  scopes?: readonly string[];
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonOperationResponse {
  schema_version: "operational.v1";
  request_id: string;
  correlation_id: string;
  payload: JsonObject;
  replayed?: boolean;
}

/** @deprecated use PythonOperationInput -- kept as an alias so existing echo call sites and tests do not need to change. */
export type PythonEchoInput = PythonOperationInput;
/** @deprecated use PythonOperationResponse -- kept as an alias so existing echo call sites and tests do not need to change. */
export type PythonEchoResponse = PythonOperationResponse;

function errorFor(
  code: PythonAdapterErrorCode,
  status: number,
  requestId: string,
  correlationId: string,
): PythonAdapterError {
  return new PythonAdapterError({ code, status, requestId, correlationId });
}

function normalizeDeadlineMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEADLINE_DEFAULT_MS;
  return Math.min(DEADLINE_MAX_MS, Math.max(1, Math.trunc(value)));
}

function readPythonConfig(
  env: AdapterEnvironment,
  requestId: string,
  correlationId: string,
): { url: URL; secret: string } {
  const rawUrl = env.PYTHON_BACKEND_URL?.trim();
  const secret = env.INTERNAL_HMAC_SECRET?.trim();
  if (!rawUrl || !secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw errorFor("PYTHON_BACKEND_NOT_CONFIGURED", 503, requestId, correlationId);
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw errorFor("PYTHON_BACKEND_INVALID_URL", 503, requestId, correlationId);
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw errorFor("PYTHON_BACKEND_INVALID_URL", 503, requestId, correlationId);
  }
  url.search = "";
  url.hash = "";
  return { url, secret };
}

function endpointUrl(baseUrl: URL, path: string): URL {
  const result = new URL(baseUrl.toString());
  const basePath = result.pathname.endsWith("/") ? result.pathname : `${result.pathname}/`;
  result.pathname = `${basePath}${path.slice(1)}`.replace(/\/+/g, "/");
  return result;
}

function stringCode(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim().toLowerCase() : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function upstreamCode(value: unknown): string | undefined {
  if (!isJsonObject(value)) return undefined;
  const record = value;
  const direct = stringCode(record.code);
  if (direct) return direct;
  if (!isJsonObject(record.detail)) return undefined;
  return stringCode(record.detail.code);
}

function mapUpstreamError(
  status: number,
  body: unknown,
  requestId: string,
  correlationId: string,
): PythonAdapterError {
  const code = upstreamCode(body);
  if (status === 401 && (code === "nonce_replay" || code === "replay")) {
    return errorFor("PYTHON_REPLAY", 401, requestId, correlationId);
  }
  if (status === 408 || code === "deadline_exceeded") {
    return errorFor("PYTHON_BACKEND_TIMEOUT", 504, requestId, correlationId);
  }
  if (status === 499 || code === "client_cancelled") {
    return errorFor("PYTHON_REQUEST_CANCELLED", 499, requestId, correlationId);
  }
  if (status === 401) return errorFor("PYTHON_AUTH_FAILED", 401, requestId, correlationId);
  if (status === 403) return errorFor("PYTHON_SCOPE_DENIED", 403, requestId, correlationId);
  if (status === 413) return errorFor("PYTHON_PAYLOAD_TOO_LARGE", 413, requestId, correlationId);
  if (status === 422) return errorFor("PYTHON_INVALID_REQUEST", 422, requestId, correlationId);
  if (status === 503 && code === "auth_unavailable") {
    return errorFor("PYTHON_AUTH_UNAVAILABLE", 503, requestId, correlationId);
  }
  if (status === 409) {
    if (code === "replay" || code === "nonce_replay" || code === "idempotency_replay") {
      return errorFor("PYTHON_REPLAY", 409, requestId, correlationId);
    }
    if (code === "conflict" || code === "idempotency_conflict") {
      return errorFor("PYTHON_IDEMPOTENCY_CONFLICT", 409, requestId, correlationId);
    }
    if (code === "in_flight" || code === "idempotency_in_flight") {
      return errorFor("PYTHON_IDEMPOTENCY_IN_FLIGHT", 409, requestId, correlationId);
    }
  }
  return errorFor("PYTHON_UNAVAILABLE", status >= 500 ? 502 : status, requestId, correlationId);
}

function readJsonObject(value: unknown): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

/**
 * Shared Next -> Python boundary for every /internal/v1/* operation: HMAC
 * signing, deadline, nonce, idempotency headers and upstream error mapping
 * are identical across operations. Only `path` (which endpoint) and the
 * default `scope` (when the caller does not pass explicit scopes) vary.
 */
async function llamarPythonOperacion(
  path: string,
  defaultScope: string,
  input: PythonOperationInput,
): Promise<PythonOperationResponse> {
  const requestId = z.string().uuid().parse(input.requestId);
  const correlationId = z.string().uuid().parse(input.correlationId);
  const env = input.env ?? process.env;
  const selection = seleccionarBackendPython(env);
  if (selection.backend !== "python") {
    throw errorFor("PYTHON_BACKEND_NOT_SELECTED", 409, requestId, correlationId);
  }

  const { url: baseUrl, secret } = readPythonConfig(env, requestId, correlationId);
  const target = endpointUrl(baseUrl, path);
  const scopes = [...(input.scopes ?? [defaultScope])];
  const deadlineMs = normalizeDeadlineMs(input.deadlineMs);
  const parentSignal = input.parentSignal ?? new AbortController().signal;
  const deadline = crearDeadlineSignal(parentSignal, deadlineMs);
  const randomUUID = input.randomUUID ?? (() => crypto.randomUUID());
  const inputBodySha256 = input.bodySha256 ?? sha256Body(JSON.stringify(input.payload));

  try {
    const context = OperationalContextV1Schema.parse({
      schema_version: "operational.v1",
      request_id: requestId,
      correlation_id: correlationId,
      deadline_at: new Date(deadline.deadlineAt).toISOString(),
      deadline_ms: deadlineMs,
      body_sha256: inputBodySha256,
      ...(input.idempotencyKey ? { idempotency_key: input.idempotencyKey } : {}),
      scopes,
    });
    const body = JSON.stringify({
      context,
      ...(input.operationBody ?? { payload: input.payload }),
    });
    if (new TextEncoder().encode(body).byteLength > PYTHON_MAX_BODY_BYTES) {
      throw errorFor("PYTHON_PAYLOAD_TOO_LARGE", 413, requestId, correlationId);
    }

    const bodyHash = sha256Body(body);
    const signature = InternalRequestSignatureV1Schema.parse(firmarRequestInterna({
      secret,
      method: "POST",
      path: target.pathname,
      bodySha256: bodyHash,
      scopes,
      timestamp: Math.floor(Date.now() / 1000),
      nonce: randomUUID(),
    }));
    const headers = new Headers({
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-request-id": requestId,
      "x-correlation-id": correlationId,
      "x-deadline-ms": String(deadlineMs),
      "x-deadline-at": new Date(deadline.deadlineAt).toISOString(),
      "x-internal-schema-version": signature.schema_version,
      "x-internal-timestamp": String(signature.timestamp),
      "x-internal-nonce": signature.nonce,
      "x-internal-signature": signature.signature,
      "x-internal-scopes": signature.scopes.join(","),
    });
    if (input.idempotencyKey) headers.set("idempotency-key", input.idempotencyKey);

    let response: Response;
    try {
      response = await (input.fetchImpl ?? fetch)(target, {
        method: "POST",
        headers,
        body,
        signal: deadline.signal,
        cache: "no-store",
      });
    } catch (error) {
      if (deadline.wasDeadlineExceeded()) {
        throw errorFor("PYTHON_BACKEND_TIMEOUT", 504, requestId, correlationId);
      }
      if (deadline.signal.aborted) {
        throw errorFor("PYTHON_REQUEST_CANCELLED", 499, requestId, correlationId);
      }
      if (error instanceof PythonAdapterError) throw error;
      throw errorFor("PYTHON_UNAVAILABLE", 502, requestId, correlationId);
    }

    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      responseBody = undefined;
    }
    if (!response.ok) {
      throw mapUpstreamError(response.status, responseBody, requestId, correlationId);
    }
    const parsed = responseSchema.safeParse(responseBody);
    const replayed = response.headers.get("x-idempotency-result") === "replay";
    if (
      !parsed.success ||
      (!replayed &&
        (parsed.data.request_id !== requestId || parsed.data.correlation_id !== correlationId))
    ) {
      throw errorFor("PYTHON_INVALID_RESPONSE", 502, requestId, correlationId);
    }
    return replayed ? { ...parsed.data, replayed: true } : parsed.data;
  } catch (error) {
    if (error instanceof PythonAdapterError) throw error;
    if (error instanceof z.ZodError) {
      throw errorFor("PYTHON_INVALID_REQUEST", 422, requestId, correlationId);
    }
    throw errorFor("PYTHON_UNAVAILABLE", 502, requestId, correlationId);
  } finally {
    deadline.dispose();
  }
}

export async function llamarPythonEcho(input: PythonOperationInput): Promise<PythonOperationResponse> {
  return llamarPythonOperacion(PYTHON_ECHO_PATH, PYTHON_ECHO_SCOPE, input);
}

export interface PythonRerankCandidate {
  id: string;
  text: string;
}

export interface PythonRerankInput {
  query: string;
  candidates: PythonRerankCandidate[];
  requestId: string;
  correlationId: string;
  bodySha256?: string;
  deadlineMs?: number;
  idempotencyKey?: string;
  scopes?: readonly string[];
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonRerankResult {
  /** Candidate ids in reranked order -- always a permutation of the input ids. */
  order: string[];
  scores: Record<string, number>;
  replayed?: boolean;
}

const rerankPayloadResultSchema = z.object({
  order: z.array(z.string().min(1)),
  scores: z.record(z.string().min(1), z.number().finite()),
});

/**
 * Reorders a candidate list PostgreSQL already authorized (see
 * buscarHibrido in src/lib/rag/retrieval/search.ts). Never adds or removes a
 * candidate -- `order` is validated to be a permutation of the input ids.
 */
export async function llamarPythonRerank(input: PythonRerankInput): Promise<PythonRerankResult> {
  const { query, candidates, ...rest } = input;
  const operationPayload = { query, candidates };
  const response = await llamarPythonOperacion(PYTHON_RERANK_PATH, PYTHON_RERANK_SCOPE, {
    ...rest,
    payload: operationPayload,
    operationBody: operationPayload,
  });
  const parsed = rerankPayloadResultSchema.safeParse(response.payload);
  if (!parsed.success) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  const expectedIdList = candidates.map((candidate) => candidate.id);
  const expectedIds = new Set(expectedIdList);
  const returnedIds = new Set(parsed.data.order);
  const scoreIds = new Set(Object.keys(parsed.data.scores));
  const isPermutation = parsed.data.order.length === candidates.length
    && expectedIds.size === expectedIdList.length
    && expectedIds.size === returnedIds.size
    && expectedIds.size === scoreIds.size
    && [...expectedIds].every((id) => returnedIds.has(id) && scoreIds.has(id));
  if (!isPermutation) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  return response.replayed
    ? { ...parsed.data, replayed: true }
    : parsed.data;
}

export function pythonErrorBody(error: PythonAdapterError): {
  schema_version: "operational.v1";
  code: PythonAdapterErrorCode;
  message: string;
  retryable: boolean;
  request_id: string;
  correlation_id: string;
} {
  return {
    schema_version: "operational.v1",
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    request_id: error.requestId,
    correlation_id: error.correlationId,
  };
}

export function parseEchoPayload(value: unknown): JsonObject | undefined {
  return readJsonObject(value);
}
