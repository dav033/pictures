import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Which resolver produced the plan hash this token is bound to. Re-resolving a
 * plan with a different backend can legitimately produce a different hash, so
 * the backend travels with the context: `/api/generate` and `/api/plan-editar`
 * re-resolve with the same one that issued the plan instead of guessing.
 */
export type BackendPlan = "next" | "python";

export type EntradaAllowlistPlan = { product_id: string; variant_ids: string[] };

/**
 * Commercial provenance of a plan proposal, captured server-side when the plan
 * was resolved and returned signed so later requests can restate it without the
 * browser being able to change it.
 *
 * `catalogSnapshotId` and `allowlist` are domain inputs of the Python resolver
 * (services/ai-api/app/plan.py): the snapshot decides which published catalog is
 * authoritative, and the allowlist is the same-turn restriction — the resolver
 * may only choose variants the model actually saw in that turn. Neither may ever
 * be read from the request body.
 */
export type ContextoPlan = {
  planHash: string;
  requestId: string;
  expiresAt: number;
  backend: BackendPlan;
  /** `null` when the turn resolved without a published catalog snapshot (TypeScript path only). */
  catalogSnapshotId: string | null;
  allowlist: EntradaAllowlistPlan[];
};

const TTL_POR_DEFECTO_MS = 24 * 60 * 60 * 1000;
/** A signed context carries the turn allowlist; this bounds what we will parse. */
const LARGO_MAXIMO_TOKEN = 256 * 1024;

const EntradaAllowlistSchema = z.object({
  product_id: z.string().min(1),
  variant_ids: z.array(z.string().min(1)),
}).strict();

const PayloadV1Schema = z.object({
  v: z.literal(1),
  planHash: z.string().min(1),
  requestId: z.string().min(1),
  expiresAt: z.number().int().positive(),
}).strict();

const PayloadV2Schema = z.object({
  v: z.literal(2),
  planHash: z.string().min(1),
  requestId: z.string().min(1),
  expiresAt: z.number().int().positive(),
  backend: z.enum(["next", "python"]),
  catalogSnapshotId: z.string().min(1).nullable(),
  allowlist: z.array(EntradaAllowlistSchema),
}).strict();

const PayloadSchema = z.union([PayloadV2Schema, PayloadV1Schema]);

type Payload = z.infer<typeof PayloadSchema>;

function secret(): string {
  const value = process.env.PLAN_APPROVAL_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (value?.trim()) return value;
  if (process.env.NODE_ENV === "production") throw new Error("PLAN_APPROVAL_SECRET is required in production.");
  return "local-development-plan-approval-secret";
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function signature(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function firmar(payload: Payload): string {
  const encoded = encode(JSON.stringify(payload));
  return `${encoded}.${signature(encoded)}`;
}

/**
 * Verifies the HMAC and the expiry and returns the decoded payload. It does NOT
 * bind the plan hash: that is what `verificarTokenAprobacion` is for, and every
 * caller must still do it after resolving.
 */
function abrir(token: string | undefined): Payload | null {
  if (!token || token.length > LARGO_MAXIMO_TOKEN) return null;
  const [payload, providedSignature] = token.split(".");
  if (!payload || !providedSignature) return null;
  const expected = signature(payload);
  const provided = Buffer.from(providedSignature);
  const expectedBytes = Buffer.from(expected);
  if (provided.length !== expectedBytes.length || !timingSafeEqual(provided, expectedBytes)) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  // The payload is server-signed, but it still arrives from the browser: parse
  // it instead of trusting its shape.
  const parsed = PayloadSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.expiresAt < Date.now()) return null;
  return parsed.data;
}

function contextoDesdePayload(payload: Payload): ContextoPlan {
  if (payload.v === 2) {
    return {
      planHash: payload.planHash,
      requestId: payload.requestId,
      expiresAt: payload.expiresAt,
      backend: payload.backend,
      catalogSnapshotId: payload.catalogSnapshotId,
      allowlist: payload.allowlist,
    };
  }
  // A v1 token predates signed provenance: it can only be re-resolved by the
  // TypeScript path, which derives its own whitelist from the plan.
  return {
    planHash: payload.planHash,
    requestId: payload.requestId,
    expiresAt: payload.expiresAt,
    backend: "next",
    catalogSnapshotId: null,
    allowlist: [],
  };
}

/**
 * Issues the approval token together with the commercial provenance of the
 * proposal. The token is opaque to the browser and to the Python service:
 * Python receives `catalog_snapshot_id`/`allowlist` as domain inputs and never
 * sees the token.
 */
export function crearTokenPlan(
  input: {
    planHash: string;
    requestId: string;
    backend: BackendPlan;
    catalogSnapshotId: string | null;
    allowlist: EntradaAllowlistPlan[];
  },
  ttlMs = TTL_POR_DEFECTO_MS,
): string {
  return firmar({
    v: 2,
    planHash: input.planHash,
    requestId: input.requestId,
    expiresAt: Date.now() + ttlMs,
    backend: input.backend,
    catalogSnapshotId: input.catalogSnapshotId,
    allowlist: input.allowlist,
  });
}

/**
 * Approval token without recorded provenance: the plan can only be re-resolved
 * by the TypeScript path. Kept for call sites that never had a catalog snapshot
 * to record.
 */
export function crearTokenAprobacion(planHash: string, requestId: string, ttlMs = TTL_POR_DEFECTO_MS): string {
  return crearTokenPlan({ planHash, requestId, backend: "next", catalogSnapshotId: null, allowlist: [] }, ttlMs);
}

/** Approval gate: the token must be valid, unexpired and bound to this exact plan hash. */
export function verificarTokenAprobacion(token: string | undefined, planHash: string): { requestId: string; expiresAt: number } | null {
  const payload = abrir(token);
  if (!payload || payload.planHash !== planHash) return null;
  return { requestId: payload.requestId, expiresAt: payload.expiresAt };
}

/**
 * Reads the signed provenance needed to re-resolve the plan (backend, catalog
 * snapshot, same-turn allowlist) before the new plan hash exists.
 *
 * This is NOT the approval check: it deliberately does not bind the plan hash,
 * so the caller MUST still call `verificarTokenAprobacion` with the hash it
 * resolved before treating the plan as approved.
 */
export function abrirContextoPlan(token: string | undefined): ContextoPlan | null {
  const payload = abrir(token);
  return payload ? contextoDesdePayload(payload) : null;
}

/** Turns the resolver product-to-variants map into the signed/wire allowlist shape. */
export function allowlistDesdeMapa(mapa: ReadonlyMap<string, ReadonlySet<string>>): EntradaAllowlistPlan[] {
  return [...mapa.entries()]
    .map(([product_id, variantes]) => ({ product_id, variant_ids: [...variantes].sort() }))
    .filter((entrada) => entrada.variant_ids.length > 0)
    .sort((a, b) => a.product_id.localeCompare(b.product_id));
}

/** Inverse of `allowlistDesdeMapa`, for the TypeScript resolver signature. */
export function mapaDesdeAllowlist(allowlist: readonly EntradaAllowlistPlan[]): Map<string, Set<string>> {
  const mapa = new Map<string, Set<string>>();
  for (const entrada of allowlist) {
    const variantes = mapa.get(entrada.product_id) ?? new Set<string>();
    for (const variantId of entrada.variant_ids) variantes.add(variantId);
    mapa.set(entrada.product_id, variantes);
  }
  return mapa;
}
