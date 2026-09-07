import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const OPERATIONAL_CONTRACT_VERSION = "operational.v1" as const;
export const DEADLINE_DEFAULT_MS = 75_000;
export const DEADLINE_MAX_MS = 75_000;
const FIRMA_SKEW_SECONDS = 300;
const MIN_SECRET_BYTES = 32;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const scopeSchema = z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9._:/-]+$/);

export const OperationalContextV1Schema = z.object({
  schema_version: z.literal(OPERATIONAL_CONTRACT_VERSION),
  request_id: z.string().uuid(),
  correlation_id: z.string().uuid(),
  deadline_at: z.string().datetime({ offset: true }),
  deadline_ms: z.number().int().positive().max(DEADLINE_MAX_MS),
  body_sha256: sha256Schema,
  idempotency_key: z.string().trim().min(1).max(200).optional(),
  scopes: z.array(scopeSchema).max(32),
}).strict();

export const InternalRequestSignatureV1Schema = z.object({
  schema_version: z.literal(OPERATIONAL_CONTRACT_VERSION),
  timestamp: z.number().int().positive(),
  nonce: z.string().uuid(),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
  scopes: z.array(scopeSchema).max(32),
}).strict();

export const BackendSelectionV1Schema = z.object({
  schema_version: z.literal(OPERATIONAL_CONTRACT_VERSION),
  backend: z.enum(["next", "python"]),
  kill_switch: z.boolean(),
}).strict();

export type OperationalContextV1 = z.infer<typeof OperationalContextV1Schema>;
export type InternalRequestSignatureV1 = z.infer<typeof InternalRequestSignatureV1Schema>;
export type BackendSelectionV1 = z.infer<typeof BackendSelectionV1Schema>;

function esVerdadero(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "on";
}

function clampDeadline(value: number): number {
  return Math.min(DEADLINE_MAX_MS, Math.max(1, Math.trunc(value)));
}

function headerUuid(request: Request, name: string, fallback: string): string {
  const value = request.headers.get(name);
  return value && z.string().uuid().safeParse(value).success ? value : fallback;
}

/** Lee solo metadatos de transporte. Un cliente nunca puede ampliar el máximo. */
export function leerDeadlineMs(request: Request): number {
  const raw = request.headers.get("x-deadline-ms");
  if (!raw || !/^\d+$/.test(raw)) return DEADLINE_DEFAULT_MS;
  return clampDeadline(Number(raw));
}

export function leerContextoOperativo(request: Request, bodySha256 = "0".repeat(64)): OperationalContextV1 {
  const requestId = headerUuid(request, "x-request-id", crypto.randomUUID());
  const correlationId = headerUuid(request, "x-correlation-id", requestId);
  const deadlineMs = leerDeadlineMs(request);
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() || undefined;
  return OperationalContextV1Schema.parse({
    schema_version: OPERATIONAL_CONTRACT_VERSION,
    request_id: requestId,
    correlation_id: correlationId,
    deadline_at: new Date(Date.now() + deadlineMs).toISOString(),
    deadline_ms: deadlineMs,
    body_sha256: sha256Schema.parse(bodySha256),
    ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    scopes: [],
  });
}

export function sha256Body(body: string | Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

function canonicalSignatureInput(input: {
  timestamp: number;
  nonce: string;
  method: string;
  path: string;
  bodySha256: string;
  scopes: readonly string[];
}): string {
  return [
    input.timestamp,
    input.nonce,
    input.method.toUpperCase(),
    input.path,
    input.bodySha256,
    [...input.scopes].sort().join(","),
  ].join(".");
}

function secretoValido(secret: string): boolean {
  return Buffer.byteLength(secret, "utf8") >= MIN_SECRET_BYTES;
}

/** Firma interna HMAC; el nonce debe persistirse y consumirse en el receptor. */
export function firmarRequestInterna(input: {
  secret: string;
  method: string;
  path: string;
  bodySha256: string;
  scopes?: readonly string[];
  timestamp?: number;
  nonce?: string;
}): InternalRequestSignatureV1 {
  if (!secretoValido(input.secret)) throw new Error("INTERNAL_AUTH_SECRET_TOO_SHORT");
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  const nonce = input.nonce ?? crypto.randomUUID();
  const scopes = [...(input.scopes ?? [])];
  const signature = createHmac("sha256", input.secret)
    .update(canonicalSignatureInput({ ...input, timestamp, nonce, scopes }))
    .digest("hex");
  return InternalRequestSignatureV1Schema.parse({
    schema_version: OPERATIONAL_CONTRACT_VERSION,
    timestamp,
    nonce,
    signature,
    scopes,
  });
}

export function verificarRequestInterna(input: {
  secret: string;
  signature: InternalRequestSignatureV1;
  method: string;
  path: string;
  bodySha256: string;
  nowSeconds?: number;
  maxSkewSeconds?: number;
  requiredScopes?: readonly string[];
}): boolean {
  if (!secretoValido(input.secret)) return false;
  const parsed = InternalRequestSignatureV1Schema.safeParse(input.signature);
  if (!parsed.success) return false;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const skew = input.maxSkewSeconds ?? FIRMA_SKEW_SECONDS;
  if (Math.abs(now - parsed.data.timestamp) > skew) return false;
  if ((input.requiredScopes ?? []).some((scope) => !parsed.data.scopes.includes(scope))) return false;
  const expected = createHmac("sha256", input.secret)
    .update(canonicalSignatureInput({
      timestamp: parsed.data.timestamp,
      nonce: parsed.data.nonce,
      method: input.method,
      path: input.path,
      bodySha256: input.bodySha256,
      scopes: parsed.data.scopes,
    }))
    .digest("hex");
  return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(parsed.data.signature, "utf8"));
}

export type IdempotencyDecision = "new" | "replay" | "conflict";

/** Política pura; la persistencia/replay atómico pertenece al store de Etapa 3. */
export function decidirIdempotencia(existingBodySha256: string | undefined, bodySha256: string): IdempotencyDecision {
  if (!existingBodySha256) return "new";
  return existingBodySha256 === bodySha256 ? "replay" : "conflict";
}

export function seleccionarBackendMigracion(env: Record<string, string | undefined> = process.env): BackendSelectionV1 {
  const killSwitch = esVerdadero(env.PYTHON_BACKEND_KILL_SWITCH);
  const enabled = esVerdadero(env.PYTHON_BACKEND_ENABLED);
  return BackendSelectionV1Schema.parse({
    schema_version: OPERATIONAL_CONTRACT_VERSION,
    backend: enabled && !killSwitch ? "python" : "next",
    kill_switch: killSwitch,
  });
}

export function crearDeadlineSignal(parentSignal: AbortSignal, deadlineMs: number): {
  signal: AbortSignal;
  deadlineAt: number;
  wasDeadlineExceeded: () => boolean;
  cancel: (reason?: unknown) => void;
  dispose: () => void;
} {
  const controller = new AbortController();
  const deadlineAt = Date.now() + clampDeadline(deadlineMs);
  let deadlineExceeded = false;
  const onParentAbort = () => controller.abort(parentSignal.reason);
  const timer = setTimeout(() => {
    deadlineExceeded = true;
    controller.abort(new Error("DEADLINE_EXCEEDED"));
  }, Math.max(1, deadlineAt - Date.now()));
  parentSignal.addEventListener("abort", onParentAbort, { once: true });
  if (parentSignal.aborted) onParentAbort();
  return {
    signal: controller.signal,
    deadlineAt,
    wasDeadlineExceeded: () => deadlineExceeded,
    cancel: (reason?: unknown) => controller.abort(reason ?? new Error("CLIENT_CANCELLED")),
    dispose: () => {
      clearTimeout(timer);
      parentSignal.removeEventListener("abort", onParentAbort);
    },
  };
}

export function remainingDeadlineMs(deadlineAt: number): number {
  return Math.max(1, deadlineAt - Date.now());
}
