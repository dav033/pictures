import { createHash, randomUUID } from "node:crypto";
import type { ZodType } from "zod";
import type { PoolClient, QueryConfig } from "pg";
import { getRagPool } from "../rag/db";

export const BODY_LIMIT = 32 * 1024;
export const WEBHOOK_TIMEOUT_MS = 60_000;
export const MAX_PENDING_ACQUISITIONS = 8;
declare global {
  var __happiePendingAcquisitions: number | undefined;
}
type Result = { status: number; body: unknown };
export class WebhookError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function esperarConSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.race([promise, Promise.reject(signal.reason)]);
  let abort: () => void = () => {};
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
    })]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export async function leerBodyLimitado(request: Request, signal: AbortSignal): Promise<string> {
  if (Number(request.headers.get("content-length")) > BODY_LIMIT) {
    throw new WebhookError(413, "Body demasiado grande.");
  }
  signal.throwIfAborted();
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > BODY_LIMIT) {
        cancel();
        throw new WebhookError(413, "Body demasiado grande.");
      }
      chunks.push(value);
    }
    try {
      // Reject lossy decoding so distinct invalid byte sequences cannot share a body hash.
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
    } catch {
      throw new WebhookError(400, "El body debe ser UTF-8 valido.");
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

export interface WebhookStore {
  rate(scope: string, signal: AbortSignal): Promise<boolean>;
  claim(scope: string, key: string, hash: string, owner: string, signal: AbortSignal): Promise<"claimed" | "conflict" | "busy" | Result>;
  finish(scope: string, key: string, owner: string, result: Result | null, signal: AbortSignal): Promise<void>;
}

// pg supports query_timeout at runtime, but @types/pg only exposes it on ClientConfig.
async function query(config: QueryConfig & { query_timeout: number }, signal: AbortSignal) {
  signal.throwIfAborted();
  const acquisition = new AbortController();
  const timer = setTimeout(() => acquisition.abort(new WebhookError(503, "PostgreSQL temporalmente no disponible.")), 5_000);
  const acquireSignal = AbortSignal.any([signal, acquisition.signal]);
  let client: PoolClient | undefined;
  let abandoned = false;
  let destroy = false;
  try {
    try {
      // Pool queues cannot be cancelled. A late connection must never execute SQL.
      if ((globalThis.__happiePendingAcquisitions ?? 0) >= MAX_PENDING_ACQUISITIONS) {
        throw new WebhookError(503, "PostgreSQL temporalmente no disponible.");
      }
      globalThis.__happiePendingAcquisitions = (globalThis.__happiePendingAcquisitions ?? 0) + 1;
      let connecting: Promise<PoolClient>;
      try {
        connecting = getRagPool().connect();
      } catch (error) {
        globalThis.__happiePendingAcquisitions--;
        throw error;
      }
      // Keep abandoned acquisitions counted until pg actually settles them, including across hot reloads.
      const pending = connecting.finally(() => {
        globalThis.__happiePendingAcquisitions!--;
      }).then(connection => {
        if (abandoned) connection.release();
        else client = connection;
      });
      await esperarConSignal(pending, acquireSignal);
      acquireSignal.throwIfAborted();
    } finally {
      abandoned = true;
      clearTimeout(timer);
    }
    signal.throwIfAborted();
    destroy = true;
    const result = await esperarConSignal(client!.query(config), signal);
    destroy = false;
    return result;
  } finally {
    // Do not return a connection with an interrupted query to the idle pool.
    client?.release(destroy);
  }
}

// Atomic statements, no transaction or connection held during provider calls.
export const postgresWebhookStore: WebhookStore = {
  async rate(scope, signal) {
    const { rows } = await query({
      text: `INSERT INTO happie_webhook_rate (scope, window_start, hits)
        VALUES ($1, date_trunc('minute', clock_timestamp()), 1)
        ON CONFLICT (scope) DO UPDATE SET
          hits = CASE WHEN happie_webhook_rate.window_start >= EXCLUDED.window_start
            THEN happie_webhook_rate.hits + 1 ELSE 1 END,
          window_start = GREATEST(happie_webhook_rate.window_start, EXCLUDED.window_start)
        RETURNING hits`, values: [scope], query_timeout: 5_000,
    }, signal);
    return rows[0].hits <= 30;
  },
  async claim(scope, key, hash, owner, signal) {
    const { rows } = await query({
      text: `INSERT INTO happie_webhook_requests (scope, key_hash, body_hash, owner, lease_until, expires_at)
        VALUES ($1, $2, $3, $4, now() + interval '2 minutes', now() + interval '24 hours')
        ON CONFLICT (scope, key_hash) DO UPDATE SET
          body_hash = CASE WHEN happie_webhook_requests.expires_at <= now() THEN EXCLUDED.body_hash ELSE happie_webhook_requests.body_hash END,
          owner = EXCLUDED.owner, lease_until = EXCLUDED.lease_until,
          response = NULL, status = NULL, expires_at = EXCLUDED.expires_at
        WHERE happie_webhook_requests.expires_at <= now() OR
          (happie_webhook_requests.body_hash = EXCLUDED.body_hash AND happie_webhook_requests.response IS NULL
           AND happie_webhook_requests.lease_until <= now())
        RETURNING owner`, values: [scope, key, hash, owner], query_timeout: 5_000,
    }, signal);
    if (rows.length) return "claimed";
    const result = await query({
      text: `SELECT body_hash, status, response FROM happie_webhook_requests WHERE scope = $1 AND key_hash = $2`,
      values: [scope, key], query_timeout: 5_000,
    }, signal);
    const row = result.rows[0];
    if (!row) return "busy";
    if (row.body_hash !== hash) return "conflict";
    return row.response !== null ? { status: row.status, body: row.response } : "busy";
  },
  async finish(scope, key, owner, result, signal) {
    await query({
      text: `UPDATE happie_webhook_requests SET response = $4::jsonb, status = $5, lease_until = now()
        WHERE scope = $1 AND key_hash = $2 AND owner = $3`,
      values: [scope, key, owner, result ? JSON.stringify(result.body) : null, result?.status ?? null],
      query_timeout: 5_000,
    }, signal);
  },
};

export async function ejecutarWebhook(
  request: Request, operation: string, auth: Response | null, schema: ZodType,
  work: (request: Request) => Promise<Result>, store = postgresWebhookStore,
): Promise<Response> {
  const correlationId = randomUUID();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Deadline", "TimeoutError")), WEBHOOK_TIMEOUT_MS);
  const signal = AbortSignal.any([request.signal, controller.signal]);
  const respond = (result: Result, retry?: string) => Response.json(
    result.status >= 400 ? { ...(result.body as object), correlationId } : result.body,
    { status: result.status, headers: { "Cache-Control": "no-store", "X-Correlation-ID": correlationId, ...(retry ? { "Retry-After": retry } : {}) } },
  );
  const digest = (text: string) => createHash("sha256").update(text).digest("hex");
  let claimed = false;
  let key = "";
  const scope = `${digest(request.headers.get("x-api-key") ?? "")}:${operation}`;
  try {
    if (auth) return respond({ status: auth.status, body: await auth.json() });
    const raw = await leerBodyLimitado(request, signal);
    let json: unknown;
    try { json = JSON.parse(raw); } catch { throw new WebhookError(400, "El body debe ser JSON valido."); }
    const parsed = schema.safeParse(json);
    if (!parsed.success) return respond({ status: 400, body: { error: "Solicitud invalida.", campos: parsed.error.issues.map(i => i.path.join(".")) } });
    const header = request.headers.get("idempotency-key");
    if (header !== null && !/^[\x21-\x7e]{1,128}$/.test(header)) throw new WebhookError(400, "Idempotency-Key invalida.");
    if (!await esperarConSignal(store.rate(scope.split(":")[0], signal), signal)) return respond({ status: 429, body: { error: "Limite de solicitudes excedido." } }, "60");
    signal.throwIfAborted();
    if (header !== null) {
      key = digest(header);
      const claim = await esperarConSignal(store.claim(scope, key, digest(raw), correlationId, signal), signal);
      if (claim === "conflict") throw new WebhookError(409, "Idempotency-Key usada con otro body.");
      if (claim === "busy") return respond({ status: 409, body: { error: "Solicitud en curso." } }, "120");
      if (claim !== "claimed") return respond(claim);
      claimed = true;
    }
    signal.throwIfAborted();
    const workHeaders = new Headers(request.headers);
    workHeaders.set("x-correlation-id", correlationId);
    const result = await esperarConSignal(work(new Request(request.url, { method: "POST", headers: workHeaders, body: raw, signal })), signal);
    signal.throwIfAborted();
    if (claimed) {
      claimed = false;
      await esperarConSignal(store.finish(scope, key, correlationId, result.status < 400 ? result : null, signal), signal);
    }
    return respond(result, result.status >= 500 ? "5" : undefined);
  } catch (error) {
    const status = signal.aborted ? (request.signal.aborted ? 408 : 504) : error instanceof WebhookError ? error.status : error instanceof Error && error.name === "TimeoutError" ? 504 : 503;
    // Never log provider messages, bodies, prompts or credentials.
    console.error("happie-webhook", { correlationId, operation, status });
    return respond({ status, body: { error: error instanceof WebhookError ? error.message : "Servicio temporalmente no disponible." } }, status >= 500 ? "5" : undefined);
  } finally {
    try {
      // Cleanup shares the original deadline; an uncertain finish leaves the lease to expire.
      if (claimed && !signal.aborted) {
        const cleanupSignal = AbortSignal.any([signal, AbortSignal.timeout(5_000)]);
        await esperarConSignal(store.finish(scope, key, correlationId, null, cleanupSignal), cleanupSignal).catch(() => {
          console.error("happie-webhook-release", { correlationId });
        });
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
