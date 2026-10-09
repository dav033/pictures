import { createHash } from "node:crypto";
import { cookieValue } from "@/lib/auth/request";
import { SESSION_COOKIE } from "@/lib/auth/session";

/** Huella (16 hex) de la cookie de sesión de la petición, para anotar quién pidió un render sin guardar la cookie; `null` sin sesión. */
export function huellaDeSesion(request: Request): string | null {
  const valor = cookieValue(request, SESSION_COOKIE);
  return valor ? createHash("sha256").update(valor).digest("hex").slice(0, 16) : null;
}
