import {
  DEADLINE_DEFAULT_MS,
  DEADLINE_MAX_MS,
  InternalRequestSignatureV1Schema,
  OperationalContextV1Schema,
  crearDeadlineSignal,
  firmarRequestInterna,
  sha256Body,
} from "@/lib/ia/contracts/operational-v1";
import {
  CATALOG_RECOMMENDATIONS_CONTRACT_VERSION,
  CatalogRecommendationsResultV1Schema,
  PlanResolutionResultV1Schema,
} from "@/lib/ia/contracts/domain-v1";
import type { EdicionPlan } from "@/lib/plan/edicion-esquemas";
import {
  MODOS_PATRON_COLOR,
  PatronColorResueltoSchema,
  type PatronColor,
  type PatronColorResuelto,
  type PistaPatron,
} from "@/lib/plan/patron-color";
import { PlanDecoracionSchema, type PlanDecoracion } from "@/lib/plan/tipos";
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
export const PYTHON_INTENT_PARSE_PATH = "/internal/v1/ia/intent-parse";
export const PYTHON_INTENT_PARSE_SCOPE = "ia.intent_parse";
export const PYTHON_HAPPIE_GENERATE_PATH = "/internal/v1/ia/happie-generate";
export const PYTHON_HAPPIE_GENERATE_SCOPE = "ia.happie_generate";
export const PYTHON_REFERENCE_TURN_PATH = "/internal/v1/ia/reference-turn";
export const PYTHON_REFERENCE_TURN_SCOPE = "ia.reference_turn";
export const PYTHON_IMAGE_GENERATE_PATH = "/internal/v1/ia/image-generate";
export const PYTHON_IMAGE_GENERATE_SCOPE = "ia.image_generate";
export const PYTHON_LORA_GENERATE_PATH = "/internal/v1/ia/lora-generate";
export const PYTHON_LORA_GENERATE_SCOPE = "ia.lora_generate";
export const PYTHON_CHAT_TURN_STREAM_PATH = "/internal/v1/ia/chat-turn-stream";
export const PYTHON_CHAT_TURN_STREAM_SCOPE = "ia.chat_turn_stream";
export const PYTHON_PATRON_REFERENCIA_PATH = "/internal/v1/ia/patron-referencia";
export const PYTHON_PATRON_REFERENCIA_SCOPE = "ia.patron_referencia";
export const PYTHON_PLAN_EDIT_PATH = "/internal/v1/plan/edit";
export const PYTHON_PLAN_EDIT_SCOPE = "plan.edit";
export const PYTHON_PLAN_PATRON_PATH = "/internal/v1/plan/patron";
export const PYTHON_PLAN_PATRON_SCOPE = "plan.patron";
export const PYTHON_EMBEDDING_MODEL = "gemini-embedding-2";
export const PYTHON_EMBEDDING_DIMENSIONS = 768;
export const PYTHON_MAX_BODY_BYTES = 64 * 1024;
/** Reference-image analysis (Amaterasu) only -- same 10MB cap Next already enforces client-side (LIMITE_CUERPO_ANALISIS_BYTES in analisis-http.ts). */
export const PYTHON_MAX_BODY_BYTES_IMAGENES = 11 * 1024 * 1024;
/** Omoikane's chat turn only -- just above the 25_000_000-byte body /api/chat/route.ts already accepts from the browser, so the same photos fit on the Next -> Python hop. */
export const PYTHON_MAX_BODY_BYTES_CHAT = 25 * 1024 * 1024;
/** Happie's package recommendation only -- it carries the active Happia catalog as JSON text (MAX_BODY_BYTES_HAPPIE in main.py). */
export const PYTHON_MAX_BODY_BYTES_HAPPIE = 4 * 1024 * 1024;

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

/**
 * Stable domain error codes reported by POST /internal/v1/plan/edit
 * (services/ai-api/app/plan_edicion.py, ADR-0028 §9). They keep Python's HTTP
 * status (404, 409, 400 or 422), so they do not all classify as
 * PYTHON_INVALID_REQUEST: callers branch on `domainCode`. `patron_invalido`
 * carries `domainDetails` (structure, stable `motivo`, Spanish `mensaje`).
 */
export const PYTHON_PLAN_EDIT_DOMAIN_CODES = [
  "estructura_no_encontrada",
  "variante_objetivo_no_encontrada",
  "reparto_no_corresponde",
  "material_no_editable",
  "unico_material",
  "sin_participacion",
  "patron_activo",
  "patron_invalido",
  "invalid_plan",
] as const;
export type PythonPlanEditDomainCode = (typeof PYTHON_PLAN_EDIT_DOMAIN_CODES)[number];

/** Stable domain error codes reported by POST /internal/v1/plan/patron (ADR-0028 §10). */
export const PYTHON_PLAN_PATRON_DOMAIN_CODES = ["estructura_no_encontrada", "patron_invalido", "invalid_plan"] as const;
export type PythonPlanPatronDomainCode = (typeof PYTHON_PLAN_PATRON_DOMAIN_CODES)[number];

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

/**
 * Generic passthrough for a domain error's original provider status/detail
 * (Kagutsuchi's account-rejected fal.ai responses -- see
 * ProveedorImagenNoDisponibleError in kagutsuchi/sempertex-lora.ts, which
 * needs the real 401/402/403 fal returned, not the boundary's own 502/503).
 * Not specific to one operation: any future domain error can populate these
 * two fields the same way Python's `_detail_metadata` already does.
 */
function upstreamProviderStatus(value: unknown): number | undefined {
  if (!isJsonObject(value) || !isJsonObject(value.detail)) return undefined;
  const parsed = z.number().int().positive().safeParse(value.detail.provider_status);
  return parsed.success ? parsed.data : undefined;
}

function upstreamProviderDetail(value: unknown): string | undefined {
  if (!isJsonObject(value) || !isJsonObject(value.detail)) return undefined;
  const parsed = z.string().min(1).safeParse(value.detail.provider_detail);
  return parsed.success ? parsed.data : undefined;
}

/**
 * What a domain error says next to its code (Python's `_detail_metadata`):
 * `patron_invalido` names the structure, a stable rule and a Spanish sentence
 * for the decorator. Written by the domain, never echoed from the request.
 */
export interface PythonDomainDetails {
  estructuraId?: string;
  motivo?: string;
  mensaje?: string;
}

function upstreamDomainDetails(value: unknown): PythonDomainDetails | undefined {
  if (!isJsonObject(value) || !isJsonObject(value.detail)) return undefined;
  const detail = value.detail;
  const texto = (campo: unknown, maximo: number): string | undefined => {
    const parsed = z.string().trim().min(1).max(maximo).safeParse(campo);
    return parsed.success ? parsed.data : undefined;
  };
  const estructuraId = texto(detail.estructura_id, 160);
  const motivo = texto(detail.motivo, 64);
  const mensaje = texto(detail.mensaje, 400);
  if (estructuraId === undefined && motivo === undefined && mensaje === undefined) return undefined;
  return {
    ...(estructuraId === undefined ? {} : { estructuraId }),
    ...(motivo === undefined ? {} : { motivo }),
    ...(mensaje === undefined ? {} : { mensaje }),
  };
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
  /** See upstreamProviderStatus/upstreamProviderDetail above. */
  readonly providerStatus?: number;
  readonly providerDetail?: string;
  /** See upstreamDomainDetails above. */
  readonly domainDetails?: PythonDomainDetails;

  constructor(input: {
    code: PythonAdapterErrorCode;
    status: number;
    requestId: string;
    correlationId: string;
    attempts?: PythonEmbeddingAttempt[];
    domainCode?: string;
    providerStatus?: number;
    providerDetail?: string;
    domainDetails?: PythonDomainDetails;
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
    this.providerStatus = input.providerStatus;
    this.providerDetail = input.providerDetail;
    this.domainDetails = input.domainDetails;
  }
}

export function isPythonAdapterError(error: unknown): error is PythonAdapterError {
  return error instanceof PythonAdapterError;
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
  /** Overrides PYTHON_MAX_BODY_BYTES for one call (Amaterasu's reference images). */
  maxBodyBytes?: number;
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
  providerStatus?: number,
  providerDetail?: string,
  domainDetails?: PythonDomainDetails,
): PythonAdapterError {
  return new PythonAdapterError({ code, status, requestId, correlationId, attempts, domainCode, providerStatus, providerDetail, domainDetails });
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
  const providerStatus = upstreamProviderStatus(body);
  const providerDetail = upstreamProviderDetail(body);
  const domainDetails = upstreamDomainDetails(body);
  // The upstream domain code travels on the error so a caller can tell apart
  // failures that all classify as the same transport outcome (see
  // PythonAdapterError.domainCode).
  const upstream = (adapterCode: PythonAdapterErrorCode, adapterStatus: number): PythonAdapterError =>
    errorFor(adapterCode, adapterStatus, requestId, correlationId, attempts, code, providerStatus, providerDetail, domainDetails);
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

type DeadlinePython = ReturnType<typeof crearDeadlineSignal>;

interface PeticionPythonAbierta {
  response: Response;
  requestId: string;
  correlationId: string;
  /** Owned by the caller from here on: it must `dispose()` it once the body is consumed. */
  deadline: DeadlinePython;
}

function normalizarErrorPython(error: unknown, requestId: string, correlationId: string): PythonAdapterError {
  if (error instanceof PythonAdapterError) return error;
  if (error instanceof z.ZodError) return errorFor("PYTHON_INVALID_REQUEST", 422, requestId, correlationId);
  return errorFor("PYTHON_UNAVAILABLE", 502, requestId, correlationId);
}

/** Maps a failure while the request or its body was in flight, once the deadline signal may have fired. */
function errorDeTransporte(error: unknown, deadline: DeadlinePython, requestId: string, correlationId: string): PythonAdapterError {
  if (deadline.wasDeadlineExceeded()) return errorFor("PYTHON_BACKEND_TIMEOUT", 504, requestId, correlationId);
  if (deadline.signal.aborted) return errorFor("PYTHON_REQUEST_CANCELLED", 499, requestId, correlationId);
  if (error instanceof PythonAdapterError) return error;
  return errorFor("PYTHON_UNAVAILABLE", 502, requestId, correlationId);
}

/**
 * Shared Next -> Python boundary for every /internal/v1/* operation: HMAC
 * signing, deadline, nonce, idempotency headers and upstream error mapping
 * are identical across operations. Only `path` (which endpoint) and the
 * default `scope` (when the caller does not pass explicit scopes) vary.
 * Returns only OK responses; how the body is read (one JSON envelope, or an
 * NDJSON stream) is the caller's.
 */
async function abrirPeticionPython(
  path: string,
  defaultScope: string,
  input: PythonOperationInput,
): Promise<PeticionPythonAbierta> {
  const requestId = z.string().uuid().parse(input.requestId);
  const correlationId = z.string().uuid().parse(input.correlationId);
  const env = input.env ?? process.env;
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
    const maxBodyBytes = input.maxBodyBytes ?? PYTHON_MAX_BODY_BYTES;
    if (new TextEncoder().encode(body).byteLength > maxBodyBytes) {
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
      throw errorDeTransporte(error, deadline, requestId, correlationId);
    }

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = undefined;
      }
      throw mapUpstreamError(response.status, errorBody, requestId, correlationId);
    }
    return { response, requestId, correlationId, deadline };
  } catch (error) {
    deadline.dispose();
    throw normalizarErrorPython(error, requestId, correlationId);
  }
}

async function llamarPythonOperacion(
  path: string,
  defaultScope: string,
  input: PythonOperationInput,
): Promise<PythonOperationResponse> {
  const { response, requestId, correlationId, deadline } = await abrirPeticionPython(path, defaultScope, input);
  try {
    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      responseBody = undefined;
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
    throw normalizarErrorPython(error, requestId, correlationId);
  } finally {
    deadline.dispose();
  }
}

/**
 * Streaming counterpart of `llamarPythonOperacion`: same signing and error
 * mapping, then yields each NDJSON line of the body as parsed JSON (not yet
 * validated -- that belongs to the operation). Returning early (the consumer
 * stopped, or the terminal event arrived) cancels the body reader, which
 * closes the connection; Python sees the disconnect and closes the provider
 * stream.
 */
async function* leerPythonNdjson(
  path: string,
  defaultScope: string,
  input: PythonOperationInput,
): AsyncGenerator<unknown, void, undefined> {
  const { response, requestId, correlationId, deadline } = await abrirPeticionPython(path, defaultScope, input);
  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.body || !contentType.startsWith("application/x-ndjson")) {
      throw errorFor("PYTHON_INVALID_RESPONSE", 502, requestId, correlationId);
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    const parsear = (linea: string): unknown => {
      try {
        return JSON.parse(linea) as unknown;
      } catch {
        throw errorFor("PYTHON_INVALID_RESPONSE", 502, requestId, correlationId);
      }
    };
    try {
      let pendiente = "";
      while (true) {
        let lectura: ReadableStreamReadResult<string>;
        try {
          lectura = await reader.read();
        } catch (error) {
          throw errorDeTransporte(error, deadline, requestId, correlationId);
        }
        if (lectura.done) break;
        pendiente += lectura.value;
        let salto = pendiente.indexOf("\n");
        while (salto >= 0) {
          const linea = pendiente.slice(0, salto).trim();
          pendiente = pendiente.slice(salto + 1);
          if (linea) yield parsear(linea);
          salto = pendiente.indexOf("\n");
        }
      }
      if (pendiente.trim()) yield parsear(pendiente.trim());
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  } catch (error) {
    throw normalizarErrorPython(error, requestId, correlationId);
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

export interface PythonIntentParseInput {
  message: string;
  systemInstruction: string;
  /** `z.toJSONSchema(IntentQuerySchema, { target: "draft-7" })` -- Python stays schema-agnostic and just forwards this to Gemini. */
  responseJsonSchema: Record<string, unknown>;
  model?: string;
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  idempotencyKey?: string;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonIntentParseUsage {
  prompt_token_count?: number;
  candidates_token_count?: number;
  thoughts_token_count?: number;
  cached_content_token_count?: number;
  total_token_count?: number;
}

export interface PythonIntentParseResult {
  text: string;
  model: string;
  usage: PythonIntentParseUsage | null;
  replayed?: boolean;
}

export type PythonHappieGeneratePurpose = "conversation_extract" | "package_recommend";

export interface PythonHappieGenerateInput {
  purpose: PythonHappieGeneratePurpose;
  /** Text parts of the single user message, in order. */
  parts: string[];
  systemInstruction: string;
  /** Already adapted with `paraGoogleSchema`; Python forwards it to Gemini untouched. */
  responseJsonSchema: Record<string, unknown>;
  model?: string;
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonHappieGenerateUsage extends PythonIntentParseUsage {
  tool_use_prompt_token_count?: number;
}

export interface PythonHappieGenerateResult {
  text: string;
  model: string;
  usage: PythonHappieGenerateUsage | null;
}

export interface PythonReferenceTurnImage {
  id: string;
  mime: "image/png" | "image/jpeg" | "image/webp";
  base64: string;
  descripcion?: string;
}

export interface PythonReferenceTurnTool {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

export interface PythonReferenceTurnInput {
  systemInstruction: string;
  message: string;
  images: PythonReferenceTurnImage[];
  tools: PythonReferenceTurnTool[];
  temperature?: number;
  maxOutputTokens?: number;
  model?: string;
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  idempotencyKey?: string;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonReferenceTurnToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface PythonReferenceTurnResult {
  text: string;
  toolCalls: PythonReferenceTurnToolCall[];
  model: string;
  usage: PythonIntentParseUsage | null;
  finishReason: string | null;
  blockReason: string | null;
  replayed?: boolean;
}

/** A balloon structure the reference analysis found in one photo. */
export interface PythonPatronReferenciaElemento {
  elementId: string;
  /** Plan structure type (`visual_semantics.structure_type`) or "desconocido"; context for the model only. */
  tipo: string;
  bbox?: { x: number; y: number; width: number; height: number };
  coloresObservados: string[];
}

export interface PythonPatronReferenciaInput {
  imagen: { mimeType: "image/png" | "image/jpeg" | "image/webp"; dataBase64: string };
  /** 1..12, unique ids, all from the same photo as `imagen`. */
  elementos: PythonPatronReferenciaElemento[];
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

/** One hint as Python validated it; "ninguno" carries no colors. */
export type PythonPatronReferenciaPista = z.infer<typeof patronReferenciaPistaSchema>;

export interface PythonPatronReferenciaResult {
  pistas: PythonPatronReferenciaPista[];
  modelo: string;
  promptVersion: string;
  usage: PythonIntentParseUsage | null;
  replayed?: boolean;
}

export type PythonImageGenerateInputBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: "image/png" | "image/jpeg" | "image/webp" };

export interface PythonImageGenerateInput {
  model?: string;
  input: PythonImageGenerateInputBlock[];
  store?: boolean;
  previousInteractionId?: string;
  aspectRatio: "1:1" | "2:3" | "3:2" | "16:9";
  imageSize: "1K" | "2K";
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  idempotencyKey?: string;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonImageGenerateUsage {
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_thought_tokens?: number;
  total_cached_tokens?: number;
  total_tool_use_tokens?: number;
  total_tokens?: number;
}

export interface PythonImageGenerateResult {
  imageBase64: string;
  model: string;
  interactionId: string | null;
  usage: PythonImageGenerateUsage | null;
  replayed?: boolean;
}

export interface PythonLoraSpec {
  path: string;
  scale: number;
}

export interface PythonLoraGenerateInput {
  mode: "text" | "edit";
  prompt: string;
  loras: PythonLoraSpec[];
  guidanceScale: number;
  numInferenceSteps: number;
  imageWidth: number;
  imageHeight: number;
  seed?: number;
  /** `data:<mime>;base64,<...>` strings, already built by referenciasParaLoraEdit's caller -- empty for mode "text". */
  imageDataUrls: string[];
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  idempotencyKey?: string;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonLoraGenerateResult {
  imageBase64: string;
  mime: string;
  providerRequestId: string | null;
  endpoint: string;
  replayed?: boolean;
}

export interface PythonChatTurnTool {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

/**
 * No `idempotencyKey`: the Python route rejects one, because replaying a
 * streamed turn would repeat text the customer already saw and a provider
 * charge (see `_handle_operational_stream` in services/ai-api/app/main.py).
 */
export interface PythonChatTurnStreamInput {
  systemInstruction: string;
  /** Gemini `Content` JSON exactly as `historialAContents` (agente-core) builds it. */
  contents: unknown[];
  tools: PythonChatTurnTool[];
  thinkingLevel?: "low" | "minimal";
  temperature?: number;
  maxOutputTokens?: number;
  model?: string;
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
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
  color_substitutions?: Array<{ pedido: string; entregado: string }>;
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
  /** Absent unless the caller passes it: every other request stays byte-identical (ADR-0028 §7). */
  completarPatrones?: boolean;
  pistasPatron?: PistaPatron[];
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

/** A resolved line of the edited structure, as the verified base resolution printed it. */
export interface PythonPlanEditLineaBase {
  product_id: string;
  variant_id: string;
  color: string | null;
}

export interface PythonPlanEditInput {
  plan: PlanDecoracion;
  lineasBase: ReadonlyArray<{ estructura_id: string; lineas: readonly PythonPlanEditLineaBase[] }>;
  edicion: EdicionPlan;
  /** Real colors of the variant admitted for "agregar"/"reemplazar"; empty otherwise. */
  coloresVariante: readonly string[];
  /** `PATRONES_COLOR_V1`: a piece going from one color to two gets its preset pattern. */
  completarPatrones: boolean;
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonPlanEditResult {
  plan: PlanDecoracion;
  /** Sentences for the decorator (e.g. "El patrón se rehízo porque quitaste un color."). */
  avisos: string[];
  replayed?: boolean;
}

export interface PythonPlanPatronInput {
  plan: PlanDecoracion;
  estructuraId: string;
  /** `null` asks for the suggested pattern of a structure. */
  patronColor: PatronColor | null;
  requestId: string;
  correlationId: string;
  deadlineMs?: number;
  parentSignal?: AbortSignal;
  env?: AdapterEnvironment;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}

export interface PythonPlanPatronResult {
  patron: PatronColorResuelto;
  replayed?: boolean;
}

const rerankPayloadResultSchema = z.object({
  order: z.array(z.string().min(1)),
  scores: z.record(z.string().min(1), z.number().finite()),
});

const intentParseUsageSchema = z.object({
  prompt_token_count: z.number().int().nonnegative().optional(),
  candidates_token_count: z.number().int().nonnegative().optional(),
  thoughts_token_count: z.number().int().nonnegative().optional(),
  cached_content_token_count: z.number().int().nonnegative().optional(),
  total_token_count: z.number().int().nonnegative().optional(),
}).strict();

const intentParsePayloadResultSchema = z.object({
  text: z.string().min(1),
  model: z.string().min(1),
  usage: intentParseUsageSchema.nullable(),
}).strict();

const happieGeneratePayloadResultSchema = z.object({
  text: z.string().min(1),
  model: z.string().min(1),
  usage: intentParseUsageSchema.extend({
    tool_use_prompt_token_count: z.number().int().nonnegative().optional(),
  }).strict().nullable(),
}).strict();

const referenceTurnToolCallSchema = z.object({
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
}).strict();

const referenceTurnPayloadResultSchema = z.object({
  text: z.string(),
  tool_calls: z.array(referenceTurnToolCallSchema),
  model: z.string().min(1),
  usage: intentParseUsageSchema.nullable(),
  finish_reason: z.string().nullable(),
  block_reason: z.string().nullable(),
}).strict();

// Local contract (ADR-0026 §3): the Pydantic side is
// services/ai-api/app/amaterasu/patron_referencia.py, which owns the prompt,
// the palette and the validation of the provider output.
const patronReferenciaPistaSchema = z.object({
  element_id: z.string().min(1).max(80),
  modo: z.enum([...MODOS_PATRON_COLOR, "ninguno"]),
  colores: z.array(z.string().min(1).max(80)).max(12),
  globos_por_racimo: z.number().int().min(1).max(8).optional(),
  pesos: z.array(z.number().int().min(1).max(100)).max(12).optional(),
  confianza: z.number().min(0).max(1),
}).strict();

const patronReferenciaPayloadResultSchema = z.object({
  operation_schema_version: z.literal("patron-referencia-result.v1"),
  pistas: z.array(patronReferenciaPistaSchema).max(12),
  modelo: z.string().min(1),
  prompt_version: z.string().min(1),
  usage: intentParseUsageSchema.extend({
    tool_use_prompt_token_count: z.number().int().nonnegative().optional(),
  }).strict().nullable(),
}).strict();

/** Hints only for elements that were asked about, once each; only "ninguno" may come without colors. */
function patronReferenciaPayloadIsConsistent(
  payload: z.infer<typeof patronReferenciaPayloadResultSchema>,
  elementIds: readonly string[],
): boolean {
  const pedidos = new Set(elementIds);
  const vistos = new Set<string>();
  for (const pista of payload.pistas) {
    if (!pedidos.has(pista.element_id) || vistos.has(pista.element_id)) return false;
    if (pista.modo !== "ninguno" && pista.colores.length === 0) return false;
    if (pista.pesos !== undefined && pista.pesos.length !== pista.colores.length) return false;
    vistos.add(pista.element_id);
  }
  return true;
}

// Local contracts (ADR-0026 §3) of the plan editor, owned by the Pydantic
// models in services/ai-api/app/plan_edicion.py (ADR-0028 §9, §10). The plan
// is validated with the same Zod owner as every other plan (`tipos.ts`), which
// also checks what JSON Schema cannot (shares that add up to 1).
const planEditPayloadResultSchema = z.object({
  operation_schema_version: z.literal("plan-edit-result.v1"),
  plan: PlanDecoracionSchema,
  avisos: z.array(z.string().min(1).max(400)).max(8),
}).strict();

/** The edit touches one plan: same id and the same structures, in the same order. */
function planEditPayloadIsConsistent(plan: PlanDecoracion, pedido: PlanDecoracion): boolean {
  return plan.plan_id === pedido.plan_id
    && plan.estructuras.length === pedido.estructuras.length
    && plan.estructuras.every((estructura, indice) => estructura.estructura_id === pedido.estructuras[indice]!.estructura_id);
}

const planPatronPayloadResultSchema = z.object({
  operation_schema_version: z.literal("plan-patron-result.v1"),
  patron: PatronColorResueltoSchema,
}).strict();

const imageGenerateUsageSchema = z.object({
  total_input_tokens: z.number().int().nonnegative().optional(),
  total_output_tokens: z.number().int().nonnegative().optional(),
  total_thought_tokens: z.number().int().nonnegative().optional(),
  total_cached_tokens: z.number().int().nonnegative().optional(),
  total_tool_use_tokens: z.number().int().nonnegative().optional(),
  total_tokens: z.number().int().nonnegative().optional(),
}).strict();

const imageGeneratePayloadResultSchema = z.object({
  image_base64: z.string().min(1),
  model: z.string().min(1),
  interaction_id: z.string().nullable(),
  usage: imageGenerateUsageSchema.nullable(),
}).strict();

const chatTurnStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), delta: z.string().min(1) }).strict(),
  z.object({
    type: z.literal("end"),
    text: z.string(),
    tool_calls: z.array(z.object({
      id: z.string().min(1).nullable(),
      name: z.string().min(1),
      args: z.record(z.string(), z.unknown()),
      thought_signature: z.string().min(1).nullable(),
    }).strict()),
    usage_metadata: z.record(z.string(), z.number().int().nonnegative()),
    model: z.string().min(1),
    finish_reason: z.string().nullable(),
    block_reason: z.string().nullable(),
  }).strict(),
  z.object({
    type: z.literal("error"),
    code: z.string().min(1),
    /** "open": nothing reached the provider's output yet, so the turn may be retried. */
    phase: z.enum(["open", "stream"]),
    provider_status: z.number().int().positive().nullable().optional(),
    provider_message: z.string().nullable().optional(),
  }).strict(),
]);

export type PythonChatTurnStreamEvent = z.infer<typeof chatTurnStreamEventSchema>;

const loraGeneratePayloadResultSchema = z.object({
  image_base64: z.string().min(1),
  mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
  provider_request_id: z.string().min(1).nullable(),
  endpoint: z.string().min(1),
}).strict();

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

const catalogColorSubstitutionSchema = z.object({
  pedido: z.string().min(1),
  entregado: z.string().min(1),
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
  // A requested color the active snapshot does not stock, resolved by Python
  // to the nearest one it has (catalog.py, x-tonos-colores-catalogo). Optional:
  // every mock payload in the test scripts predates this field.
  color_substitutions: z.array(catalogColorSubstitutionSchema).optional(),
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

  // Identity only: every requested pair comes back exactly once, validated
  // lines stay inside the signed allowlist with the requested quantity. The
  // subtotal, total and status are Python's (catalog.py) and are not
  // recomputed here -- re-deriving a formula to compare it would make Next a
  // second owner (AGENTS.md, the `validateMaterialEstimate` incident).
  const returnedPairs = new Set<string>();
  for (const item of payload.validados) {
    const key = selectionPairKey(item.product_id, item.variant_id);
    const requested = requestedByPair.get(key);
    if (!requested || returnedPairs.has(key)) return false;
    if (item.quantity !== requested.quantity) return false;
    if (!allowlistByProduct.get(item.product_id)?.has(item.variant_id)) return false;
    returnedPairs.add(key);
  }
  for (const item of payload.rechazados) {
    const key = selectionPairKey(item.product_id, item.variant_id);
    if (!requestedByPair.has(key) || returnedPairs.has(key)) return false;
    returnedPairs.add(key);
  }
  if (returnedPairs.size !== requestedByPair.size) return false;
  return !(payload.validados.length > 0 && payload.catalog_snapshot_id === null);
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

/**
 * The one Gemini call Inari's parser makes (src/lib/ia/inari/parse.ts). Python
 * receives the already-built prompt and JSON schema and does nothing but the
 * provider round trip -- the deterministic-first parse and the merge of local
 * and remote results stay in TypeScript, unchanged.
 */
export async function llamarPythonIntentParse(
  input: PythonIntentParseInput,
): Promise<PythonIntentParseResult> {
  const { message, systemInstruction, responseJsonSchema, model, ...rest } = input;
  const operationPayload = {
    schema_version: "intent-parse.v1" as const,
    message,
    system_instruction: systemInstruction,
    response_json_schema: responseJsonSchema,
    ...(model === undefined ? {} : { model }),
  };
  const response = await llamarPythonOperacion(PYTHON_INTENT_PARSE_PATH, PYTHON_INTENT_PARSE_SCOPE, {
    ...rest,
    payload: operationPayload,
    operationBody: operationPayload,
  });
  const parsed = intentParsePayloadResultSchema.safeParse(response.payload);
  if (!parsed.success) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  return response.replayed
    ? { ...parsed.data, replayed: true }
    : parsed.data;
}

/**
 * One of Happie's two structured-output Gemini calls: the conversation
 * extractor (src/lib/happie/conversacion-webhook.ts) or the package
 * recommender (packages/happie-package-ia, through the generator the app
 * injects). Python only makes the provider round trip; prompts, the state
 * machine, the package id filter and the Zod validation stay in TypeScript.
 * No idempotency key: the call has no side effect to reconcile, and the
 * direct path never retried it either.
 */
export async function llamarPythonHappieGenerate(
  input: PythonHappieGenerateInput,
): Promise<PythonHappieGenerateResult> {
  const { purpose, parts, systemInstruction, responseJsonSchema, model, ...rest } = input;
  const operationPayload = {
    schema_version: "happie-generate.v1" as const,
    purpose,
    parts,
    system_instruction: systemInstruction,
    response_json_schema: responseJsonSchema,
    ...(model === undefined ? {} : { model }),
  };
  const response = await llamarPythonOperacion(PYTHON_HAPPIE_GENERATE_PATH, PYTHON_HAPPIE_GENERATE_SCOPE, {
    ...rest,
    payload: operationPayload,
    operationBody: operationPayload,
    maxBodyBytes: PYTHON_MAX_BODY_BYTES_HAPPIE,
  });
  const parsed = happieGeneratePayloadResultSchema.safeParse(response.payload);
  if (!parsed.success) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  return parsed.data;
}

/**
 * The one Gemini tool-calling turn Amaterasu's inventory and audit passes
 * make (src/lib/ia/amaterasu/analizar-referencias-v2.ts, via the ChatPort
 * `src/lib/ia/amaterasu/chat-python.ts` wraps around this). Python only makes
 * the provider round trip; the retry-on-malformed loop, the blueprint
 * assembly and everything else stays in TypeScript, unchanged. Uses
 * `maxBodyBytes: PYTHON_MAX_BODY_BYTES_IMAGENES` since reference photos are
 * far larger than every other operation's payload.
 */
export async function llamarPythonReferenceTurn(
  input: PythonReferenceTurnInput,
): Promise<PythonReferenceTurnResult> {
  const { systemInstruction, message, images, tools, temperature, maxOutputTokens, model, ...rest } = input;
  const operationPayload = {
    schema_version: "reference-turn.v1" as const,
    system_instruction: systemInstruction,
    message,
    images: images.map((image) => ({ id: image.id, mime: image.mime, base64: image.base64, descripcion: image.descripcion ?? "" })),
    tools: tools.map((tool) => ({ name: tool.name, description: tool.description, parameters_json_schema: tool.parametersJsonSchema })),
    ...(temperature === undefined ? {} : { temperature }),
    ...(maxOutputTokens === undefined ? {} : { max_output_tokens: maxOutputTokens }),
    ...(model === undefined ? {} : { model }),
  };
  const response = await llamarPythonOperacion(PYTHON_REFERENCE_TURN_PATH, PYTHON_REFERENCE_TURN_SCOPE, {
    ...rest,
    payload: operationPayload,
    operationBody: operationPayload,
    maxBodyBytes: PYTHON_MAX_BODY_BYTES_IMAGENES,
  });
  const parsed = referenceTurnPayloadResultSchema.safeParse(response.payload);
  if (!parsed.success) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  const result: PythonReferenceTurnResult = {
    text: parsed.data.text,
    toolCalls: parsed.data.tool_calls,
    model: parsed.data.model,
    usage: parsed.data.usage,
    finishReason: parsed.data.finish_reason,
    blockReason: parsed.data.block_reason,
  };
  return response.replayed ? { ...result, replayed: true } : result;
}

/**
 * Reads the color pattern of each balloon structure in one reference photo
 * (docs/architecture/decisions/0028 §11). Unlike the reference turn, Python
 * owns everything here -- prompt, palette, response schema and validation of
 * the provider output; this only transports the photo and the elements the
 * analysis already found, and checks the answer is about those elements. No
 * idempotency key and no retry: the call has no side effect and the caller
 * continues without hints on any failure.
 */
export async function llamarPythonPatronReferencia(
  input: PythonPatronReferenciaInput,
): Promise<PythonPatronReferenciaResult> {
  const { imagen, elementos, ...rest } = input;
  const operationPayload = {
    schema_version: "patron-referencia.v1" as const,
    imagen: { mime_type: imagen.mimeType, data_base64: imagen.dataBase64 },
    elementos: elementos.map((elemento) => ({
      element_id: elemento.elementId,
      tipo: elemento.tipo,
      ...(elemento.bbox === undefined ? {} : { bbox: elemento.bbox }),
      colores_observados: elemento.coloresObservados,
    })),
  };
  const response = await llamarPythonOperacion(PYTHON_PATRON_REFERENCIA_PATH, PYTHON_PATRON_REFERENCIA_SCOPE, {
    ...rest,
    payload: operationPayload,
    operationBody: operationPayload,
    maxBodyBytes: PYTHON_MAX_BODY_BYTES_IMAGENES,
  });
  const parsed = patronReferenciaPayloadResultSchema.safeParse(response.payload);
  if (!parsed.success || !patronReferenciaPayloadIsConsistent(parsed.data, elementos.map((elemento) => elemento.elementId))) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  const result: PythonPatronReferenciaResult = {
    pistas: parsed.data.pistas,
    modelo: parsed.data.modelo,
    promptVersion: parsed.data.prompt_version,
    usage: parsed.data.usage,
  };
  return response.replayed ? { ...result, replayed: true } : result;
}

/**
 * The one Gemini Interactions call `crearImagenGemini`'s `generar()` makes
 * (src/lib/ia/uzume/imagen.ts, via the ImagenPort
 * src/lib/ia/uzume/imagen-python.ts wraps around this). `input` travels
 * already fully composed (prompt + per-image role/allowed_use labels) --
 * Python never decides what a reference image is for, only sends it. Uses
 * `maxBodyBytes: PYTHON_MAX_BODY_BYTES_IMAGENES` since reference/product
 * images are far larger than every other operation's payload.
 */
export async function llamarPythonImageGenerate(
  input: PythonImageGenerateInput,
): Promise<PythonImageGenerateResult> {
  const { model, input: blocks, store, previousInteractionId, aspectRatio, imageSize, ...rest } = input;
  const operationPayload = {
    schema_version: "image-generate.v1" as const,
    input: blocks.map((block) => block.type === "text"
      ? { type: "text" as const, text: block.text }
      : { type: "image" as const, data: block.data, mime_type: block.mimeType }),
    store: store ?? true,
    ...(previousInteractionId === undefined ? {} : { previous_interaction_id: previousInteractionId }),
    aspect_ratio: aspectRatio,
    image_size: imageSize,
    ...(model === undefined ? {} : { model }),
  };
  const response = await llamarPythonOperacion(PYTHON_IMAGE_GENERATE_PATH, PYTHON_IMAGE_GENERATE_SCOPE, {
    ...rest,
    payload: operationPayload,
    operationBody: operationPayload,
    maxBodyBytes: PYTHON_MAX_BODY_BYTES_IMAGENES,
  });
  const parsed = imageGeneratePayloadResultSchema.safeParse(response.payload);
  if (!parsed.success) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  const result: PythonImageGenerateResult = {
    imageBase64: parsed.data.image_base64,
    model: parsed.data.model,
    interactionId: parsed.data.interaction_id,
    usage: parsed.data.usage,
  };
  return response.replayed ? { ...result, replayed: true } : result;
}

/**
 * The submit -> poll -> download sequence against fal.ai's queue that
 * `generarConSempertexLora` makes directly today
 * (src/lib/ia/kagutsuchi/sempertex-lora.ts). `prompt`, `loras`, `mode` and
 * every sizing/guidance value already reflect TypeScript's composition
 * (buildLoraEditPrompt, ensureLoraTriggers, referenciasParaLoraEdit,
 * guidanceScaleSeguro) -- Python only talks to the provider and applies the
 * SSRF allow-list. Uses `maxBodyBytes: PYTHON_MAX_BODY_BYTES_IMAGENES` (up to
 * 4 reference images for `/edit`) and a `deadlineMs` above the shared
 * default: fal.ai's own queue can legitimately take up to 105s
 * (submit + poll + download), the same budget the direct path already
 * spends inside the browser-facing /api/generate call.
 */
export async function llamarPythonLoraGenerate(
  input: PythonLoraGenerateInput,
): Promise<PythonLoraGenerateResult> {
  const { mode, prompt, loras, guidanceScale, numInferenceSteps, imageWidth, imageHeight, seed, imageDataUrls, deadlineMs, ...rest } = input;
  const operationPayload = {
    schema_version: "lora-generate.v1" as const,
    mode,
    prompt,
    loras,
    guidance_scale: guidanceScale,
    num_inference_steps: numInferenceSteps,
    image_width: imageWidth,
    image_height: imageHeight,
    ...(seed === undefined ? {} : { seed }),
    image_data_urls: imageDataUrls,
  };
  const response = await llamarPythonOperacion(PYTHON_LORA_GENERATE_PATH, PYTHON_LORA_GENERATE_SCOPE, {
    ...rest,
    payload: operationPayload,
    operationBody: operationPayload,
    maxBodyBytes: PYTHON_MAX_BODY_BYTES_IMAGENES,
    deadlineMs: deadlineMs ?? DEADLINE_MAX_MS,
  });
  const parsed = loraGeneratePayloadResultSchema.safeParse(response.payload);
  if (!parsed.success) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  const result: PythonLoraGenerateResult = {
    imageBase64: parsed.data.image_base64,
    mime: parsed.data.mime,
    providerRequestId: parsed.data.provider_request_id,
    endpoint: parsed.data.endpoint,
  };
  return response.replayed ? { ...result, replayed: true } : result;
}

/**
 * One streamed Gemini turn of Omoikane's chat
 * (services/ai-api/app/omoikane/turno_stream.py). Yields validated events and
 * guarantees the stream ended with exactly one terminal event (`end` or
 * `error`); anything else -- a malformed line, a truncated body -- is
 * PYTHON_INVALID_RESPONSE. It never retries: whether an `error` with phase
 * "open" is retried is the ChatPort's decision
 * (src/lib/ia/omoikane/chat-python.ts).
 */
export async function* llamarPythonChatTurnStream(
  input: PythonChatTurnStreamInput,
): AsyncGenerator<PythonChatTurnStreamEvent, void, undefined> {
  const { systemInstruction, contents, tools, thinkingLevel, temperature, maxOutputTokens, model, ...rest } = input;
  const operationPayload = {
    schema_version: "chat-turn-stream.v1" as const,
    system_instruction: systemInstruction,
    contents,
    tools: tools.map((tool) => ({ name: tool.name, description: tool.description, parameters_json_schema: tool.parametersJsonSchema })),
    ...(thinkingLevel === undefined ? {} : { thinking_level: thinkingLevel }),
    ...(temperature === undefined ? {} : { temperature }),
    ...(maxOutputTokens === undefined ? {} : { max_output_tokens: maxOutputTokens }),
    ...(model === undefined ? {} : { model }),
  };
  const lineas = leerPythonNdjson(PYTHON_CHAT_TURN_STREAM_PATH, PYTHON_CHAT_TURN_STREAM_SCOPE, {
    ...rest,
    payload: operationPayload,
    operationBody: operationPayload,
    maxBodyBytes: PYTHON_MAX_BODY_BYTES_CHAT,
  });
  for await (const linea of lineas) {
    const parsed = chatTurnStreamEventSchema.safeParse(linea);
    if (!parsed.success) {
      throw errorFor("PYTHON_INVALID_RESPONSE", 502, input.requestId, input.correlationId);
    }
    yield parsed.data;
    if (parsed.data.type !== "text") return;
  }
  throw errorFor("PYTHON_INVALID_RESPONSE", 502, input.requestId, input.correlationId);
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
    completarPatrones,
    pistasPatron,
    ...rest
  } = input;
  const operationBody = {
    schema_version: "plan-resolution.v1" as const,
    plan,
    allowlist,
    catalog_snapshot_id: catalogSnapshotId,
    ...(loraVariantIds === undefined ? {} : { lora_variant_ids: loraVariantIds }),
    ...(completarPatrones === undefined ? {} : { completar_patrones: completarPatrones }),
    ...(pistasPatron === undefined ? {} : { pistas_patron: pistasPatron }),
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

/**
 * Applies one edit to the declarative plan (ADR-0028 §9). Python owns the
 * mutation; Next already verified the approval, admitted the variant, and
 * resolves and signs whatever comes back. No idempotency key: the operation
 * is pure and has no effect to deduplicate.
 */
export async function llamarPythonPlanEdit(input: PythonPlanEditInput): Promise<PythonPlanEditResult> {
  const { plan, lineasBase, edicion, coloresVariante, completarPatrones, ...rest } = input;
  const operationBody = {
    schema_version: "plan-edit.v1" as const,
    plan,
    lineas_base: lineasBase.map((estructura) => ({
      estructura_id: estructura.estructura_id,
      lineas: estructura.lineas.map((linea) => ({ product_id: linea.product_id, variant_id: linea.variant_id, color: linea.color })),
    })),
    edicion,
    colores_variante: [...coloresVariante],
    completar_patrones: completarPatrones,
  };
  const response = await llamarPythonOperacion(PYTHON_PLAN_EDIT_PATH, PYTHON_PLAN_EDIT_SCOPE, {
    ...rest,
    payload: operationBody,
    operationBody,
    scopes: [PYTHON_PLAN_EDIT_SCOPE],
  });
  const parsed = planEditPayloadResultSchema.safeParse(response.payload);
  if (!parsed.success || !planEditPayloadIsConsistent(parsed.data.plan, plan)) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  const result: PythonPlanEditResult = { plan: parsed.data.plan, avisos: parsed.data.avisos };
  return response.replayed ? { ...result, replayed: true } : result;
}

/**
 * Expands one structure's color pattern, or suggests one with `null`
 * (ADR-0028 §10), for the pattern editor. No catalog and no side effect.
 */
export async function llamarPythonPlanPatron(input: PythonPlanPatronInput): Promise<PythonPlanPatronResult> {
  const { plan, estructuraId, patronColor, ...rest } = input;
  const operationBody = {
    schema_version: "plan-patron.v1" as const,
    plan,
    estructura_id: estructuraId,
    patron_color: patronColor,
  };
  const response = await llamarPythonOperacion(PYTHON_PLAN_PATRON_PATH, PYTHON_PLAN_PATRON_SCOPE, {
    ...rest,
    payload: operationBody,
    operationBody,
    scopes: [PYTHON_PLAN_PATRON_SCOPE],
  });
  const parsed = planPatronPayloadResultSchema.safeParse(response.payload);
  // The answer is about the structure asked for, and a suggestion is never "aplicado".
  if (
    !parsed.success
    || parsed.data.patron.estructura_id !== estructuraId
    || parsed.data.patron.aplicado !== (patronColor !== null)
  ) {
    throw errorFor("PYTHON_INVALID_RESPONSE", 502, response.request_id, response.correlation_id);
  }
  return response.replayed ? { patron: parsed.data.patron, replayed: true } : { patron: parsed.data.patron };
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
