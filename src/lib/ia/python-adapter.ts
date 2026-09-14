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
import {
  CATALOG_RECOMMENDATIONS_CONTRACT_VERSION,
  CatalogRecommendationsResultV1Schema,
  PlanResolutionResultV1Schema,
} from "@/lib/ia/contracts/domain-v1";
import type { PlanDecoracion } from "@/lib/plan/tipos";
import { z } from "zod";

export const PYTHON_ECHO_PATH = "/internal/v1/echo";
export const PYTHON_ECHO_SCOPE = "ai.echo";
export const PYTHON_RERANK_PATH = "/internal/v1/rerank";
export const PYTHON_RERANK_SCOPE = "ai.rerank";
export const PYTHON_EMBEDDING_PATH = "/internal/v1/embed";
export const PYTHON_EMBEDDING_SCOPE = "ai.embedding";
export const PYTHON_CATALOG_SEARCH_PATH = "/internal/v1/catalog/search";
export const PYTHON_CATALOG_SEARCH_SCOPE = "catalog.search";
export const PYTHON_CATALOG_SELECTION_PATH = "/internal/v1/catalog/selection";
export const PYTHON_CATALOG_SELECTION_SCOPE = "catalog.selection";
export const PYTHON_PLAN_RESOLUTION_PATH = "/internal/v1/plan/resolve";
export const PYTHON_PLAN_RESOLUTION_SCOPE = "plan.resolve";
export const PYTHON_CATALOG_RECOMMENDATIONS_PATH = "/internal/v1/catalog/recommendations";
export const PYTHON_CATALOG_RECOMMENDATIONS_SCOPE = "catalog.recommendations";
export const PYTHON_EMBEDDING_MODEL = "gemini-embedding-2";
export const PYTHON_EMBEDDING_DIMENSIONS = 768;
export const PYTHON_MAX_BODY_BYTES = 64 * 1024;

/**
 * Stable domain error codes reported by POST /internal/v1/plan/resolve
 * (services/ai-api/app/plan.py). They arrive as PythonAdapterError.domainCode
 * under the PYTHON_INVALID_REQUEST transport code. A plan with no catalog
 * coverage is NOT an error: the service answers 200 with
 * `plan_resuelto.sin_cobertura` populated. `allowlist_product_mismatch` means a
 * variant was paired with a product that does not own it in the snapshot.
 */
export const PYTHON_PLAN_RESOLUTION_DOMAIN_CODES = ["invalid_plan", "catalog_snapshot_not_found", "allowlist_product_mismatch"] as const;
export type PythonPlanResolutionDomainCode = (typeof PYTHON_PLAN_RESOLUTION_DOMAIN_CODES)[number];

/**
 * Stable domain error codes reported by POST /internal/v1/catalog/selection
 * (services/ai-api/app/catalog.py). Same transport as plan resolution.
 */
export const PYTHON_CATALOG_SELECTION_DOMAIN_CODES = ["allowlist_product_mismatch"] as const;
export type PythonCatalogSelectionDomainCode = (typeof PYTHON_CATALOG_SELECTION_DOMAIN_CODES)[number];

/**
 * Stable domain error codes reported by POST /internal/v1/catalog/recommendations
 * (services/ai-api/app/recommendations.py), under PYTHON_INVALID_REQUEST.
 */
export const PYTHON_CATALOG_RECOMMENDATIONS_DOMAIN_CODES = ["catalog_snapshot_not_found", "reference_variant_not_found"] as const;
export type PythonCatalogRecommendationsDomainCode = (typeof PYTHON_CATALOG_RECOMMENDATIONS_DOMAIN_CODES)[number];

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

export interface PythonEmbeddingAttempt {
  attempt: number;
  result: "ok" | "error";
  elapsed_ms: number;
}

const embeddingAttemptSchema = z.object({
  attempt: z.number().int().positive(),
  result: z.enum(["ok", "error"]),
  elapsed_ms: z.number().int().nonnegative(),
}).strict();

function upstreamEmbeddingAttempts(value: unknown): PythonEmbeddingAttempt[] | undefined {
  if (!isJsonObject(value) || !isJsonObject(value.detail)) return undefined;
  const parsed = z.array(embeddingAttemptSchema).min(1).safeParse(value.detail.attempts);
  return parsed.success ? parsed.data : undefined;
}

export class PythonAdapterError extends Error {
  readonly code: PythonAdapterErrorCode;
  /**
   * Domain error code reported by the Python service (`detail.code`), when the
   * failure came from the service instead of the transport. The adapter code
   * above only classifies the transport outcome: several distinct domain
   * failures collapse into `PYTHON_INVALID_REQUEST`, so a caller that needs to
   * tell `catalog_snapshot_not_found` from `invalid_plan` reads this instead.
   * Never present for locally raised transport errors.
   */
  readonly domainCode?: string;
  readonly status: number;
  readonly requestId: string;
  readonly correlationId: string;
  readonly retryable: boolean;
  readonly attempts?: PythonEmbeddingAttempt[];

  constructor(input: {
    code: PythonAdapterErrorCode;
    status: number;
    requestId: string;
    correlationId: string;
    attempts?: PythonEmbeddingAttempt[];
    domainCode?: string;
  }) {
    super(ERROR_MESSAGES[input.code]);
    this.name = "PythonAdapterError";
    this.code = input.code;
    this.status = input.status;
    this.requestId = input.requestId;
    this.correlationId = input.correlationId;
    this.retryable = RETRYABLE_CODES.has(input.code);
    this.attempts = input.attempts;
    this.domainCode = input.domainCode;
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
  attempts?: PythonEmbeddingAttempt[],
  domainCode?: string,
): PythonAdapterError {
  return new PythonAdapterError({ code, status, requestId, correlationId, attempts, domainCode });
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
  const attempts = upstreamEmbeddingAttempts(body);
  // The upstream domain code travels on the error so a caller can tell apart
  // failures that all classify as the same transport outcome (see
  // PythonAdapterError.domainCode).
  const upstream = (adapterCode: PythonAdapterErrorCode, adapterStatus: number): PythonAdapterError =>
    errorFor(adapterCode, adapterStatus, requestId, correlationId, attempts, code);
  if (status === 401 && (code === "nonce_replay" || code === "replay")) {
    return upstream("PYTHON_REPLAY", 401);
  }
  if (status === 408 || code === "deadline_exceeded") {
    return upstream("PYTHON_BACKEND_TIMEOUT", 504);
  }
  if (status === 499 || code === "client_cancelled") {
    return upstream("PYTHON_REQUEST_CANCELLED", 499);
  }
  if (status === 401) return upstream("PYTHON_AUTH_FAILED", 401);
  if (status === 403) return upstream("PYTHON_SCOPE_DENIED", 403);
  if (status === 413) return upstream("PYTHON_PAYLOAD_TOO_LARGE", 413);
  if (status === 422) return upstream("PYTHON_INVALID_REQUEST", 422);
  if (status === 503 && code === "auth_unavailable") {
    return upstream("PYTHON_AUTH_UNAVAILABLE", 503);
  }
  if (status === 409) {
    if (code === "replay" || code === "nonce_replay" || code === "idempotency_replay") {
      return upstream("PYTHON_REPLAY", 409);
    }
    if (code === "conflict" || code === "idempotency_conflict") {
      return upstream("PYTHON_IDEMPOTENCY_CONFLICT", 409);
    }
    if (code === "in_flight" || code === "idempotency_in_flight") {
      return upstream("PYTHON_IDEMPOTENCY_IN_FLIGHT", 409);
    }
  }
  return upstream("PYTHON_UNAVAILABLE", status >= 500 ? 502 : status);
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
  const operationBody = input.operationBody ?? { payload: input.payload };
  const inputBodySha256 = input.bodySha256 ?? sha256Body(JSON.stringify(input.operationBody ?? input.payload));

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
      ...operationBody,
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

export interface PythonEmbeddingInput {
  text: string;
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  idempotencyKey?: string;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonEmbeddingResult {
  values: number[];
  model: string;
  dimensions: number;
  task_type: "RETRIEVAL_QUERY";
  attempts: PythonEmbeddingAttempt[];
  replayed?: boolean;
}

export interface PythonCatalogSearchFilters {
  available?: boolean;
  price_max?: number;
  categories?: string[];
  occasions?: string[];
  colors?: string[];
  finishes?: string[];
  shapes?: string[];
  diameters_inches?: number[];
}

export interface PythonCatalogSearchAllowlistEntry {
  product_id: string;
  variant_ids: string[];
}

export interface PythonCatalogSearchInput {
  message: string;
  filters: PythonCatalogSearchFilters;
  allowlist: PythonCatalogSearchAllowlistEntry[];
  limit?: number;
  catalogSnapshotId?: string;
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  idempotencyKey?: string;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonCatalogSearchResult {
  status: "OK" | "NO_MATCH" | "AMBIGUOUS_SKU";
  sku_status: "not_sku" | "unique" | "ambiguous" | "not_found" | "filtered_out" | null;
  candidates: Array<{
    product_id: string;
    title: string;
    category: string | null;
    colors: string[];
    finishes: string[];
    occasions: string[];
    available: boolean;
    image: string | null;
    score: number;
    variants: Array<{
      variant_id: string;
      sku: string | null;
      title: string | null;
      price: number;
      available: boolean;
      size_code: string | null;
      diameter_inches: number | null;
      shape: string | null;
      colors: string[];
    }>;
  }>;
  whitelist: PythonCatalogSearchAllowlistEntry[];
  catalog_snapshot_id: string | null;
  latency_parse_ms: number;
  latency_retrieval_ms: number;
  replayed?: boolean;
}

export interface PythonCatalogSelectionInput {
  items: Array<{
    product_id: string;
    variant_id: string;
    quantity: number;
    reason?: string;
  }>;
  allowlist: PythonCatalogSearchAllowlistEntry[];
  catalogSnapshotId?: string;
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  idempotencyKey?: string;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonCatalogSelectionResult {
  status: "ok" | "partial" | "empty";
  catalog_snapshot_id: string | null;
  validados: Array<{
    product_id: string;
    variant_id: string;
    sku: string | null;
    product_title: string;
    title: string;
    unit_price_cop: number;
    quantity: number;
    subtotal_cop: number;
    image_url: string | null;
    handle: string | null;
    product_type: string | null;
    category: string | null;
    colors: string[];
    description: string | null;
    units_per_package: number | null;
    size_code: string | null;
    shape: string | null;
    diameter_inches: number | null;
  }>;
  rechazados: Array<{
    product_id: string;
    variant_id: string;
    reason: string;
  }>;
  total_cop: number;
  replayed?: boolean;
}

export interface PythonPlanResolutionInput {
  plan: PlanDecoracion;
  allowlist: PythonCatalogSearchAllowlistEntry[];
  catalogSnapshotId: string;
  loraVariantIds?: string[];
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  idempotencyKey?: string;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export type PythonPlanResolutionResult = z.infer<typeof PlanResolutionResultV1Schema> & {
  replayed?: boolean;
};

export interface PythonCatalogRecommendationsInput {
  referenceVariantId: string;
  catalogSnapshotId: string;
  /** Absent means unrestricted. Never pass an empty list: callers fail closed before calling. */
  loraVariantIds?: readonly string[];
  limit?: number;
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export type PythonCatalogRecommendationsResult = z.infer<typeof CatalogRecommendationsResultV1Schema> & {
  replayed?: boolean;
};

const rerankPayloadResultSchema = z.object({
  order: z.array(z.string().min(1)),
  scores: z.record(z.string().min(1), z.number().finite()),
});

const embeddingPayloadResultSchema = z.object({
  values: z.array(z.number().finite()).min(1),
  model: z.string().min(1),
  dimensions: z.number().int().positive(),
  task_type: z.literal("RETRIEVAL_QUERY"),
  attempts: z.array(embeddingAttemptSchema).min(1),
}).strict();

const catalogVariantSchema = z.object({
  variant_id: z.string().min(1),
  sku: z.string().nullable(),
  title: z.string().nullable(),
  price: z.number().finite().nonnegative(),
  available: z.boolean(),
  size_code: z.string().nullable(),
  diameter_inches: z.number().finite().nullable(),
  shape: z.string().nullable(),
  colors: z.array(z.string()),
}).strict();

const catalogCandidateSchema = z.object({
  product_id: z.string().min(1),
  title: z.string().min(1),
  category: z.string().nullable(),
  colors: z.array(z.string()),
  finishes: z.array(z.string()),
  occasions: z.array(z.string()),
  available: z.boolean(),
  image: z.string().nullable(),
  score: z.number().finite(),
  variants: z.array(catalogVariantSchema),
}).strict();

const catalogPayloadResultSchema = z.object({
  operation_schema_version: z.literal("catalog-search-result.v1"),
  status: z.enum(["OK", "NO_MATCH", "AMBIGUOUS_SKU"]),
  sku_status: z.enum(["not_sku", "unique", "ambiguous", "not_found", "filtered_out"]).nullable(),
  candidates: z.array(catalogCandidateSchema).max(50),
  whitelist: z.array(z.object({
    product_id: z.string().min(1),
    variant_ids: z.array(z.string().min(1)),
  }).strict()),
  catalog_snapshot_id: z.string().min(1).nullable(),
  latency_parse_ms: z.number().int().nonnegative(),
  latency_retrieval_ms: z.number().int().nonnegative(),
}).strict();

const catalogSelectionItemSchema = z.object({
  product_id: z.string().min(1),
  variant_id: z.string().min(1),
  sku: z.string().nullable(),
  product_title: z.string().min(1),
  title: z.string().min(1),
  unit_price_cop: z.number().int().nonnegative().safe(),
  quantity: z.number().int().positive().safe(),
  subtotal_cop: z.number().int().nonnegative().safe(),
  image_url: z.string().url().nullable(),
  handle: z.string().min(1).nullable(),
  product_type: z.string().min(1).nullable(),
  category: z.string().min(1).nullable(),
  colors: z.array(z.string()),
  description: z.string().nullable(),
  units_per_package: z.number().int().positive().safe().nullable(),
  size_code: z.string().min(1).nullable(),
  shape: z.string().min(1).nullable(),
  diameter_inches: z.number().finite().nonnegative().nullable(),
}).strict();

const catalogSelectionPayloadResultSchema = z.object({
  operation_schema_version: z.literal("catalog-selection-result.v1"),
  status: z.enum(["ok", "partial", "empty"]),
  catalog_snapshot_id: z.string().min(1).nullable(),
  validados: z.array(catalogSelectionItemSchema),
  rechazados: z.array(z.object({
    product_id: z.string().min(1),
    variant_id: z.string().min(1),
    reason: z.string().min(1),
  }).strict()),
  total_cop: z.number().int().nonnegative().safe(),
}).strict();

function planResolutionPayloadIsConsistent(
  payload: z.infer<typeof PlanResolutionResultV1Schema>,
  requestedSnapshotId: string,
): boolean {
  const resolvedTotals = payload.plan_resuelto.totales;
  const estimateTotals = payload.material_estimate.totals;
  const quote = payload.quote;
  return payload.catalog_snapshot_id === requestedSnapshotId
    && quote.plan_hash === payload.plan_resuelto.plan_hash
    && resolvedTotals.total_cop === quote.total_cop
    && resolvedTotals.merma_porcentaje === quote.waste_percentage
    && quote.purchase_cost_cop !== undefined
    && quote.consumption_cost_cop !== undefined
    && quote.target_waste_reserve !== undefined
    && quote.covered_waste_reserve !== undefined
    && quote.leftover_inventory !== undefined
    && quote.purchase_cost_cop === resolvedTotals.purchase_cost
    && quote.consumption_cost_cop === resolvedTotals.consumption_cost
    && quote.target_waste_reserve === resolvedTotals.target_waste_reserve
    && quote.covered_waste_reserve === resolvedTotals.covered_waste_reserve
    && quote.leftover_inventory === estimateTotals.operational_surplus
    && estimateTotals.design_quantity === resolvedTotals.design_quantity
    && estimateTotals.purchase_cost === resolvedTotals.purchase_cost
    && estimateTotals.consumption_cost === resolvedTotals.consumption_cost
    && estimateTotals.target_waste_reserve === resolvedTotals.target_waste_reserve
    && estimateTotals.covered_waste_reserve === resolvedTotals.covered_waste_reserve;
}

type CatalogSearchPayloadResult = z.infer<typeof catalogPayloadResultSchema>;
type CatalogSelectionPayloadResult = z.infer<typeof catalogSelectionPayloadResultSchema>;

function hasUniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (!hasUniqueStrings(left) || !hasUniqueStrings(right) || left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function catalogSearchPayloadIsConsistent(
  payload: CatalogSearchPayloadResult,
  requestedSnapshotId: string | undefined,
): boolean {
  if (requestedSnapshotId !== undefined && payload.catalog_snapshot_id !== requestedSnapshotId) return false;
  if (payload.status === "OK" ? payload.candidates.length === 0 : payload.candidates.length > 0) return false;
  if (payload.status === "AMBIGUOUS_SKU" && payload.sku_status !== "ambiguous") return false;
  if (payload.sku_status === "ambiguous" && payload.status !== "AMBIGUOUS_SKU") return false;
  if (payload.candidates.length > 0 && payload.catalog_snapshot_id === null) return false;

  const candidatesByProduct = new Map<string, string[]>();
  const seenVariantIds = new Set<string>();
  for (const candidate of payload.candidates) {
    if (candidatesByProduct.has(candidate.product_id) || candidate.variants.length === 0) return false;
    const variantIds = candidate.variants.map((variant) => variant.variant_id);
    if (!hasUniqueStrings(variantIds)) return false;
    for (const variantId of variantIds) {
      if (seenVariantIds.has(variantId)) return false;
      seenVariantIds.add(variantId);
    }
    candidatesByProduct.set(candidate.product_id, variantIds);
  }

  const whitelistByProduct = new Map<string, string[]>();
  for (const entry of payload.whitelist) {
    if (whitelistByProduct.has(entry.product_id) || !hasUniqueStrings(entry.variant_ids)) return false;
    whitelistByProduct.set(entry.product_id, entry.variant_ids);
  }
  if (candidatesByProduct.size !== whitelistByProduct.size) return false;
  for (const [productId, variantIds] of candidatesByProduct) {
    const whitelistedVariantIds = whitelistByProduct.get(productId);
    if (!whitelistedVariantIds || !sameStringSet(variantIds, whitelistedVariantIds)) return false;
  }
  return true;
}

function selectionPairKey(productId: string, variantId: string): string {
  return `${productId}\u0000${variantId}`;
}

function catalogSelectionPayloadIsConsistent(
  payload: CatalogSelectionPayloadResult,
  input: PythonCatalogSelectionInput,
): boolean {
  if (input.catalogSnapshotId !== undefined && payload.catalog_snapshot_id !== input.catalogSnapshotId) return false;

  const requestedByPair = new Map<string, PythonCatalogSelectionInput["items"][number]>();
  const requestedVariantIds = new Set<string>();
  for (const item of input.items) {
    const key = selectionPairKey(item.product_id, item.variant_id);
    if (requestedByPair.has(key) || requestedVariantIds.has(item.variant_id)) return false;
    requestedByPair.set(key, item);
    requestedVariantIds.add(item.variant_id);
  }
  const allowlistByProduct = new Map<string, Set<string>>();
  for (const entry of input.allowlist) {
    const variantIds = allowlistByProduct.get(entry.product_id) ?? new Set<string>();
    for (const variantId of entry.variant_ids) variantIds.add(variantId);
    allowlistByProduct.set(entry.product_id, variantIds);
  }

  const returnedPairs = new Set<string>();
  let total = 0;
  for (const item of payload.validados) {
    const key = selectionPairKey(item.product_id, item.variant_id);
    const requested = requestedByPair.get(key);
    if (!requested || returnedPairs.has(key)) return false;
    if (item.quantity !== requested.quantity) return false;
    if (!allowlistByProduct.get(item.product_id)?.has(item.variant_id)) return false;
    const subtotal = item.unit_price_cop * item.quantity;
    if (!Number.isSafeInteger(subtotal) || item.subtotal_cop !== subtotal) return false;
    total += subtotal;
    if (!Number.isSafeInteger(total)) return false;
    returnedPairs.add(key);
  }
  for (const item of payload.rechazados) {
    const key = selectionPairKey(item.product_id, item.variant_id);
    if (!requestedByPair.has(key) || returnedPairs.has(key)) return false;
    returnedPairs.add(key);
  }
  if (returnedPairs.size !== requestedByPair.size || payload.total_cop !== total) return false;
  if (payload.validados.length > 0 && payload.catalog_snapshot_id === null) return false;

  const expectedStatus = payload.rechazados.length === 0 ? "ok" : payload.validados.length > 0 ? "partial" : "empty";
  return payload.status === expectedStatus;
}

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

export async function llamarPythonEmbedding(
  input: PythonEmbeddingInput,
): Promise<PythonEmbeddingResult> {
  const { text, ...rest } = input;
  const operationPayload = { text, task_type: "RETRIEVAL_QUERY" as const };
  const response = await llamarPythonOperacion(PYTHON_EMBEDDING_PATH, PYTHON_EMBEDDING_SCOPE, {
    ...rest,
    payload: operationPayload,
    operationBody: operationPayload,
  });
  const parsed = embeddingPayloadResultSchema.safeParse(response.payload);
  if (
    !parsed.success
    || parsed.data.model !== PYTHON_EMBEDDING_MODEL
    || parsed.data.dimensions !== PYTHON_EMBEDDING_DIMENSIONS
    || parsed.data.values.length !== PYTHON_EMBEDDING_DIMENSIONS
  ) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  return response.replayed
    ? { ...parsed.data, replayed: true }
    : parsed.data;
}

export async function llamarPythonCatalogSearch(
  input: PythonCatalogSearchInput,
): Promise<PythonCatalogSearchResult> {
  const { message, filters, allowlist, limit = 15, catalogSnapshotId, ...rest } = input;
  const operationBody = {
    schema_version: "catalog-search.v1" as const,
    message,
    filters,
    allowlist,
    limit,
    ...(catalogSnapshotId === undefined ? {} : { catalog_snapshot_id: catalogSnapshotId }),
  };
  const response = await llamarPythonOperacion(PYTHON_CATALOG_SEARCH_PATH, PYTHON_CATALOG_SEARCH_SCOPE, {
    ...rest,
    payload: operationBody,
    operationBody,
    scopes: [PYTHON_CATALOG_SEARCH_SCOPE],
  });
  const parsed = catalogPayloadResultSchema.safeParse(response.payload);
  if (!parsed.success || !catalogSearchPayloadIsConsistent(parsed.data, catalogSnapshotId)) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  return response.replayed
    ? { ...parsed.data, replayed: true }
    : parsed.data;
}

export async function llamarPythonCatalogSelection(
  input: PythonCatalogSelectionInput,
): Promise<PythonCatalogSelectionResult> {
  const { items, allowlist, catalogSnapshotId, ...rest } = input;
  const operationBody = {
    schema_version: "catalog-selection.v1" as const,
    request_id: input.requestId,
    ...(catalogSnapshotId === undefined ? {} : { catalog_snapshot_id: catalogSnapshotId }),
    items,
    allowlist,
  };
  const response = await llamarPythonOperacion(PYTHON_CATALOG_SELECTION_PATH, PYTHON_CATALOG_SELECTION_SCOPE, {
    ...rest,
    payload: operationBody,
    operationBody,
    scopes: [PYTHON_CATALOG_SELECTION_SCOPE],
  });
  const parsed = catalogSelectionPayloadResultSchema.safeParse(response.payload);
  if (!parsed.success || !catalogSelectionPayloadIsConsistent(parsed.data, input)) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  return response.replayed
    ? { ...parsed.data, replayed: true }
    : parsed.data;
}

export async function llamarPythonPlanResolution(
  input: PythonPlanResolutionInput,
): Promise<PythonPlanResolutionResult> {
  const {
    plan,
    allowlist,
    catalogSnapshotId,
    loraVariantIds,
    ...rest
  } = input;
  const operationBody = {
    schema_version: "plan-resolution.v1" as const,
    plan,
    allowlist,
    catalog_snapshot_id: catalogSnapshotId,
    ...(loraVariantIds === undefined ? {} : { lora_variant_ids: loraVariantIds }),
  };
  const response = await llamarPythonOperacion(PYTHON_PLAN_RESOLUTION_PATH, PYTHON_PLAN_RESOLUTION_SCOPE, {
    ...rest,
    payload: operationBody,
    operationBody,
    scopes: [PYTHON_PLAN_RESOLUTION_SCOPE],
  });
  const parsed = PlanResolutionResultV1Schema.safeParse(response.payload);
  if (!parsed.success || !planResolutionPayloadIsConsistent(parsed.data, catalogSnapshotId)) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  return response.replayed
    ? { ...parsed.data, replayed: true }
    : parsed.data;
}

const CATALOG_RECOMMENDATIONS_DEFAULT_LIMIT = 100;

/**
 * Python owns which rows are recommendable; Next only checks that the answer
 * is the one it asked for and cannot widen anything: pinned snapshot and
 * reference echoed, reference excluded, unique ids, bounded by `limit`, and a
 * subset of the LoRA set when one was sent.
 */
function catalogRecommendationsPayloadIsConsistent(
  payload: z.infer<typeof CatalogRecommendationsResultV1Schema>,
  input: { referenceVariantId: string; catalogSnapshotId: string; loraVariantIds?: readonly string[]; limit: number },
): boolean {
  if (payload.catalog_snapshot_id !== input.catalogSnapshotId) return false;
  if (payload.reference.variant_id !== input.referenceVariantId) return false;
  const lora = input.loraVariantIds === undefined ? null : new Set(input.loraVariantIds);
  const productIds = new Set<string>();
  const variantIds = new Set<string>();
  for (const candidate of payload.candidates) {
    if (productIds.has(candidate.product_id)) return false;
    productIds.add(candidate.product_id);
    for (const variant of candidate.variants) {
      if (variant.variant_id === input.referenceVariantId || variantIds.has(variant.variant_id)) return false;
      if (lora && !lora.has(variant.variant_id)) return false;
      variantIds.add(variant.variant_id);
    }
  }
  return variantIds.size <= input.limit;
}

export async function llamarPythonCatalogRecommendations(
  input: PythonCatalogRecommendationsInput,
): Promise<PythonCatalogRecommendationsResult> {
  const { referenceVariantId, catalogSnapshotId, loraVariantIds, limit = CATALOG_RECOMMENDATIONS_DEFAULT_LIMIT, ...rest } = input;
  const operationBody = {
    schema_version: CATALOG_RECOMMENDATIONS_CONTRACT_VERSION,
    catalog_snapshot_id: catalogSnapshotId,
    reference_variant_id: referenceVariantId,
    ...(loraVariantIds === undefined ? {} : { lora_variant_ids: [...loraVariantIds] }),
    limit,
  };
  const response = await llamarPythonOperacion(PYTHON_CATALOG_RECOMMENDATIONS_PATH, PYTHON_CATALOG_RECOMMENDATIONS_SCOPE, {
    ...rest,
    payload: operationBody,
    operationBody,
    scopes: [PYTHON_CATALOG_RECOMMENDATIONS_SCOPE],
  });
  const parsed = CatalogRecommendationsResultV1Schema.safeParse(response.payload);
  if (
    !parsed.success
    || !catalogRecommendationsPayloadIsConsistent(parsed.data, { referenceVariantId, catalogSnapshotId, loraVariantIds, limit })
  ) {
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
