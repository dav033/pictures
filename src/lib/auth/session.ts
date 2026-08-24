import { createHash } from "node:crypto";

export const SESSION_COOKIE = "session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 dias

/** Token derivado de la contraseña, nunca la contraseña en texto plano en la cookie. */
export function sessionToken(password: string) {
  return createHash("sha256").update(password).digest("hex");
}
