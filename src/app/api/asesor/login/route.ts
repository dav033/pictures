import { NextResponse } from "next/server";
import { ASESOR_SESSION_COOKIE, advisorCookieOptions, authenticateAdvisor, createAdvisorSessionToken } from "@/lib/asesor/auth";
import { isSameOriginRequest } from "@/lib/auth/request";

function redirectToLogin(request: Request, failed: boolean): NextResponse {
  const url = new URL("/asesor/login", request.url);
  if (failed) url.searchParams.set("error", "1");
  return NextResponse.redirect(url, 303);
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
    return isJson ? NextResponse.json({ code: "INVALID_CREDENTIALS" }, { status: 401 }) : redirectToLogin(request, true);
  }

  const role = await authenticateAdvisor(username, password);
  const token = role ? createAdvisorSessionToken(role) : null;
  if (!role || !token) {
    return isJson ? NextResponse.json({ code: "INVALID_CREDENTIALS" }, { status: 401 }) : redirectToLogin(request, true);
  }

  if (!isJson) {
    const response = NextResponse.redirect(new URL("/asesor", request.url), 303);
    response.cookies.set(ASESOR_SESSION_COOKIE, token, advisorCookieOptions());
    return response;
  }
  const response = NextResponse.json({ ok: true, role });
  response.cookies.set(ASESOR_SESSION_COOKIE, token, advisorCookieOptions());
  return response;
}
