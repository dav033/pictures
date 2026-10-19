import { z } from "zod";
import type { QueryResultRow } from "pg";

import { decidirIdempotencia } from "@/lib/ia/contracts/operational-v1";

export const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_NONCE_TTL_MS = 5 * 60 * 1000;
export const MAX_NONCE_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_CLEANUP_BATCH = 1_000;

const TABLE_NAME = "operational_idempotency";
const NONCE_TABLE_NAME = "operational_request_nonces";
const INVALID_INPUT = "IDEMPOTENCY_INVALID_INPUT";
const CORRUPT_ROW = "IDEMPOTENCY_STORE_CORRUPT_ROW";
const NOT_CLAIMED = "IDEMPOTENCY_NOT_CLAIMED";

const scopeSchema = z.string().min(1).max(120).regex(/^[a-zA-Z0-9._:/-]+$/);
const idempotencyKeySchema = z.string().min(1).max(200);
const bodySha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const uuidSchema = z.string().uuid();
const stateSchema = z.enum(["in_progress", "completed", "failed"]);
const statusSchema = z.number().int().min(200).max(599);
const contentTypeSchema = z.string().min(1).max(120);

const rawRowSchema = z.object({
  scope: z.string(),
  idempotency_key: z.string(),
  body_sha256: z.string(),
  request_id: z.string(),
  correlation_id: z.string(),
  state: stateSchema,
  response_body: z.unknown().nullable(),
  response_status: z.number().int().nullable(),
  response_content_type: z.string().nullable(),
  created_at: z.union([z.string(), z.date()]),
  updated_at: z.union([z.string(), z.date()]),
  expires_at: z.union([z.string(), z.date()]),
  reserved: z.boolean().optional(),
});

const rawNonceRowSchema = z.object({
  namespace: z.string(),
  nonce: z.string(),
  expires_at: z.union([z.string(), z.date()]),
  accepted: z.boolean(),
});

const CLAIM_SQL = `
WITH reserved AS (
  INSERT INTO ${TABLE_NAME} (
    scope,
    idempotency_key,
    body_sha256,
    request_id,
    correlation_id,
    state,
    expires_at
  )
  VALUES ($1, $2, $3, $4::uuid, $5::uuid, 'in_progress', now() + ($6::bigint * interval '1 millisecond'))
  ON CONFLICT (scope, idempotency_key) DO UPDATE
    SET body_sha256 = EXCLUDED.body_sha256,
        request_id = EXCLUDED.request_id,
        correlation_id = EXCLUDED.correlation_id,
        state = 'in_progress',
        response_body = NULL,
        response_status = NULL,
        response_content_type = NULL,
        created_at = now(),
        updated_at = now(),
        expires_at = EXCLUDED.expires_at
  WHERE ${TABLE_NAME}.expires_at <= now()
    AND ${TABLE_NAME}.state IN ('completed', 'failed')
  RETURNING
    scope,
    idempotency_key,
    body_sha256,
    request_id::text AS request_id,
    correlation_id::text AS correlation_id,
    state,
    response_body,
    response_status,
    response_content_type,
    created_at::text AS created_at,
    updated_at::text AS updated_at,
    expires_at::text AS expires_at,
    TRUE AS reserved
)
SELECT
  scope,
  idempotency_key,
  body_sha256,
  request_id,
  correlation_id,
  state,
  response_body,
  response_status,
  response_content_type,
  created_at,
  updated_at,
  expires_at,
  reserved
FROM reserved
UNION ALL
SELECT
  scope,
  idempotency_key,
  body_sha256,
  request_id::text AS request_id,
  correlation_id::text AS correlation_id,
  state,
  response_body,
  response_status,
  response_content_type,
  created_at::text AS created_at,
  updated_at::text AS updated_at,
  expires_at::text AS expires_at,
  FALSE AS reserved
FROM ${TABLE_NAME}
WHERE scope = $1
  AND idempotency_key = $2
  AND NOT EXISTS (SELECT 1 FROM reserved)
LIMIT 1
`;

const COMPLETE_SQL = `
UPDATE ${TABLE_NAME}
SET state = 'completed',
    response_body = $3::jsonb,
    response_status = $4,
    response_content_type = $5,
    updated_at = now()
WHERE scope = $1
  AND idempotency_key = $2
  AND body_sha256 = $6
  AND state = 'in_progress'
RETURNING
  scope,
  idempotency_key,
  body_sha256,
  request_id::text AS request_id,
  correlation_id::text AS correlation_id,
  state,
  response_body,
  response_status,
  response_content_type,
  created_at::text AS created_at,
  updated_at::text AS updated_at,
  expires_at::text AS expires_at
`;

const FAIL_SQL = COMPLETE_SQL.replace("state = 'completed'", "state = 'failed'");

const SELECT_SQL = `
SELECT
  scope,
  idempotency_key,
  body_sha256,
  request_id::text AS request_id,
  correlation_id::text AS correlation_id,
  state,
  response_body,
  response_status,
  response_content_type,
  created_at::text AS created_at,
  updated_at::text AS updated_at,
  expires_at::text AS expires_at
FROM ${TABLE_NAME}
WHERE scope = $1 AND idempotency_key = $2
LIMIT 1
`;

const CLEANUP_SQL = `
WITH expired AS (
  SELECT scope, idempotency_key
  FROM ${TABLE_NAME}
  WHERE expires_at <= now()
    AND state IN ('completed', 'failed')
  ORDER BY expires_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT $1
)
DELETE FROM ${TABLE_NAME} AS target
USING expired
WHERE target.scope = expired.scope
  AND target.idempotency_key = expired.idempotency_key
RETURNING target.scope, target.idempotency_key
`;

const CONSUME_NONCE_SQL = `
WITH accepted AS (
  INSERT INTO ${NONCE_TABLE_NAME} (namespace, nonce, expires_at)
  VALUES ($1, $2::uuid, now() + ($3::bigint * interval '1 millisecond'))
  ON CONFLICT (namespace, nonce) DO UPDATE
    SET expires_at = EXCLUDED.expires_at,
        consumed_at = now()
  WHERE ${NONCE_TABLE_NAME}.expires_at <= now()
  RETURNING namespace, nonce::text AS nonce, expires_at::text AS expires_at, TRUE AS accepted
)
SELECT namespace, nonce, expires_at, accepted
FROM accepted
UNION ALL
SELECT namespace, nonce::text AS nonce, expires_at::text AS expires_at, FALSE AS accepted
FROM ${NONCE_TABLE_NAME}
WHERE namespace = $1
  AND nonce = $2::uuid
  AND NOT EXISTS (SELECT 1 FROM accepted)
LIMIT 1
`;

const CLEANUP_NONCES_SQL = `
WITH expired AS (
  SELECT namespace, nonce
  FROM ${NONCE_TABLE_NAME}
  WHERE expires_at <= now()
  ORDER BY expires_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT $1
)
DELETE FROM ${NONCE_TABLE_NAME} AS target
USING expired
WHERE target.namespace = expired.namespace
  AND target.nonce = expired.nonce
RETURNING target.namespace, target.nonce
`;

export interface IdempotencyQueryable {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface StoredHttpResponse {
  body: JsonValue;
  status: number;
  contentType: string;
}

export type IdempotencyState = z.infer<typeof stateSchema>;

export interface OperationalIdempotencyRecord {
  scope: string;
  idempotencyKey: string;
  bodySha256: string;
  requestId: string;
  correlationId: string;
  state: IdempotencyState;
  response: StoredHttpResponse | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface ClaimInput {
  scope: string;
  idempotencyKey: string;
  bodySha256: string;
  requestId: string;
  correlationId: string;
  ttlMs?: number;
}

export interface NonceConsumeInput {
  namespace: string;
  nonce: string;
  ttlMs?: number;
}

export interface FinalizeInput extends Omit<ClaimInput, "ttlMs"> {
  response: StoredHttpResponse;
}

export type ClaimResult =
  | { kind: "new"; record: OperationalIdempotencyRecord }
  | { kind: "replay"; record: OperationalIdempotencyRecord; response: StoredHttpResponse }
  | { kind: "conflict"; existingBodySha256: string }
  | { kind: "in_flight"; expiresAt: string };

export type FinalizeResult =
  | { kind: "completed"; record: OperationalIdempotencyRecord }
  | { kind: "failed"; record: OperationalIdempotencyRecord }
  | { kind: "already_completed"; record: OperationalIdempotencyRecord }
  | { kind: "already_failed"; record: OperationalIdempotencyRecord };

export interface OperationalIdempotencyStoreOptions {
  defaultTtlMs?: number;
  maxTtlMs?: number;
  defaultNonceTtlMs?: number;
  maxNonceTtlMs?: number;
}

function invalidInput(): Error {
  return new Error(INVALID_INPUT);
}

function validarTexto(value: unknown, schema: z.ZodType<string>): string {
  const parsed = schema.safeParse(value);
  if (!parsed.success || parsed.data !== parsed.data.trim()) throw invalidInput();
  return parsed.data;
}

function validarUuid(value: unknown): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw invalidInput();
  return parsed.data;
}

function validarHash(value: unknown): string {
  const parsed = bodySha256Schema.safeParse(value);
  if (!parsed.success) throw invalidInput();
  return parsed.data;
}

function validarTtl(value: unknown, maxTtlMs: number): number {
  const parsed = z.number().int().positive().max(maxTtlMs).safeParse(value);
  if (!parsed.success) throw invalidInput();
  return parsed.data;
}

function esJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(esJsonValue);
  if (typeof value !== "object") return false;
  return Object.values(value).every(esJsonValue);
}

function normalizarJson(value: unknown): JsonValue {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw invalidInput();
  }
  if (serialized === undefined) throw invalidInput();
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw invalidInput();
  }
  if (!esJsonValue(parsed)) throw invalidInput();
  return parsed;
}

function normalizarContentType(value: unknown): string {
  const parsed = contentTypeSchema.safeParse(value);
  if (!parsed.success) throw invalidInput();
  const normalized = parsed.data.trim().toLowerCase();
  if (normalized !== "application/json" && normalized !== "application/problem+json") {
    throw invalidInput();
  }
  return normalized;
}

function normalizarResponse(value: unknown): StoredHttpResponse {
  const parsed = z.object({
    body: z.unknown(),
    status: statusSchema,
    contentType: contentTypeSchema,
  }).strict().safeParse(value);
  if (!parsed.success) throw invalidInput();
  return {
    body: normalizarJson(parsed.data.body),
    status: parsed.data.status,
    contentType: normalizarContentType(parsed.data.contentType),
  };
}

function normalizarBaseInput(input: unknown): Omit<ClaimInput, "ttlMs"> {
  const parsed = z.object({
    scope: z.unknown(),
    idempotencyKey: z.unknown(),
    bodySha256: z.unknown(),
    requestId: z.unknown(),
    correlationId: z.unknown(),
  }).safeParse(input);
  if (!parsed.success) throw invalidInput();
  return {
    scope: validarTexto(parsed.data.scope, scopeSchema),
    idempotencyKey: validarTexto(parsed.data.idempotencyKey, idempotencyKeySchema),
    bodySha256: validarHash(parsed.data.bodySha256),
    requestId: validarUuid(parsed.data.requestId),
    correlationId: validarUuid(parsed.data.correlationId),
  };
}

function normalizarNonceInput(input: unknown): Omit<NonceConsumeInput, "ttlMs"> {
  const parsed = z.object({
    namespace: z.unknown(),
    nonce: z.unknown(),
  }).safeParse(input);
  if (!parsed.success) throw invalidInput();
  return {
    namespace: validarTexto(parsed.data.namespace, scopeSchema),
    nonce: validarUuid(parsed.data.nonce),
  };
}

function normalizarTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(CORRUPT_ROW);
  return date.toISOString();
}

function parseRecord(input: unknown): { record: OperationalIdempotencyRecord; reserved: boolean } {
  const parsed = rawRowSchema.safeParse(input);
  if (!parsed.success) throw new Error(CORRUPT_ROW);
  const row = parsed.data;
  const scope = scopeSchema.safeParse(row.scope);
  const idempotencyKey = idempotencyKeySchema.safeParse(row.idempotency_key);
  const bodySha256 = bodySha256Schema.safeParse(row.body_sha256);
  const requestId = uuidSchema.safeParse(row.request_id);
  const correlationId = uuidSchema.safeParse(row.correlation_id);
  if (!scope.success || !idempotencyKey.success || !bodySha256.success || !requestId.success || !correlationId.success) {
    throw new Error(CORRUPT_ROW);
  }
  if (row.scope !== row.scope.trim() || row.idempotency_key !== row.idempotency_key.trim()) {
    throw new Error(CORRUPT_ROW);
  }

  let response: StoredHttpResponse | null = null;
  if (row.state === "in_progress") {
    if (row.response_body !== null || row.response_status !== null || row.response_content_type !== null) {
      throw new Error(CORRUPT_ROW);
    }
  } else {
    if (row.response_status === null || row.response_content_type === null) throw new Error(CORRUPT_ROW);
    const status = statusSchema.safeParse(row.response_status);
    if (!status.success) throw new Error(CORRUPT_ROW);
    let body: JsonValue;
    try {
      body = normalizarJson(row.response_body);
    } catch {
      throw new Error(CORRUPT_ROW);
    }
    let contentType: string;
    try {
      contentType = normalizarContentType(row.response_content_type);
    } catch {
      throw new Error(CORRUPT_ROW);
    }
    response = { body, status: status.data, contentType };
  }

  return {
    reserved: row.reserved ?? false,
    record: {
      scope: scope.data,
      idempotencyKey: idempotencyKey.data,
      bodySha256: bodySha256.data,
      requestId: requestId.data,
      correlationId: correlationId.data,
      state: row.state,
      response,
      createdAt: normalizarTimestamp(row.created_at),
      updatedAt: normalizarTimestamp(row.updated_at),
      expiresAt: normalizarTimestamp(row.expires_at),
    },
  };
}

function parseNonceRow(input: unknown): { namespace: string; nonce: string; expiresAt: string; accepted: boolean } {
  const parsed = rawNonceRowSchema.safeParse(input);
  if (!parsed.success) throw new Error(CORRUPT_ROW);
  const namespace = scopeSchema.safeParse(parsed.data.namespace);
  const nonce = uuidSchema.safeParse(parsed.data.nonce);
  if (!namespace.success || !nonce.success || parsed.data.namespace !== parsed.data.namespace.trim()) {
    throw new Error(CORRUPT_ROW);
  }
  return {
    namespace: namespace.data,
    nonce: nonce.data,
    expiresAt: normalizarTimestamp(parsed.data.expires_at),
    accepted: parsed.data.accepted,
  };
}

function validarCleanupLimit(value: unknown): number {
  const parsed = z.number().int().positive().max(MAX_CLEANUP_BATCH).safeParse(value);
  if (!parsed.success) throw invalidInput();
  return parsed.data;
}

async function primeraFila<T extends QueryResultRow>(queryable: IdempotencyQueryable, sql: string, values: unknown[]): Promise<T | undefined> {
  const result = await queryable.query<T>(sql, values);
  if (!Array.isArray(result.rows) || result.rows.length > 1) throw new Error(CORRUPT_ROW);
  return result.rows[0];
}

export class OperationalIdempotencyStore {
  private readonly defaultTtlMs: number;
  private readonly maxTtlMs: number;
  private readonly defaultNonceTtlMs: number;
  private readonly maxNonceTtlMs: number;

  constructor(
    private readonly queryable: IdempotencyQueryable,
    options: OperationalIdempotencyStoreOptions = {},
  ) {
    this.maxTtlMs = validarTtl(options.maxTtlMs ?? MAX_IDEMPOTENCY_TTL_MS, MAX_IDEMPOTENCY_TTL_MS);
    this.defaultTtlMs = validarTtl(options.defaultTtlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS, this.maxTtlMs);
    this.maxNonceTtlMs = validarTtl(options.maxNonceTtlMs ?? MAX_NONCE_TTL_MS, MAX_NONCE_TTL_MS);
    this.defaultNonceTtlMs = validarTtl(options.defaultNonceTtlMs ?? DEFAULT_NONCE_TTL_MS, this.maxNonceTtlMs);
  }

  async claim(input: ClaimInput): Promise<ClaimResult> {
    const base = normalizarBaseInput(input);
    const ttlMs = validarTtl(input.ttlMs ?? this.defaultTtlMs, this.maxTtlMs);
    const row = await primeraFila<QueryResultRow>(this.queryable, CLAIM_SQL, [
      base.scope,
      base.idempotencyKey,
      base.bodySha256,
      base.requestId,
      base.correlationId,
      ttlMs,
    ]);
    if (!row) throw new Error(CORRUPT_ROW);
    const parsed = parseRecord(row);
    if (parsed.reserved) return { kind: "new", record: parsed.record };

    const decision = decidirIdempotencia(parsed.record.bodySha256, base.bodySha256);
    if (decision === "conflict") return { kind: "conflict", existingBodySha256: parsed.record.bodySha256 };
    if (parsed.record.state === "in_progress") return { kind: "in_flight", expiresAt: parsed.record.expiresAt };
    if (!parsed.record.response) throw new Error(CORRUPT_ROW);
    return { kind: "replay", record: parsed.record, response: parsed.record.response };
  }

  async complete(input: FinalizeInput): Promise<FinalizeResult> {
    return this.finalize("completed", input);
  }

  async fail(input: FinalizeInput): Promise<FinalizeResult> {
    return this.finalize("failed", input);
  }

  async cleanup(limit = MAX_CLEANUP_BATCH): Promise<{ deleted: number }> {
    const parsedLimit = validarCleanupLimit(limit);
    const result = await this.queryable.query<QueryResultRow>(CLEANUP_SQL, [parsedLimit]);
    if (!Array.isArray(result.rows)) throw new Error(CORRUPT_ROW);
    return { deleted: result.rows.length };
  }

  async consumeNonce(input: NonceConsumeInput): Promise<{ kind: "accepted" | "replay"; expiresAt: string }> {
    const base = normalizarNonceInput(input);
    const ttlMs = validarTtl(input.ttlMs ?? this.defaultNonceTtlMs, this.maxNonceTtlMs);
    const row = await primeraFila<QueryResultRow>(this.queryable, CONSUME_NONCE_SQL, [
      base.namespace,
      base.nonce,
      ttlMs,
    ]);
    if (!row) throw new Error(CORRUPT_ROW);
    const parsed = parseNonceRow(row);
    return parsed.accepted ? { kind: "accepted", expiresAt: parsed.expiresAt } : { kind: "replay", expiresAt: parsed.expiresAt };
  }

  async cleanupNonces(limit = MAX_CLEANUP_BATCH): Promise<{ deleted: number }> {
    const parsedLimit = validarCleanupLimit(limit);
    const result = await this.queryable.query<QueryResultRow>(CLEANUP_NONCES_SQL, [parsedLimit]);
    if (!Array.isArray(result.rows)) throw new Error(CORRUPT_ROW);
    return { deleted: result.rows.length };
  }

  private async finalize(targetState: "completed" | "failed", input: FinalizeInput): Promise<FinalizeResult> {
    const base = normalizarBaseInput(input);
    const response = normalizarResponse(input.response);
    const sql = targetState === "completed" ? COMPLETE_SQL : FAIL_SQL;
    const updated = await primeraFila<QueryResultRow>(this.queryable, sql, [
      base.scope,
      base.idempotencyKey,
      JSON.stringify(response.body),
      response.status,
      response.contentType,
      base.bodySha256,
    ]);
    if (updated) {
      const record = parseRecord(updated).record;
      return targetState === "completed" ? { kind: "completed", record } : { kind: "failed", record };
    }

    const existing = await primeraFila<QueryResultRow>(this.queryable, SELECT_SQL, [base.scope, base.idempotencyKey]);
    if (!existing) throw new Error(NOT_CLAIMED);
    const record = parseRecord(existing).record;
    if (decidirIdempotencia(record.bodySha256, base.bodySha256) === "conflict") {
      throw new Error("IDEMPOTENCY_BODY_CONFLICT");
    }
    if (record.state === "completed") return { kind: "already_completed", record };
    if (record.state === "failed") return { kind: "already_failed", record };
    throw new Error("IDEMPOTENCY_FINALIZATION_RACE");
  }
}

export const operationalIdempotencySql = {
  claim: CLAIM_SQL,
  complete: COMPLETE_SQL,
  fail: FAIL_SQL,
  select: SELECT_SQL,
  cleanup: CLEANUP_SQL,
  consumeNonce: CONSUME_NONCE_SQL,
  cleanupNonces: CLEANUP_NONCES_SQL,
} as const;
