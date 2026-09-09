import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE, sessionToken } from "@/lib/auth/session";
import { compararEnTiempoConstante } from "@/lib/seguridad/comparar-constante";

/**
 * Redirección con `Location` RELATIVO.
 *
 * `NextResponse.redirect()` exige una URL absoluta, y construirla con
 * `new URL(destino, request.url)` clava el host que ve el server, no el de la petición:
 * entrando desde otra máquina de la red a `http://192.168.72.101:3001`, el login respondía
 * `Location: http://localhost:3001/...` y el navegador del visitante terminaba buscando SU
 * propio localhost. Un `Location` relativo lo resuelve el navegador contra la URL pedida
 * (RFC 9110 §10.2.2), así que funciona igual desde localhost, desde la IP de red o detrás de
 * un túnel, y sin tener que confiar en el header `Host`.
 */
function redireccionRelativa(destino: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: destino } });
}

export async function POST(request: Request) {
  const isJsonRequest = request.headers.get("content-type")?.includes("application/json") ?? false;
  let password: string | undefined;
  let from = "/";

  if (isJsonRequest) {
    const body = (await request.json()) as { password?: string };
    password = body.password;
  } else {
    const formData = await request.formData();
    const passwordValue = formData.get("password");
    const fromValue = formData.get("from");
    password = typeof passwordValue === "string" ? passwordValue : undefined;
    from = typeof fromValue === "string" ? fromValue : "/";
  }

  const expected = process.env.APP_PASSWORD;
  const safeFrom = from.startsWith("/") && !from.startsWith("//") ? from : "/";

  if (!expected || !password || !compararEnTiempoConstante(password, expected)) {
    if (!isJsonRequest) {
      const parametros = new URLSearchParams({ from: safeFrom, error: "1" });
      return redireccionRelativa(`/login?${parametros.toString()}`);
    }

    return NextResponse.json({ error: "Contraseña incorrecta" }, { status: 401 });
  }

  const cookie = {
    name: SESSION_COOKIE,
    value: sessionToken(expected),
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      maxAge: SESSION_MAX_AGE,
      path: "/",
    },
  };

  if (!isJsonRequest) {
    const response = redireccionRelativa(safeFrom);
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
