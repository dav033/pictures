import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ValidUntilSchema } from "./contracts";
import { isNotExpired } from "./dates";

const TOKEN_SECRET_BYTES_MIN = 32;
const TOKEN_LENGTH_MAX = 256;
const PayloadSchema = z.object({
  v: z.literal(1),
  id: z.string().uuid(),
  validUntil: ValidUntilSchema,
}).strict();

export type ShareTokenPayload = z.infer<typeof PayloadSchema>;

function secretIsStrong(secret: string): boolean {
  return Buffer.byteLength(secret, "utf8") >= TOKEN_SECRET_BYTES_MIN;
}

function signatureFor(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload, "utf8").digest();
}

export function signShareToken(
  input: { id: string; validUntil: string },
  secret: string,
): string {
  if (!secretIsStrong(secret)) throw new Error("El secreto de enlaces compartidos debe tener al menos 32 bytes.");
  const payload = PayloadSchema.parse({ v: 1, ...input });
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signatureFor(encodedPayload, secret).toString("base64url");
  return `${encodedPayload}.${signature}`;
}

export function verifyShareToken(
  token: string,
  secret: string,
  now: Date,
): ShareTokenPayload | null {
  if (!secretIsStrong(secret) || token.length > TOKEN_LENGTH_MAX) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null;

  const [encodedPayload, encodedSignature] = parts;
  const receivedSignature = Buffer.from(encodedSignature, "base64url");
  if (receivedSignature.toString("base64url") !== encodedSignature) return null;
  const expectedSignature = signatureFor(encodedPayload, secret);
  if (receivedSignature.length !== expectedSignature.length || !timingSafeEqual(receivedSignature, expectedSignature)) return null;

  const bytes = Buffer.from(encodedPayload, "base64url");
  if (bytes.toString("base64url") !== encodedPayload) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    return null;
  }

  const parsed = PayloadSchema.safeParse(decoded);
  if (!parsed.success || !isNotExpired(parsed.data.validUntil, now)) return null;
  return parsed.data;
}
