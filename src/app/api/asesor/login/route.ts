import { NextResponse } from "next/server";
import { ASESOR_SESSION_COOKIE, advisorCookieOptions, authenticateAdvisor, createAdvisorSessionToken } from "@/lib/asesor/auth";
import { isSameOriginRequest } from "@/lib/auth/request";
import { versionCodigo } from "@/lib/registro/version";

/** Public release identity for coordinator checks; no settings or credentials are exposed. */
export async function GET() {
  const version = versionCodigo();
  const headers = { "Cache-Control": "no-store" };
  if (!version.commit || version.origen === "git-local") {
    return NextResponse.json({ code: "DEPLOYMENT_IDENTITY_UNAVAILABLE" }, { status: 503, headers });
  }
  return NextResponse.json({ schema: "asesor-deployment/1", revision: version.commit }, { headers });
}

/**
 * A relative Location: behind the VPS reverse proxy `request.url` is the server's bind address (0.0.0.0:3000),
 * so an absolute URL built from it sends the browser to an unreachable host. The browser resolves this path
 * against the public origin it used.
 */
function seeOther(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

function loginFailed(): NextResponse {
  return seeOther("/asesor/login?error=1");
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ code: "INVALID_ORIGIN" }, { status: 403 });

  const isJson = request.headers.get("content-type")?.includes("application/json") ?? false;
  let username: unknown;
  let password: unknown;
  if (isJson) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ code: "INVALID_JSON" }, { status: 400 });
    }
    if (typeof body !== "object" || body === null) return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 });
    username = "username" in body ? body.username : undefined;
    password = "password" in body ? body.password : undefined;
  } else {
    const form = await request.formData();
    username = form.get("username");
    password = form.get("password");
  }
  if (typeof username !== "string" || typeof password !== "string" || password.length === 0 || password.length > 1024) {
    return isJson ? NextResponse.json({ code: "INVALID_CREDENTIALS" }, { status: 401 }) : loginFailed();
  }

  const role = await authenticateAdvisor(username, password);
  const token = role ? createAdvisorSessionToken(role) : null;
  if (!role || !token) {
    return isJson ? NextResponse.json({ code: "INVALID_CREDENTIALS" }, { status: 401 }) : loginFailed();
  }

  if (!isJson) {
    const response = seeOther("/asesor");
    response.cookies.set(ASESOR_SESSION_COOKIE, token, advisorCookieOptions());
    return response;
  }
  const response = NextResponse.json({ ok: true, role });
  response.cookies.set(ASESOR_SESSION_COOKIE, token, advisorCookieOptions());
  return response;
}
