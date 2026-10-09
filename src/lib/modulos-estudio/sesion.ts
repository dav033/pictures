import { createHash } from "node:crypto";
import { SESSION_COOKIE } from "@/lib/auth/session";

/** Huella (16 hex) de la cookie de sesión de la petición, para anotar quién pidió un render sin guardar la cookie; `null` sin sesión. */
export function huellaDeSesion(request: Request): string | null {
  const galleta = request.headers.get("cookie")?.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  const valor = galleta?.slice(SESSION_COOKIE.length + 1);
  return valor ? createHash("sha256").update(valor).digest("hex").slice(0, 16) : null;
}
