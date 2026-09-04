import "server-only";

import { SESSION_COOKIE, sessionToken } from "./session";

function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return undefined;
}

/** Guardia de servidor para Route Handlers; Proxy sigue siendo una primera barrera. */
export function isAuthenticatedRequest(request: Request): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return true;
  return cookieValue(request, SESSION_COOKIE) === sessionToken(expected);
}

/** Comprueba Origin cuando el navegador lo envía, para proteger mutaciones contra CSRF. */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
