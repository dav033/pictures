import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ASESOR_SESSION_COOKIE, readAdvisorSessionToken } from "@/lib/asesor/auth";
import { SESSION_COOKIE, loginOmitidoEnDesarrollo, sessionToken } from "@/lib/auth/session";
import { isPublicSharedQuotePath } from "@/lib/auth/shared-quote-public-path";

export function proxy(request: NextRequest) {
  if (isPublicSharedQuotePath(request.nextUrl.pathname)) return NextResponse.next();
  const path = request.nextUrl.pathname;
  if (path === "/asesor/admin" || path.startsWith("/asesor/admin/")) {
    const token = request.cookies.get(ASESOR_SESSION_COOKIE)?.value;
    const session = readAdvisorSessionToken(token);
    if (!session) return NextResponse.redirect(new URL("/asesor/login", request.url));
    if (session.role !== "admin") return NextResponse.json({ code: "ADVISOR_FORBIDDEN" }, { status: 403 });
    return NextResponse.next();
  }
  if (path === "/asesor" || path.startsWith("/asesor/") || path === "/api/asesor" || path.startsWith("/api/asesor/")) {
    return NextResponse.next();
  }
  if (loginOmitidoEnDesarrollo()) return NextResponse.next();
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json(
        { code: "AUTH_NOT_CONFIGURED", message: "La autenticación del servicio no está configurada." },
        { status: 503 },
      );
    }
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "auth-config");
    return NextResponse.redirect(url);
  }

  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (cookie === sessionToken(expected)) {
    return NextResponse.next();
  }

  const url = new URL("/login", request.url);
  url.searchParams.set("from", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Shopify es server-to-server: no trae cookie y usa su propia autenticación HMAC. El cron del análisis de feedback
  // tampoco trae cookie: su ruta exige `Authorization: Bearer CRON_SECRET` y sin el secreto responde 401.
  matcher: [
    "/((?!api/login|api/happie/recommend-packages|api/happie/recommend-package|api/happie/webhook|api/rag/webhooks/shopify|api/feedback-ia/analisis-cron|api/voz/transcribir(?:/|$)|api/asesor(?:/(?!admin(?:/|$))|$)|asesor(?:/(?!admin(?:/|$))|$)|login|_next/static|_next/image|favicon.ico).*)",
  ],
};
