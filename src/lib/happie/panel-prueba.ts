import { isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";

/**
 * Kill switch of the /happie/prueba panel and its routes: on by default (beta, see D-039), off with
 * `HAPPIE_PANEL_PRUEBA=0` without touching code.
 */
export function panelPruebaActivo(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HAPPIE_PANEL_PRUEBA !== "0";
}

/** A 401/403 response when the caller may not use the panel's routes, `null` when it may. */
export function rechazoDePanel(request: Request, { mutacion }: { mutacion: boolean }): Response | null {
  if (!isAuthenticatedRequest(request)) return Response.json({ error: "Sesión requerida." }, { status: 401 });
  if (mutacion && !isSameOriginRequest(request)) return Response.json({ error: "Origen no permitido." }, { status: 403 });
  return null;
}

/**
 * Rate-limit scope of a session caller: its IP. Every user shares one app password (one session token), so a
 * per-session scope would be a single bucket for everybody; the IP keeps users apart. `x-api-key` plays no part.
 */
export function ambitoDeSesion(request: Request): string {
  const reenviada = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `ip:${(reenviada || request.headers.get("x-real-ip")?.trim() || "desconocida").slice(0, 64)}`;
}
