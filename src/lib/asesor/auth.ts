import "server-only";

import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

function deriveScrypt(password: string, salt: Buffer, keyLength: number, options: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}
export const ASESOR_SESSION_COOKIE = "asesor_session";
export const ASESOR_SESSION_MAX_AGE = 60 * 60 * 12;
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const KEY_LENGTH = 64;

export type AdvisorRole = "user" | "admin";
export type AdvisorSession = { role: AdvisorRole; expiresAt: number };

function isAdvisorRole(value: unknown): value is AdvisorRole {
  return value === "user" || value === "admin";
}

function sessionSecret(): string | null {
  const secret = process.env.ASESOR_SESSION_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

export async function hashAdvisorPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveScrypt(password, salt, KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
  });
  return `scrypt$${SCRYPT_COST}$${SCRYPT_BLOCK_SIZE}$${SCRYPT_PARALLELIZATION}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

async function verifyAdvisorPassword(password: string, encoded: string | undefined): Promise<boolean> {
  if (!encoded) return false;
  const [algorithm, costText, blockText, parallelText, saltText, keyText, extra] = encoded.split("$");
  if (algorithm !== "scrypt" || !costText || !blockText || !parallelText || !saltText || !keyText || extra !== undefined) return false;
  const cost = Number(costText);
  const blockSize = Number(blockText);
  const parallelization = Number(parallelText);
  if (cost !== SCRYPT_COST || blockSize !== SCRYPT_BLOCK_SIZE || parallelization !== SCRYPT_PARALLELIZATION) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltText, "base64url");
    expected = Buffer.from(keyText, "base64url");
  } catch {
    return false;
  }
  if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
  const actual = await deriveScrypt(password, salt, expected.length, { N: cost, r: blockSize, p: parallelization });
  return timingSafeEqual(actual, expected);
}

/** Only the two explicitly provisioned advisor accounts can establish a session. */
export async function authenticateAdvisor(username: string, password: string): Promise<AdvisorRole | null> {
  if (!sessionSecret()) return null;
  const configured = new Map<AdvisorRole, string | undefined>([
    ["user", process.env.ASESOR_USER_PASSWORD_HASH],
    ["admin", process.env.ASESOR_ADMIN_PASSWORD_HASH],
  ]);
  if (!isAdvisorRole(username)) return null;
  const encoded = configured.get(username);
  return await verifyAdvisorPassword(password, encoded) ? username : null;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createAdvisorSessionToken(role: AdvisorRole, now = Date.now()): string | null {
  const secret = sessionSecret();
  if (!secret || !isAdvisorRole(role)) return null;
  const payload = Buffer.from(JSON.stringify({ role, expiresAt: now + ASESOR_SESSION_MAX_AGE * 1000 })).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function readAdvisorSessionToken(token: string | undefined, now = Date.now()): AdvisorSession | null {
  const secret = sessionSecret();
  if (!secret || !token) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expectedSignature = Buffer.from(sign(payload, secret));
  const actualSignature = Buffer.from(signature);
  if (expectedSignature.length !== actualSignature.length || !timingSafeEqual(expectedSignature, actualSignature)) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || !("role" in parsed) || !("expiresAt" in parsed)) return null;
    if (Array.isArray(parsed)) return null;
    const role = Reflect.get(parsed, "role");
    const expiresAt = Reflect.get(parsed, "expiresAt");
    if (!isAdvisorRole(role) || typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) || expiresAt <= now) return null;
    return { role, expiresAt };
  } catch {
    return null;
  }
}

export function advisorCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: ASESOR_SESSION_MAX_AGE,
    path: "/",
  };
}

export function advisorSessionFromRequest(request: Request): AdvisorSession | null {
  const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${ASESOR_SESSION_COOKIE}=`));
  const token = cookie?.slice(ASESOR_SESSION_COOKIE.length + 1);
  return readAdvisorSessionToken(token);
}

export function requireAdvisorRole(request: Request, allowedRoles: readonly AdvisorRole[] = ["user", "admin"]): AdvisorSession | NextResponse {
  const session = advisorSessionFromRequest(request);
  if (!session) return NextResponse.json({ code: "ADVISOR_UNAUTHENTICATED" }, { status: 401 });
  if (!allowedRoles.includes(session.role)) return NextResponse.json({ code: "ADVISOR_FORBIDDEN" }, { status: 403 });
  return session;
}
