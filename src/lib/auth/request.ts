import "server-only";

import { SESSION_COOKIE, loginOmitidoEnDesarrollo, sessionToken } from "./session";

function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Guardia de servidor para Route Handlers; Proxy sigue siendo una primera barrera. */
export function isAuthenticatedRequest(request: Request): boolean {
  if (loginOmitidoEnDesarrollo()) return true;
  const expected = process.env.APP_PASSWORD;
  // Desarrollo sin secreto sigue siendo explícitamente permisivo; producción
  // falla cerrado para que un despliegue incompleto no exponga mutaciones.
  if (!expected) return process.env.NODE_ENV !== "production";
  return cookieValue(request, SESSION_COOKIE) === sessionToken(expected);
}

const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Los orígenes públicos de la app (`APP_ORIGINS`, separados por coma): los que un proxy inverso deja distintos de la URL interna del pedido. */
function origenesPermitidos(): Set<string> {
  const lista = new Set<string>();
  for (const crudo of (process.env.APP_ORIGINS ?? "").split(",")) {
    try { if (crudo.trim()) lista.add(new URL(crudo.trim()).origin); } catch { /* una entrada mal escrita no abre nada */ }
  }
  return lista;
}

/**
 * Comprueba Origin cuando el navegador lo envía, para proteger mutaciones contra CSRF. Vale el origen de la URL del pedido,
 * los de `APP_ORIGINS` (detrás de un proxy la URL del pedido es la interna) y, solo fuera de producción, localhost y
 * 127.0.0.1 con cualquier puerto (Next arma la URL con «localhost» aunque se abra por 127.0.0.1). La cabecera `Host` no se
 * usa: quien manda el pedido puede ponerle cualquiera.
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const url = new URL(origin);
    if (url.origin === new URL(request.url).origin) return true;
    if (origenesPermitidos().has(url.origin)) return true;
    return process.env.NODE_ENV !== "production" && HOSTS_LOCALES.has(url.hostname);
  } catch {
    return false;
  }
}
