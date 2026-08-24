import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_MAX_AGE, sessionToken } from "@/lib/auth/session";

export async function POST(request: Request) {
  const { password } = (await request.json()) as { password?: string };
  const expected = process.env.APP_PASSWORD;

  if (!expected || !password || password !== expected) {
    return NextResponse.json({ error: "Contraseña incorrecta" }, { status: 401 });
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, sessionToken(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });

  return NextResponse.json({ ok: true });
}
