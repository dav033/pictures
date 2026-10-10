import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Which resolver produced the plan hash this token is bound to. Re-resolving a
 * plan with a different backend can legitimately produce a different hash, so
 * the backend travels with the context: `/api/generate` and `/api/plan-editar`
 * re-resolve with the same one that issued the plan instead of guessing.
 *
 * `globos3d` (REQ-007): the plan was counted by the 3D engine from a signed
 * `EspecClienteV1`, not resolved by Python. Its `planHash` is the spec hash. Each
 * plan has exactly one quantity owner: the Python routes (`/api/generate`,
 * `/api/plan-editar`) reject these tokens (`token-motor.ts`) and the 3D routes
 * reject `python` ones.
 */
export type BackendPlan = "next" | "python" | "globos3d";

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
  /**
   * Creativity level (0-5, creatividad.ts) the proposal was designed with.
   * Generation uses it instead of the current slider so the image matches the
   * approved plan. `null` for tokens issued before the field existed.
   */
  creatividad: number | null;
  /**
   * The customer gave measures for the plan's pieces in the turn that
   * confirmed it (ADR-0031, review finding 33). An edit has no customer text,
   * so the re-resolution reads it from here to keep those measures fixed
   * against the photo's count. `false` for tokens issued without it.
   */
  medidasDelCliente: boolean;
  /**
   * Huella del navegador al que se le dio el plan (solo los planes del motor 3D). El token es opaco pero se puede copiar:
   * atarlo al navegador que lo pidió hace que un token copiado a otro no sirva (REQ-007). `null` si no lo trae.
   */
  navegador: string | null;
  /**
   * Cuándo se emitió el PRIMER plan de esta línea (un plan y los que salen de él al cambiarlo, sumarle una idea o rehacerlo;
   * solo el motor 3D lo escribe, P-045): cada token nuevo dura 24 h, pero esta hora se hereda, así que encadenar cambios no
   * alarga la vida de la línea. Un token sin el campo cuenta desde su propia emisión (`expiresAt` − 24 h).
   */
  origenEn: number;
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
  backend: z.enum(["next", "python", "globos3d"]),
  catalogSnapshotId: z.string().min(1).nullable(),
  allowlist: z.array(EntradaAllowlistSchema),
  // Optional so v2 tokens issued before the field existed keep opening.
  creatividad: z.number().int().min(0).max(5).optional(),
  // Optional for the same reason; only written when true (ADR-0031, finding 33).
  medidasDelCliente: z.literal(true).optional(),
  // Solo en los planes del motor 3D (REQ-007): huella del navegador que los pidió.
  navegador: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  // Solo en los planes del motor 3D (P-045): la hora del primer plan de la línea, heredada al volver a firmar.
  origenEn: z.number().int().positive().optional(),
}).strict();

const PayloadSchema = z.union([PayloadV2Schema, PayloadV1Schema]);

type Payload = z.infer<typeof PayloadSchema>;

export function secretoDeFirmas(): string {
  const value = process.env.PLAN_APPROVAL_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (value?.trim()) return value;
  if (process.env.NODE_ENV === "production") throw new Error("PLAN_APPROVAL_SECRET is required in production.");
  return "local-development-plan-approval-secret";
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function signature(payload: string): string {
  return createHmac("sha256", secretoDeFirmas()).update(payload).digest("base64url");
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
      creatividad: payload.creatividad ?? null,
      medidasDelCliente: payload.medidasDelCliente === true,
      navegador: payload.navegador ?? null,
      origenEn: payload.origenEn ?? payload.expiresAt - TTL_POR_DEFECTO_MS,
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
    creatividad: null,
    medidasDelCliente: false,
    navegador: null,
    origenEn: payload.expiresAt - TTL_POR_DEFECTO_MS,
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
    /** Level the chat designed the plan with; omitted by callers that do not know it. */
    creatividad?: number;
    /** The customer gave the pieces' measures (ADR-0031, finding 33); omitted when not. */
    medidasDelCliente?: boolean;
    /** Huella del navegador (solo planes del motor 3D). */
    navegador?: string;
    /** La hora del primer plan de la línea (solo planes del motor 3D): la de su plan base, o ahora si es nuevo. */
    origenEn?: number;
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
    ...(input.creatividad === undefined ? {} : { creatividad: input.creatividad }),
    ...(input.medidasDelCliente === true ? { medidasDelCliente: true as const } : {}),
    ...(input.navegador ? { navegador: input.navegador } : {}),
    ...(input.origenEn === undefined ? {} : { origenEn: input.origenEn }),
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

/**
 * Desarrollo: deja de exigir que la huella del plan coincida con la que el
 * cliente aprobó. Mismo patrón que `FLUX_ALLOW_REJECTED_FOR_TESTING`
 * (resolución anterior de modo LoRA): **falla cerrado en producción**, porque
 * `NODE_ENV` no es "development" allí.
 *
 * Por qué existe: cualquier cambio en el reparto de color mueve `plan_hash`, y
 * entonces toda propuesta aprobada antes del cambio deja de generar. Mientras se
 * itera sobre el patrón de color eso obliga a reaprobar en cada recarga, sin que
 * aporte nada.
 *
 * Qué NO abre: el token sigue siendo obligatorio, porque transporta la allowlist
 * y el snapshot de catálogo con los que se re-resuelve el plan. Siguen vivas la
 * puerta de presupuesto, la de cobertura y la de la estimación de materiales.
 * Lo único que se deja de exigir es que la huella sea la misma.
 *
 * Condición de retirada: cuando el reparto de color se estabilice y deje de
 * mover `plan_hash` en cada iteración.
 */
export function aprobacionSinHuellaEnPruebas(): boolean {
  return process.env.NODE_ENV === "development" && process.env.APROBACION_SIN_HUELLA_PARA_PRUEBAS === "true";
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
