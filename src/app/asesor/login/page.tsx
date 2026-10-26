import { Suspense, type ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { advisorSessionFromCookies } from "@/lib/asesor/auth";
import AdvisorLoginError from "./login-error";

/**
 * The advisor has no login of its own for customers: the Demo Decoración login is the only one. This page remains for the
 * administration account that watches the conversations (`?admin=1`, or back from a failed attempt).
 */
async function LoginGate({ searchParams }: { searchParams: Promise<{ admin?: string; error?: string }> }): Promise<ReactNode> {
  await connection();
  const query = await searchParams;
  if (query.admin !== "1" && query.error === undefined) {
    const jar = await cookies();
    redirect(advisorSessionFromCookies((name) => jar.get(name)?.value) ? "/asesor" : "/login?from=/asesor");
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">Administración del asesor</h1>
      <p className="mt-2 text-sm text-muted-foreground">Acceso para ver las conversaciones de los clientes. Los clientes entran con el acceso de Demo Decoración.</p>
      <Suspense fallback={null}><AdvisorLoginError /></Suspense>
      <form action="/api/asesor/login" method="post" className="mt-6 grid gap-4">
        <input type="hidden" name="username" value="admin" />
        <label className="grid gap-2 text-sm">
          Contraseña de administración
          <input name="password" type="password" required autoComplete="current-password" className="rounded-md border bg-background px-3 py-2" />
        </label>
        <button type="submit" className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground">Entrar</button>
      </form>
    </main>
  );
}

export default function AdvisorLoginPage({ searchParams }: { searchParams: Promise<{ admin?: string; error?: string }> }) {
  return <Suspense fallback={null}><LoginGate searchParams={searchParams} /></Suspense>;
}
