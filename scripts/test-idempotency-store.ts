import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  MAX_CLEANUP_BATCH,
  OperationalIdempotencyStore,
  operationalIdempotencySql,
  type IdempotencyQueryable,
  type JsonValue,
} from "../src/lib/ia/idempotencia/store";

const UUID_1 = "00000000-0000-4000-8000-000000000001";
const UUID_2 = "00000000-0000-4000-8000-000000000002";
const UUID_3 = "00000000-0000-4000-8000-000000000003";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

type FakeRow = {
  scope: string;
  idempotency_key: string;
  body_sha256: string;
  request_id: string;
  correlation_id: string;
  state: "in_progress" | "completed" | "failed";
  response_body: JsonValue | null;
  response_status: number | null;
  response_content_type: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
};

type FakeNonceRow = {
  namespace: string;
  nonce: string;
  expires_at: string;
  consumed_at: string;
};

class FakeQueryable implements IdempotencyQueryable {
  private readonly rows = new Map<string, FakeRow>();
  private readonly nonces = new Map<string, FakeNonceRow>();
  private nowMs = Date.parse("2026-09-07T12:00:00.000Z");

  advance(ms: number): void {
    this.nowMs += ms;
  }

  get(scope: string, idempotencyKey: string): FakeRow | undefined {
    return this.rows.get(`${scope}:${idempotencyKey}`);
  }

  getNonce(namespace: string, nonce: string): FakeNonceRow | undefined {
    return this.nonces.get(`${namespace}:${nonce}`);
  }

  async query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> {
    const normalized = sql.trimStart();
    if (normalized.includes("WITH reserved AS")) return { rows: [this.claim(values) as unknown as T] };
    if (normalized.includes("WITH accepted AS")) return { rows: [this.consumeNonce(values) as unknown as T] };
    if (normalized.startsWith("UPDATE operational_idempotency")) return { rows: this.finalize(normalized, values) as unknown as T[] };
    if (normalized.startsWith("SELECT\n  scope")) return { rows: this.select(values) as unknown as T[] };
    if (normalized.startsWith("WITH expired AS") && normalized.includes("operational_request_nonces")) {
      return { rows: this.cleanupNonces(values) as unknown as T[] };
    }
    if (normalized.startsWith("WITH expired AS")) return { rows: this.cleanup(values) as unknown as T[] };
    throw new Error(`Unexpected fake query: ${sql.slice(0, 40)}`);
  }

  private claim(values: unknown[]): FakeRow & { reserved: boolean } {
    const [scope, key, hash, requestId, correlationId, ttlMs] = values as [string, string, string, string, string, number];
    const mapKey = `${scope}:${key}`;
    const existing = this.rows.get(mapKey);
    if (existing && !(existing.expires_at <= this.nowIso() && existing.state !== "in_progress")) {
      return { ...existing, reserved: false };
    }
    const now = this.nowIso();
    const row: FakeRow = {
      scope,
      idempotency_key: key,
      body_sha256: hash,
      request_id: requestId,
      correlation_id: correlationId,
      state: "in_progress",
      response_body: null,
      response_status: null,
      response_content_type: null,
      created_at: now,
      updated_at: now,
      expires_at: new Date(this.nowMs + ttlMs).toISOString(),
    };
    this.rows.set(mapKey, row);
    return { ...row, reserved: true };
  }

  private finalize(sql: string, values: unknown[]): FakeRow[] {
    const [scope, key, body, status, contentType, hash] = values as [string, string, string, number, string, string];
    const row = this.rows.get(`${scope}:${key}`);
    if (!row || row.body_sha256 !== hash || row.state !== "in_progress") return [];
    row.state = sql.includes("state = 'failed'") ? "failed" : "completed";
    row.response_body = JSON.parse(body) as JsonValue;
    row.response_status = status;
    row.response_content_type = contentType;
    row.updated_at = this.nowIso();
    return [{ ...row }];
  }

  private select(values: unknown[]): FakeRow[] {
    const [scope, key] = values as [string, string];
    const row = this.rows.get(`${scope}:${key}`);
    return row ? [{ ...row }] : [];
  }

  private consumeNonce(values: unknown[]): FakeNonceRow & { accepted: boolean } {
    const [namespace, nonce, ttlMs] = values as [string, string, number];
    const mapKey = `${namespace}:${nonce}`;
    const existing = this.nonces.get(mapKey);
    if (existing && existing.expires_at > this.nowIso()) return { ...existing, accepted: false };
    const now = this.nowIso();
    const row: FakeNonceRow = {
      namespace,
      nonce,
      expires_at: new Date(this.nowMs + ttlMs).toISOString(),
      consumed_at: now,
    };
    this.nonces.set(mapKey, row);
    return { ...row, accepted: true };
  }

  private cleanup(values: unknown[]): Array<{ scope: string; idempotency_key: string }> {
    const limit = values[0] as number;
    const expired = [...this.rows.values()]
      .filter((row) => row.state !== "in_progress" && row.expires_at <= this.nowIso())
      .sort((left, right) => left.expires_at.localeCompare(right.expires_at))
      .slice(0, limit);
    for (const row of expired) this.rows.delete(`${row.scope}:${row.idempotency_key}`);
    return expired.map((row) => ({ scope: row.scope, idempotency_key: row.idempotency_key }));
  }

  private cleanupNonces(values: unknown[]): Array<{ namespace: string; nonce: string }> {
    const limit = values[0] as number;
    const expired = [...this.nonces.values()]
      .filter((row) => row.expires_at <= this.nowIso())
      .sort((left, right) => left.expires_at.localeCompare(right.expires_at))
      .slice(0, limit);
    for (const row of expired) this.nonces.delete(`${row.namespace}:${row.nonce}`);
    return expired.map((row) => ({ namespace: row.namespace, nonce: row.nonce }));
  }

  private nowIso(): string {
    return new Date(this.nowMs).toISOString();
  }
}

function input(overrides: Partial<{
  scope: string;
  idempotencyKey: string;
  bodySha256: string;
  requestId: string;
  correlationId: string;
}> = {}) {
  return {
    scope: overrides.scope ?? "chat.execute",
    idempotencyKey: overrides.idempotencyKey ?? "same-request",
    bodySha256: overrides.bodySha256 ?? HASH_A,
    requestId: overrides.requestId ?? UUID_1,
    correlationId: overrides.correlationId ?? UUID_2,
  };
}

function response(body: JsonValue, status = 200) {
  return { body, status, contentType: "application/json" } as const;
}

async function main(): Promise<void> {
  const migration = readFileSync("scripts/migrations/020_operational_idempotency.sql", "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS operational_idempotency/);
  assert.match(migration, /PRIMARY KEY \(scope, idempotency_key\)/);
  assert.match(migration, /state IN \('in_progress', 'completed', 'failed'\)/);
  assert.match(migration, /JSONB/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS operational_request_nonces/);
  assert.match(migration, /namespace, nonce, expires_at/);
  assert.match(operationalIdempotencySql.cleanup, /SKIP LOCKED/);
  assert.match(operationalIdempotencySql.consumeNonce, /ON CONFLICT \(namespace, nonce\)/);
  assert.match(operationalIdempotencySql.cleanupNonces, /SKIP LOCKED/);

  const fake = new FakeQueryable();
  const store = new OperationalIdempotencyStore(fake, {
    defaultTtlMs: 100,
    maxTtlMs: 1_000,
    defaultNonceTtlMs: 100,
    maxNonceTtlMs: 1_000,
  });

  const nonceInput = { namespace: "internal.chat", nonce: UUID_1 };
  const nonceAccepted = await store.consumeNonce(nonceInput);
  assert.equal(nonceAccepted.kind, "accepted");
  assert.equal((await store.consumeNonce(nonceInput)).kind, "replay");
  assert.equal(fake.getNonce(nonceInput.namespace, nonceInput.nonce)?.nonce, UUID_1);
  fake.advance(101);
  assert.equal((await store.consumeNonce(nonceInput)).kind, "accepted");
  const cleanupNonceInput = { namespace: "internal.chat", nonce: UUID_3 };
  await store.consumeNonce(cleanupNonceInput);
  fake.advance(101);
  assert.deepEqual(await store.cleanupNonces(1), { deleted: 1 });

  const [first, second] = await Promise.all([store.claim(input()), store.claim(input())]);
  assert.equal(first.kind, "new");
  assert.equal(second.kind, "in_flight");
  assert.equal(fake.get("chat.execute", "same-request")?.state, "in_progress");

  const conflict = await store.claim(input({ bodySha256: HASH_B }));
  assert.deepEqual(conflict, { kind: "conflict", existingBodySha256: HASH_A });

  const completed = await store.complete({ ...input(), response: response({ ok: true, result: [1, "x"] }) });
  assert.equal(completed.kind, "completed");
  const replay = await store.claim(input());
  assert.equal(replay.kind, "replay");
  if (replay.kind === "replay") {
    assert.deepEqual(replay.response, response({ ok: true, result: [1, "x"] }));
  }
  const repeatedComplete = await store.complete({ ...input(), response: response({ ignored: true }) });
  assert.equal(repeatedComplete.kind, "already_completed");
  assert.deepEqual(fake.get("chat.execute", "same-request")?.response_body, { ok: true, result: [1, "x"] });

  const failedInput = input({ idempotencyKey: "failed-request", requestId: UUID_3 });
  assert.equal((await store.claim(failedInput)).kind, "new");
  const failed = await store.fail({ ...failedInput, response: response({ error: "temporary" }, 503) });
  assert.equal(failed.kind, "failed");
  assert.equal((await store.fail({ ...failedInput, response: response({ changed: true }, 500) })).kind, "already_failed");
  const failedReplay = await store.claim(failedInput);
  assert.equal(failedReplay.kind, "replay");
  if (failedReplay.kind === "replay") assert.equal(failedReplay.response.status, 503);

  const expiringInput = input({ idempotencyKey: "expiring-request" });
  assert.equal((await store.claim(expiringInput)).kind, "new");
  await store.complete({ ...expiringInput, response: response({ done: true }) });
  fake.advance(101);
  assert.deepEqual(await store.cleanup(1), { deleted: 1 });
  assert.equal((await store.claim(expiringInput)).kind, "new");

  await assert.rejects(() => store.claim(input({ bodySha256: "not-a-hash" })), /IDEMPOTENCY_INVALID_INPUT/);
  await assert.rejects(() => store.claim(input({ idempotencyKey: " " })), /IDEMPOTENCY_INVALID_INPUT/);
  await assert.rejects(() => store.complete({ ...input({ idempotencyKey: "json-invalid" }), response: response(BigInt(1) as never) }), /IDEMPOTENCY_INVALID_INPUT/);
  await assert.rejects(() => store.complete({ ...input({ idempotencyKey: "status-invalid" }), response: { body: {}, status: 302, contentType: "text/html" } }), /IDEMPOTENCY_INVALID_INPUT/);
  await assert.rejects(() => store.consumeNonce({ namespace: "", nonce: UUID_2 }), /IDEMPOTENCY_INVALID_INPUT/);
  await assert.rejects(() => store.consumeNonce({ namespace: "internal.chat", nonce: "not-a-uuid" }), /IDEMPOTENCY_INVALID_INPUT/);
  await assert.rejects(() => store.cleanup(MAX_CLEANUP_BATCH + 1), /IDEMPOTENCY_INVALID_INPUT/);

  console.log("Operational idempotency store: OK");
}

void main();
