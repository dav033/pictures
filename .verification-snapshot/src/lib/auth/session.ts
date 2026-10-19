import { createHash } from "node:crypto";

export const SESSION_COOKIE = "session";

/**
 * `next dev` does not ask for the password: local work and demos run without
 * logging in. Explicit and bounded: only with NODE_ENV=development (never in
 * `next start` or production builds), and `DEV_REQUIRE_LOGIN=1` restores the
 * login to test it locally.
 */
export function loginOmitidoEnDesarrollo(): boolean {
  return process.env.NODE_ENV === "development" && process.env.DEV_REQUIRE_LOGIN !== "1";
}
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 dias

/** Token derivado de la contraseña, nunca la contraseña en texto plano en la cookie. */
export function sessionToken(password: string) {
  return createHash("sha256").update(password).digest("hex");
}
