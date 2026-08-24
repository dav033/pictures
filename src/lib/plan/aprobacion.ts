import { createHmac, timingSafeEqual } from "node:crypto";

type TokenPayload = {
  v: 1;
  planHash: string;
  requestId: string;
  expiresAt: number;
};

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

export function crearTokenAprobacion(planHash: string, requestId: string, ttlMs = 24 * 60 * 60 * 1000): string {
  const payload = encode(JSON.stringify({ v: 1, planHash, requestId, expiresAt: Date.now() + ttlMs } satisfies TokenPayload));
  return `${payload}.${signature(payload)}`;
}

export function verificarTokenAprobacion(token: string | undefined, planHash: string): { requestId: string; expiresAt: number } | null {
  if (!token) return null;
  const [payload, providedSignature] = token.split(".");
  if (!payload || !providedSignature) return null;
  const expected = signature(payload);
  const provided = Buffer.from(providedSignature);
  const expectedBytes = Buffer.from(expected);
  if (provided.length !== expectedBytes.length || !timingSafeEqual(provided, expectedBytes)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TokenPayload;
    if (parsed.v !== 1 || parsed.planHash !== planHash || !parsed.requestId || parsed.expiresAt < Date.now()) return null;
    return { requestId: parsed.requestId, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}
